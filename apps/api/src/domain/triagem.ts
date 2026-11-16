/**
 * Triagem visual da safra — classificação de qualidade a partir de uma foto.
 *
 * Divisão de responsabilidades (igual ao resto do sistema):
 *  - O dispositivo (navegador) faz a PERCEPÇÃO genérica da foto, sem conhecer a
 *    cultura: mede a fração de pixels em cada família de cor, a nitidez, o brilho
 *    e quanto do quadro é produto (e não fundo). Isso roda offline, sem baixar
 *    nenhum modelo — ver `apps/web/src/triagem.ts`.
 *  - O servidor faz o JULGAMENTO por cultura, aqui, com uma função pura e
 *    determinística: as mesmas características sempre dão a mesma classe. É
 *    explicável (cada fator mostra quanto somou ou tirou), como o AgroScore.
 *
 * Em produção, a percepção no dispositivo é trocada por um modelo de visão
 * computacional (as `Caracteristicas` continuam sendo a fronteira entre as duas
 * partes), mantendo este julgamento auditável.
 */

/** Famílias de cor e sinais de qualidade medidos no dispositivo (frações 0..1). */
export type Caracteristicas = {
  vermelho: number;
  laranja: number;
  amarelo: number;
  verde: number;
  marrom: number; // maturação passada, terra ou podridão
  escuro: number; // manchas, machucados, podridão escura
  claro: number; // reflexos, descoloração ou fundo claro sobrando
  cobertura: number; // fração do quadro ocupada pelo produto (não-fundo)
  nitidez: number; // 0 = borrado, 1 = nítido
  brilho: number; // luminância média (0 = escuro, 1 = estourado)
};

export type ClasseSafra = 'A' | 'B' | 'C' | 'refugo' | 'rever';
export type Maturidade = 'verde' | 'no_ponto' | 'passado' | 'incerta';
export type FatorTriagem = { rotulo: string; efeito: number };

export type ResultadoTriagem = {
  classe: ClasseSafra;
  rotulo: string;
  pontuacao: number; // 0..100
  maturidade: Maturidade;
  confiavel: boolean; // a foto é boa o suficiente para decidir?
  ajustePrecoPct: number; // efeito indicativo da classe sobre o preço de referência
  observacoes: string[];
  fatores: FatorTriagem[];
};

type Familia = keyof Pick<Caracteristicas, 'vermelho' | 'laranja' | 'amarelo' | 'verde' | 'marrom'>;

type Perfil = {
  /** Cores que indicam o produto no ponto de colheita. */
  maduras: Familia[];
  /** Cores de maturidade parcial (contam metade). */
  quase?: Familia[];
  /** Cor de produto ainda imaturo (penaliza, salvo em folhosas). */
  imatura?: Familia;
  /** Em folhosas o verde é o ponto certo; amarelo/marrom viram "murcha". */
  folhosa?: boolean;
  nomeMaduro: string;
  nomeImaturo?: string;
};

const PADRAO: Perfil = { maduras: ['verde', 'vermelho', 'laranja', 'amarelo'], nomeMaduro: 'coloração típica' };

const PERFIS: Record<string, Perfil> = {
  tomate: { maduras: ['vermelho'], quase: ['laranja'], imatura: 'verde', nomeMaduro: 'vermelho maduro', nomeImaturo: 'verde' },
  morango: { maduras: ['vermelho'], quase: ['laranja'], imatura: 'verde', nomeMaduro: 'vermelho vivo', nomeImaturo: 'esbranquiçado/verde' },
  laranja: { maduras: ['laranja'], quase: ['amarelo'], imatura: 'verde', nomeMaduro: 'laranja', nomeImaturo: 'verde' },
  banana: { maduras: ['amarelo'], quase: ['verde'], imatura: 'verde', nomeMaduro: 'amarela', nomeImaturo: 'verde' },
  cenoura: { maduras: ['laranja'], quase: ['amarelo'], nomeMaduro: 'alaranjada' },
  milho: { maduras: ['amarelo'], quase: ['laranja'], nomeMaduro: 'amarelo' },
  alface: { maduras: ['verde'], folhosa: true, nomeMaduro: 'verde fresca' },
  couve: { maduras: ['verde'], folhosa: true, nomeMaduro: 'verde fresca' },
  batata: { maduras: ['amarelo', 'marrom'], quase: ['laranja'], nomeMaduro: 'casca clara uniforme' },
  mandioca: { maduras: ['marrom', 'amarelo'], nomeMaduro: 'casca uniforme' },
  feijao: { maduras: ['marrom', 'amarelo'], nomeMaduro: 'grão seco uniforme' },
  cafe: { maduras: ['vermelho'], quase: ['laranja'], imatura: 'verde', nomeMaduro: 'cereja vermelho', nomeImaturo: 'verde' },
};

const limitar = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const soma = (c: Caracteristicas, fs: Familia[] = []) => fs.reduce((s, f) => s + (c[f] ?? 0), 0);
const arred = (n: number) => Math.round(n);

const ROTULOS: Record<ClasseSafra, string> = {
  A: 'Extra (A)',
  B: 'Boa (B)',
  C: 'Comercial (C)',
  refugo: 'Refugo',
  rever: 'Refazer a foto',
};

const AJUSTE_PRECO: Record<ClasseSafra, number> = { A: 10, B: 0, C: -15, refugo: -45, rever: 0 };

/**
 * Classifica uma amostra de safra a partir das características percebidas na foto.
 * Determinística: as mesmas características devolvem sempre o mesmo resultado.
 */
export function classificarSafra(culturaId: string, c: Caracteristicas): ResultadoTriagem {
  const perfil = PERFIS[culturaId] ?? PADRAO;

  const maduro = limitar(soma(c, perfil.maduras));
  const quase = limitar(soma(c, perfil.quase));
  const imaturo = perfil.imatura ? limitar(c[perfil.imatura]) : 0;
  const maturidade = limitar(maduro + 0.5 * quase);

  // Defeitos: manchas escuras sempre pesam; em folhosas, amarelo/marrom = murcha.
  const mancha = limitar(c.escuro + 0.7 * c.marrom + (perfil.folhosa ? 0.8 * c.amarelo : 0));
  // Coloração fora do padrão: reflexos/descoloração (claro) e, exceto folhosas, marrom disperso.
  const foraDeCor = limitar(c.claro * 0.8 + (perfil.folhosa ? 0 : 0.3 * c.marrom));

  const fatores: FatorTriagem[] = [];
  const empurrar = (rotulo: string, efeito: number) => {
    if (Math.abs(efeito) >= 0.5) fatores.push({ rotulo, efeito: arred(efeito) });
  };

  let p = 62;
  const bonusMaturidade = 42 * maturidade;
  p += bonusMaturidade;
  empurrar(`Coloração ${perfil.nomeMaduro}`, bonusMaturidade);

  const penalMancha = 140 * mancha;
  p -= penalMancha;
  empurrar(perfil.folhosa ? 'Folhas manchadas ou murchas' : 'Manchas escuras / machucados', -penalMancha);

  if (!perfil.folhosa && perfil.imatura) {
    const penalImaturo = 60 * imaturo;
    p -= penalImaturo;
    empurrar(`Parte ainda ${perfil.nomeImaturo ?? 'imatura'}`, -penalImaturo);
  }

  const penalFora = 40 * foraDeCor;
  p -= penalFora;
  empurrar('Coloração irregular', -penalFora);

  const pontuacao = arred(limitar(p, 0, 100));

  // A foto é confiável? Borrada, escura/estourada ou com pouco produto no quadro não decide.
  const motivosRuins: string[] = [];
  if (c.nitidez < 0.35) motivosRuins.push('A foto ficou borrada.');
  if (c.cobertura < 0.4) motivosRuins.push('Pouco produto aparece na foto — aproxime a câmera.');
  if (c.brilho < 0.12) motivosRuins.push('A foto ficou escura demais.');
  if (c.brilho > 0.95) motivosRuins.push('A foto ficou clara/estourada demais.');
  const confiavel = motivosRuins.length === 0;

  let maturidadeRotulo: Maturidade;
  if (!confiavel) maturidadeRotulo = 'incerta';
  else if (perfil.imatura && imaturo > maduro && imaturo >= 0.3) maturidadeRotulo = 'verde';
  else if (mancha >= 0.3) maturidadeRotulo = 'passado';
  else maturidadeRotulo = 'no_ponto';

  let classe: ClasseSafra;
  if (!confiavel) classe = 'rever';
  else if (pontuacao >= 80) classe = 'A';
  else if (pontuacao >= 62) classe = 'B';
  else if (pontuacao >= 42) classe = 'C';
  else classe = 'refugo';

  const observacoes: string[] = [];
  if (!confiavel) observacoes.push(...motivosRuins);
  else {
    if (maturidadeRotulo === 'verde') observacoes.push(`Boa parte ainda ${perfil.nomeImaturo ?? 'verde'} — pode valer mais amadurecendo um pouco.`);
    if (mancha >= 0.12) observacoes.push(perfil.folhosa ? 'Há folhas manchadas ou murchas na amostra.' : 'Há manchas escuras — possível machucado ou início de perda.');
    if (foraDeCor >= 0.25) observacoes.push('Coloração irregular entre as unidades.');
    if (!observacoes.length) observacoes.push('Lote no ponto e uniforme.');
  }

  return {
    classe,
    rotulo: ROTULOS[classe],
    pontuacao,
    maturidade: maturidadeRotulo,
    confiavel,
    ajustePrecoPct: AJUSTE_PRECO[classe],
    observacoes,
    fatores: fatores.sort((a, b) => Math.abs(b.efeito) - Math.abs(a.efeito)),
  };
}

export const ROTULO_CLASSE = ROTULOS;
