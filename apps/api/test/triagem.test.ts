import { describe, expect, it } from 'vitest';
import { classificarSafra, valorEstimado, type Caracteristicas } from '../src/domain/triagem.js';

/** Foto boa por padrão; cada teste sobrepõe só o que importa. */
function foto(sobre: Partial<Caracteristicas> = {}): Caracteristicas {
  return { vermelho: 0, laranja: 0, amarelo: 0, verde: 0, marrom: 0, escuro: 0, claro: 0, cobertura: 0.85, nitidez: 0.8, brilho: 0.5, ...sobre };
}

describe('triagem visual da safra', () => {
  it('tomate vermelho e limpo é classe A no ponto', () => {
    const r = classificarSafra('tomate', foto({ vermelho: 0.85 }));
    expect(r.classe).toBe('A');
    expect(r.maturidade).toBe('no_ponto');
    expect(r.confiavel).toBe(true);
    expect(r.ajustePrecoPct).toBe(10);
  });

  it('mais manchas escuras sempre derrubam a pontuação (monotonicidade)', () => {
    const base = foto({ vermelho: 0.85 });
    const p0 = classificarSafra('tomate', { ...base, escuro: 0 }).pontuacao;
    const p1 = classificarSafra('tomate', { ...base, escuro: 0.15 }).pontuacao;
    const p2 = classificarSafra('tomate', { ...base, escuro: 0.35 }).pontuacao;
    expect(p0).toBeGreaterThan(p1);
    expect(p1).toBeGreaterThan(p2);
  });

  it('tomate ainda verde é detectado como verde e não vira classe A', () => {
    const maduro = classificarSafra('tomate', foto({ vermelho: 0.85 }));
    const verde = classificarSafra('tomate', foto({ verde: 0.8 }));
    expect(verde.maturidade).toBe('verde');
    expect(verde.classe).not.toBe('A');
    expect(verde.pontuacao).toBeLessThan(maduro.pontuacao);
  });

  it('em folhosa o verde é o ponto certo, mas amarelado é murcha', () => {
    expect(classificarSafra('alface', foto({ verde: 0.85 })).classe).toBe('A');
    const murcha = classificarSafra('alface', foto({ amarelo: 0.7 }));
    expect(murcha.classe).not.toBe('A');
    expect(['C', 'refugo']).toContain(murcha.classe);
  });

  it('foto borrada ou com pouco produto pede nova foto (não decide)', () => {
    expect(classificarSafra('tomate', foto({ vermelho: 0.85, nitidez: 0.2 })).classe).toBe('rever');
    expect(classificarSafra('tomate', foto({ vermelho: 0.85, cobertura: 0.3 })).confiavel).toBe(false);
    const escura = classificarSafra('tomate', foto({ vermelho: 0.85, brilho: 0.05 }));
    expect(escura.classe).toBe('rever');
    expect(escura.observacoes.join(' ')).toMatch(/escur/i);
  });

  it('amostra muito deteriorada é refugo', () => {
    expect(classificarSafra('tomate', foto({ vermelho: 0.2, escuro: 0.6, marrom: 0.2 })).classe).toBe('refugo');
  });

  it('é determinística e lista fatores explicáveis', () => {
    const entrada = foto({ vermelho: 0.7, escuro: 0.1 });
    const a = classificarSafra('tomate', entrada);
    const b = classificarSafra('tomate', entrada);
    expect(a).toEqual(b);
    expect(a.fatores.length).toBeGreaterThan(0);
    // a soma dos fatores em torno da base explica a pontuação
    expect(a.fatores.some((f) => f.efeito > 0)).toBe(true);
    expect(a.fatores.some((f) => f.efeito < 0)).toBe(true);
  });

  it('cultura desconhecida usa o perfil padrão sem quebrar', () => {
    const r = classificarSafra('abacaxi', foto({ amarelo: 0.6, verde: 0.2 }));
    expect(['A', 'B', 'C', 'refugo', 'rever']).toContain(r.classe);
  });
});

describe('valor estimado por qualidade', () => {
  it('classe A valoriza +10% e C desvaloriza -15% sobre o preço do dia', () => {
    const a = valorEstimado(500, 100, 'A'); // 500 c/kg × 100 kg = R$ 500,00 bruto
    expect(a.brutoCentavos).toBe(50_000);
    expect(a.ajustePct).toBe(10);
    expect(a.ajustadoCentavos).toBe(55_000);

    const c = valorEstimado(500, 100, 'C');
    expect(c.ajustePct).toBe(-15);
    expect(c.ajustadoCentavos).toBe(42_500);
  });

  it('sem classe (ou foto a rever) não aplica ajuste', () => {
    expect(valorEstimado(500, 100, null)).toMatchObject({ ajustePct: 0, ajustadoCentavos: 50_000 });
    expect(valorEstimado(500, 100, 'rever')).toMatchObject({ ajustePct: 0, ajustadoCentavos: 50_000 });
  });

  it('melhor classe vale mais que pior para o mesmo lote', () => {
    const extra = valorEstimado(800, 250, 'A').ajustadoCentavos;
    const refugo = valorEstimado(800, 250, 'refugo').ajustadoCentavos;
    expect(extra).toBeGreaterThan(refugo);
  });
});
