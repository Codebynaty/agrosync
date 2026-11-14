import crypto from 'node:crypto';
import type { Ponto } from '../domain/geo.js';

export type Previsao = {
  data: string;
  chuvaMm: number;
  ventoKmh: number;
  tempMaxC: number;
  severo: boolean;
  descricao: string;
  fonte: string;
};

export interface ProvedorClima {
  readonly nome: string;
  previsao(ponto: Ponto, data: string): Promise<Previsao>;
}

export function classificar(chuvaMm: number, ventoKmh: number): { severo: boolean; descricao: string } {
  if (chuvaMm >= 50) return { severo: true, descricao: 'Chuva muito forte: risco de estradas de terra intransitáveis' };
  if (ventoKmh >= 60) return { severo: true, descricao: 'Ventos fortes: risco de queda de árvores nas estradas' };
  if (chuvaMm >= 20) return { severo: false, descricao: 'Chuva moderada: proteja a carga' };
  if (chuvaMm >= 2) return { severo: false, descricao: 'Chuva fraca' };
  return { severo: false, descricao: 'Tempo firme' };
}

/** Simulador determinístico (mesmo lugar + mesma data = mesma previsão). Cerca de 1 em 8 dias é severo. */
export class ClimaSimulado implements ProvedorClima {
  readonly nome = 'clima-simulado';
  async previsao(p: Ponto, data: string): Promise<Previsao> {
    const h = crypto.createHash('sha256').update(`${p.lat.toFixed(1)}|${p.lng.toFixed(1)}|${data}`).digest();
    const r1 = h[0] / 255;
    const r2 = h[1] / 255;
    const chuvaMm = r1 > 0.875 ? Math.round(50 + r2 * 40) : r1 > 0.55 ? Math.round(r2 * 30) : 0;
    const ventoKmh = Math.round(8 + (h[2] / 255) * 35);
    const tempMaxC = Math.round(22 + (h[3] / 255) * 10);
    return { data, chuvaMm, ventoKmh, tempMaxC, ...classificar(chuvaMm, ventoKmh), fonte: 'Simulado (modelo INMET)' };
  }
}

/** Previsão real via Open-Meteo (gratuita, sem chave). Ative com CLIMA_PROVIDER=open-meteo. */
export class ClimaOpenMeteo implements ProvedorClima {
  readonly nome = 'open-meteo';
  private reserva = new ClimaSimulado();
  async previsao(p: Ponto, data: string): Promise<Previsao> {
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', p.lat.toFixed(3));
      url.searchParams.set('longitude', p.lng.toFixed(3));
      url.searchParams.set('daily', 'precipitation_sum,wind_speed_10m_max,temperature_2m_max');
      url.searchParams.set('timezone', 'America/Sao_Paulo');
      url.searchParams.set('start_date', data);
      url.searchParams.set('end_date', data);
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`open-meteo ${r.status}`);
      const j = (await r.json()) as { daily: { precipitation_sum: number[]; wind_speed_10m_max: number[]; temperature_2m_max: number[] } };
      const chuvaMm = Math.round(j.daily.precipitation_sum[0] ?? 0);
      const ventoKmh = Math.round(j.daily.wind_speed_10m_max[0] ?? 0);
      const tempMaxC = Math.round(j.daily.temperature_2m_max[0] ?? 0);
      return { data, chuvaMm, ventoKmh, tempMaxC, ...classificar(chuvaMm, ventoKmh), fonte: 'Open-Meteo' };
    } catch {
      return this.reserva.previsao(p, data);
    }
  }
}
