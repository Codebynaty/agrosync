import { centroide, distanciaKm, projetar, type Ponto } from './geo.js';
import { planejarCarga, type ParametrosFrete } from './frete.js';

export type PedidoAgrupavel = Ponto & {
  id: string;
  volumeKg: number;
  /** Data desejada de coleta, YYYY-MM-DD. */
  dataDesejada: string;
  destinoId: string;
};

type XY = { x: number; y: number };

/**
 * K-Means determinístico: inicialização farthest-first (sem aleatoriedade),
 * para que o mesmo conjunto de pedidos gere sempre os mesmos grupos.
 */
export function kmeans(pontos: XY[], k: number, maxIter = 100): number[] {
  const n = pontos.length;
  if (k >= n) return pontos.map((_, i) => i);
  const d2 = (a: XY, b: XY) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

  const centros: XY[] = [pontos[0]];
  while (centros.length < k) {
    let melhor = 0;
    let melhorDist = -1;
    pontos.forEach((p, i) => {
      const d = Math.min(...centros.map((c) => d2(p, c)));
      if (d > melhorDist) {
        melhorDist = d;
        melhor = i;
      }
    });
    centros.push(pontos[melhor]);
  }

  let rotulos = new Array<number>(n).fill(-1);
  for (let it = 0; it < maxIter; it++) {
    const novos = pontos.map((p) => {
      let m = 0;
      for (let c = 1; c < k; c++) if (d2(p, centros[c]) < d2(p, centros[m])) m = c;
      return m;
    });
    const mudou = novos.some((r, i) => r !== rotulos[i]);
    rotulos = novos;
    for (let c = 0; c < k; c++) {
      const membros = pontos.filter((_, i) => rotulos[i] === c);
      if (membros.length) {
        centros[c] = {
          x: membros.reduce((s, p) => s + p.x, 0) / membros.length,
          y: membros.reduce((s, p) => s + p.y, 0) / membros.length,
        };
      }
    }
    if (!mudou) break;
  }
  return rotulos;
}

export function grupoValido(grupo: PedidoAgrupavel[], p: ParametrosFrete): boolean {
  const volume = grupo.reduce((s, g) => s + g.volumeKg, 0);
  if (volume > p.capacidadeKg) return false;
  const c = centroide(grupo);
  return grupo.every((g) => distanciaKm(g, c) <= p.raioKm);
}

/** Particiona um conjunto em grupos que respeitam capacidade e raio, com o menor k possível. */
export function particionar(pedidos: PedidoAgrupavel[], p: ParametrosFrete): PedidoAgrupavel[][] {
  if (pedidos.length === 0) return [];
  const ref = centroide(pedidos);
  const xy = pedidos.map((q) => projetar(q, ref));
  const volume = pedidos.reduce((s, q) => s + q.volumeKg, 0);

  for (let k = Math.max(1, Math.ceil(volume / p.capacidadeKg)); k <= pedidos.length; k++) {
    const rotulos = kmeans(xy, k);
    const grupos: PedidoAgrupavel[][] = Array.from({ length: k }, () => []);
    rotulos.forEach((r, i) => grupos[r].push(pedidos[i]));
    const naoVazios = grupos.filter((g) => g.length > 0);
    if (naoVazios.every((g) => grupoValido(g, p))) return naoVazios;
  }
  return pedidos.map((q) => [q]);
}

export function diasEntre(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

/**
 * Agrupa pedidos em cargas coletivas:
 * 1. separa por destino;
 * 2. varre por data, formando janelas de `janelaHoras`;
 * 3. em cada janela, K-Means com restrição de capacidade e raio;
 * 4. só devolve grupos com 2+ pedidos e que saem mais baratos que os fretes individuais.
 */
export function agruparPedidos(
  pedidos: PedidoAgrupavel[],
  destinos: Record<string, Ponto>,
  p: ParametrosFrete,
): PedidoAgrupavel[][] {
  const elegiveis = pedidos.filter((q) => q.volumeKg <= p.capacidadeKg);
  const porDestino = new Map<string, PedidoAgrupavel[]>();
  for (const q of elegiveis) {
    if (!destinos[q.destinoId]) continue;
    porDestino.set(q.destinoId, [...(porDestino.get(q.destinoId) ?? []), q]);
  }

  const janelaDias = p.janelaHoras / 24;
  const resultado: PedidoAgrupavel[][] = [];

  for (const [destinoId, lista] of [...porDestino.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ordenados = [...lista].sort((a, b) => a.dataDesejada.localeCompare(b.dataDesejada) || a.id.localeCompare(b.id));
    let i = 0;
    while (i < ordenados.length) {
      const inicio = ordenados[i].dataDesejada;
      const janela: PedidoAgrupavel[] = [];
      while (i < ordenados.length && diasEntre(inicio, ordenados[i].dataDesejada) < janelaDias) {
        janela.push(ordenados[i]);
        i++;
      }
      for (const grupo of particionar(janela, p)) {
        if (grupo.length < 2) continue;
        const plano = planejarCarga(
          destinos[destinoId],
          grupo.map((g) => ({ lat: g.lat, lng: g.lng, pedidoId: g.id, volumeKg: g.volumeKg })),
          p,
        );
        if (plano.custoTotalCentavos < plano.custoIndividualTotalCentavos) resultado.push(grupo);
      }
    }
  }
  return resultado;
}
