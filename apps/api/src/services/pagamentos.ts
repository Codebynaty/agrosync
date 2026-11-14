import { z } from 'zod';
import { exec, todos, transacao, um } from '../db.js';
import { formatarBRL } from '../domain/dinheiro.js';
import { notificar } from './alertas.js';
import { agoraISO, type Contexto } from './contexto.js';
import { transitarCarga, transitarPedido } from './transicoes.js';

const EventoSchema = z.object({
  id: z.string().min(1),
  tipo: z.literal('pix.recebido'),
  txid: z.string().min(1),
  valorCentavos: z.number().int().nonnegative(),
  pagoEm: z.string(),
});

export type ResultadoWebhook =
  | 'confirmado'
  | 'duplicado'
  | 'ja_confirmado'
  | 'txid_desconhecido'
  | 'valor_divergente';

/**
 * Processa um webhook Pix de forma idempotente:
 * - o event_id é gravado (PRIMARY KEY) na mesma transação do efeito;
 * - evento repetido não tem efeito nenhum;
 * - pagamento já confirmado não é confirmado de novo (mesmo com outro event_id);
 * - valor diferente do cobrado não confirma.
 */
export async function processarWebhookPix(ctx: Contexto, corpo: unknown): Promise<ResultadoWebhook> {
  const ev = EventoSchema.parse(corpo);
  const avisos: { usuarioId: string; titulo: string; mensagem: string; chave: string }[] = [];

  const resultado = transacao(ctx.db, (): ResultadoWebhook => {
    if (um(ctx.db, 'SELECT 1 FROM webhook_eventos WHERE event_id = ?', ev.id)) return 'duplicado';

    const registrar = (r: ResultadoWebhook) => {
      exec(
        ctx.db,
        'INSERT INTO webhook_eventos (event_id, tipo, payload, resultado, recebido_em) VALUES (?, ?, ?, ?, ?)',
        ev.id,
        ev.tipo,
        JSON.stringify(ev),
        r,
        agoraISO(ctx),
      );
      return r;
    };

    const pg = um<{ id: string; status: string; valor_centavos: number; rateio_id: string }>(
      ctx.db,
      'SELECT id, status, valor_centavos, rateio_id FROM pagamentos WHERE txid = ?',
      ev.txid,
    );
    if (!pg) return registrar('txid_desconhecido');
    if (pg.status === 'confirmado') return registrar('ja_confirmado');
    if (pg.valor_centavos !== ev.valorCentavos) return registrar('valor_divergente');

    exec(ctx.db, "UPDATE pagamentos SET status = 'confirmado', confirmado_em = ? WHERE id = ? AND status = 'pendente'", ev.pagoEm, pg.id);
    const r = um<{ pedido_id: string; carga_id: string; produtor_id: string }>(
      ctx.db,
      'SELECT pedido_id, carga_id, produtor_id FROM rateios WHERE id = ?',
      pg.rateio_id,
    )!;
    transitarPedido(ctx, r.pedido_id, 'pago', `webhook:${ev.id}`);
    avisos.push({
      usuarioId: r.produtor_id,
      titulo: 'Pagamento confirmado',
      mensagem: `Recebemos seu Pix de ${formatarBRL(pg.valor_centavos)}. Obrigado!`,
      chave: `pagamento:${pg.id}:confirmado`,
    });

    const faltam = um<{ n: number }>(
      ctx.db,
      `SELECT COUNT(*) AS n FROM rateios r JOIN pedidos p ON p.id = r.pedido_id
        WHERE r.carga_id = ? AND r.ativo = 1 AND p.status <> 'pago'`,
      r.carga_id,
    )!.n;
    if (faltam === 0) {
      transitarCarga(ctx, r.carga_id, 'liquidada', `webhook:${ev.id}`);
      const c = um<{ motorista_id: string; custo_total_centavos: number }>(
        ctx.db,
        'SELECT motorista_id, custo_total_centavos FROM cargas WHERE id = ?',
        r.carga_id,
      )!;
      const recebido = todos<{ v: number }>(
        ctx.db,
        'SELECT valor_centavos AS v FROM rateios WHERE carga_id = ? AND ativo = 1',
        r.carga_id,
      ).reduce((s, x) => s + x.v, 0);
      if (c.motorista_id) {
        avisos.push({
          usuarioId: c.motorista_id,
          titulo: 'Frete liquidado',
          mensagem: `Todos os produtores pagaram. ${formatarBRL(recebido)} serão repassados para você.`,
          chave: `carga:${r.carga_id}:liquidada`,
        });
      }
    }
    return registrar('confirmado');
  });

  for (const a of avisos) await notificar(ctx, a.usuarioId, { tipo: 'pagamento', ...a });
  return resultado;
}
