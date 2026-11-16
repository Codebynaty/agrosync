import crypto from 'node:crypto';
import { exec, todos, transacao, um } from '../db.js';
import { buscarCultura } from '../domain/culturas.js';
import { dataLocal } from '../domain/tempo.js';
import { classificarSafra, valorEstimado, type Caracteristicas, type ClasseSafra } from '../domain/triagem.js';
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
  triagem_classe: string | null;
  triagem_pontuacao: number | null;
  triagem_maturidade: string | null;
  triagem_json: string | null;
  triagem_miniatura: string | null;
};

export type TriagemEntrada = { caracteristicas: Caracteristicas; miniatura?: string };

export type SafraComValor = SafraLinha & {
  pedido_id: string | null;
  preco_centavos_kg: number;
  valor_bruto_centavos: number;
  valor_estimado_centavos: number;
  ajuste_pct: number;
};

/**
 * Lista as colheitas do produtor já com o valor estimado em reais: cotação do dia
 * × quantidade, ajustado pela classe da triagem. O cálculo mora no servidor para
 * que app, bot e painel mostrem exatamente o mesmo número.
 */
export async function listarSafras(ctx: Contexto, produtorId: string): Promise<SafraComValor[]> {
  const linhas = todos<SafraLinha & { pedido_id: string | null }>(
    ctx.db,
    `SELECT s.*, (SELECT p.id FROM pedidos p WHERE p.safra_id = s.id AND p.status <> 'cancelado') AS pedido_id
       FROM safras s WHERE s.produtor_id = ? ORDER BY s.criado_em DESC LIMIT 100`,
    produtorId,
  );
  const cot = Object.fromEntries((await ctx.cotacoes.cotacoes(dataLocal(ctx.agora()))).map((c) => [c.cultura, c.precoCentavosKg]));
  return linhas.map((s) => {
    const preco = cot[s.cultura] ?? 0;
    const v = valorEstimado(preco, s.quantidade_kg, s.triagem_classe as ClasseSafra | null);
    return { ...s, preco_centavos_kg: preco, valor_bruto_centavos: v.brutoCentavos, valor_estimado_centavos: v.ajustadoCentavos, ajuste_pct: v.ajustePct };
  });
}

export type NovaSafra = {
  id?: string;
  propriedadeId?: string;
  cultura: string;
  quantidadeKg: number;
  perecivel?: boolean;
  colhidoEm?: string;
  origem?: 'app' | 'voz' | 'bot' | 'sensor' | 'seed';
  triagem?: TriagemEntrada;
};

/** Miniatura só é aceita se for um data URL de imagem pequeno (evita inchar o banco). */
const MAX_MINIATURA = 64 * 1024;

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

    // Triagem visual: o julgamento é refeito no servidor a partir das características
    // percebidas no dispositivo (o app não dita a classe; aqui é a fonte da verdade).
    let classe: string | null = null;
    let pontuacao: number | null = null;
    let maturidade: string | null = null;
    let triagemJson: string | null = null;
    let miniatura: string | null = null;
    if (d.triagem) {
      const resultado = classificarSafra(cultura.id, d.triagem.caracteristicas);
      classe = resultado.classe;
      pontuacao = resultado.pontuacao;
      maturidade = resultado.maturidade;
      triagemJson = JSON.stringify({ ...resultado, caracteristicas: d.triagem.caracteristicas });
      const m = d.triagem.miniatura;
      if (m && m.startsWith('data:image/') && m.length <= MAX_MINIATURA) miniatura = m;
    }

    const agora = agoraISO(ctx);
    exec(
      ctx.db,
      `INSERT INTO safras (id, produtor_id, propriedade_id, cultura, quantidade_kg, perecivel, origem, colhido_em, criado_em,
                           triagem_classe, triagem_pontuacao, triagem_maturidade, triagem_json, triagem_miniatura)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      produtorId,
      prop.id,
      cultura.id,
      d.quantidadeKg,
      (d.perecivel ?? cultura.perecivel) ? 1 : 0,
      d.origem ?? 'app',
      d.colhidoEm ?? agora,
      agora,
      classe,
      pontuacao,
      maturidade,
      triagemJson,
      miniatura,
    );
    return { safra: um<SafraLinha>(ctx.db, 'SELECT * FROM safras WHERE id = ?', id)!, criada: true };
  });
}
