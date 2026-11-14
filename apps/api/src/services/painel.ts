import { todos, um } from '../db.js';
import { dataLocal } from '../domain/tempo.js';
import type { Contexto } from './contexto.js';

export async function painelProdutor(ctx: Contexto, produtorId: string) {
  const economia = um<{ economia: number | null; pago: number | null }>(
    ctx.db,
    `SELECT SUM(r.custo_individual_centavos - r.valor_centavos) AS economia, SUM(r.valor_centavos) AS pago
       FROM rateios r JOIN pedidos p ON p.id = r.pedido_id
      WHERE r.produtor_id = ? AND r.ativo = 1 AND p.status IN ('entregue','pago')`,
    produtorId,
  )!;
  const enviados = todos<{ cultura: string; kg: number }>(
    ctx.db,
    "SELECT cultura, SUM(volume_kg) AS kg FROM pedidos WHERE produtor_id = ? AND status IN ('entregue','pago') GROUP BY cultura",
    produtorId,
  );
  const cot = Object.fromEntries((await ctx.cotacoes.cotacoes(dataLocal(ctx.agora()))).map((c) => [c.cultura, c.precoCentavosKg]));
  const receitaEstimada = enviados.reduce((s, e) => s + e.kg * (cot[e.cultura] ?? 0), 0);
  const ativos = um<{ n: number }>(
    ctx.db,
    "SELECT COUNT(*) AS n FROM pedidos WHERE produtor_id = ? AND status IN ('solicitado','agrupado','agendado','coletado')",
    produtorId,
  )!.n;
  const pendentes = um<{ n: number; v: number | null }>(
    ctx.db,
    `SELECT COUNT(*) AS n, SUM(pg.valor_centavos) AS v FROM pagamentos pg JOIN rateios r ON r.id = pg.rateio_id
      WHERE r.produtor_id = ? AND pg.status = 'pendente'`,
    produtorId,
  )!;
  const naoLidos = um<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM alertas WHERE usuario_id = ? AND lido = 0', produtorId)!.n;

  return {
    economiaCentavos: economia.economia ?? 0,
    fretePagoCentavos: economia.pago ?? 0,
    kgEnviados: enviados.reduce((s, e) => s + e.kg, 0),
    receitaEstimadaCentavos: Math.round(receitaEstimada),
    pedidosAtivos: ativos,
    pagamentosPendentes: pendentes.n,
    valorPendenteCentavos: pendentes.v ?? 0,
    alertasNaoLidos: naoLidos,
    porCultura: enviados,
  };
}

export function painelCooperativa(ctx: Contexto) {
  const n = (sql: string) => um<{ n: number }>(ctx.db, sql)!.n;
  const economia = um<{ e: number | null; total: number | null }>(
    ctx.db,
    `SELECT SUM(r.custo_individual_centavos - r.valor_centavos) AS e, SUM(r.custo_individual_centavos) AS total
       FROM rateios r JOIN pedidos p ON p.id = r.pedido_id
      WHERE r.ativo = 1 AND p.status IN ('agrupado','agendado','coletado','entregue','pago')`,
  )!;
  return {
    produtores: n("SELECT COUNT(*) AS n FROM usuarios WHERE papel = 'produtor'"),
    motoristas: n("SELECT COUNT(*) AS n FROM usuarios WHERE papel = 'motorista'"),
    kgMovimentados: n("SELECT COALESCE(SUM(volume_kg),0) AS n FROM pedidos WHERE status IN ('entregue','pago')"),
    economiaCentavos: economia.e ?? 0,
    economiaPct: economia.total ? Math.round(((economia.e ?? 0) / economia.total) * 1000) / 10 : 0,
    pedidosPorStatus: todos<{ status: string; n: number }>(ctx.db, 'SELECT status, COUNT(*) AS n FROM pedidos GROUP BY status'),
    cargasPorStatus: todos<{ status: string; n: number }>(ctx.db, 'SELECT status, COUNT(*) AS n FROM cargas GROUP BY status'),
    kgPorCultura: todos<{ cultura: string; kg: number }>(
      ctx.db,
      "SELECT cultura, SUM(volume_kg) AS kg FROM pedidos WHERE status IN ('entregue','pago') GROUP BY cultura ORDER BY kg DESC",
    ),
    kgPorMunicipio: todos<{ municipio: string; kg: number; produtores: number }>(
      ctx.db,
      `SELECT pr.municipio, SUM(p.volume_kg) AS kg, COUNT(DISTINCT p.produtor_id) AS produtores
         FROM pedidos p JOIN propriedades pr ON pr.id = p.propriedade_id
        WHERE p.status IN ('entregue','pago') GROUP BY pr.municipio ORDER BY kg DESC`,
    ),
    kgPorMes: todos<{ mes: string; kg: number }>(
      ctx.db,
      `SELECT substr(data_desejada, 1, 7) AS mes, SUM(volume_kg) AS kg FROM pedidos
        WHERE status IN ('entregue','pago') GROUP BY mes ORDER BY mes`,
    ),
  };
}
