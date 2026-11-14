import { dividirProporcional } from './dinheiro.js';
import { distanciaEstradaKm, planejarRota, type Ponto } from './geo.js';

export type ParametrosFrete = {
  /** Capacidade do caminhão em kg. */
  capacidadeKg: number;
  /** Raio máximo (km) de cada parada até o centro do grupo. */
  raioKm: number;
  /** Janela de agrupamento em horas. */
  janelaHoras: number;
  /** Custo fixo de mobilizar um caminhão. */
  taxaFixaCentavos: number;
  /** Custo de cada parada (carga/descarga). */
  taxaParadaCentavos: number;
  /** Custo por km rodado. */
  custoKmCentavos: number;
};

export const PARAMETROS_PADRAO: ParametrosFrete = {
  capacidadeKg: 6000,
  raioKm: 25,
  janelaHoras: 48,
  taxaFixaCentavos: 6000,
  taxaParadaCentavos: 2500,
  custoKmCentavos: 450,
};

export function custoViagem(distanciaKm: number, paradas: number, p: ParametrosFrete): number {
  return p.taxaFixaCentavos + paradas * p.taxaParadaCentavos + Math.round(distanciaKm * p.custoKmCentavos);
}

/** Frete individual: o caminhão sai do destino, vai à propriedade e volta. */
export function custoIndividual(propriedade: Ponto, destino: Ponto, p: ParametrosFrete): number {
  return custoViagem(2 * distanciaEstradaKm(propriedade, destino), 1, p);
}

export type ParadaFrete = Ponto & { pedidoId: string; volumeKg: number };

export type PlanoCarga = {
  ordem: ParadaFrete[];
  distanciaKm: number;
  custoTotalCentavos: number;
  custosIndividuais: Record<string, number>;
  custoIndividualTotalCentavos: number;
  rateio: Record<string, number>;
};

/**
 * Rateio justo do custo coletivo.
 * Peso = volume × distância da propriedade ao destino (quem leva mais e mora mais longe paga mais),
 * com teto: ninguém paga mais do que pagaria no frete individual.
 */
export function ratear(
  custoTotal: number,
  itens: { pedidoId: string; volumeKg: number; distanciaKm: number; custoIndividual: number }[],
): Record<string, number> {
  const somaTetos = itens.reduce((s, i) => s + i.custoIndividual, 0);
  if (custoTotal > somaTetos) throw new Error('custo coletivo maior que a soma dos fretes individuais');

  const resultado: Record<string, number> = {};
  let abertos = [...itens];
  let restante = custoTotal;

  while (abertos.length) {
    const partes = dividirProporcional(
      restante,
      abertos.map((i) => i.volumeKg * Math.max(i.distanciaKm, 1)),
    );
    const estourados = abertos.filter((i, k) => partes[k] > i.custoIndividual);
    if (estourados.length === 0) {
      abertos.forEach((i, k) => (resultado[i.pedidoId] = partes[k]));
      break;
    }
    for (const i of estourados) {
      resultado[i.pedidoId] = i.custoIndividual;
      restante -= i.custoIndividual;
    }
    abertos = abertos.filter((i) => !estourados.includes(i));
  }
  return resultado;
}

export function planejarCarga(destino: Ponto, paradas: ParadaFrete[], p: ParametrosFrete): PlanoCarga {
  const { ordem, distanciaKm } = planejarRota(destino, paradas);
  const custoTotalCentavos = custoViagem(distanciaKm, paradas.length, p);
  const custosIndividuais: Record<string, number> = {};
  for (const s of paradas) custosIndividuais[s.pedidoId] = custoIndividual(s, destino, p);
  const custoIndividualTotalCentavos = Object.values(custosIndividuais).reduce((a, b) => a + b, 0);

  const rateio =
    custoTotalCentavos <= custoIndividualTotalCentavos
      ? ratear(
          custoTotalCentavos,
          paradas.map((s) => ({
            pedidoId: s.pedidoId,
            volumeKg: s.volumeKg,
            distanciaKm: distanciaEstradaKm(s, destino),
            custoIndividual: custosIndividuais[s.pedidoId],
          })),
        )
      : {};

  return { ordem, distanciaKm, custoTotalCentavos, custosIndividuais, custoIndividualTotalCentavos, rateio };
}
