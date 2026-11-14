export type Ponto = { lat: number; lng: number };

const RAIO_TERRA_KM = 6371;
const rad = (g: number) => (g * Math.PI) / 180;

/** Distância em linha reta (haversine), em km. */
export function distanciaKm(a: Ponto, b: Ponto): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Fator de tortuosidade: estradas rurais são mais longas que a linha reta.
 * 1,3 é uma aproximação usual para malha viária secundária.
 */
export const FATOR_ESTRADA = 1.3;

export function distanciaEstradaKm(a: Ponto, b: Ponto): number {
  return distanciaKm(a, b) * FATOR_ESTRADA;
}

/** Projeção equiretangular local em km, adequada para clusterização regional. */
export function projetar(p: Ponto, referencia: Ponto): { x: number; y: number } {
  const x = rad(p.lng - referencia.lng) * Math.cos(rad(referencia.lat)) * RAIO_TERRA_KM;
  const y = rad(p.lat - referencia.lat) * RAIO_TERRA_KM;
  return { x, y };
}

export function centroide(pontos: Ponto[]): Ponto {
  const n = pontos.length || 1;
  return {
    lat: pontos.reduce((s, p) => s + p.lat, 0) / n,
    lng: pontos.reduce((s, p) => s + p.lng, 0) / n,
  };
}

function comprimentoCircuito(base: Ponto, ordem: Ponto[]): number {
  if (ordem.length === 0) return 0;
  let total = distanciaEstradaKm(base, ordem[0]);
  for (let i = 1; i < ordem.length; i++) total += distanciaEstradaKm(ordem[i - 1], ordem[i]);
  total += distanciaEstradaKm(ordem[ordem.length - 1], base);
  return total;
}

/**
 * Rota fechada saindo do destino (onde o caminhão está), passando por todas as
 * paradas e voltando ao destino para descarregar.
 * Vizinho mais próximo + melhoria 2-opt (ótimo local; suficiente para poucas paradas).
 */
export function planejarRota<T extends Ponto>(base: Ponto, paradas: T[]): { ordem: T[]; distanciaKm: number } {
  const restantes = [...paradas];
  const ordem: T[] = [];
  let atual: Ponto = base;
  while (restantes.length) {
    let melhor = 0;
    for (let i = 1; i < restantes.length; i++) {
      if (distanciaKm(atual, restantes[i]) < distanciaKm(atual, restantes[melhor])) melhor = i;
    }
    const [p] = restantes.splice(melhor, 1);
    ordem.push(p);
    atual = p;
  }

  let melhorou = true;
  while (melhorou && ordem.length > 2) {
    melhorou = false;
    for (let i = 0; i < ordem.length - 1; i++) {
      for (let j = i + 1; j < ordem.length; j++) {
        const candidata = [...ordem.slice(0, i), ...ordem.slice(i, j + 1).reverse(), ...ordem.slice(j + 1)];
        if (comprimentoCircuito(base, candidata) + 1e-9 < comprimentoCircuito(base, ordem)) {
          ordem.splice(0, ordem.length, ...candidata);
          melhorou = true;
        }
      }
    }
  }

  return { ordem, distanciaKm: comprimentoCircuito(base, ordem) };
}

/** Menor distância (km) entre o ponto p e o segmento a-b. */
export function distanciaPontoSegmentoKm(p: Ponto, a: Ponto, b: Ponto): number {
  const ref = a;
  const P = projetar(p, ref);
  const A = { x: 0, y: 0 };
  const B = projetar(b, ref);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
  const cx = A.x + t * dx;
  const cy = A.y + t * dy;
  return Math.hypot(P.x - cx, P.y - cy);
}
