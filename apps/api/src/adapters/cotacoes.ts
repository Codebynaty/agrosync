import crypto from 'node:crypto';
import { CULTURAS } from '../domain/culturas.js';

export type Cotacao = { cultura: string; nome: string; precoCentavosKg: number; variacaoPct: number; data: string; fonte: string };

export interface ProvedorCotacoes {
  readonly nome: string;
  cotacoes(data: string): Promise<Cotacao[]>;
}

function fatorDia(cultura: string, data: string): number {
  const h = crypto.createHash('sha256').update(`${cultura}|${data}`).digest();
  return 0.92 + (h[0] / 255) * 0.16; // ±8%
}

/** Cotações simuladas sobre preços de referência (estrutura compatível com Cepea/CONAB). */
export class CotacoesSimuladas implements ProvedorCotacoes {
  readonly nome = 'cotacoes-simuladas';
  async cotacoes(data: string): Promise<Cotacao[]> {
    const ontem = new Date(`${data}T12:00:00Z`);
    ontem.setUTCDate(ontem.getUTCDate() - 1);
    const dOntem = ontem.toISOString().slice(0, 10);
    return CULTURAS.map((c) => {
      const hoje = Math.round(c.precoBaseCentavosKg * fatorDia(c.id, data));
      const antes = Math.round(c.precoBaseCentavosKg * fatorDia(c.id, dOntem));
      return {
        cultura: c.id,
        nome: c.nome,
        precoCentavosKg: hoje,
        variacaoPct: Math.round(((hoje - antes) / antes) * 1000) / 10,
        data,
        fonte: 'Simulado (referência Cepea/CONAB)',
      };
    });
  }
}
