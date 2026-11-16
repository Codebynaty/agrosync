import crypto from 'node:crypto';
import { NotificadorSimulado } from './adapters/notificacao.js';
import { PixSimulado } from './adapters/pix.js';
import { exec, todos, um } from './db.js';
import { somarDias, dataLocal } from './domain/tempo.js';
import type { Contexto } from './services/contexto.js';
import { aceitarCarga, agrupar, cancelarPedido, checkin, criarPedido, entregarCarga, freteIndividual } from './services/fretes.js';
import { processarWebhookPix } from './services/pagamentos.js';
import { criarSafra } from './services/safras.js';
import type { Caracteristicas } from './domain/triagem.js';

/**
 * Dados de demonstração: todos os nomes, telefones e locais de propriedades são fictícios.
 * O histórico é gerado passando pelos mesmos serviços usados pela API (agrupamento,
 * rateio, check-in, cobrança e webhook), então os números do painel são reais para o sistema.
 */

export const DESTINOS = [
  { id: 'ceagesp', nome: 'CEAGESP – Entreposto São Paulo', municipio: 'São Paulo', lat: -23.5367, lng: -46.7296 },
  { id: 'coop-ibiuna', nome: 'Central da Cooperativa – Ibiúna', municipio: 'Ibiúna', lat: -23.656, lng: -47.223 },
];

export const USUARIOS_DEMO = [
  { id: 'u-ana', nome: 'Ana Souza', telefone: '5511900000001', papel: 'produtor', canal: 'whatsapp', prop: { nome: 'Sítio Boa Vista', municipio: 'Ibiúna', lat: -23.6712, lng: -47.2391 } },
  { id: 'u-benedito', nome: 'Benedito Lima', telefone: '5511900000002', papel: 'produtor', canal: 'sms', prop: { nome: 'Sítio São José', municipio: 'Ibiúna', lat: -23.6301, lng: -47.261 } },
  { id: 'u-carla', nome: 'Carla Mendes', telefone: '5511900000003', papel: 'produtor', canal: 'whatsapp', prop: { nome: 'Chácara Morada do Sol', municipio: 'Piedade', lat: -23.701, lng: -47.398 } },
  { id: 'u-dirceu', nome: 'Dirceu Rocha', telefone: '5511900000004', papel: 'produtor', canal: 'sms', prop: { nome: 'Sítio Três Irmãos', municipio: 'Mairinque', lat: -23.556, lng: -47.169 } },
  { id: 'u-elza', nome: 'Elza Nogueira', telefone: '5511900000005', papel: 'produtor', canal: 'sms', prop: { nome: 'Sítio Recanto Verde', municipio: 'São Roque', lat: -23.553, lng: -47.142 } },
  { id: 'u-fabio', nome: 'Fábio Tanaka', telefone: '5511900000006', papel: 'produtor', canal: 'push', prop: { nome: 'Sítio Tanaka', municipio: 'Cotia', lat: -23.664, lng: -46.985 } },
  { id: 'u-joao', nome: 'João Pereira', telefone: '5511900000011', papel: 'motorista', canal: 'whatsapp' },
  { id: 'u-marcos', nome: 'Marcos Silva', telefone: '5511900000012', papel: 'motorista', canal: 'sms' },
  { id: 'u-coop', nome: 'Cooperativa Agro Ibiúna', telefone: '5511900000021', papel: 'cooperativa', canal: 'push' },
] as const;

const CULTURAS_POR_PRODUTOR: Record<string, string[]> = {
  'u-ana': ['tomate', 'alface', 'couve'],
  'u-benedito': ['tomate', 'cenoura', 'batata'],
  'u-carla': ['morango', 'alface'],
  'u-dirceu': ['mandioca', 'milho', 'banana'],
  'u-elza': ['alface', 'couve', 'cenoura'],
  'u-fabio': ['morango', 'tomate'],
};

/** Atraso típico (horas) entre a cobrança e o Pix de cada produtor, para o AgroScore ter variação real. */
const ATRASO_PAGAMENTO_H: Record<string, [number, number]> = {
  'u-ana': [1, 20],
  'u-benedito': [2, 40],
  'u-carla': [1, 10],
  'u-dirceu': [30, 140],
  'u-elza': [4, 60],
  'u-fabio': [1, 30],
};

function rng(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Meio-dia (horário de Brasília) da data. */
const em = (data: string, hora = 8) => new Date(`${data}T${String(hora).padStart(2, '0')}:00:00-03:00`);

const COR_MADURA_SEED: Record<string, keyof Caracteristicas> = {
  tomate: 'vermelho', morango: 'vermelho', cafe: 'vermelho',
  laranja: 'laranja', cenoura: 'laranja',
  milho: 'amarelo', banana: 'amarelo', batata: 'amarelo',
  alface: 'verde', couve: 'verde',
  mandioca: 'marrom', feijao: 'marrom',
};

/**
 * Características plausíveis de uma foto de demonstração, com a semente do seed,
 * para o painel e os selos nascerem com uma distribuição realista de qualidade.
 */
function triagemSeed(cultura: string, r: () => number): { caracteristicas: Caracteristicas } {
  const fam = COR_MADURA_SEED[cultura] ?? 'verde';
  const folhosa = fam === 'verde';
  const roll = r();
  const escuro = roll < 0.12 ? 0.25 + r() * 0.3 : r() * 0.07; // ~12% com manchas
  const imaturo = !folhosa && roll > 0.85 ? 0.3 + r() * 0.25 : r() * 0.04; // alguns verdes/murchos
  const maduro = Math.max(0.2, 0.88 - escuro - imaturo - r() * 0.08);
  const c: Caracteristicas = {
    vermelho: 0, laranja: 0, amarelo: 0, verde: 0, marrom: 0,
    escuro, claro: r() * 0.05, cobertura: 0.6 + r() * 0.3, nitidez: 0.55 + r() * 0.4, brilho: 0.4 + r() * 0.25,
  };
  c[fam] = maduro;
  if (folhosa) c.amarelo = imaturo; // folhosa: imaturo vira amarelado (murcha)
  else c.verde = imaturo;
  return { caracteristicas: c };
}

export function bancoVazio(ctx: Contexto) {
  return !um(ctx.db, 'SELECT 1 FROM usuarios LIMIT 1');
}

export async function popular(base: Contexto) {
  const silencioso = new NotificadorSimulado();
  let relogio = base.agora();
  const pix = new PixSimulado(base.config.pixWebhookSecret, async () => {});
  const ctx: Contexto = {
    ...base,
    notificador: silencioso,
    pix,
    agora: () => relogio,
    log: () => {},
    config: { ...base.config, autoAgrupar: false },
  };
  const db = ctx.db;
  const agoraReal = base.agora();
  const hojeReal = dataLocal(agoraReal);

  // ---- cadastros
  for (const d of DESTINOS) exec(db, 'INSERT INTO destinos (id, nome, municipio, lat, lng) VALUES (?, ?, ?, ?, ?)', d.id, d.nome, d.municipio, d.lat, d.lng);
  const criadoEm = em(somarDias(hojeReal, -200)).toISOString();
  for (const u of USUARIOS_DEMO) {
    exec(db, 'INSERT INTO usuarios (id, nome, telefone, papel, canal_preferido, criado_em) VALUES (?, ?, ?, ?, ?, ?)', u.id, u.nome, u.telefone, u.papel, u.canal, criadoEm);
    if ('prop' in u) {
      exec(
        db,
        'INSERT INTO propriedades (id, produtor_id, nome, municipio, lat, lng, chave_dispositivo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        `p-${u.id.slice(2)}`,
        u.id,
        u.prop.nome,
        u.prop.municipio,
        u.prop.lat,
        u.prop.lng,
        `dev-${u.id.slice(2)}-${crypto.randomBytes(6).toString('hex')}`,
        criadoEm,
      );
    }
  }

  const produtores = USUARIOS_DEMO.filter((u) => u.papel === 'produtor').map((u) => u.id);
  const motoristas = ['u-joao', 'u-marcos'];
  const r = rng(42);
  const escolher = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

  async function pagar(produtorId: string, txid: string, valor: number, criadoEm: string) {
    const [min, max] = ATRASO_PAGAMENTO_H[produtorId];
    const pagoEm = new Date(Date.parse(criadoEm) + (min + r() * (max - min)) * 3600_000).toISOString();
    await processarWebhookPix(ctx, { id: `evt_seed_${crypto.randomUUID()}`, tipo: 'pix.recebido', txid, valorCentavos: valor, pagoEm });
  }

  /** Uma rodada completa: colheita → pedido → agrupamento → coleta → entrega → Pix. */
  async function rodada(data: string, participantes: string[], opcoes: { pagar?: (id: string) => boolean } = {}) {
    relogio = em(data, 7);
    for (const p of participantes) {
      const cultura = escolher(CULTURAS_POR_PRODUTOR[p]);
      const kg = Math.round((200 + r() * 1400) / 10) * 10;
      const { safra } = criarSafra(ctx, p, { cultura, quantidadeKg: kg, origem: 'seed', colhidoEm: relogio.toISOString(), triagem: triagemSeed(cultura, r) });
      await criarPedido(ctx, p, { safraId: safra.id, destinoId: 'ceagesp', dataDesejada: somarDias(data, 1) });
    }
    relogio = em(data, 9);
    if (r() < 0.25) {
      const pend = um<{ id: string; produtor_id: string }>(db, "SELECT id, produtor_id FROM pedidos WHERE status = 'solicitado' AND produtor_id = 'u-dirceu'");
      if (pend) await cancelarPedido(ctx, pend.produtor_id, pend.id);
    }
    await agrupar(ctx, 'seed');
    for (const p of todos<{ id: string; produtor_id: string }>(db, "SELECT id, produtor_id FROM pedidos WHERE status = 'solicitado'")) {
      await freteIndividual(ctx, p.produtor_id, p.id);
    }

    for (const c of todos<{ id: string }>(db, "SELECT id FROM cargas WHERE status = 'aberta'")) {
      const m = escolher(motoristas);
      relogio = em(data, 15);
      await aceitarCarga(ctx, m, c.id);
      relogio = em(somarDias(data, 1), 6);
      for (const p of todos<{ qr_token: string }>(db, 'SELECT qr_token FROM pedidos WHERE carga_id = ?', c.id)) {
        await checkin(ctx, m, c.id, p.qr_token);
      }
      relogio = em(somarDias(data, 1), 11);
      await entregarCarga(ctx, m, c.id);
      for (const pg of todos<{ txid: string; valor_centavos: number; produtor_id: string; criado_em: string }>(
        db,
        `SELECT pg.txid, pg.valor_centavos, r.produtor_id, pg.criado_em FROM pagamentos pg JOIN rateios r ON r.id = pg.rateio_id
          WHERE r.carga_id = ? AND pg.status = 'pendente'`,
        c.id,
      )) {
        if (opcoes.pagar && !opcoes.pagar(pg.produtor_id)) continue;
        await pagar(pg.produtor_id, pg.txid, pg.valor_centavos, pg.criado_em);
      }
    }
  }

  // ---- histórico: ~6 meses, duas rodadas por mês
  for (let semana = 26; semana >= 2; semana -= 2) {
    const data = somarDias(hojeReal, -semana * 7);
    const participantes = produtores.filter(() => r() < 0.7);
    if (participantes.length) await rodada(data, participantes);
  }

  // ---- estado atual
  // Ontem: carga entregue; Ana ainda não pagou (para demonstrar o Pix e o webhook duplicado).
  await rodada(somarDias(hojeReal, -1), ['u-ana', 'u-benedito', 'u-elza'], { pagar: (id) => id !== 'u-ana' });

  // Hoje: pedidos para amanhã aguardando motorista / grupo.
  relogio = new Date(agoraReal.getTime() - 2 * 3600_000);
  for (const [p, cultura, kg] of [
    ['u-benedito', 'tomate', 900],
    ['u-carla', 'morango', 400],
    ['u-dirceu', 'mandioca', 1500],
    ['u-elza', 'alface', 600],
  ] as const) {
    const { safra } = criarSafra(ctx, p, { cultura, quantidadeKg: kg, origem: 'seed', triagem: triagemSeed(cultura, r) });
    await criarPedido(ctx, p, { safraId: safra.id, destinoId: 'ceagesp', dataDesejada: somarDias(hojeReal, 1) });
  }
  await agrupar(ctx, 'seed');

  // Ana tem uma colheita registrada hoje, ainda sem frete (para a demo): tomate Extra (A).
  criarSafra(ctx, 'u-ana', {
    cultura: 'tomate',
    quantidadeKg: 700,
    origem: 'seed',
    triagem: { caracteristicas: { vermelho: 0.88, laranja: 0.04, amarelo: 0, verde: 0, marrom: 0, escuro: 0.01, claro: 0.02, cobertura: 0.82, nitidez: 0.82, brilho: 0.52 } },
  });

  // Sensores: últimas 24 h na propriedade da Ana.
  for (let h = 24; h >= 0; h -= 2) {
    const t = new Date(agoraReal.getTime() - h * 3600_000).toISOString();
    exec(db, 'INSERT INTO leituras_sensor (propriedade_id, tipo, valor, medido_em) VALUES (?, ?, ?, ?)', 'p-ana', 'umidade_solo', Math.round(38 - h * 0.6 + r() * 3), t);
    exec(db, 'INSERT INTO leituras_sensor (propriedade_id, tipo, valor, medido_em) VALUES (?, ?, ?, ?)', 'p-ana', 'temperatura', Math.round(18 + Math.sin(((24 - h) / 24) * Math.PI) * 9), t);
  }

  // Alertas do histórico já foram "lidos"; os de ontem e hoje ficam como novos.
  exec(db, 'UPDATE alertas SET lido = 1 WHERE criado_em < ?', em(somarDias(hojeReal, -1), 0).toISOString());
}
