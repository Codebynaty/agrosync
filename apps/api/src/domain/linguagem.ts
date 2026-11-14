import { CULTURAS, type Cultura } from './culturas.js';

/** Remove acentos, baixa a caixa e normaliza espaços. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N},.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNIDADES: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16,
  dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
  sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200,
  trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500,
  seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800,
  novecentos: 900, novecentas: 900,
};

/** Converte números por extenso simples ("trezentos e cinquenta", "dois mil") em inteiro. */
export function numeroPorExtenso(palavras: string[]): number | null {
  let total = 0;
  let parcial = 0;
  let achou = false;
  for (const p of palavras) {
    if (p === 'e') continue;
    if (p === 'mil') {
      total += (parcial || 1) * 1000;
      parcial = 0;
      achou = true;
      continue;
    }
    if (!(p in UNIDADES)) return null;
    parcial += UNIDADES[p];
    achou = true;
  }
  return achou ? total + parcial : null;
}

const UNIDADES_PESO: { re: RegExp; fator: number }[] = [
  { re: /^(toneladas?|ton|t)$/, fator: 1000 },
  { re: /^(sacas?|sacos?)$/, fator: 60 },
  { re: /^(caixas?|cx)$/, fator: 20 },
  { re: /^(kg|kgs|quilos?|kilos?|quilogramas?)$/, fator: 1 },
];

export type ColheitaInterpretada = { cultura: Cultura; quantidadeKg: number; entendido: string };

/**
 * Interpreta frases como:
 *  "colhi 300 kg de tomate", "trezentos quilos de alface", "2 toneladas de milho",
 *  "10 caixas de morango", "tomate 150".
 * Caixa = 20 kg e saca = 60 kg (padrões de mercado). Sempre exige confirmação do usuário.
 */
export function interpretarColheita(texto: string): ColheitaInterpretada | null {
  const norm = normalizar(texto);
  const tokens = norm.split(' ');

  let cultura: Cultura | undefined;
  for (const c of CULTURAS) {
    if (c.sinonimos.some((s) => tokens.includes(s))) {
      cultura = c;
      break;
    }
  }
  if (!cultura) return null;

  let quantidade: number | null = null;
  let fator = 1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const numerico = t.replace(/\./g, '').replace(',', '.');
    if (/^\d+(\.\d+)?$/.test(numerico)) {
      quantidade = Number(numerico);
      const prox = tokens[i + 1];
      const u = prox && UNIDADES_PESO.find((u) => u.re.test(prox));
      if (u) fator = u.fator;
      break;
    }
    if (t in UNIDADES || t === 'mil') {
      const seq: string[] = [];
      let j = i;
      while (j < tokens.length && (tokens[j] in UNIDADES || tokens[j] === 'mil' || tokens[j] === 'e')) seq.push(tokens[j++]);
      while (seq.length && seq[seq.length - 1] === 'e') seq.pop();
      const n = numeroPorExtenso(seq);
      if (n !== null && n > 0) {
        quantidade = n;
        const u = tokens[j] && UNIDADES_PESO.find((u) => u.re.test(tokens[j]));
        if (u) fator = u.fator;
        break;
      }
    }
  }
  if (quantidade === null || quantidade <= 0) return null;
  const quantidadeKg = Math.round(quantidade * fator);
  if (quantidadeKg <= 0 || quantidadeKg > 100_000) return null;

  return {
    cultura,
    quantidadeKg,
    entendido: `${quantidadeKg.toLocaleString('pt-BR')} kg de ${cultura.nome.toLowerCase()}`,
  };
}
