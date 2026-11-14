import crypto from 'node:crypto';
import { exec, todos, transacao, um } from '../db.js';
import { agruparPedidos, diasEntre, grupoValido, type PedidoAgrupavel } from '../domain/agrupamento.js';
import { CULTURA_POR_ID } from '../domain/culturas.js';
import { formatarBRL } from '../domain/dinheiro.js';
import type { StatusPedido } from '../domain/estados.js';
import { planejarCarga, type ParadaFrete } from '../domain/frete.js';
import { distanciaKm, type Ponto } from '../domain/geo.js';
import { dataLocal, formatarDataBR, somarDias } from '../domain/tempo.js';
import { notificar, type TipoAlerta } from './alertas.js';
import { agoraISO, conflito, invalido, naoEncontrado, proibido, type Contexto } from './contexto.js';
import { transitarCarga, transitarPedido } from './transicoes.js';

type Aviso = { usuarioId: string; tipo: TipoAlerta; titulo: string; mensagem: string; chave?: string };

async function enviar(ctx: Contexto, avisos: Aviso[]) {
  for (const a of avisos) await notificar(ctx, a.usuarioId, a);
}

export type PedidoLinha = {
  id: string;
  produtor_id: string;
  propriedade_id: string;
  safra_id: string | null;
  destino_id: string;
  cultura: string;
  volume_kg: number;
  data_desejada: string;
  status: StatusPedido;
  carga_id: string | null;
  qr_token: string;
  coletado_em: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type ParadaRota = {
  pedidoId: string;
  produtorId: string;
  produtorNome: string;
  propriedadeNome: string;
  municipio: string;
  cultura: string;
  volumeKg: number;
  lat: number;
  lng: number;
};

const hoje = (ctx: Contexto) => dataLocal(ctx.agora());

export function destinoMaisProximo(ctx: Contexto, p: Ponto): string {
  const ds = todos<{ id: string; lat: number; lng: number }>(ctx.db, 'SELECT id, lat, lng FROM destinos ORDER BY id');
  if (!ds.length) throw naoEncontrado('Destino');
  return ds.reduce((m, d) => (distanciaKm(p, d) < distanciaKm(p, m) ? d : m)).id;
}

// ---------------------------------------------------------------- pedidos

export type NovoPedido = { id?: string; safraId: string; destinoId?: string; dataDesejada?: string };

export async function criarPedido(ctx: Contexto, produtorId: string, d: NovoPedido): Promise<{ pedido: PedidoLinha; criado: boolean }> {
  const r = transacao(ctx.db, () => {
    if (d.id) {
      const existente = um<PedidoLinha>(ctx.db, 'SELECT * FROM pedidos WHERE id = ?', d.id);
      if (existente) {
        if (existente.produtor_id !== produtorId) throw conflito('Identificador já usado.');
        return { pedido: existente, criado: false };
      }
    }
    const safra = um<{ id: string; produtor_id: string; propriedade_id: string; cultura: string; quantidade_kg: number }>(
      ctx.db,
      'SELECT id, produtor_id, propriedade_id, cultura, quantidade_kg FROM safras WHERE id = ?',
      d.safraId,
    );
    if (!safra) throw naoEncontrado('Colheita');
    if (safra.produtor_id !== produtorId) throw proibido('Colheita de outro produtor.');

    const ativo = um<PedidoLinha>(ctx.db, "SELECT * FROM pedidos WHERE safra_id = ? AND status <> 'cancelado'", safra.id);
    if (ativo) return { pedido: ativo, criado: false };

    const prop = um<{ lat: number; lng: number }>(ctx.db, 'SELECT lat, lng FROM propriedades WHERE id = ?', safra.propriedade_id)!;
    const destinoId = d.destinoId ?? destinoMaisProximo(ctx, prop);
    if (!um(ctx.db, 'SELECT 1 FROM destinos WHERE id = ?', destinoId)) throw naoEncontrado('Destino');

    const data = d.dataDesejada ?? somarDias(hoje(ctx), 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw invalido('Data deve estar no formato AAAA-MM-DD.');
    if (data < hoje(ctx)) throw invalido('A data de coleta não pode estar no passado.');
    if (data > somarDias(hoje(ctx), 30)) throw invalido('A data de coleta deve estar nos próximos 30 dias.');
    if (safra.quantidade_kg > ctx.config.frete.capacidadeKg) {
      throw invalido(`Volume acima da capacidade de um caminhão (${ctx.config.frete.capacidadeKg} kg). Divida em mais registros.`);
    }

    const id = d.id ?? crypto.randomUUID();
    const agora = agoraISO(ctx);
    exec(
      ctx.db,
      `INSERT INTO pedidos (id, produtor_id, propriedade_id, safra_id, destino_id, cultura, volume_kg, data_desejada, status, qr_token, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'solicitado', ?, ?, ?)`,
      id,
      produtorId,
      safra.propriedade_id,
      safra.id,
      destinoId,
      safra.cultura,
      safra.quantidade_kg,
      data,
      crypto.randomBytes(4).toString('hex').toUpperCase(),
      agora,
      agora,
    );
    return { pedido: um<PedidoLinha>(ctx.db, 'SELECT * FROM pedidos WHERE id = ?', id)!, criado: true };
  });

  if (r.criado && ctx.config.autoAgrupar) await agrupar(ctx, 'auto:novo-pedido');
  return { pedido: um<PedidoLinha>(ctx.db, 'SELECT * FROM pedidos WHERE id = ?', r.pedido.id)!, criado: r.criado };
}

export async function cancelarPedido(ctx: Contexto, produtorId: string, pedidoId: string) {
  const avisos: Aviso[] = [];
  transacao(ctx.db, () => {
    const p = um<PedidoLinha>(ctx.db, 'SELECT * FROM pedidos WHERE id = ?', pedidoId);
    if (!p) throw naoEncontrado('Pedido');
    if (p.produtor_id !== produtorId) throw proibido();
    if (p.carga_id && (p.status === 'agrupado' || p.status === 'agendado')) {
      avisos.push(...removerDaCarga(ctx, p.carga_id, [p.id], 'produtor:cancelou', 'cancelado'));
    } else {
      transitarPedido(ctx, p.id, 'cancelado', 'produtor:cancelou');
    }
  });
  await enviar(ctx, avisos);
}

// ---------------------------------------------------------------- cargas

function carregarParadas(ctx: Contexto, pedidoIds: string[]) {
  const marc = pedidoIds.map(() => '?').join(',');
  return todos<PedidoLinha & { lat: number; lng: number; prop_nome: string; municipio: string; produtor_nome: string }>(
    ctx.db,
    `SELECT p.*, pr.lat, pr.lng, pr.nome AS prop_nome, pr.municipio, u.nome AS produtor_nome
       FROM pedidos p JOIN propriedades pr ON pr.id = p.propriedade_id JOIN usuarios u ON u.id = p.produtor_id
      WHERE p.id IN (${marc})`,
    ...pedidoIds,
  );
}

/** Cria a carga, o rateio e move os pedidos para "agrupado". Deve rodar dentro de transação. */
function criarCarga(ctx: Contexto, pedidoIds: string[], origem: string): { cargaId: string; avisos: Aviso[] } {
  const linhas = carregarParadas(ctx, pedidoIds);
  if (linhas.length !== pedidoIds.length) throw naoEncontrado('Pedido');
  const destinoId = linhas[0].destino_id;
  if (linhas.some((l) => l.destino_id !== destinoId)) throw invalido('Pedidos com destinos diferentes.');
  const destino = um<{ id: string; nome: string; lat: number; lng: number }>(ctx.db, 'SELECT * FROM destinos WHERE id = ?', destinoId)!;

  const paradas: ParadaFrete[] = linhas.map((l) => ({ lat: l.lat, lng: l.lng, pedidoId: l.id, volumeKg: l.volume_kg }));
  const plano = planejarCarga(destino, paradas, ctx.config.frete);
  if (linhas.length > 1 && plano.custoTotalCentavos >= plano.custoIndividualTotalCentavos) {
    throw conflito('Carga coletiva não é vantajosa para esses pedidos.');
  }
  const rateio = linhas.length === 1 ? { [linhas[0].id]: plano.custoTotalCentavos } : plano.rateio;

  const porId = Object.fromEntries(linhas.map((l) => [l.id, l]));
  const rota: ParadaRota[] = plano.ordem.map((o) => {
    const l = porId[o.pedidoId];
    return {
      pedidoId: l.id,
      produtorId: l.produtor_id,
      produtorNome: l.produtor_nome,
      propriedadeNome: l.prop_nome,
      municipio: l.municipio,
      cultura: l.cultura,
      volumeKg: l.volume_kg,
      lat: l.lat,
      lng: l.lng,
    };
  });

  const cargaId = crypto.randomUUID();
  const agora = agoraISO(ctx);
  const dataColeta = linhas.map((l) => l.data_desejada).sort()[0] < hoje(ctx) ? hoje(ctx) : linhas.map((l) => l.data_desejada).sort()[0];
  const volume = linhas.reduce((s, l) => s + l.volume_kg, 0);

  exec(
    ctx.db,
    `INSERT INTO cargas (id, destino_id, motorista_id, status, data_coleta, capacidade_kg, volume_kg, distancia_m,
                         custo_total_centavos, custo_individual_total_centavos, rota_json, criado_em, atualizado_em)
     VALUES (?, ?, NULL, 'aberta', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    cargaId,
    destinoId,
    dataColeta,
    ctx.config.frete.capacidadeKg,
    volume,
    Math.round(plano.distanciaKm * 1000),
    plano.custoTotalCentavos,
    plano.custoIndividualTotalCentavos,
    JSON.stringify(rota),
    agora,
    agora,
  );

  const avisos: Aviso[] = [];
  for (const l of linhas) {
    exec(
      ctx.db,
      `INSERT INTO rateios (id, carga_id, pedido_id, produtor_id, valor_centavos, custo_individual_centavos, ativo, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      crypto.randomUUID(),
      cargaId,
      l.id,
      l.produtor_id,
      rateio[l.id],
      plano.custosIndividuais[l.id],
      agora,
    );
    transitarPedido(ctx, l.id, 'agrupado', origem, { cargaId });
    const economia = plano.custosIndividuais[l.id] - rateio[l.id];
    const cultura = CULTURA_POR_ID[l.cultura]?.nome.toLowerCase() ?? l.cultura;
    avisos.push({
      usuarioId: l.produtor_id,
      tipo: 'carga',
      titulo: linhas.length > 1 ? 'Seu frete entrou numa carga coletiva' : 'Frete individual criado',
      mensagem:
        linhas.length > 1
          ? `${l.volume_kg} kg de ${cultura} vão com mais ${linhas.length - 1} vizinho(s) para ${destino.nome}. ` +
            `Sua parte: ${formatarBRL(rateio[l.id])} (economia de ${formatarBRL(economia)}). Aguardando motorista.`
          : `${l.volume_kg} kg de ${cultura} para ${destino.nome}. Frete: ${formatarBRL(rateio[l.id])}. Aguardando motorista.`,
      chave: `carga:${cargaId}:produtor:${l.id}`,
    });
  }

  const motoristas = todos<{ id: string }>(ctx.db, "SELECT id FROM usuarios WHERE papel = 'motorista'");
  for (const m of motoristas) {
    avisos.push({
      usuarioId: m.id,
      tipo: 'carga',
      titulo: 'Nova carga disponível',
      mensagem: `${rota.length} parada(s), ${volume} kg, ${Math.round(plano.distanciaKm)} km até ${destino.nome} em ${formatarDataBR(dataColeta)}. Frete: ${formatarBRL(plano.custoTotalCentavos)}.`,
      chave: `carga:${cargaId}:motorista:${m.id}`,
    });
  }
  return { cargaId, avisos };
}

/** Executa o agrupamento sobre todos os pedidos "solicitado". */
export async function agrupar(ctx: Contexto, origem: string): Promise<{ cargas: string[]; pedidosAgrupados: number }> {
  const avisos: Aviso[] = [];
  const cargas: string[] = [];
  let pedidosAgrupados = 0;

  transacao(ctx.db, () => {
    const linhas = todos<{ id: string; lat: number; lng: number; volume_kg: number; data_desejada: string; destino_id: string }>(
      ctx.db,
      `SELECT p.id, pr.lat, pr.lng, p.volume_kg, p.data_desejada, p.destino_id
         FROM pedidos p JOIN propriedades pr ON pr.id = p.propriedade_id
        WHERE p.status = 'solicitado' AND p.data_desejada >= ?`,
      hoje(ctx),
    );
    const pedidos: PedidoAgrupavel[] = linhas.map((l) => ({
      id: l.id,
      lat: l.lat,
      lng: l.lng,
      volumeKg: l.volume_kg,
      dataDesejada: l.data_desejada,
      destinoId: l.destino_id,
    }));
    const destinos = Object.fromEntries(
      todos<{ id: string; lat: number; lng: number }>(ctx.db, 'SELECT id, lat, lng FROM destinos').map((d) => [d.id, d]),
    );

    // 1) Pedido novo pega carona numa carga ainda sem motorista, se couber e continuar vantajoso.
    const restantes: PedidoAgrupavel[] = [];
    for (const novo of pedidos) {
      const r = incluirEmCargaAberta(ctx, novo, destinos[novo.destinoId], origem);
      if (r) {
        cargas.push(r.cargaId);
        avisos.push(...r.avisos);
        pedidosAgrupados += 1;
      } else restantes.push(novo);
    }

    // 2) Os demais formam novos grupos.
    for (const grupo of agruparPedidos(restantes, destinos, ctx.config.frete)) {
      const r = criarCarga(ctx, grupo.map((g) => g.id), origem);
      cargas.push(r.cargaId);
      avisos.push(...r.avisos);
      pedidosAgrupados += grupo.length;
    }
  });

  await enviar(ctx, avisos);
  if (cargas.length) ctx.log(`agrupamento (${origem}): ${cargas.length} carga(s), ${pedidosAgrupados} pedido(s)`);
  return { cargas, pedidosAgrupados };
}

/**
 * Tenta incluir um pedido numa carga "aberta" (sem motorista) do mesmo destino e janela.
 * Só acontece se a carga continuar dentro da capacidade e do raio e mais barata que os
 * fretes individuais. A carga antiga é cancelada e substituída por uma replanejada.
 */
function incluirEmCargaAberta(
  ctx: Contexto,
  novo: PedidoAgrupavel,
  destino: Ponto | undefined,
  origem: string,
): { cargaId: string; avisos: Aviso[] } | null {
  if (!destino) return null;
  const abertas = todos<{ id: string; data_coleta: string }>(
    ctx.db,
    "SELECT id, data_coleta FROM cargas WHERE status = 'aberta' AND destino_id = ? ORDER BY criado_em",
    novo.destinoId,
  );
  for (const c of abertas) {
    const membros = todos<{ id: string; lat: number; lng: number; volume_kg: number; data_desejada: string }>(
      ctx.db,
      `SELECT p.id, pr.lat, pr.lng, p.volume_kg, p.data_desejada FROM pedidos p
         JOIN propriedades pr ON pr.id = p.propriedade_id WHERE p.carga_id = ?`,
      c.id,
    );
    const grupo: PedidoAgrupavel[] = [
      ...membros.map((m) => ({ id: m.id, lat: m.lat, lng: m.lng, volumeKg: m.volume_kg, dataDesejada: m.data_desejada, destinoId: novo.destinoId })),
      novo,
    ];
    const datas = grupo.map((g) => g.dataDesejada).sort();
    if (diasEntre(datas[0], datas[datas.length - 1]) >= ctx.config.frete.janelaHoras / 24) continue;
    if (!grupoValido(grupo, ctx.config.frete)) continue;
    const plano = planejarCarga(destino, grupo.map((g) => ({ lat: g.lat, lng: g.lng, pedidoId: g.id, volumeKg: g.volumeKg })), ctx.config.frete);
    if (plano.custoTotalCentavos >= plano.custoIndividualTotalCentavos) continue;

    exec(ctx.db, 'UPDATE rateios SET ativo = 0 WHERE carga_id = ?', c.id);
    for (const m of membros) transitarPedido(ctx, m.id, 'solicitado', `${origem}:ampliacao`, { cargaId: null });
    transitarCarga(ctx, c.id, 'cancelada', `${origem}:ampliada`);
    return criarCarga(ctx, grupo.map((g) => g.id), `${origem}:ampliada`);
  }
  return null;
}

/** Pedido sem grupo (ou expirado): o produtor opta por frete individual. */
export async function freteIndividual(ctx: Contexto, produtorId: string, pedidoId: string) {
  const r = transacao(ctx.db, () => {
    const p = um<PedidoLinha>(ctx.db, 'SELECT * FROM pedidos WHERE id = ?', pedidoId);
    if (!p) throw naoEncontrado('Pedido');
    if (p.produtor_id !== produtorId) throw proibido();
    if (p.status !== 'solicitado' && p.status !== 'expirado') throw conflito('Só pedidos sem grupo podem virar frete individual.');
    if (p.data_desejada < hoje(ctx)) exec(ctx.db, 'UPDATE pedidos SET data_desejada = ? WHERE id = ?', hoje(ctx), p.id);
    return criarCarga(ctx, [p.id], 'produtor:frete-individual');
  });
  await enviar(ctx, r.avisos);
  return r.cargaId;
}

/**
 * Remove pedidos de uma carga ainda não iniciada. Se sobrar um grupo viável, ele é
 * replanejado (nova rota e novo rateio); senão a carga é cancelada e os demais voltam a aguardar grupo.
 */
function removerDaCarga(
  ctx: Contexto,
  cargaId: string,
  remover: string[],
  origem: string,
  statusRemovidos: 'cancelado' | 'solicitado',
): Aviso[] {
  const carga = um<{ status: string; motorista_id: string | null }>(ctx.db, 'SELECT status, motorista_id FROM cargas WHERE id = ?', cargaId);
  if (!carga) throw naoEncontrado('Carga');
  if (carga.status !== 'aberta' && carga.status !== 'agendada') throw conflito('A carga já está em rota.');

  const membros = todos<{ id: string; status: StatusPedido; produtor_id: string }>(
    ctx.db,
    'SELECT id, status, produtor_id FROM pedidos WHERE carga_id = ?',
    cargaId,
  );
  exec(ctx.db, 'UPDATE rateios SET ativo = 0 WHERE carga_id = ?', cargaId);
  for (const m of membros.filter((m) => remover.includes(m.id))) {
    transitarPedido(ctx, m.id, statusRemovidos === 'cancelado' ? 'cancelado' : 'solicitado', origem, { cargaId: null });
  }
  const restantes = membros.filter((m) => !remover.includes(m.id));
  for (const m of restantes) transitarPedido(ctx, m.id, 'solicitado', origem, { cargaId: null });
  transitarCarga(ctx, cargaId, 'cancelada', origem);

  const avisos: Aviso[] = [];
  if (carga.motorista_id) {
    avisos.push({
      usuarioId: carga.motorista_id,
      tipo: 'carga',
      titulo: 'Carga alterada',
      mensagem: 'Um produtor saiu da carga. A carga foi replanejada e você será avisado se ela voltar a ficar disponível.',
      chave: `carga:${cargaId}:alterada`,
    });
  }

  if (restantes.length >= 2) {
    try {
      const r = criarCarga(ctx, restantes.map((m) => m.id), `${origem}:replanejada`);
      avisos.push(...r.avisos);
      return avisos;
    } catch {
      /* grupo deixou de ser viável: pedidos ficam aguardando novo grupo */
    }
  }
  for (const m of restantes) {
    avisos.push({
      usuarioId: m.produtor_id,
      tipo: 'carga',
      titulo: 'Carga coletiva desfeita',
      mensagem: 'Um vizinho saiu da carga. Seu pedido voltou a aguardar um novo grupo.',
      chave: `carga:${cargaId}:desfeita:${m.id}`,
    });
  }
  return avisos;
}

export async function cancelarCarga(ctx: Contexto, cargaId: string) {
  const avisos = transacao(ctx.db, () => {
    const ids = todos<{ id: string }>(ctx.db, 'SELECT id FROM pedidos WHERE carga_id = ?', cargaId).map((p) => p.id);
    return removerDaCarga(ctx, cargaId, ids, 'cooperativa:cancelou', 'solicitado');
  });
  await enviar(ctx, avisos);
}

export async function aceitarCarga(ctx: Contexto, motoristaId: string, cargaId: string) {
  const avisos: Aviso[] = [];
  transacao(ctx.db, () => {
    const carga = um<{ status: string; data_coleta: string; rota_json: string }>(ctx.db, 'SELECT * FROM cargas WHERE id = ?', cargaId);
    if (!carga) throw naoEncontrado('Carga');
    if (carga.status !== 'aberta') throw conflito('Esta carga já foi aceita por outro motorista.');
    transitarCarga(ctx, cargaId, 'agendada', `motorista:${motoristaId}`, { motoristaId });
    const motorista = um<{ nome: string; telefone: string }>(ctx.db, 'SELECT nome, telefone FROM usuarios WHERE id = ?', motoristaId)!;
    const pedidos = todos<{ id: string; produtor_id: string; qr_token: string }>(
      ctx.db,
      'SELECT id, produtor_id, qr_token FROM pedidos WHERE carga_id = ?',
      cargaId,
    );
    for (const p of pedidos) {
      transitarPedido(ctx, p.id, 'agendado', `motorista:${motoristaId}`);
      avisos.push({
        usuarioId: p.produtor_id,
        tipo: 'coleta',
        titulo: 'Coleta agendada',
        mensagem: `${motorista.nome} passa na sua propriedade em ${formatarDataBR(carga.data_coleta)}. Deixe a carga pronta e mostre o código ${p.qr_token} (QR no app).`,
        chave: `coleta:${p.id}:agendada`,
      });
    }
  });
  await enviar(ctx, avisos);
}

function cargaDoMotorista(ctx: Contexto, motoristaId: string, cargaId: string) {
  const carga = um<{ id: string; status: string; motorista_id: string | null; destino_id: string }>(
    ctx.db,
    'SELECT id, status, motorista_id, destino_id FROM cargas WHERE id = ?',
    cargaId,
  );
  if (!carga) throw naoEncontrado('Carga');
  if (carga.motorista_id !== motoristaId) throw proibido('Esta carga é de outro motorista.');
  return carga;
}

/** Check-in na propriedade pelo código do QR exibido no app do produtor. */
export async function checkin(ctx: Contexto, motoristaId: string, cargaId: string, qrToken: string) {
  const avisos: Aviso[] = [];
  const pedido = transacao(ctx.db, () => {
    const carga = cargaDoMotorista(ctx, motoristaId, cargaId);
    const p = um<PedidoLinha>(ctx.db, 'SELECT * FROM pedidos WHERE carga_id = ? AND qr_token = ?', cargaId, qrToken.trim().toUpperCase());
    if (!p) throw invalido('Código não pertence a esta carga.');
    if (p.status === 'coletado') return p;
    if (carga.status === 'agendada') transitarCarga(ctx, cargaId, 'em_rota', `motorista:${motoristaId}`);
    transitarPedido(ctx, p.id, 'coletado', `motorista:${motoristaId}:qr`, { coletadoEm: agoraISO(ctx) });
    avisos.push({
      usuarioId: p.produtor_id,
      tipo: 'coleta',
      titulo: 'Carga coletada',
      mensagem: `Sua carga de ${p.volume_kg} kg foi coletada e está a caminho do destino.`,
      chave: `coleta:${p.id}:coletada`,
    });
    return um<PedidoLinha>(ctx.db, 'SELECT * FROM pedidos WHERE id = ?', p.id)!;
  });
  await enviar(ctx, avisos);
  return pedido;
}

/**
 * Entrega no destino. Pedidos não coletados (produtor ausente) voltam a aguardar grupo e não pagam.
 * Para cada pedido entregue é gerada uma cobrança Pix do rateio.
 */
export async function entregarCarga(ctx: Contexto, motoristaId: string, cargaId: string) {
  const avisos: Aviso[] = [];
  transacao(ctx.db, () => {
    const carga = cargaDoMotorista(ctx, motoristaId, cargaId);
    if (carga.status !== 'em_rota') throw conflito('Faça o check-in de pelo menos uma coleta antes de entregar.');
    const pedidos = todos<PedidoLinha>(ctx.db, 'SELECT * FROM pedidos WHERE carga_id = ?', cargaId);
    for (const p of pedidos) {
      if (p.status === 'coletado') {
        transitarPedido(ctx, p.id, 'entregue', `motorista:${motoristaId}`);
      } else if (p.status === 'agendado') {
        exec(ctx.db, 'UPDATE rateios SET ativo = 0 WHERE pedido_id = ? AND ativo = 1', p.id);
        transitarPedido(ctx, p.id, 'solicitado', `motorista:${motoristaId}:nao-coletado`, { cargaId: null });
        avisos.push({
          usuarioId: p.produtor_id,
          tipo: 'coleta',
          titulo: 'Coleta não realizada',
          mensagem: 'O motorista não conseguiu coletar sua carga. Seu pedido voltou para a fila e nada será cobrado.',
          chave: `coleta:${p.id}:nao-coletada:${cargaId}`,
        });
      }
    }
    transitarCarga(ctx, cargaId, 'entregue', `motorista:${motoristaId}`);
  });
  await enviar(ctx, avisos);
  await garantirCobrancas(ctx, cargaId);
}

/** Cria (de forma idempotente) as cobranças Pix dos rateios de uma carga entregue. */
export async function garantirCobrancas(ctx: Contexto, cargaId: string) {
  const pendentes = todos<{ rateio_id: string; valor_centavos: number; produtor_id: string; pedido_id: string; destino: string }>(
    ctx.db,
    `SELECT r.id AS rateio_id, r.valor_centavos, r.produtor_id, r.pedido_id, d.nome AS destino
       FROM rateios r
       JOIN pedidos p ON p.id = r.pedido_id
       JOIN cargas c ON c.id = r.carga_id
       JOIN destinos d ON d.id = c.destino_id
      WHERE r.carga_id = ? AND r.ativo = 1 AND p.status = 'entregue'
        AND NOT EXISTS (SELECT 1 FROM pagamentos pg WHERE pg.rateio_id = r.id)`,
    cargaId,
  );
  for (const r of pendentes) {
    const txid = `AGS${crypto.randomBytes(12).toString('hex').toUpperCase()}`.slice(0, 30);
    const { copiaECola } = await ctx.pix.criarCobranca({
      txid,
      valorCentavos: r.valor_centavos,
      descricao: `Frete coletivo ${r.destino}`,
    });
    const n = exec(
      ctx.db,
      `INSERT INTO pagamentos (id, rateio_id, txid, valor_centavos, status, copia_e_cola, criado_em)
       VALUES (?, ?, ?, ?, 'pendente', ?, ?) ON CONFLICT(rateio_id) DO NOTHING`,
      crypto.randomUUID(),
      r.rateio_id,
      txid,
      r.valor_centavos,
      copiaECola,
      agoraISO(ctx),
    );
    if (n) {
      await notificar(ctx, r.produtor_id, {
        tipo: 'pagamento',
        titulo: 'Carga entregue: pague sua parte do frete',
        mensagem: `Sua parte do frete é ${formatarBRL(r.valor_centavos)}. Pague pelo Pix no app.`,
        chave: `pagamento:${r.rateio_id}:cobranca`,
      });
    }
  }
}
