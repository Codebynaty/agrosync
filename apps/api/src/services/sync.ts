import { z } from 'zod';
import { exec, um } from '../db.js';
import { agoraISO, ErroApp, type Contexto } from './contexto.js';
import { criarPedido } from './fretes.js';
import { criarSafra } from './safras.js';

const Fracao = z.number().min(0).max(1);

/** Características percebidas na foto pelo dispositivo (ver domain/triagem.ts). */
export const CaracteristicasSchema = z.object({
  vermelho: Fracao,
  laranja: Fracao,
  amarelo: Fracao,
  verde: Fracao,
  marrom: Fracao,
  escuro: Fracao,
  claro: Fracao,
  cobertura: Fracao,
  nitidez: Fracao,
  brilho: Fracao,
});

export const TriagemSchema = z.object({
  caracteristicas: CaracteristicasSchema,
  miniatura: z.string().max(64 * 1024).optional(),
});

export const OperacaoSchema = z.discriminatedUnion('tipo', [
  z.object({
    opId: z.string().uuid(),
    tipo: z.literal('criar_safra'),
    dados: z.object({
      id: z.string().uuid(),
      propriedadeId: z.string().optional(),
      cultura: z.string(),
      quantidadeKg: z.number().int().positive(),
      perecivel: z.boolean().optional(),
      colhidoEm: z.string().optional(),
      origem: z.enum(['app', 'voz']).optional(),
      triagem: TriagemSchema.optional(),
    }),
  }),
  z.object({
    opId: z.string().uuid(),
    tipo: z.literal('criar_pedido'),
    dados: z.object({
      id: z.string().uuid(),
      safraId: z.string().uuid(),
      destinoId: z.string().optional(),
      dataDesejada: z.string().optional(),
    }),
  }),
]);

export type Operacao = z.infer<typeof OperacaoSchema>;
export type ResultadoOperacao = { opId: string; ok: boolean; repetida: boolean; entidadeId?: string; erro?: string };

/**
 * Aplica, em ordem, as operações que o app acumulou offline.
 * Idempotente por opId: reenviar o mesmo lote devolve os mesmos resultados sem duplicar nada.
 * Erros de validação são definitivos (o app descarta a operação e avisa o produtor);
 * as demais operações do lote continuam.
 */
export async function sincronizar(ctx: Contexto, usuarioId: string, operacoes: Operacao[]): Promise<ResultadoOperacao[]> {
  const resultados: ResultadoOperacao[] = [];
  for (const op of operacoes) {
    const ja = um<{ resultado: string; usuario_id: string }>(ctx.db, 'SELECT resultado, usuario_id FROM operacoes_sync WHERE op_id = ?', op.opId);
    if (ja && ja.usuario_id === usuarioId) {
      resultados.push({ ...(JSON.parse(ja.resultado) as ResultadoOperacao), repetida: true });
      continue;
    }
    let r: ResultadoOperacao;
    try {
      if (op.tipo === 'criar_safra') {
        const { safra } = criarSafra(ctx, usuarioId, { ...op.dados, origem: op.dados.origem ?? 'app' });
        r = { opId: op.opId, ok: true, repetida: false, entidadeId: safra.id };
      } else {
        const { pedido } = await criarPedido(ctx, usuarioId, op.dados);
        r = { opId: op.opId, ok: true, repetida: false, entidadeId: pedido.id };
      }
    } catch (e) {
      if (!(e instanceof ErroApp)) throw e;
      r = { opId: op.opId, ok: false, repetida: false, erro: e.message };
    }
    exec(
      ctx.db,
      'INSERT INTO operacoes_sync (op_id, usuario_id, tipo, resultado, aplicado_em) VALUES (?, ?, ?, ?, ?) ON CONFLICT(op_id) DO NOTHING',
      op.opId,
      usuarioId,
      op.tipo,
      JSON.stringify(r),
      agoraISO(ctx),
    );
    resultados.push(r);
  }
  return resultados;
}
