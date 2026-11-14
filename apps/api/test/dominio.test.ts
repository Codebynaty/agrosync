import { describe, expect, it } from 'vitest';
import { agruparPedidos, kmeans, type PedidoAgrupavel } from '../src/domain/agrupamento.js';
import { calcularScore } from '../src/domain/agroscore.js';
import { dividirProporcional, formatarBRL } from '../src/domain/dinheiro.js';
import { podeTransitarCarga, podeTransitarPedido } from '../src/domain/estados.js';
import { custoIndividual, PARAMETROS_PADRAO, planejarCarga, ratear } from '../src/domain/frete.js';
import { distanciaKm, planejarRota } from '../src/domain/geo.js';
import { interpretarColheita } from '../src/domain/linguagem.js';
import { somarDias } from '../src/domain/tempo.js';
import { rotaAfetada } from '../src/services/bloqueios.js';

const CEAGESP = { lat: -23.5367, lng: -46.7296 };
const IBIUNA = [
  { lat: -23.6712, lng: -47.2391 },
  { lat: -23.6301, lng: -47.261 },
  { lat: -23.701, lng: -47.398 },
  { lat: -23.66, lng: -47.22 },
];

describe('dinheiro', () => {
  it('divide centavos sem perder nem criar dinheiro', () => {
    for (const [total, pesos] of [
      [100, [1, 1, 1]],
      [1, [1, 1]],
      [99_999, [3, 7, 11, 13]],
      [0, [1, 2]],
      [500, [0, 0, 0]],
    ] as [number, number[]][]) {
      const partes = dividirProporcional(total, pesos);
      expect(partes.reduce((a, b) => a + b, 0)).toBe(total);
      expect(partes.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
    }
  });

  it('respeita a proporção', () => {
    expect(dividirProporcional(1000, [1, 3])).toEqual([250, 750]);
  });

  it('rejeita valores não inteiros', () => {
    expect(() => dividirProporcional(10.5, [1])).toThrow();
  });

  it('formata em reais', () => {
    expect(formatarBRL(123456)).toBe('R$ 1.234,56');
    expect(formatarBRL(5)).toBe('R$ 0,05');
  });
});

describe('geografia e rota', () => {
  it('haversine Ibiúna → CEAGESP fica entre 50 e 60 km em linha reta', () => {
    const d = distanciaKm(IBIUNA[0], CEAGESP);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(60);
  });

  it('rota visita todas as paradas e não é pior que a ordem original', () => {
    const paradas = IBIUNA.map((p, i) => ({ ...p, id: i }));
    const { ordem, distanciaKm: d } = planejarRota(CEAGESP, paradas);
    expect(new Set(ordem.map((o) => o.id)).size).toBe(paradas.length);
    const ingenua = planejarRota(CEAGESP, [paradas[2], paradas[0], paradas[3], paradas[1]]);
    expect(d).toBeLessThanOrEqual(ingenua.distanciaKm + 1e-6);
  });
});

describe('frete e rateio', () => {
  const paradas = IBIUNA.map((p, i) => ({ ...p, pedidoId: `p${i}`, volumeKg: 500 + i * 200 }));
  const plano = planejarCarga(CEAGESP, paradas, PARAMETROS_PADRAO);

  it('carga coletiva sai mais barata que a soma dos fretes individuais', () => {
    expect(plano.custoTotalCentavos).toBeLessThan(plano.custoIndividualTotalCentavos);
  });

  it('o rateio soma exatamente o custo da carga', () => {
    const soma = Object.values(plano.rateio).reduce((a, b) => a + b, 0);
    expect(soma).toBe(plano.custoTotalCentavos);
  });

  it('ninguém paga mais do que pagaria sozinho', () => {
    for (const p of paradas) expect(plano.rateio[p.pedidoId]).toBeLessThanOrEqual(plano.custosIndividuais[p.pedidoId]);
  });

  it('aplica o teto e redistribui o excedente', () => {
    const r = ratear(1000, [
      { pedidoId: 'a', volumeKg: 1000, distanciaKm: 50, custoIndividual: 300 },
      { pedidoId: 'b', volumeKg: 10, distanciaKm: 50, custoIndividual: 900 },
    ]);
    expect(r.a).toBe(300);
    expect(r.b).toBe(700);
  });

  it('custo individual cresce com a distância', () => {
    expect(custoIndividual(IBIUNA[2], CEAGESP, PARAMETROS_PADRAO)).toBeGreaterThan(custoIndividual(IBIUNA[0], CEAGESP, PARAMETROS_PADRAO));
  });
});

describe('agrupamento (K-Means com restrições)', () => {
  const base = (id: string, p: { lat: number; lng: number }, kg = 500, data = '2026-11-20', destinoId = 'ceagesp'): PedidoAgrupavel => ({
    id,
    ...p,
    volumeKg: kg,
    dataDesejada: data,
    destinoId,
  });
  const destinos = { ceagesp: CEAGESP, outro: { lat: -22.9, lng: -47.06 } };

  it('é determinístico', () => {
    const pts = IBIUNA.map((p) => ({ x: p.lng * 100, y: p.lat * 100 }));
    expect(kmeans(pts, 2)).toEqual(kmeans(pts, 2));
  });

  it('agrupa vizinhos com o mesmo destino e janela', () => {
    const grupos = agruparPedidos(IBIUNA.map((p, i) => base(`p${i}`, p)), destinos, PARAMETROS_PADRAO);
    expect(grupos.flat().length).toBe(4);
  });

  it('respeita a capacidade do caminhão', () => {
    const pedidos = IBIUNA.map((p, i) => base(`p${i}`, p, 2500));
    const grupos = agruparPedidos(pedidos, destinos, PARAMETROS_PADRAO);
    for (const g of grupos) expect(g.reduce((s, q) => s + q.volumeKg, 0)).toBeLessThanOrEqual(PARAMETROS_PADRAO.capacidadeKg);
  });

  it('não mistura destinos diferentes', () => {
    const grupos = agruparPedidos([base('a', IBIUNA[0]), base('b', IBIUNA[1], 500, '2026-11-20', 'outro')], destinos, PARAMETROS_PADRAO);
    expect(grupos).toEqual([]);
  });

  it('não junta pedidos fora da janela de 48 h', () => {
    const grupos = agruparPedidos([base('a', IBIUNA[0], 500, '2026-11-20'), base('b', IBIUNA[1], 500, '2026-11-25')], destinos, PARAMETROS_PADRAO);
    expect(grupos).toEqual([]);
  });

  it('não junta propriedades muito distantes (raio)', () => {
    const longe = { lat: -21.2, lng: -47.8 }; // Ribeirão Preto
    const grupos = agruparPedidos([base('a', IBIUNA[0]), base('b', longe)], destinos, PARAMETROS_PADRAO);
    expect(grupos).toEqual([]);
  });
});

describe('máquinas de estado', () => {
  it('permite o fluxo feliz do pedido', () => {
    const fluxo = ['solicitado', 'agrupado', 'agendado', 'coletado', 'entregue', 'pago'] as const;
    for (let i = 0; i < fluxo.length - 1; i++) expect(podeTransitarPedido(fluxo[i], fluxo[i + 1])).toBe(true);
  });

  it('estados terminais não regridem', () => {
    expect(podeTransitarPedido('pago', 'entregue')).toBe(false);
    expect(podeTransitarPedido('cancelado', 'solicitado')).toBe(false);
    expect(podeTransitarCarga('liquidada', 'entregue')).toBe(false);
  });

  it('não pula etapas', () => {
    expect(podeTransitarPedido('solicitado', 'pago')).toBe(false);
    expect(podeTransitarCarga('aberta', 'entregue')).toBe(false);
  });
});

describe('linguagem natural', () => {
  it.each([
    ['colhi 300 kg de tomate', 'tomate', 300],
    ['Colhi 2 toneladas de milho', 'milho', 2000],
    ['trezentos e cinquenta quilos de alface', 'alface', 350],
    ['10 caixas de morango', 'morango', 200],
    ['feijão 3 sacas', 'feijao', 180],
    ['dois mil quilos de mandioca', 'mandioca', 2000],
    ['1.500 kg de batata', 'batata', 1500],
  ])('"%s" → %s %i kg', (frase, cultura, kg) => {
    const r = interpretarColheita(frase);
    expect(r?.cultura.id).toBe(cultura);
    expect(r?.quantidadeKg).toBe(kg);
  });

  it('não inventa quando não entende', () => {
    expect(interpretarColheita('bom dia')).toBeNull();
    expect(interpretarColheita('colhi tomate')).toBeNull();
  });
});

describe('AgroScore', () => {
  const bom = { entregas: 20, pontualidade: 1, volumeMedioKg: 1200, mesesAtivos: 10, cancelamentos: 0 };
  const ruim = { entregas: 3, pontualidade: 0.2, volumeMedioKg: 300, mesesAtivos: 2, cancelamentos: 5 };

  it('fica entre 300 e 900', () => {
    for (const c of [bom, ruim]) {
      const s = calcularScore(c).score;
      expect(s).toBeGreaterThanOrEqual(300);
      expect(s).toBeLessThanOrEqual(900);
    }
  });

  it('bom histórico pontua mais que histórico ruim', () => {
    expect(calcularScore(bom).score).toBeGreaterThan(calcularScore(ruim).score);
  });

  it('pontualidade aumenta o score (monotonicidade)', () => {
    expect(calcularScore({ ...ruim, pontualidade: 0.9 }).score).toBeGreaterThan(calcularScore(ruim).score);
  });

  it('cancelamentos diminuem o score', () => {
    expect(calcularScore({ ...bom, cancelamentos: 6 }).score).toBeLessThan(calcularScore(bom).score);
  });

  it('explica os fatores', () => {
    expect(calcularScore(bom).fatores).toHaveLength(5);
  });
});

describe('datas', () => {
  it('vira mês e ano', () => {
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('bloqueios de estrada', () => {
  it('detecta bloqueio no trecho entre paradas', () => {
    const meio = { lat: (IBIUNA[0].lat + CEAGESP.lat) / 2, lng: (IBIUNA[0].lng + CEAGESP.lng) / 2 };
    expect(rotaAfetada(CEAGESP, [IBIUNA[0]], meio, 1)).toBe(true);
    expect(rotaAfetada(CEAGESP, [IBIUNA[0]], { lat: -22.0, lng: -47.0 }, 1)).toBe(false);
  });
});
