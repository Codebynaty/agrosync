import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { assinar } from '../src/adapters/pix.js';
import { criarApp } from '../src/app.js';
import { abrirBanco, todos, um } from '../src/db.js';
import type { Contexto } from '../src/services/contexto.js';
import { popular } from '../src/seed.js';

const AGORA = new Date('2026-11-14T10:00:00-03:00');
const AMANHA = '2026-11-15';

let app: FastifyInstance;
let ctx: Contexto;

async function novoApp(opcoes: { autoAgrupar?: boolean } = {}) {
  const r = await criarApp({
    db: abrirBanco(':memory:'),
    agora: () => AGORA,
    config: { autoAgrupar: opcoes.autoAgrupar ?? false, webDist: '/nao-existe', otpEcho: true },
  });
  app = r.app;
  ctx = r.ctx;
  const db = ctx.db;
  db.exec(`
    INSERT INTO destinos VALUES ('ceagesp','CEAGESP','São Paulo',-23.5367,-46.7296);
    INSERT INTO usuarios VALUES ('u1','Ana','5511900000001','produtor','sms','2026-01-01');
    INSERT INTO usuarios VALUES ('u2','Beto','5511900000002','produtor','sms','2026-01-01');
    INSERT INTO usuarios VALUES ('u3','Caio','5511900000003','produtor','sms','2026-01-01');
    INSERT INTO usuarios VALUES ('m1','João','5511900000011','motorista','sms','2026-01-01');
    INSERT INTO usuarios VALUES ('m2','Marcos','5511900000012','motorista','sms','2026-01-01');
    INSERT INTO usuarios VALUES ('c1','Coop','5511900000021','cooperativa','sms','2026-01-01');
    INSERT INTO propriedades VALUES ('p1','u1','Sítio A','Ibiúna',-23.6712,-47.2391,'chave-p1','2026-01-01');
    INSERT INTO propriedades VALUES ('p2','u2','Sítio B','Ibiúna',-23.6301,-47.2610,'chave-p2','2026-01-01');
    INSERT INTO propriedades VALUES ('p3','u3','Sítio C','Piedade',-23.7010,-47.3980,'chave-p3','2026-01-01');
  `);
}

async function login(telefone: string): Promise<string> {
  const c = await app.inject({ method: 'POST', url: '/api/auth/codigo', payload: { telefone } });
  const { codigoDev } = c.json();
  const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { telefone, codigo: codigoDev } });
  return r.json().token;
}

const req = (token: string) => ({
  post: (url: string, payload?: unknown) =>
    app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) }),
  get: (url: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }),
});

async function colheitaComPedido(token: string, cultura = 'tomate', kg = 500) {
  const s = await req(token).post('/api/safras', { cultura, quantidadeKg: kg });
  const p = await req(token).post('/api/pedidos', { safraId: s.json().id, destinoId: 'ceagesp', dataDesejada: AMANHA });
  return p.json();
}

/** Monta uma carga de 3 produtores, entregue e com cobranças Pix pendentes. */
async function cargaEntregue() {
  const [t1, t2, t3, tm, tc] = await Promise.all(['5511900000001', '5511900000002', '5511900000003', '5511900000011', '5511900000021'].map(login));
  const pedidos = [await colheitaComPedido(t1), await colheitaComPedido(t2, 'alface', 300), await colheitaComPedido(t3, 'morango', 200)];
  const ag = await req(tc).post('/api/agrupamento');
  const cargaId = ag.json().cargas[0];
  await req(tm).post(`/api/cargas/${cargaId}/aceitar`);
  for (const p of pedidos) {
    const tok = um<{ qr_token: string }>(ctx.db, 'SELECT qr_token FROM pedidos WHERE id = ?', p.id)!.qr_token;
    await req(tm).post(`/api/cargas/${cargaId}/checkin`, { codigo: tok });
  }
  await req(tm).post(`/api/cargas/${cargaId}/entregar`);
  return { cargaId, pedidos, tokens: { t1, t2, t3, tm, tc } };
}

function webhook(evento: object) {
  const corpo = JSON.stringify(evento);
  return app.inject({
    method: 'POST',
    url: '/api/webhooks/pix',
    headers: { 'content-type': 'application/json', 'x-assinatura': assinar(corpo, ctx.config.pixWebhookSecret) },
    payload: corpo,
  });
}

describe('autenticação', () => {
  beforeEach(() => novoApp());

  it('entra com código e bloqueia rota de outro papel', async () => {
    const t = await login('11 90000-0001');
    expect((await req(t).get('/api/me')).json().nome).toBe('Ana');
    expect((await req(t).get('/api/cargas')).statusCode).toBe(403);
  });

  it('rejeita código errado e bloqueia após 5 tentativas', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/codigo', payload: { telefone: '5511900000001' } });
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { telefone: '5511900000001', codigo: '000000x'.slice(0, 6) } });
      expect(r.statusCode).toBe(401);
    }
    const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { telefone: '5511900000001', codigo: '123456' } });
    expect(r.statusCode).toBe(429);
  });

  it('exige token nas rotas privadas', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/safras' })).statusCode).toBe(401);
  });
});

describe('sincronização offline', () => {
  beforeEach(() => novoApp());

  it('reenviar o mesmo lote não duplica registros', async () => {
    const t = await login('5511900000001');
    const safraId = crypto.randomUUID();
    const lote = {
      operacoes: [
        { opId: crypto.randomUUID(), tipo: 'criar_safra', dados: { id: safraId, cultura: 'tomate', quantidadeKg: 300 } },
        { opId: crypto.randomUUID(), tipo: 'criar_pedido', dados: { id: crypto.randomUUID(), safraId, destinoId: 'ceagesp', dataDesejada: AMANHA } },
      ],
    };
    const r1 = (await req(t).post('/api/sync', lote)).json();
    const r2 = (await req(t).post('/api/sync', lote)).json();
    expect(r1.resultados.every((r: { ok: boolean }) => r.ok)).toBe(true);
    expect(r2.resultados.every((r: { repetida: boolean }) => r.repetida)).toBe(true);
    expect(um<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM safras')!.n).toBe(1);
    expect(um<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM pedidos')!.n).toBe(1);
  });

  it('erro em uma operação não derruba o lote', async () => {
    const t = await login('5511900000001');
    const r = await req(t).post('/api/sync', {
      operacoes: [
        { opId: crypto.randomUUID(), tipo: 'criar_safra', dados: { id: crypto.randomUUID(), cultura: 'inexistente', quantidadeKg: 300 } },
        { opId: crypto.randomUUID(), tipo: 'criar_safra', dados: { id: crypto.randomUUID(), cultura: 'alface', quantidadeKg: 100 } },
      ],
    });
    const [a, b] = r.json().resultados;
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(true);
  });

  it('não deixa pedir dois fretes para a mesma colheita', async () => {
    const t = await login('5511900000001');
    const s = (await req(t).post('/api/safras', { cultura: 'tomate', quantidadeKg: 300 })).json();
    const a = (await req(t).post('/api/pedidos', { safraId: s.id, destinoId: 'ceagesp', dataDesejada: AMANHA })).json();
    const b = (await req(t).post('/api/pedidos', { safraId: s.id, destinoId: 'ceagesp', dataDesejada: AMANHA })).json();
    expect(a.id).toBe(b.id);
  });
});

describe('fluxo do frete coletivo', () => {
  beforeEach(() => novoApp());

  it('agrupa, agenda, coleta por QR, entrega e cobra', async () => {
    const { cargaId } = await cargaEntregue();
    const carga = um<{ status: string; custo_total_centavos: number; custo_individual_total_centavos: number }>(ctx.db, 'SELECT * FROM cargas WHERE id = ?', cargaId)!;
    expect(carga.status).toBe('entregue');
    expect(carga.custo_total_centavos).toBeLessThan(carga.custo_individual_total_centavos);
    const pg = todos<{ valor_centavos: number }>(ctx.db, "SELECT valor_centavos FROM pagamentos WHERE status = 'pendente'");
    expect(pg).toHaveLength(3);
    expect(pg.reduce((s, p) => s + p.valor_centavos, 0)).toBe(carga.custo_total_centavos);
  });

  it('só um motorista consegue aceitar a mesma carga', async () => {
    const [t1, t2, tm1, tm2, tc] = await Promise.all(['5511900000001', '5511900000002', '5511900000011', '5511900000012', '5511900000021'].map(login));
    await colheitaComPedido(t1);
    await colheitaComPedido(t2);
    const cargaId = (await req(tc).post('/api/agrupamento')).json().cargas[0];
    const [a, b] = await Promise.all([req(tm1).post(`/api/cargas/${cargaId}/aceitar`), req(tm2).post(`/api/cargas/${cargaId}/aceitar`)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
  });

  it('QR de outra carga é recusado', async () => {
    const { cargaId, tokens } = await cargaEntregue();
    const r = await req(tokens.tm).post(`/api/cargas/${cargaId}/checkin`, { codigo: 'ZZZZZZZZ' });
    expect(r.statusCode).toBe(400);
  });

  it('cancelamento de um produtor replaneja a carga dos demais', async () => {
    const [t1, t2, t3, tc] = await Promise.all(['5511900000001', '5511900000002', '5511900000003', '5511900000021'].map(login));
    const p1 = await colheitaComPedido(t1);
    await colheitaComPedido(t2);
    await colheitaComPedido(t3);
    const cargaId = (await req(tc).post('/api/agrupamento')).json().cargas[0];
    await req(t1).post(`/api/pedidos/${p1.id}/cancelar`);
    expect(um<{ status: string }>(ctx.db, 'SELECT status FROM cargas WHERE id = ?', cargaId)!.status).toBe('cancelada');
    const nova = um<{ id: string; volume_kg: number }>(ctx.db, "SELECT id, volume_kg FROM cargas WHERE status = 'aberta'");
    expect(nova).toBeDefined();
    const soma = todos<{ v: number }>(ctx.db, 'SELECT valor_centavos AS v FROM rateios WHERE carga_id = ? AND ativo = 1', nova!.id).reduce((s, r) => s + r.v, 0);
    expect(soma).toBe(um<{ c: number }>(ctx.db, 'SELECT custo_total_centavos AS c FROM cargas WHERE id = ?', nova!.id)!.c);
  });

  it('produtor ausente volta para a fila e não é cobrado', async () => {
    const [t1, t2, t3, tm, tc] = await Promise.all(['5511900000001', '5511900000002', '5511900000003', '5511900000011', '5511900000021'].map(login));
    const ps = [await colheitaComPedido(t1), await colheitaComPedido(t2), await colheitaComPedido(t3)];
    const cargaId = (await req(tc).post('/api/agrupamento')).json().cargas[0];
    await req(tm).post(`/api/cargas/${cargaId}/aceitar`);
    for (const p of ps.slice(0, 2)) {
      const tok = um<{ qr_token: string }>(ctx.db, 'SELECT qr_token FROM pedidos WHERE id = ?', p.id)!.qr_token;
      await req(tm).post(`/api/cargas/${cargaId}/checkin`, { codigo: tok });
    }
    await req(tm).post(`/api/cargas/${cargaId}/entregar`);
    expect(um<{ status: string }>(ctx.db, 'SELECT status FROM pedidos WHERE id = ?', ps[2].id)!.status).toBe('solicitado');
    expect(um<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM pagamentos')!.n).toBe(2);
  });

  it('pedido novo entra numa carga aberta compatível e o rateio é refeito', async () => {
    const [t1, t2, t3, tc] = await Promise.all(['5511900000001', '5511900000002', '5511900000003', '5511900000021'].map(login));
    await colheitaComPedido(t1);
    await colheitaComPedido(t2);
    const antiga = (await req(tc).post('/api/agrupamento')).json().cargas[0];
    await colheitaComPedido(t3);
    const r = (await req(tc).post('/api/agrupamento')).json();
    expect(r.pedidosAgrupados).toBe(1);
    expect(um<{ status: string }>(ctx.db, 'SELECT status FROM cargas WHERE id = ?', antiga)!.status).toBe('cancelada');
    const nova = um<{ id: string; custo_total_centavos: number }>(ctx.db, "SELECT id, custo_total_centavos FROM cargas WHERE status = 'aberta'")!;
    const membros = todos<{ v: number }>(ctx.db, 'SELECT valor_centavos AS v FROM rateios WHERE carga_id = ? AND ativo = 1', nova.id);
    expect(membros).toHaveLength(3);
    expect(membros.reduce((s, m) => s + m.v, 0)).toBe(nova.custo_total_centavos);
  });

  it('carga já aceita por motorista não é alterada por pedido novo', async () => {
    const [t1, t2, t3, tm, tc] = await Promise.all(['5511900000001', '5511900000002', '5511900000003', '5511900000011', '5511900000021'].map(login));
    await colheitaComPedido(t1);
    await colheitaComPedido(t2);
    const cargaId = (await req(tc).post('/api/agrupamento')).json().cargas[0];
    await req(tm).post(`/api/cargas/${cargaId}/aceitar`);
    await colheitaComPedido(t3);
    await req(tc).post('/api/agrupamento');
    expect(um<{ status: string }>(ctx.db, 'SELECT status FROM cargas WHERE id = ?', cargaId)!.status).toBe('agendada');
  });

  it('pedido novo entra automaticamente numa carga quando há vizinho', async () => {
    await novoApp({ autoAgrupar: true });
    const [t1, t2] = await Promise.all(['5511900000001', '5511900000002'].map(login));
    await colheitaComPedido(t1);
    const p2 = await colheitaComPedido(t2);
    expect(p2.status).toBe('agrupado');
  });
});

describe('webhooks Pix', () => {
  beforeEach(() => novoApp());

  async function primeiraCobranca() {
    await cargaEntregue();
    return um<{ txid: string; valor_centavos: number; rateio_id: string }>(ctx.db, "SELECT txid, valor_centavos, rateio_id FROM pagamentos WHERE status = 'pendente' LIMIT 1")!;
  }

  it('webhook duplicado não confirma duas vezes', async () => {
    const c = await primeiraCobranca();
    const ev = { id: 'evt_1', tipo: 'pix.recebido', txid: c.txid, valorCentavos: c.valor_centavos, pagoEm: AGORA.toISOString() };
    expect((await webhook(ev)).json().resultado).toBe('confirmado');
    expect((await webhook(ev)).json().resultado).toBe('duplicado');
    expect(um<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM auditoria WHERE entidade = 'pedido' AND para = 'pago'")!.n).toBe(1);
  });

  it('outro evento para o mesmo pagamento é ignorado', async () => {
    const c = await primeiraCobranca();
    await webhook({ id: 'evt_a', tipo: 'pix.recebido', txid: c.txid, valorCentavos: c.valor_centavos, pagoEm: AGORA.toISOString() });
    expect((await webhook({ id: 'evt_b', tipo: 'pix.recebido', txid: c.txid, valorCentavos: c.valor_centavos, pagoEm: AGORA.toISOString() })).json().resultado).toBe('ja_confirmado');
  });

  it('valor divergente não confirma', async () => {
    const c = await primeiraCobranca();
    const r = await webhook({ id: 'evt_x', tipo: 'pix.recebido', txid: c.txid, valorCentavos: c.valor_centavos - 1, pagoEm: AGORA.toISOString() });
    expect(r.json().resultado).toBe('valor_divergente');
    expect(um<{ status: string }>(ctx.db, 'SELECT status FROM pagamentos WHERE txid = ?', c.txid)!.status).toBe('pendente');
  });

  it('assinatura inválida é rejeitada', async () => {
    const c = await primeiraCobranca();
    const r = await app.inject({
      method: 'POST',
      url: '/api/webhooks/pix',
      headers: { 'content-type': 'application/json', 'x-assinatura': 'deadbeef' },
      payload: JSON.stringify({ id: 'evt_f', tipo: 'pix.recebido', txid: c.txid, valorCentavos: c.valor_centavos, pagoEm: AGORA.toISOString() }),
    });
    expect(r.statusCode).toBe(401);
  });

  it('carga é liquidada quando todos pagam', async () => {
    const { cargaId } = await cargaEntregue();
    for (const c of todos<{ txid: string; valor_centavos: number }>(ctx.db, "SELECT txid, valor_centavos FROM pagamentos WHERE status = 'pendente'")) {
      await webhook({ id: `evt_${c.txid}`, tipo: 'pix.recebido', txid: c.txid, valorCentavos: c.valor_centavos, pagoEm: AGORA.toISOString() });
    }
    expect(um<{ status: string }>(ctx.db, 'SELECT status FROM cargas WHERE id = ?', cargaId)!.status).toBe('liquidada');
  });

  it('sandbox do app paga com webhook duplicado e o sistema ignora a repetição', async () => {
    const { tokens } = await cargaEntregue();
    const c = um<{ txid: string }>(ctx.db, "SELECT pg.txid FROM pagamentos pg JOIN rateios r ON r.id = pg.rateio_id WHERE r.produtor_id = 'u1'")!;
    const r = await req(tokens.t1).post(`/api/pix-sandbox/pagar/${c.txid}`, { duplicar: true });
    expect(r.statusCode).toBe(200);
    expect(um<{ status: string }>(ctx.db, 'SELECT status FROM pagamentos WHERE txid = ?', c.txid)!.status).toBe('confirmado');
    expect(um<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM auditoria WHERE entidade = 'pedido' AND para = 'pago'")!.n).toBe(1);
  });
});

describe('bot, sensores e alertas', () => {
  beforeEach(() => novoApp());

  it('bot registra colheita e pede frete por mensagem', async () => {
    const r1 = await app.inject({ method: 'POST', url: '/api/bot/mensagem', payload: { telefone: '11900000001', texto: 'colhi 300 kg de tomate' } });
    expect(r1.json().resposta).toContain('300 kg de tomate');
    const r2 = await app.inject({ method: 'POST', url: '/api/bot/mensagem', payload: { telefone: '11900000001', texto: 'frete' } });
    expect(r2.json().resposta).toContain('Frete pedido');
    expect(um<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM pedidos WHERE produtor_id = 'u1'")!.n).toBe(1);
  });

  it('bot não atende número desconhecido', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/bot/mensagem', payload: { telefone: '11999999999', texto: 'oi' } });
    expect(r.json().resposta).toContain('não cadastrado');
  });

  it('sensor com solo seco gera um único alerta por dia', async () => {
    const enviar = () =>
      app.inject({ method: 'POST', url: '/api/sensores/leituras', headers: { 'x-chave-dispositivo': 'chave-p1' }, payload: { leituras: [{ tipo: 'umidade_solo', valor: 12 }] } });
    expect((await enviar()).statusCode).toBe(200);
    await enviar();
    expect(um<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM alertas WHERE tipo = 'sensor'")!.n).toBe(1);
  });

  it('sensor com chave inválida é rejeitado', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/sensores/leituras', headers: { 'x-chave-dispositivo': 'x' }, payload: { leituras: [{ tipo: 'umidade_solo', valor: 12 }] } });
    expect(r.statusCode).toBe(401);
  });
});

describe('triagem visual da safra', () => {
  beforeEach(() => novoApp());

  const fotoBoa = {
    caracteristicas: { vermelho: 0.85, laranja: 0, amarelo: 0, verde: 0, marrom: 0, escuro: 0, claro: 0, cobertura: 0.85, nitidez: 0.8, brilho: 0.5 },
    miniatura: 'data:image/jpeg;base64,/9j/abc',
  };

  it('classifica a colheita ao registrar com foto (POST /api/safras)', async () => {
    const t = await login('5511900000001');
    const s = (await req(t).post('/api/safras', { cultura: 'tomate', quantidadeKg: 300, triagem: fotoBoa })).json();
    expect(s.triagem_classe).toBe('A');
    expect(s.triagem_pontuacao).toBeGreaterThanOrEqual(80);
    expect(s.triagem_miniatura).toBe(fotoBoa.miniatura);
    const parsed = JSON.parse(s.triagem_json);
    expect(parsed.caracteristicas.vermelho).toBe(0.85);
  });

  it('o servidor é a fonte da verdade: a classe vem do cálculo, não do app', async () => {
    const t = await login('5511900000001');
    // características de amostra deteriorada → refugo, independentemente de qualquer palpite do cliente
    const ruim = { ...fotoBoa.caracteristicas, vermelho: 0.2, escuro: 0.6, marrom: 0.2 };
    const s = (await req(t).post('/api/safras', { cultura: 'tomate', quantidadeKg: 300, triagem: { caracteristicas: ruim } })).json();
    expect(s.triagem_classe).toBe('refugo');
  });

  it('a triagem sobe junto pela fila offline (/sync) e não duplica', async () => {
    const t = await login('5511900000001');
    const safraId = crypto.randomUUID();
    const op = { opId: crypto.randomUUID(), tipo: 'criar_safra', dados: { id: safraId, cultura: 'alface', quantidadeKg: 120, triagem: { caracteristicas: { ...fotoBoa.caracteristicas, vermelho: 0, verde: 0.85 } } } };
    await req(t).post('/api/sync', { operacoes: [op] });
    await req(t).post('/api/sync', { operacoes: [op] });
    const linha = um<{ triagem_classe: string }>(ctx.db, 'SELECT triagem_classe FROM safras WHERE id = ?', safraId)!;
    expect(linha.triagem_classe).toBe('A');
    expect(um<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM safras')!.n).toBe(1);
  });

  it('rejeita características fora do intervalo 0..1', async () => {
    const t = await login('5511900000001');
    const r = await req(t).post('/api/safras', { cultura: 'tomate', quantidadeKg: 300, triagem: { caracteristicas: { ...fotoBoa.caracteristicas, vermelho: 2 } } });
    expect(r.statusCode).toBe(400);
  });
});

describe('dados de demonstração', () => {
  it('o seed roda de ponta a ponta e gera histórico consistente', async () => {
    const r = await criarApp({ db: abrirBanco(':memory:'), agora: () => AGORA, config: { webDist: '/nao-existe' } });
    await popular(r.ctx);
    const db = r.ctx.db;
    expect(um<{ n: number }>(db, "SELECT COUNT(*) AS n FROM pedidos WHERE status = 'pago'")!.n).toBeGreaterThan(20);
    for (const c of todos<{ id: string; custo_total_centavos: number }>(db, "SELECT id, custo_total_centavos FROM cargas WHERE status IN ('entregue','liquidada')")) {
      const ativos = todos<{ v: number }>(db, 'SELECT valor_centavos AS v FROM rateios WHERE carga_id = ? AND ativo = 1', c.id);
      expect(ativos.reduce((s, x) => s + x.v, 0)).toBe(c.custo_total_centavos);
    }
    expect(um<{ n: number }>(db, "SELECT COUNT(*) AS n FROM pagamentos pg JOIN rateios r ON r.id = pg.rateio_id WHERE r.produtor_id = 'u-ana' AND pg.status = 'pendente'")!.n).toBe(1);
  });
});
