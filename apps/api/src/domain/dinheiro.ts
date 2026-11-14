/**
 * Dinheiro é sempre inteiro em centavos. Nunca ponto flutuante.
 */

export function formatarBRL(centavos: number): string {
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cents = (abs % 100).toString().padStart(2, '0');
  return `${sinal}R$ ${reais},${cents}`;
}

/**
 * Divide `total` centavos proporcionalmente aos pesos, pelo método do maior resto.
 * Garante: resultado inteiro, não negativo e soma exatamente igual a `total`.
 */
export function dividirProporcional(total: number, pesos: number[]): number[] {
  if (!Number.isInteger(total) || total < 0) throw new Error('total deve ser inteiro >= 0 (centavos)');
  if (pesos.length === 0) return [];
  if (pesos.some((p) => !(p >= 0) || !Number.isFinite(p))) throw new Error('pesos devem ser números >= 0');

  const soma = pesos.reduce((s, p) => s + p, 0);
  const efetivos = soma === 0 ? pesos.map(() => 1) : pesos;
  const somaEf = soma === 0 ? pesos.length : soma;

  const brutos = efetivos.map((p) => (total * p) / somaEf);
  const base = brutos.map((v) => Math.floor(v));
  let sobra = total - base.reduce((s, v) => s + v, 0);

  const ordem = brutos
    .map((v, i) => ({ i, resto: v - Math.floor(v) }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);

  for (let k = 0; sobra > 0; k = (k + 1) % ordem.length, sobra--) base[ordem[k].i] += 1;
  return base;
}
