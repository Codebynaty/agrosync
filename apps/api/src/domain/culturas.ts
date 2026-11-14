export type Cultura = {
  id: string;
  nome: string;
  emoji: string;
  perecivel: boolean;
  /** Preço base de referência em centavos por kg (usado pelo adapter simulado de cotações). */
  precoBaseCentavosKg: number;
  sinonimos: string[];
};

export const CULTURAS: Cultura[] = [
  { id: 'tomate', nome: 'Tomate', emoji: '🍅', perecivel: true, precoBaseCentavosKg: 520, sinonimos: ['tomate', 'tomates'] },
  { id: 'alface', nome: 'Alface', emoji: '🥬', perecivel: true, precoBaseCentavosKg: 380, sinonimos: ['alface', 'alfaces'] },
  { id: 'couve', nome: 'Couve', emoji: '🥬', perecivel: true, precoBaseCentavosKg: 450, sinonimos: ['couve', 'couves'] },
  { id: 'morango', nome: 'Morango', emoji: '🍓', perecivel: true, precoBaseCentavosKg: 1650, sinonimos: ['morango', 'morangos'] },
  { id: 'banana', nome: 'Banana', emoji: '🍌', perecivel: true, precoBaseCentavosKg: 340, sinonimos: ['banana', 'bananas'] },
  { id: 'cenoura', nome: 'Cenoura', emoji: '🥕', perecivel: true, precoBaseCentavosKg: 290, sinonimos: ['cenoura', 'cenouras'] },
  { id: 'batata', nome: 'Batata', emoji: '🥔', perecivel: false, precoBaseCentavosKg: 310, sinonimos: ['batata', 'batatas'] },
  { id: 'mandioca', nome: 'Mandioca', emoji: '🌿', perecivel: false, precoBaseCentavosKg: 220, sinonimos: ['mandioca', 'aipim', 'macaxeira'] },
  { id: 'milho', nome: 'Milho', emoji: '🌽', perecivel: false, precoBaseCentavosKg: 110, sinonimos: ['milho'] },
  { id: 'feijao', nome: 'Feijão', emoji: '🫘', perecivel: false, precoBaseCentavosKg: 780, sinonimos: ['feijao', 'feijoes'] },
  { id: 'cafe', nome: 'Café', emoji: '☕', perecivel: false, precoBaseCentavosKg: 2350, sinonimos: ['cafe'] },
  { id: 'laranja', nome: 'Laranja', emoji: '🍊', perecivel: true, precoBaseCentavosKg: 160, sinonimos: ['laranja', 'laranjas'] },
];

export const CULTURA_POR_ID = Object.fromEntries(CULTURAS.map((c) => [c.id, c]));

export function buscarCultura(id: string): Cultura | undefined {
  return CULTURA_POR_ID[id];
}
