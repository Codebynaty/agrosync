/**
 * Triagem visual — percepção da foto NO DISPOSITIVO (offline, sem baixar modelo).
 *
 * Lê os pixels da foto num canvas pequeno e mede sinais genéricos (frações de cor,
 * nitidez, brilho, quanto do quadro é produto). Quem julga a qualidade por cultura
 * é o servidor (apps/api/src/domain/triagem.ts): aqui não se decide a classe.
 * Em produção, esta percepção é trocada por um modelo de visão no aparelho.
 */

export type Caracteristicas = {
  vermelho: number;
  laranja: number;
  amarelo: number;
  verde: number;
  marrom: number;
  escuro: number;
  claro: number;
  cobertura: number;
  nitidez: number;
  brilho: number;
};

export type ClasseSafra = 'A' | 'B' | 'C' | 'refugo' | 'rever';

export type ResultadoTriagem = {
  classe: ClasseSafra;
  rotulo: string;
  pontuacao: number;
  maturidade: 'verde' | 'no_ponto' | 'passado' | 'incerta';
  confiavel: boolean;
  ajustePrecoPct: number;
  observacoes: string[];
  fatores: { rotulo: string; efeito: number }[];
};

/** Aparência do selo de qualidade por classe (tom combina com as classes .chip do CSS). */
export const APARENCIA_CLASSE: Record<ClasseSafra, { tom: string; emoji: string }> = {
  A: { tom: 'ok', emoji: '🟢' },
  B: { tom: 'info', emoji: '🔵' },
  C: { tom: 'warn', emoji: '🟡' },
  refugo: { tom: 'bad', emoji: '🔴' },
  rever: { tom: '', emoji: '📷' },
};

function rgbParaHsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max === 0 ? 0 : (max - min) / max;
  let h = 0;
  const d = max - min;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

function desenhar(img: HTMLImageElement, lado: number): ImageData | null {
  const canvas = document.createElement('canvas');
  canvas.width = lado;
  canvas.height = lado;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, lado, lado);
  try {
    return ctx.getImageData(0, 0, lado, lado);
  } catch {
    return null;
  }
}

function miniaturaDataUrl(img: HTMLImageElement, lado = 96): string | undefined {
  const canvas = document.createElement('canvas');
  const escala = Math.min(1, lado / Math.max(img.width, img.height));
  canvas.width = Math.max(1, Math.round(img.width * escala));
  canvas.height = Math.max(1, Math.round(img.height * escala));
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL('image/jpeg', 0.55);
  } catch {
    return undefined;
  }
}

function extrair(dados: ImageData): Caracteristicas {
  const { data, width, height } = dados;
  const lum = new Float32Array(width * height);
  const familias = { vermelho: 0, laranja: 0, amarelo: 0, verde: 0, marrom: 0, escuro: 0, claro: 0 };
  let produto = 0;
  let somaLum = 0;

  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[px] = l;
    somaLum += l;
    const { h, s, v } = rgbParaHsv(r, g, b);

    // Fundo claro/neutro (mesa, bancada, céu): não é produto.
    if (s < 0.12 && v > 0.85) continue;
    produto++;

    if (v < 0.22) familias.escuro++;
    else if (s < 0.15 && v > 0.9) familias.claro++;
    else if (h >= 10 && h < 45 && v < 0.5 && s > 0.3) familias.marrom++;
    else if (h >= 345 || h < 16 || (h >= 300 && h < 345)) familias.vermelho++;
    else if (h >= 16 && h < 42) familias.laranja++;
    else if (h >= 42 && h < 70) familias.amarelo++;
    else if (h >= 70 && h < 175) familias.verde++;
    else familias.claro++;
  }

  // Nitidez: energia média de gradiente da luminância (foto borrada → baixa).
  let grad = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (x + 1 < width) grad += Math.abs(lum[p] - lum[p + 1]);
      if (y + 1 < height) grad += Math.abs(lum[p] - lum[p + width]);
    }
  }
  const gradMedio = grad / (2 * width * height);

  const n = Math.max(1, produto);
  const frac = (x: number) => Math.min(1, x / n);
  return {
    vermelho: frac(familias.vermelho),
    laranja: frac(familias.laranja),
    amarelo: frac(familias.amarelo),
    verde: frac(familias.verde),
    marrom: frac(familias.marrom),
    escuro: frac(familias.escuro),
    claro: frac(familias.claro),
    cobertura: produto / (width * height),
    nitidez: Math.min(1, gradMedio / 22),
    brilho: somaLum / (width * height) / 255,
  };
}

/** Lê a foto e devolve as características percebidas + uma miniatura pequena. */
export function analisarFoto(file: File): Promise<{ caracteristicas: Caracteristicas; miniatura?: string } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const dados = desenhar(img, 64);
      const miniatura = miniaturaDataUrl(img);
      URL.revokeObjectURL(url);
      resolve(dados ? { caracteristicas: extrair(dados), miniatura } : null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/** Dica rápida offline, sem afirmar a classe (quem classifica é o servidor). */
export function dicaLocal(c: Caracteristicas): string | null {
  if (c.nitidez < 0.35) return 'A foto ficou borrada — tente de novo com a mão firme.';
  if (c.cobertura < 0.4) return 'Pouco produto aparece na foto — aproxime a câmera.';
  if (c.brilho < 0.12) return 'Ambiente escuro — a foto ficou muito escura.';
  if (c.brilho > 0.95) return 'Foto muito clara/estourada — evite luz direta.';
  return null;
}
