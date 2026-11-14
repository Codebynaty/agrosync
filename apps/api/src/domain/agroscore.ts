/**
 * AgroScore: modelo de regressão logística que estima a probabilidade de um
 * produtor honrar um microcrédito, usando sinais da própria operação no AgroSync
 * (sem histórico bancário).
 *
 * O modelo é treinado por gradiente descendente sobre uma base sintética com
 * semente fixa (determinística). Em produção, a base sintética é substituída
 * pelo histórico real de microcréditos concedidos.
 */

export type Caracteristicas = {
  /** Fretes concluídos e pagos. */
  entregas: number;
  /** Fração de pagamentos de frete feitos em até 72 h (0 a 1). */
  pontualidade: number;
  /** Volume médio por entrega (kg). */
  volumeMedioKg: number;
  /** Meses distintos com colheita registrada. */
  mesesAtivos: number;
  /** Pedidos cancelados pelo produtor. */
  cancelamentos: number;
};

const NOMES: (keyof Caracteristicas)[] = ['entregas', 'pontualidade', 'volumeMedioKg', 'mesesAtivos', 'cancelamentos'];

export const ROTULOS: Record<keyof Caracteristicas, string> = {
  entregas: 'Entregas concluídas',
  pontualidade: 'Pagamentos de frete em dia',
  volumeMedioKg: 'Volume médio por entrega',
  mesesAtivos: 'Meses com colheita registrada',
  cancelamentos: 'Pedidos cancelados',
};

export type Modelo = {
  versao: string;
  media: number[];
  desvio: number[];
  pesos: number[];
  vies: number;
};

function vetor(c: Caracteristicas): number[] {
  return [
    Math.min(c.entregas, 40),
    c.pontualidade,
    Math.log1p(Math.max(0, c.volumeMedioKg)),
    Math.min(c.mesesAtivos, 24),
    Math.min(c.cancelamentos, 20),
  ];
}

function mulberry32(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sigmoide = (z: number) => 1 / (1 + Math.exp(-z));

/** Base sintética: relações plausíveis (mais entregas/pontualidade ↑, cancelamentos ↓) + ruído. */
export function gerarBaseSintetica(n = 3000, semente = 2026): { x: Caracteristicas; y: 0 | 1 }[] {
  const rnd = mulberry32(semente);
  const base: { x: Caracteristicas; y: 0 | 1 }[] = [];
  for (let i = 0; i < n; i++) {
    const x: Caracteristicas = {
      entregas: Math.floor(rnd() * 30),
      pontualidade: Math.min(1, Math.max(0, 0.35 + rnd() * 0.75 - 0.1)),
      volumeMedioKg: 100 + rnd() * 2500,
      mesesAtivos: Math.floor(rnd() * 18),
      cancelamentos: Math.floor(rnd() ** 2 * 8),
    };
    const z =
      -2.2 + 0.07 * x.entregas + 2.6 * x.pontualidade + 0.18 * Math.log1p(x.volumeMedioKg) + 0.06 * x.mesesAtivos - 0.45 * x.cancelamentos;
    const ruido = (rnd() - 0.5) * 1.2;
    base.push({ x, y: rnd() < sigmoide(z + ruido) ? 1 : 0 });
  }
  return base;
}

export function treinar(base: { x: Caracteristicas; y: 0 | 1 }[], epocas = 400, taxa = 0.3): Modelo {
  const X = base.map((b) => vetor(b.x));
  const d = NOMES.length;
  const media = Array.from({ length: d }, (_, j) => X.reduce((s, r) => s + r[j], 0) / X.length);
  const desvio = Array.from({ length: d }, (_, j) => {
    const v = X.reduce((s, r) => s + (r[j] - media[j]) ** 2, 0) / X.length;
    return Math.sqrt(v) || 1;
  });
  const Z = X.map((r) => r.map((v, j) => (v - media[j]) / desvio[j]));
  const pesos = new Array(d).fill(0);
  let vies = 0;
  const lambda = 0.001;

  for (let e = 0; e < epocas; e++) {
    const grad = new Array(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < Z.length; i++) {
      const p = sigmoide(Z[i].reduce((s, v, j) => s + v * pesos[j], vies));
      const erro = p - base[i].y;
      for (let j = 0; j < d; j++) grad[j] += erro * Z[i][j];
      gradB += erro;
    }
    for (let j = 0; j < d; j++) pesos[j] -= taxa * (grad[j] / Z.length + lambda * pesos[j]);
    vies -= taxa * (gradB / Z.length);
  }
  return { versao: 'logreg-v1', media, desvio, pesos, vies };
}

let modeloPadrao: Modelo | null = null;
export function obterModelo(): Modelo {
  if (!modeloPadrao) modeloPadrao = treinar(gerarBaseSintetica());
  return modeloPadrao;
}

export type FatorScore = { chave: keyof Caracteristicas; rotulo: string; valor: number; impacto: number };

export type ResultadoScore = {
  score: number;
  probabilidade: number;
  faixa: 'A' | 'B' | 'C' | 'D';
  limiteSugeridoCentavos: number;
  fatores: FatorScore[];
  historicoInsuficiente: boolean;
  modeloVersao: string;
};

export function calcularScore(c: Caracteristicas, modelo: Modelo = obterModelo()): ResultadoScore {
  const v = vetor(c);
  const z = v.map((x, j) => (x - modelo.media[j]) / modelo.desvio[j]);
  const contrib = z.map((x, j) => x * modelo.pesos[j]);
  const p = sigmoide(contrib.reduce((s, x) => s + x, modelo.vies));
  const score = Math.round(300 + 600 * p);
  const faixa = score >= 750 ? 'A' : score >= 620 ? 'B' : score >= 480 ? 'C' : 'D';
  const historicoInsuficiente = c.entregas < 2;
  const limite = historicoInsuficiente
    ? 30000
    : { A: 500000, B: 250000, C: 100000, D: 0 }[faixa];

  return {
    score,
    probabilidade: p,
    faixa,
    limiteSugeridoCentavos: limite,
    fatores: NOMES.map((k, j) => ({ chave: k, rotulo: ROTULOS[k], valor: c[k], impacto: contrib[j] })).sort(
      (a, b) => Math.abs(b.impacto) - Math.abs(a.impacto),
    ),
    historicoInsuficiente,
    modeloVersao: modelo.versao,
  };
}
