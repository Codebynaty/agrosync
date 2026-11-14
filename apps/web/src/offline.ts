import { openDB, type IDBPDatabase } from 'idb';
import { useEffect, useState } from 'react';
import { post } from './api';

/**
 * Fila offline-first. Toda operação de escrita do produtor entra primeiro aqui
 * (IndexedDB, no aparelho) e é enviada ao servidor quando há conexão.
 * Cada operação tem um opId (UUID) e cada entidade nasce com UUID local:
 * reenviar o mesmo lote nunca duplica dados no servidor.
 */

export type OperacaoFila =
  | {
      opId: string;
      tipo: 'criar_safra';
      dados: { id: string; cultura: string; quantidadeKg: number; perecivel?: boolean; colhidoEm?: string; origem?: 'app' | 'voz' };
      criadaEm: string;
      descricao: string;
    }
  | {
      opId: string;
      tipo: 'criar_pedido';
      dados: { id: string; safraId: string; destinoId?: string; dataDesejada?: string };
      criadaEm: string;
      descricao: string;
    };

export type FalhaSync = { opId: string; descricao: string; erro: string };

type Estado = { pendentes: OperacaoFila[]; sincronizando: boolean; online: boolean; falhas: FalhaSync[]; ultimaSync: string | null };

let estado: Estado = { pendentes: [], sincronizando: false, online: navigator.onLine, falhas: [], ultimaSync: null };
const ouvintes = new Set<(e: Estado) => void>();
const emitir = (parcial: Partial<Estado>) => {
  estado = { ...estado, ...parcial };
  ouvintes.forEach((f) => f(estado));
};

let dbPromessa: Promise<IDBPDatabase> | null = null;
function banco() {
  dbPromessa ??= openDB('agrosync', 1, {
    upgrade(db) {
      db.createObjectStore('fila', { keyPath: 'opId' });
    },
  });
  return dbPromessa;
}

async function recarregar() {
  try {
    const todas = (await (await banco()).getAll('fila')) as OperacaoFila[];
    emitir({ pendentes: todas.sort((a, b) => a.criadaEm.localeCompare(b.criadaEm)) });
  } catch {
    /* IndexedDB indisponível (aba anônima): app segue online-only */
  }
}

export const uuid = () =>
  crypto.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export async function enfileirar(ops: Omit<OperacaoFila, 'opId' | 'criadaEm'>[]) {
  const db = await banco();
  const tx = db.transaction('fila', 'readwrite');
  for (const op of ops) await tx.store.put({ ...op, opId: uuid(), criadaEm: new Date().toISOString() });
  await tx.done;
  await recarregar();
  void sincronizar();
}

type ResultadoSync = { opId: string; ok: boolean; repetida: boolean; entidadeId?: string; erro?: string };

export async function sincronizar(): Promise<boolean> {
  if (estado.sincronizando || !navigator.onLine) return false;
  await recarregar();
  if (!estado.pendentes.length) return true;
  emitir({ sincronizando: true });
  try {
    const lote = estado.pendentes.slice(0, 100);
    const { resultados } = await post<{ resultados: ResultadoSync[] }>('/sync', {
      operacoes: lote.map(({ opId, tipo, dados }) => ({ opId, tipo, dados })),
    });
    const db = await banco();
    const falhas: FalhaSync[] = [];
    for (const r of resultados) {
      await db.delete('fila', r.opId);
      if (!r.ok) falhas.push({ opId: r.opId, descricao: lote.find((o) => o.opId === r.opId)?.descricao ?? '', erro: r.erro ?? 'Erro' });
    }
    emitir({ falhas: [...estado.falhas, ...falhas], ultimaSync: new Date().toISOString() });
    await recarregar();
    window.dispatchEvent(new Event('agrosync:sincronizado'));
    return true;
  } catch {
    return false;
  } finally {
    emitir({ sincronizando: false });
  }
}

export function descartarFalhas() {
  emitir({ falhas: [] });
}

let iniciado = false;
export function iniciarSincronizacao() {
  if (iniciado) return;
  iniciado = true;
  window.addEventListener('online', () => {
    emitir({ online: true });
    void sincronizar();
  });
  window.addEventListener('offline', () => emitir({ online: false }));
  void recarregar().then(sincronizar);
  setInterval(() => void sincronizar(), 20_000);
}

export function useFila() {
  const [e, setE] = useState(estado);
  useEffect(() => {
    ouvintes.add(setE);
    setE(estado);
    return () => {
      ouvintes.delete(setE);
    };
  }, []);
  return e;
}

/** Recarrega dados quando a fila termina de sincronizar. */
export function useAoSincronizar(f: () => void) {
  useEffect(() => {
    window.addEventListener('agrosync:sincronizado', f);
    return () => window.removeEventListener('agrosync:sincronizado', f);
  }, [f]);
}
