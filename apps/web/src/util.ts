import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export const brl = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const kg = (n: number) => `${Math.round(n).toLocaleString('pt-BR')} kg`;

export const dataBR = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

export const diaSemana = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });

export const quando = (iso: string) => {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
  return d.toLocaleDateString('pt-BR');
};

export function hojeISO(deslocamentoDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + deslocamentoDias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Busca dados da API com estado de carregamento, erro e recarga. */
export function useApi<T>(caminho: string | null) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(!!caminho);
  const vivo = useRef(true);

  const recarregar = useCallback(async () => {
    if (!caminho) return;
    setCarregando(true);
    try {
      const d = await api<T>(caminho);
      if (vivo.current) {
        setDados(d);
        setErro(null);
      }
    } catch (e) {
      if (vivo.current) setErro((e as Error).message);
    } finally {
      if (vivo.current) setCarregando(false);
    }
  }, [caminho]);

  useEffect(() => {
    vivo.current = true;
    void recarregar();
    return () => {
      vivo.current = false;
    };
  }, [recarregar]);

  return { dados, erro, carregando, recarregar, setDados };
}

/** Lista local de culturas (o app precisa dela mesmo offline). */
export const CULTURAS = [
  { id: 'tomate', nome: 'Tomate', emoji: '🍅', perecivel: true },
  { id: 'alface', nome: 'Alface', emoji: '🥬', perecivel: true },
  { id: 'couve', nome: 'Couve', emoji: '🥦', perecivel: true },
  { id: 'morango', nome: 'Morango', emoji: '🍓', perecivel: true },
  { id: 'banana', nome: 'Banana', emoji: '🍌', perecivel: true },
  { id: 'cenoura', nome: 'Cenoura', emoji: '🥕', perecivel: true },
  { id: 'batata', nome: 'Batata', emoji: '🥔', perecivel: false },
  { id: 'mandioca', nome: 'Mandioca', emoji: '🌿', perecivel: false },
  { id: 'milho', nome: 'Milho', emoji: '🌽', perecivel: false },
  { id: 'feijao', nome: 'Feijão', emoji: '🫘', perecivel: false },
  { id: 'cafe', nome: 'Café', emoji: '☕', perecivel: false },
  { id: 'laranja', nome: 'Laranja', emoji: '🍊', perecivel: true },
] as const;

export const culturaPorId = (id: string) => CULTURAS.find((c) => c.id === id);
export const nomeCultura = (id: string) => culturaPorId(id)?.nome ?? id;
