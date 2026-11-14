import crypto from 'node:crypto';
import { exec, transacao, um } from '../db.js';
import { buscarCultura } from '../domain/culturas.js';
import { agoraISO, conflito, invalido, naoEncontrado, proibido, type Contexto } from './contexto.js';

export type SafraLinha = {
  id: string;
  produtor_id: string;
  propriedade_id: string;
  cultura: string;
  quantidade_kg: number;
  perecivel: number;
  origem: string;
  colhido_em: string;
  criado_em: string;
};

export type NovaSafra = {
  id?: string;
  propriedadeId?: string;
  cultura: string;
  quantidadeKg: number;
  perecivel?: boolean;
  colhidoEm?: string;
  origem?: 'app' | 'voz' | 'bot' | 'sensor' | 'seed';
};

export function propriedadePadrao(ctx: Contexto, produtorId: string) {
  return um<{ id: string; lat: number; lng: number; municipio: string }>(
    ctx.db,
    'SELECT id, lat, lng, municipio FROM propriedades WHERE produtor_id = ? ORDER BY criado_em LIMIT 1',
    produtorId,
  );
}

/**
 * Cria um registro de colheita. Idempotente pelo `id` (UUID gerado no dispositivo):
 * reenviar a mesma operação após reconexão devolve o registro existente.
 */
export function criarSafra(ctx: Contexto, produtorId: string, d: NovaSafra): { safra: SafraLinha; criada: boolean } {
  const cultura = buscarCultura(d.cultura);
  if (!cultura) throw invalido(`Cultura desconhecida: ${d.cultura}`);
  if (!Number.isInteger(d.quantidadeKg) || d.quantidadeKg <= 0 || d.quantidadeKg > 100_000) {
    throw invalido('Quantidade deve ser um inteiro entre 1 e 100.000 kg.');
  }
  const id = d.id ?? crypto.randomUUID();

  return transacao(ctx.db, () => {
    const existente = um<SafraLinha>(ctx.db, 'SELECT * FROM safras WHERE id = ?', id);
    if (existente) {
      if (existente.produtor_id !== produtorId) throw conflito('Identificador já usado.');
      return { safra: existente, criada: false };
    }
    let prop: { id: string; produtor_id: string } | undefined;
    if (d.propriedadeId) {
      prop = um(ctx.db, 'SELECT id, produtor_id FROM propriedades WHERE id = ?', d.propriedadeId);
    } else {
      const padrao = propriedadePadrao(ctx, produtorId);
      prop = padrao && { id: padrao.id, produtor_id: produtorId };
    }
    if (!prop) throw naoEncontrado('Propriedade');
    if (prop.produtor_id !== produtorId) throw proibido('Propriedade de outro produtor.');

    const agora = agoraISO(ctx);
    exec(
      ctx.db,
      `INSERT INTO safras (id, produtor_id, propriedade_id, cultura, quantidade_kg, perecivel, origem, colhido_em, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      produtorId,
      prop.id,
      cultura.id,
      d.quantidadeKg,
      (d.perecivel ?? cultura.perecivel) ? 1 : 0,
      d.origem ?? 'app',
      d.colhidoEm ?? agora,
      agora,
    );
    return { safra: um<SafraLinha>(ctx.db, 'SELECT * FROM safras WHERE id = ?', id)!, criada: true };
  });
}
