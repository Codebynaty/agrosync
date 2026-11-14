import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assinaturaValida } from './adapters/pix.js';
import { exec, todos, um } from './db.js';
import { CULTURAS } from './domain/culturas.js';
import { ROTULO_PEDIDO } from './domain/estados.js';
import { interpretarColheita } from './domain/linguagem.js';
import { dataLocal, somarDias } from './domain/tempo.js';
import { solicitarCodigo, verificarCodigo } from './services/auth.js';
import { registrarBloqueio } from './services/bloqueios.js';
import { normalizarTelefone, responderBot } from './services/bot.js';
import { ErroApp, naoEncontrado, proibido, type Contexto } from './services/contexto.js';
import {
  aceitarCarga,
  agrupar,
  cancelarCarga,
  cancelarPedido,
  checkin,
  criarPedido,
  entregarCarga,
  freteIndividual,
} from './services/fretes.js';
import { executarJobs } from './services/jobs.js';
import { painelCooperativa, painelProdutor } from './services/painel.js';
import { processarWebhookPix } from './services/pagamentos.js';
import { criarSafra } from './services/safras.js';
import { agroScoreDoProdutor } from './services/score.js';
import { OperacaoSchema, sincronizar } from './services/sync.js';
import { notificar } from './services/alertas.js';

export type Papel = 'produtor' | 'motorista' | 'cooperativa';
type Sessao = { sub: string; papel: Papel; nome: string };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Sessao;
    user: Sessao;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const exigir =
  (...papeis: Papel[]) =>
  async (req: FastifyRequest, _rep: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new ErroApp(401, 'Sessão inválida ou expirada. Entre novamente.', 'nao_autenticado');
    }
    if (papeis.length && !papeis.includes(req.user.papel)) throw proibido();
  };

const autenticado = exigir();
const produtor = exigir('produtor');
const motorista = exigir('motorista');
const cooperativa = exigir('cooperativa');

const IdParams = z.object({ id: z.string().min(1) });

export function registrarRotas(app: FastifyInstance, ctx: Contexto) {
  const { db } = ctx;

  // ------------------------------------------------------------ públicas
  app.get('/api/health', async () => ({ ok: true, agora: ctx.agora().toISOString(), provedores: { pix: ctx.pix.nome, notificacao: ctx.notificador.nome, clima: ctx.clima.nome, cotacoes: ctx.cotacoes.nome } }));

  app.get('/api/culturas', async () => CULTURAS.map(({ sinonimos: _s, precoBaseCentavosKg: _p, ...c }) => c));
  app.get('/api/destinos', async () => todos(db, 'SELECT * FROM destinos ORDER BY nome'));
  app.get('/api/cotacoes', async () => ctx.cotacoes.cotacoes(dataLocal(ctx.agora())));

  app.post('/api/interpretar', async (req) => {
    const { texto } = z.object({ texto: z.string().min(1).max(300) }).parse(req.body);
    const r = interpretarColheita(texto);
    if (!r) return { entendido: false };
    return { entendido: true, cultura: r.cultura.id, quantidadeKg: r.quantidadeKg, texto: r.entendido, perecivel: r.cultura.perecivel };
  });

  // ------------------------------------------------------------ auth
  app.post('/api/auth/codigo', async (req) => {
    const { telefone } = z.object({ telefone: z.string().min(8) }).parse(req.body);
    return solicitarCodigo(ctx, telefone);
  });

  app.post('/api/auth/entrar', async (req) => {
    const { telefone, codigo } = z.object({ telefone: z.string().min(8), codigo: z.string().min(4).max(8) }).parse(req.body);
    const u = verificarCodigo(ctx, telefone, codigo);
    const token = app.jwt.sign({ sub: u.id, papel: u.papel, nome: u.nome }, { expiresIn: '30d' });
    return { token, usuario: u };
  });

  app.get('/api/me', { preHandler: autenticado }, async (req) => {
    const u = um(db, 'SELECT id, nome, telefone, papel, canal_preferido FROM usuarios WHERE id = ?', req.user.sub);
    if (!u) throw naoEncontrado('Usuário');
    return u;
  });

  app.patch('/api/me', { preHandler: autenticado }, async (req) => {
    const { canalPreferido } = z.object({ canalPreferido: z.enum(['sms', 'whatsapp', 'push']) }).parse(req.body);
    exec(db, 'UPDATE usuarios SET canal_preferido = ? WHERE id = ?', canalPreferido, req.user.sub);
    return um(db, 'SELECT id, nome, telefone, papel, canal_preferido FROM usuarios WHERE id = ?', req.user.sub);
  });

  // ------------------------------------------------------------ produtor
  app.get('/api/propriedades', { preHandler: produtor }, async (req) =>
    todos(db, 'SELECT id, nome, municipio, lat, lng, chave_dispositivo FROM propriedades WHERE produtor_id = ? ORDER BY criado_em', req.user.sub),
  );

  app.get('/api/propriedades/:id/leituras', { preHandler: produtor }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const p = um<{ produtor_id: string }>(db, 'SELECT produtor_id FROM propriedades WHERE id = ?', id);
    if (!p) throw naoEncontrado('Propriedade');
    if (p.produtor_id !== req.user.sub) throw proibido();
    return todos(db, 'SELECT tipo, valor, medido_em FROM leituras_sensor WHERE propriedade_id = ? ORDER BY medido_em DESC LIMIT 48', id);
  });

  app.get('/api/safras', { preHandler: produtor }, async (req) =>
    todos(
      db,
      `SELECT s.*, (SELECT p.id FROM pedidos p WHERE p.safra_id = s.id AND p.status <> 'cancelado') AS pedido_id
         FROM safras s WHERE s.produtor_id = ? ORDER BY s.criado_em DESC LIMIT 100`,
      req.user.sub,
    ),
  );

  app.post('/api/safras', { preHandler: produtor }, async (req, rep) => {
    const d = z
      .object({
        id: z.string().uuid().optional(),
        propriedadeId: z.string().optional(),
        cultura: z.string(),
        quantidadeKg: z.number().int().positive(),
        perecivel: z.boolean().optional(),
        origem: z.enum(['app', 'voz']).optional(),
      })
      .parse(req.body);
    const r = criarSafra(ctx, req.user.sub, d);
    rep.code(r.criada ? 201 : 200);
    return r.safra;
  });

  app.post('/api/sync', { preHandler: produtor }, async (req) => {
    const { operacoes } = z.object({ operacoes: z.array(OperacaoSchema).max(200) }).parse(req.body);
    return { resultados: await sincronizar(ctx, req.user.sub, operacoes) };
  });

  const consultaPedidos = `
    SELECT p.*, d.nome AS destino_nome, pr.nome AS propriedade_nome, pr.municipio,
           r.valor_centavos AS rateio_centavos, r.custo_individual_centavos,
           pg.txid, pg.status AS pagamento_status, pg.copia_e_cola,
           c.status AS carga_status, c.data_coleta, u.nome AS motorista_nome,
           (SELECT COUNT(*) FROM pedidos o WHERE o.carga_id = p.carga_id) AS pedidos_na_carga
      FROM pedidos p
      JOIN destinos d ON d.id = p.destino_id
      JOIN propriedades pr ON pr.id = p.propriedade_id
      LEFT JOIN rateios r ON r.pedido_id = p.id AND r.ativo = 1
      LEFT JOIN pagamentos pg ON pg.rateio_id = r.id
      LEFT JOIN cargas c ON c.id = p.carga_id
      LEFT JOIN usuarios u ON u.id = c.motorista_id`;

  const comRotulo = (rows: { status: keyof typeof ROTULO_PEDIDO }[]) => rows.map((r) => ({ ...r, status_rotulo: ROTULO_PEDIDO[r.status] }));

  app.get('/api/pedidos', { preHandler: exigir('produtor', 'cooperativa') }, async (req) => {
    const rows =
      req.user.papel === 'produtor'
        ? todos<{ status: keyof typeof ROTULO_PEDIDO }>(db, `${consultaPedidos} WHERE p.produtor_id = ? ORDER BY p.criado_em DESC LIMIT 100`, req.user.sub)
        : todos<{ status: keyof typeof ROTULO_PEDIDO }>(db, `${consultaPedidos} ORDER BY p.criado_em DESC LIMIT 300`);
    return comRotulo(rows);
  });

  app.post('/api/pedidos', { preHandler: produtor }, async (req, rep) => {
    const d = z
      .object({ id: z.string().uuid().optional(), safraId: z.string(), destinoId: z.string().optional(), dataDesejada: z.string().optional() })
      .parse(req.body);
    const r = await criarPedido(ctx, req.user.sub, d);
    rep.code(r.criado ? 201 : 200);
    return comRotulo(todos(db, `${consultaPedidos} WHERE p.id = ?`, r.pedido.id))[0];
  });

  app.post('/api/pedidos/:id/cancelar', { preHandler: produtor }, async (req) => {
    const { id } = IdParams.parse(req.params);
    await cancelarPedido(ctx, req.user.sub, id);
    return { ok: true };
  });

  app.post('/api/pedidos/:id/frete-individual', { preHandler: produtor }, async (req) => {
    const { id } = IdParams.parse(req.params);
    return { cargaId: await freteIndividual(ctx, req.user.sub, id) };
  });

  app.post('/api/pedidos/:id/nova-data', { preHandler: produtor }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const { dataDesejada } = z.object({ dataDesejada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body);
    const p = um<{ produtor_id: string; status: string }>(db, 'SELECT produtor_id, status FROM pedidos WHERE id = ?', id);
    if (!p) throw naoEncontrado('Pedido');
    if (p.produtor_id !== req.user.sub) throw proibido();
    if (p.status !== 'expirado') throw new ErroApp(409, 'Só pedidos expirados podem mudar de data.');
    const hoje = dataLocal(ctx.agora());
    if (dataDesejada < hoje || dataDesejada > somarDias(hoje, 30)) throw new ErroApp(400, 'Data deve estar nos próximos 30 dias.');
    exec(db, "UPDATE pedidos SET data_desejada = ?, criado_em = ?, status = 'solicitado', atualizado_em = ? WHERE id = ? AND status = 'expirado'", dataDesejada, ctx.agora().toISOString(), ctx.agora().toISOString(), id);
    exec(db, "INSERT INTO auditoria (entidade, entidade_id, de, para, origem, em) VALUES ('pedido', ?, 'expirado', 'solicitado', 'produtor:nova-data', ?)", id, ctx.agora().toISOString());
    if (ctx.config.autoAgrupar) await agrupar(ctx, 'auto:nova-data');
    return comRotulo(todos(db, `${consultaPedidos} WHERE p.id = ?`, id))[0];
  });

  app.post('/api/pix-sandbox/pagar/:txid', { preHandler: produtor }, async (req) => {
    const { txid } = z.object({ txid: z.string() }).parse(req.params);
    const { duplicar } = z.object({ duplicar: z.boolean().optional() }).parse(req.body ?? {});
    const pg = um<{ valor_centavos: number; produtor_id: string; status: string }>(
      db,
      'SELECT pg.valor_centavos, pg.status, r.produtor_id FROM pagamentos pg JOIN rateios r ON r.id = pg.rateio_id WHERE pg.txid = ?',
      txid,
    );
    if (!pg) throw naoEncontrado('Cobrança');
    if (pg.produtor_id !== req.user.sub) throw proibido();
    if (!ctx.pix.simularPagamento) throw new ErroApp(400, 'Provedor Pix real: pague pelo app do banco.');
    const evento = await ctx.pix.simularPagamento(txid, pg.valor_centavos, { duplicar });
    const eventos = todos(db, 'SELECT event_id, resultado, recebido_em FROM webhook_eventos WHERE event_id = ?', evento.id);
    return { evento, processamento: eventos, entregas: duplicar ? 2 : 1 };
  });

  app.get('/api/agroscore', { preHandler: produtor }, async (req) => agroScoreDoProdutor(ctx, req.user.sub));

  app.get('/api/painel/produtor', { preHandler: produtor }, async (req) => painelProdutor(ctx, req.user.sub));

  app.get('/api/clima', { preHandler: autenticado }, async (req) => {
    const q = z.object({ lat: z.coerce.number(), lng: z.coerce.number(), dias: z.coerce.number().int().min(1).max(7).default(3) }).parse(req.query);
    const hoje = dataLocal(ctx.agora());
    return Promise.all(Array.from({ length: q.dias }, (_, i) => ctx.clima.previsao(q, somarDias(hoje, i))));
  });

  // ------------------------------------------------------------ alertas
  app.get('/api/alertas', { preHandler: autenticado }, async (req) =>
    todos(db, 'SELECT id, tipo, canal, titulo, mensagem, lido, criado_em FROM alertas WHERE usuario_id = ? ORDER BY criado_em DESC LIMIT 100', req.user.sub),
  );
  app.post('/api/alertas/:id/lido', { preHandler: autenticado }, async (req) => {
    const { id } = IdParams.parse(req.params);
    exec(db, 'UPDATE alertas SET lido = 1 WHERE id = ? AND usuario_id = ?', id, req.user.sub);
    return { ok: true };
  });
  app.post('/api/alertas/lidos', { preHandler: autenticado }, async (req) => {
    exec(db, 'UPDATE alertas SET lido = 1 WHERE usuario_id = ?', req.user.sub);
    return { ok: true };
  });

  // ------------------------------------------------------------ cargas
  const detalheCarga = (id: string) => {
    const c = um<Record<string, unknown> & { rota_json: string }>(
      db,
      `SELECT c.*, d.nome AS destino_nome, d.municipio AS destino_municipio, d.lat AS destino_lat, d.lng AS destino_lng, u.nome AS motorista_nome
         FROM cargas c JOIN destinos d ON d.id = c.destino_id LEFT JOIN usuarios u ON u.id = c.motorista_id WHERE c.id = ?`,
      id,
    );
    if (!c) throw naoEncontrado('Carga');
    const status = Object.fromEntries(
      todos<{ id: string; status: string }>(db, 'SELECT id, status FROM pedidos WHERE carga_id = ?', id).map((p) => [p.id, p.status]),
    );
    const { rota_json, ...resto } = c;
    const paradas = (JSON.parse(rota_json) as { pedidoId: string }[]).map((p) => ({ ...p, status: status[p.pedidoId] ?? 'removido' }));
    return { ...resto, paradas };
  };

  app.get('/api/cargas', { preHandler: exigir('motorista', 'cooperativa') }, async (req) => {
    const base = `SELECT c.id, c.status, c.data_coleta, c.volume_kg, c.distancia_m, c.custo_total_centavos, c.custo_individual_total_centavos,
                         c.motorista_id, d.nome AS destino_nome, u.nome AS motorista_nome,
                         (SELECT COUNT(*) FROM pedidos p WHERE p.carga_id = c.id) AS paradas
                    FROM cargas c JOIN destinos d ON d.id = c.destino_id LEFT JOIN usuarios u ON u.id = c.motorista_id`;
    return req.user.papel === 'motorista'
      ? todos(db, `${base} WHERE c.status = 'aberta' OR c.motorista_id = ? ORDER BY c.data_coleta, c.criado_em`, req.user.sub)
      : todos(db, `${base} ORDER BY c.criado_em DESC LIMIT 200`);
  });

  app.get('/api/cargas/:id', { preHandler: exigir('motorista', 'cooperativa') }, async (req) => detalheCarga(IdParams.parse(req.params).id));

  app.post('/api/cargas/:id/aceitar', { preHandler: motorista }, async (req) => {
    const { id } = IdParams.parse(req.params);
    await aceitarCarga(ctx, req.user.sub, id);
    return detalheCarga(id);
  });

  app.post('/api/cargas/:id/checkin', { preHandler: motorista }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const { codigo } = z.object({ codigo: z.string().min(4).max(64) }).parse(req.body);
    await checkin(ctx, req.user.sub, id, codigo);
    return detalheCarga(id);
  });

  app.post('/api/cargas/:id/entregar', { preHandler: motorista }, async (req) => {
    const { id } = IdParams.parse(req.params);
    await entregarCarga(ctx, req.user.sub, id);
    return detalheCarga(id);
  });

  app.post('/api/cargas/:id/cancelar', { preHandler: cooperativa }, async (req) => {
    const { id } = IdParams.parse(req.params);
    await cancelarCarga(ctx, id);
    return { ok: true };
  });

  // ------------------------------------------------------------ cooperativa
  app.post('/api/agrupamento', { preHandler: cooperativa }, async () => agrupar(ctx, 'cooperativa:manual'));
  app.post('/api/jobs/executar', { preHandler: cooperativa }, async () => executarJobs(ctx));
  app.get('/api/painel/cooperativa', { preHandler: cooperativa }, async () => painelCooperativa(ctx));

  app.get('/api/produtores', { preHandler: cooperativa }, async () =>
    todos(
      db,
      `SELECT u.id, u.nome, u.telefone, u.canal_preferido, pr.municipio,
              (SELECT COUNT(*) FROM pedidos p WHERE p.produtor_id = u.id AND p.status = 'pago') AS entregas
         FROM usuarios u LEFT JOIN propriedades pr ON pr.produtor_id = u.id
        WHERE u.papel = 'produtor' GROUP BY u.id ORDER BY u.nome`,
    ),
  );

  app.get('/api/bloqueios', { preHandler: autenticado }, async () => todos(db, 'SELECT * FROM bloqueios WHERE ativo = 1 ORDER BY criado_em DESC'));
  app.post('/api/bloqueios', { preHandler: cooperativa }, async (req) => {
    const d = z
      .object({ descricao: z.string().min(3).max(200), lat: z.number().min(-34).max(6), lng: z.number().min(-74).max(-28), raioKm: z.number().positive().max(50).default(2) })
      .parse(req.body);
    return registrarBloqueio(ctx, d);
  });
  app.post('/api/bloqueios/:id/encerrar', { preHandler: cooperativa }, async (req) => {
    exec(db, 'UPDATE bloqueios SET ativo = 0 WHERE id = ?', IdParams.parse(req.params).id);
    return { ok: true };
  });

  app.get('/api/auditoria', { preHandler: cooperativa }, async () => todos(db, 'SELECT * FROM auditoria ORDER BY id DESC LIMIT 200'));
  app.get('/api/webhooks/eventos', { preHandler: cooperativa }, async () => todos(db, 'SELECT event_id, tipo, resultado, recebido_em FROM webhook_eventos ORDER BY recebido_em DESC LIMIT 100'));

  // ------------------------------------------------------------ integrações
  app.post('/api/webhooks/pix', async (req, rep) => {
    const assinatura = req.headers['x-assinatura'];
    if (!assinaturaValida(req.rawBody ?? '', typeof assinatura === 'string' ? assinatura : undefined, ctx.config.pixWebhookSecret)) {
      return rep.code(401).send({ erro: 'Assinatura inválida.' });
    }
    const resultado = await processarWebhookPix(ctx, req.body);
    return { recebido: true, resultado };
  });

  app.post('/api/bot/mensagem', async (req) => {
    const { telefone, texto } = z.object({ telefone: z.string().min(8), texto: z.string().max(500) }).parse(req.body);
    return { resposta: await responderBot(ctx, telefone, texto) };
  });

  /** Ingestão de sensores IoT (gateway LoRaWAN). Autenticação pela chave do dispositivo. */
  app.post('/api/sensores/leituras', async (req) => {
    const chave = req.headers['x-chave-dispositivo'];
    const prop = um<{ id: string; produtor_id: string; nome: string }>(
      db,
      'SELECT id, produtor_id, nome FROM propriedades WHERE chave_dispositivo = ?',
      typeof chave === 'string' ? chave : '',
    );
    if (!prop) throw new ErroApp(401, 'Dispositivo desconhecido.', 'dispositivo');
    const { leituras } = z
      .object({ leituras: z.array(z.object({ tipo: z.enum(['umidade_solo', 'temperatura', 'chuva_mm']), valor: z.number(), medidoEm: z.string().optional() })).min(1).max(100) })
      .parse(req.body);
    for (const l of leituras) {
      exec(db, 'INSERT INTO leituras_sensor (propriedade_id, tipo, valor, medido_em) VALUES (?, ?, ?, ?)', prop.id, l.tipo, l.valor, l.medidoEm ?? ctx.agora().toISOString());
      if (l.tipo === 'umidade_solo' && l.valor < 20) {
        await notificar(ctx, prop.produtor_id, {
          tipo: 'sensor',
          titulo: 'Solo seco',
          mensagem: `Umidade do solo em ${prop.nome}: ${l.valor.toFixed(0)}%. Considere irrigar.`,
          chave: `sensor:${prop.id}:seco:${dataLocal(ctx.agora())}`,
        });
      }
    }
    return { recebidas: leituras.length };
  });

  app.get('/api/dev/caixa-saida', async (_req, rep) => {
    const n = ctx.notificador as { caixaSaida?: unknown[] };
    if (!n.caixaSaida) return rep.code(404).send({ erro: 'Notificador real em uso.' });
    return n.caixaSaida.slice(-50).reverse();
  });

  app.get('/api/dev/usuarios-demo', async (_req, rep) => {
    if (!ctx.config.otpEcho) return rep.code(404).send({ erro: 'Indisponível.' });
    return todos(db, 'SELECT nome, telefone, papel FROM usuarios ORDER BY papel, nome');
  });

  app.get('/api/telefone/normalizar', async (req) => ({ telefone: normalizarTelefone(z.object({ t: z.string() }).parse(req.query).t) }));
}
