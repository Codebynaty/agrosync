import { exec, um } from '../db.js';
import {
  podeTransitarCarga,
  podeTransitarPedido,
  type StatusCarga,
  type StatusPedido,
} from '../domain/estados.js';
import { agoraISO, conflito, naoEncontrado, type Contexto } from './contexto.js';

function auditar(ctx: Contexto, entidade: string, id: string, de: string | null, para: string, origem: string) {
  exec(
    ctx.db,
    'INSERT INTO auditoria (entidade, entidade_id, de, para, origem, em) VALUES (?, ?, ?, ?, ?, ?)',
    entidade,
    id,
    de,
    para,
    origem,
    agoraISO(ctx),
  );
}

export function registrarAuditoria(ctx: Contexto, entidade: string, id: string, para: string, origem: string) {
  auditar(ctx, entidade, id, null, para, origem);
}

/**
 * Única forma de mudar o status de um pedido. Usa compare-and-set
 * (UPDATE ... WHERE status = de) para não sofrer com corridas.
 */
export function transitarPedido(
  ctx: Contexto,
  id: string,
  para: StatusPedido,
  origem: string,
  extra: { cargaId?: string | null; coletadoEm?: string } = {},
): StatusPedido {
  const atual = um<{ status: StatusPedido }>(ctx.db, 'SELECT status FROM pedidos WHERE id = ?', id);
  if (!atual) throw naoEncontrado('Pedido');
  if (!podeTransitarPedido(atual.status, para)) {
    throw conflito(`Pedido não pode ir de "${atual.status}" para "${para}".`);
  }
  const sets = ['status = ?', 'atualizado_em = ?'];
  const params: (string | null)[] = [para, agoraISO(ctx)];
  if (extra.cargaId !== undefined) {
    sets.push('carga_id = ?');
    params.push(extra.cargaId);
  }
  if (extra.coletadoEm !== undefined) {
    sets.push('coletado_em = ?');
    params.push(extra.coletadoEm);
  }
  const n = exec(ctx.db, `UPDATE pedidos SET ${sets.join(', ')} WHERE id = ? AND status = ?`, ...params, id, atual.status);
  if (n !== 1) throw conflito('Pedido foi alterado por outra operação. Tente novamente.');
  auditar(ctx, 'pedido', id, atual.status, para, origem);
  return atual.status;
}

export function transitarCarga(
  ctx: Contexto,
  id: string,
  para: StatusCarga,
  origem: string,
  extra: { motoristaId?: string } = {},
): StatusCarga {
  const atual = um<{ status: StatusCarga }>(ctx.db, 'SELECT status FROM cargas WHERE id = ?', id);
  if (!atual) throw naoEncontrado('Carga');
  if (!podeTransitarCarga(atual.status, para)) {
    throw conflito(`Carga não pode ir de "${atual.status}" para "${para}".`);
  }
  const n =
    extra.motoristaId !== undefined
      ? exec(
          ctx.db,
          'UPDATE cargas SET status = ?, motorista_id = ?, atualizado_em = ? WHERE id = ? AND status = ?',
          para,
          extra.motoristaId,
          agoraISO(ctx),
          id,
          atual.status,
        )
      : exec(ctx.db, 'UPDATE cargas SET status = ?, atualizado_em = ? WHERE id = ? AND status = ?', para, agoraISO(ctx), id, atual.status);
  if (n !== 1) throw conflito('Carga foi alterada por outra operação. Tente novamente.');
  auditar(ctx, 'carga', id, atual.status, para, origem);
  return atual.status;
}
