import { todos } from '../db.js';
import { formatarDataBR, somarDias, dataLocal } from '../domain/tempo.js';
import { notificar } from './alertas.js';
import type { Contexto } from './contexto.js';
import { agrupar, type ParadaRota } from './fretes.js';
import { transitarPedido } from './transicoes.js';

/** Pedidos que esperaram mais que a janela sem formar grupo expiram (o produtor pode pedir frete individual). */
export async function expirarPedidos(ctx: Contexto): Promise<number> {
  const limite = new Date(ctx.agora().getTime() - ctx.config.frete.janelaHoras * 3600_000).toISOString();
  const hoje = dataLocal(ctx.agora());
  const vencidos = todos<{ id: string; produtor_id: string }>(
    ctx.db,
    "SELECT id, produtor_id FROM pedidos WHERE status = 'solicitado' AND (criado_em < ? OR data_desejada < ?)",
    limite,
    hoje,
  );
  for (const p of vencidos) {
    transitarPedido(ctx, p.id, 'expirado', 'job:expiracao');
    await notificar(ctx, p.produtor_id, {
      tipo: 'carga',
      titulo: 'Nenhum vizinho no seu trajeto',
      mensagem: 'Não encontramos carga coletiva a tempo. Você pode pedir frete individual ou tentar uma nova data no app.',
      chave: `pedido:${p.id}:expirado`,
    });
  }
  return vencidos.length;
}

/** Verifica a previsão para as coletas agendadas de hoje e amanhã e avisa sobre clima severo. */
export async function verificarClima(ctx: Contexto): Promise<number> {
  const hoje = dataLocal(ctx.agora());
  const cargas = todos<{ id: string; data_coleta: string; motorista_id: string | null; rota_json: string }>(
    ctx.db,
    "SELECT id, data_coleta, motorista_id, rota_json FROM cargas WHERE status IN ('agendada','em_rota') AND data_coleta BETWEEN ? AND ?",
    hoje,
    somarDias(hoje, 1),
  );
  let alertas = 0;
  for (const c of cargas) {
    const paradas = JSON.parse(c.rota_json) as ParadaRota[];
    for (const p of paradas) {
      const prev = await ctx.clima.previsao(p, c.data_coleta);
      if (!prev.severo) continue;
      const msg = `${prev.descricao} em ${p.municipio} no dia ${formatarDataBR(c.data_coleta)} (${prev.chuvaMm} mm, vento ${prev.ventoKmh} km/h).`;
      if (await notificar(ctx, p.produtorId, { tipo: 'clima', titulo: 'Alerta de clima na coleta', mensagem: `${msg} Proteja a carga.`, chave: `clima:${c.id}:${p.pedidoId}:${c.data_coleta}` })) alertas++;
      if (c.motorista_id && (await notificar(ctx, c.motorista_id, { tipo: 'clima', titulo: 'Alerta de clima na rota', mensagem: msg, chave: `clima:${c.id}:motorista:${p.municipio}:${c.data_coleta}` }))) alertas++;
    }
  }
  return alertas;
}

export async function executarJobs(ctx: Contexto) {
  const expirados = await expirarPedidos(ctx);
  const agrupados = ctx.config.autoAgrupar ? await agrupar(ctx, 'auto:job') : { cargas: [] };
  const clima = await verificarClima(ctx);
  return { expirados, cargasCriadas: agrupados.cargas.length, alertasClima: clima };
}

export function agendarJobs(ctx: Contexto): () => void {
  let rodando = false;
  const t = setInterval(async () => {
    if (rodando) return;
    rodando = true;
    try {
      await executarJobs(ctx);
    } catch (e) {
      ctx.log(`erro nos jobs: ${(e as Error).message}`);
    } finally {
      rodando = false;
    }
  }, ctx.config.intervaloJobsMs);
  t.unref();
  return () => clearInterval(t);
}
