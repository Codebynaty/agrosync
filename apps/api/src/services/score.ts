import { todos, um } from '../db.js';
import { calcularScore, type Caracteristicas, type ResultadoScore } from '../domain/agroscore.js';
import type { Contexto } from './contexto.js';

export function caracteristicasDoProdutor(ctx: Contexto, produtorId: string): Caracteristicas {
  const entregas = um<{ n: number; vol: number | null }>(
    ctx.db,
    "SELECT COUNT(*) AS n, AVG(volume_kg) AS vol FROM pedidos WHERE produtor_id = ? AND status = 'pago'",
    produtorId,
  )!;
  const pagamentos = todos<{ criado_em: string; confirmado_em: string | null }>(
    ctx.db,
    `SELECT pg.criado_em, pg.confirmado_em FROM pagamentos pg JOIN rateios r ON r.id = pg.rateio_id
      WHERE r.produtor_id = ? AND pg.status = 'confirmado'`,
    produtorId,
  );
  const emDia = pagamentos.filter(
    (p) => p.confirmado_em && Date.parse(p.confirmado_em) - Date.parse(p.criado_em) <= 72 * 3600_000,
  ).length;
  const meses = um<{ n: number }>(
    ctx.db,
    'SELECT COUNT(DISTINCT substr(colhido_em, 1, 7)) AS n FROM safras WHERE produtor_id = ?',
    produtorId,
  )!;
  const cancel = um<{ n: number }>(
    ctx.db,
    "SELECT COUNT(*) AS n FROM pedidos WHERE produtor_id = ? AND status = 'cancelado'",
    produtorId,
  )!;
  return {
    entregas: entregas.n,
    pontualidade: pagamentos.length ? emDia / pagamentos.length : 0.5,
    volumeMedioKg: entregas.vol ?? 0,
    mesesAtivos: meses.n,
    cancelamentos: cancel.n,
  };
}

export function agroScoreDoProdutor(ctx: Contexto, produtorId: string): ResultadoScore & { caracteristicas: Caracteristicas } {
  const c = caracteristicasDoProdutor(ctx, produtorId);
  return { ...calcularScore(c), caracteristicas: c };
}
