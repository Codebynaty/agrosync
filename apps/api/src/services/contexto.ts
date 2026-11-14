import type { ProvedorClima } from '../adapters/clima.js';
import type { ProvedorCotacoes } from '../adapters/cotacoes.js';
import type { Notificador } from '../adapters/notificacao.js';
import type { PixSimulado, ProvedorPix } from '../adapters/pix.js';
import type { Config } from '../config.js';
import type { DB } from '../db.js';

export type Contexto = {
  db: DB;
  config: Config;
  pix: ProvedorPix & Partial<Pick<PixSimulado, 'simularPagamento'>>;
  notificador: Notificador;
  clima: ProvedorClima;
  cotacoes: ProvedorCotacoes;
  agora: () => Date;
  log: (m: string) => void;
};

export class ErroApp extends Error {
  constructor(
    public status: number,
    message: string,
    public codigo = 'erro',
  ) {
    super(message);
  }
}

export const naoEncontrado = (o: string) => new ErroApp(404, `${o} não encontrado(a).`, 'nao_encontrado');
export const conflito = (m: string) => new ErroApp(409, m, 'conflito');
export const proibido = (m = 'Sem permissão para esta ação.') => new ErroApp(403, m, 'proibido');
export const invalido = (m: string) => new ErroApp(400, m, 'invalido');

export const agoraISO = (ctx: Contexto) => ctx.agora().toISOString();
