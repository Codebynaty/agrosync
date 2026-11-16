import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;
type Valor = string | number | bigint | null | Uint8Array;

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL UNIQUE,
  papel TEXT NOT NULL CHECK (papel IN ('produtor','motorista','cooperativa')),
  canal_preferido TEXT NOT NULL DEFAULT 'sms' CHECK (canal_preferido IN ('sms','whatsapp','push')),
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otps (
  telefone TEXT PRIMARY KEY,
  codigo_hash TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  tentativas INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS destinos (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  municipio TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS propriedades (
  id TEXT PRIMARY KEY,
  produtor_id TEXT NOT NULL REFERENCES usuarios(id),
  nome TEXT NOT NULL,
  municipio TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  chave_dispositivo TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS safras (
  id TEXT PRIMARY KEY,
  produtor_id TEXT NOT NULL REFERENCES usuarios(id),
  propriedade_id TEXT NOT NULL REFERENCES propriedades(id),
  cultura TEXT NOT NULL,
  quantidade_kg INTEGER NOT NULL CHECK (quantidade_kg > 0),
  perecivel INTEGER NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('app','voz','bot','sensor','seed')),
  colhido_em TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  triagem_classe TEXT,
  triagem_pontuacao INTEGER,
  triagem_maturidade TEXT,
  triagem_json TEXT,
  triagem_miniatura TEXT
);

CREATE TABLE IF NOT EXISTS cargas (
  id TEXT PRIMARY KEY,
  destino_id TEXT NOT NULL REFERENCES destinos(id),
  motorista_id TEXT REFERENCES usuarios(id),
  status TEXT NOT NULL,
  data_coleta TEXT NOT NULL,
  capacidade_kg INTEGER NOT NULL,
  volume_kg INTEGER NOT NULL,
  distancia_m INTEGER NOT NULL,
  custo_total_centavos INTEGER NOT NULL,
  custo_individual_total_centavos INTEGER NOT NULL,
  rota_json TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY,
  produtor_id TEXT NOT NULL REFERENCES usuarios(id),
  propriedade_id TEXT NOT NULL REFERENCES propriedades(id),
  safra_id TEXT REFERENCES safras(id),
  destino_id TEXT NOT NULL REFERENCES destinos(id),
  cultura TEXT NOT NULL,
  volume_kg INTEGER NOT NULL CHECK (volume_kg > 0),
  data_desejada TEXT NOT NULL,
  status TEXT NOT NULL,
  carga_id TEXT REFERENCES cargas(id),
  qr_token TEXT NOT NULL UNIQUE,
  coletado_em TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pedidos_safra_ativa ON pedidos(safra_id) WHERE safra_id IS NOT NULL AND status <> 'cancelado';
CREATE INDEX IF NOT EXISTS pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS pedidos_carga ON pedidos(carga_id);

CREATE TABLE IF NOT EXISTS rateios (
  id TEXT PRIMARY KEY,
  carga_id TEXT NOT NULL REFERENCES cargas(id),
  pedido_id TEXT NOT NULL REFERENCES pedidos(id),
  produtor_id TEXT NOT NULL REFERENCES usuarios(id),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 0),
  custo_individual_centavos INTEGER NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS rateios_pedido_ativo ON rateios(pedido_id) WHERE ativo = 1;

CREATE TABLE IF NOT EXISTS pagamentos (
  id TEXT PRIMARY KEY,
  rateio_id TEXT NOT NULL UNIQUE REFERENCES rateios(id),
  txid TEXT NOT NULL UNIQUE,
  valor_centavos INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pendente','confirmado')),
  copia_e_cola TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  confirmado_em TEXT
);

CREATE TABLE IF NOT EXISTS webhook_eventos (
  event_id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  payload TEXT NOT NULL,
  resultado TEXT NOT NULL,
  recebido_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alertas (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  tipo TEXT NOT NULL,
  canal TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  chave TEXT UNIQUE,
  lido INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alertas_usuario ON alertas(usuario_id, criado_em);

CREATE TABLE IF NOT EXISTS bloqueios (
  id TEXT PRIMARY KEY,
  descricao TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  raio_km REAL NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leituras_sensor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  propriedade_id TEXT NOT NULL REFERENCES propriedades(id),
  tipo TEXT NOT NULL,
  valor REAL NOT NULL,
  medido_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS leituras_prop ON leituras_sensor(propriedade_id, medido_em);

CREATE TABLE IF NOT EXISTS operacoes_sync (
  op_id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  resultado TEXT NOT NULL,
  aplicado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entidade TEXT NOT NULL,
  entidade_id TEXT NOT NULL,
  de TEXT,
  para TEXT,
  origem TEXT NOT NULL,
  em TEXT NOT NULL
);
`;

export function abrirBanco(caminho: string): DB {
  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA foreign_keys = ON;');
  if (caminho !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(ESQUEMA);
  migrar(db);
  return db;
}

/**
 * Migrações aditivas e idempotentes para bancos criados por versões anteriores
 * (o esquema usa CREATE TABLE IF NOT EXISTS, que não altera tabelas já existentes).
 */
function migrar(db: DB) {
  const colunas = (tabela: string) => new Set(todos<{ name: string }>(db, `PRAGMA table_info(${tabela})`).map((c) => c.name));
  const safras = colunas('safras');
  for (const [nome, tipo] of [
    ['triagem_classe', 'TEXT'],
    ['triagem_pontuacao', 'INTEGER'],
    ['triagem_maturidade', 'TEXT'],
    ['triagem_json', 'TEXT'],
    ['triagem_miniatura', 'TEXT'],
  ] as const) {
    if (!safras.has(nome)) db.exec(`ALTER TABLE safras ADD COLUMN ${nome} ${tipo}`);
  }
}

const profundidade = new WeakMap<DB, number>();

/** Executa `fn` numa transação (com savepoints quando aninhada). */
export function transacao<T>(db: DB, fn: () => T): T {
  const nivel = profundidade.get(db) ?? 0;
  const sp = `sp_${nivel}`;
  db.exec(nivel === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  profundidade.set(db, nivel + 1);
  try {
    const r = fn();
    db.exec(nivel === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    db.exec(nivel === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  } finally {
    profundidade.set(db, nivel);
  }
}

export function um<T>(db: DB, sql: string, ...params: Valor[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function todos<T>(db: DB, sql: string, ...params: Valor[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function exec(db: DB, sql: string, ...params: Valor[]): number {
  return Number(db.prepare(sql).run(...params).changes);
}
