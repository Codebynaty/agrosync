import crypto from 'node:crypto';
import { exec, um } from '../db.js';
import type { Canal } from '../adapters/notificacao.js';
import { agoraISO, type Contexto } from './contexto.js';

export type TipoAlerta = 'carga' | 'coleta' | 'pagamento' | 'clima' | 'estrada' | 'sensor' | 'credito' | 'sistema';

/**
 * Registra o alerta (caixa de entrada no app) e envia pelo canal preferido do usuário.
 * `chave` torna o alerta idempotente: o mesmo aviso nunca é enviado duas vezes.
 */
export async function notificar(
  ctx: Contexto,
  usuarioId: string,
  a: { tipo: TipoAlerta; titulo: string; mensagem: string; chave?: string },
): Promise<boolean> {
  const u = um<{ telefone: string; canal_preferido: Canal }>(
    ctx.db,
    'SELECT telefone, canal_preferido FROM usuarios WHERE id = ?',
    usuarioId,
  );
  if (!u) return false;
  const inseridos = exec(
    ctx.db,
    `INSERT INTO alertas (id, usuario_id, tipo, canal, titulo, mensagem, chave, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chave) DO NOTHING`,
    crypto.randomUUID(),
    usuarioId,
    a.tipo,
    u.canal_preferido,
    a.titulo,
    a.mensagem,
    a.chave ?? null,
    agoraISO(ctx),
  );
  if (inseridos === 0) return false;
  try {
    await ctx.notificador.enviar({ telefone: u.telefone, canal: u.canal_preferido, titulo: a.titulo, texto: a.mensagem });
  } catch (e) {
    ctx.log(`falha ao enviar notificação: ${(e as Error).message}`);
  }
  return true;
}
