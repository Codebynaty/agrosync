import crypto from 'node:crypto';
import { exec, um } from '../db.js';
import { agoraISO, ErroApp, type Contexto } from './contexto.js';
import { normalizarTelefone } from './bot.js';

const hash = (codigo: string, telefone: string) => crypto.createHash('sha256').update(`${telefone}:${codigo}`).digest('hex');

export type Usuario = { id: string; nome: string; telefone: string; papel: 'produtor' | 'motorista' | 'cooperativa'; canal_preferido: string };

/** Login sem senha: código de 6 dígitos por SMS/WhatsApp, válido por 10 minutos, até 5 tentativas. */
export async function solicitarCodigo(ctx: Contexto, telefoneBruto: string): Promise<{ codigoDev?: string }> {
  const telefone = normalizarTelefone(telefoneBruto);
  const u = um<Usuario>(ctx.db, 'SELECT * FROM usuarios WHERE telefone = ?', telefone);
  if (!u) throw new ErroApp(404, 'Telefone não cadastrado. Procure sua cooperativa.', 'nao_cadastrado');

  const codigo = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const expira = new Date(ctx.agora().getTime() + 10 * 60_000).toISOString();
  exec(
    ctx.db,
    `INSERT INTO otps (telefone, codigo_hash, expira_em, tentativas) VALUES (?, ?, ?, 0)
     ON CONFLICT(telefone) DO UPDATE SET codigo_hash = excluded.codigo_hash, expira_em = excluded.expira_em, tentativas = 0`,
    telefone,
    hash(codigo, telefone),
    expira,
  );
  await ctx.notificador.enviar({ telefone, canal: 'sms', titulo: 'Código AgroSync', texto: `Seu código de acesso é ${codigo}. Válido por 10 minutos.` });
  return ctx.config.otpEcho ? { codigoDev: codigo } : {};
}

export function verificarCodigo(ctx: Contexto, telefoneBruto: string, codigo: string): Usuario {
  const telefone = normalizarTelefone(telefoneBruto);
  const otp = um<{ codigo_hash: string; expira_em: string; tentativas: number }>(ctx.db, 'SELECT * FROM otps WHERE telefone = ?', telefone);
  if (!otp || otp.expira_em < agoraISO(ctx)) throw new ErroApp(401, 'Código expirado. Peça um novo.', 'codigo_expirado');
  if (otp.tentativas >= 5) throw new ErroApp(429, 'Muitas tentativas. Peça um novo código.', 'muitas_tentativas');
  const ok = crypto.timingSafeEqual(Buffer.from(otp.codigo_hash, 'hex'), Buffer.from(hash(codigo.trim(), telefone), 'hex'));
  if (!ok) {
    exec(ctx.db, 'UPDATE otps SET tentativas = tentativas + 1 WHERE telefone = ?', telefone);
    throw new ErroApp(401, 'Código incorreto.', 'codigo_incorreto');
  }
  exec(ctx.db, 'DELETE FROM otps WHERE telefone = ?', telefone);
  return um<Usuario>(ctx.db, 'SELECT * FROM usuarios WHERE telefone = ?', telefone)!;
}
