import crypto from 'node:crypto';
import { exec, todos, um } from '../db.js';
import { distanciaKm, distanciaPontoSegmentoKm, type Ponto } from '../domain/geo.js';
import { notificar } from './alertas.js';
import { agoraISO, type Contexto } from './contexto.js';
import type { ParadaRota } from './fretes.js';

/** A rota (destino → paradas → destino) passa a menos de `raioKm` do ponto? */
export function rotaAfetada(destino: Ponto, paradas: Ponto[], ponto: Ponto, raioKm: number): boolean {
  const pts = [destino, ...paradas, destino];
  if (pts.some((p) => distanciaKm(p, ponto) <= raioKm)) return true;
  for (let i = 0; i < pts.length - 1; i++) if (distanciaPontoSegmentoKm(ponto, pts[i], pts[i + 1]) <= raioKm) return true;
  return false;
}

export async function registrarBloqueio(ctx: Contexto, d: { descricao: string; lat: number; lng: number; raioKm: number }) {
  const id = crypto.randomUUID();
  exec(
    ctx.db,
    'INSERT INTO bloqueios (id, descricao, lat, lng, raio_km, ativo, criado_em) VALUES (?, ?, ?, ?, ?, 1, ?)',
    id,
    d.descricao,
    d.lat,
    d.lng,
    d.raioKm,
    agoraISO(ctx),
  );
  return { id, avisados: await avisarCargasAfetadas(ctx, id) };
}

export async function avisarCargasAfetadas(ctx: Contexto, bloqueioId: string): Promise<number> {
  const b = um<{ id: string; descricao: string; lat: number; lng: number; raio_km: number }>(
    ctx.db,
    'SELECT * FROM bloqueios WHERE id = ? AND ativo = 1',
    bloqueioId,
  );
  if (!b) return 0;
  const cargas = todos<{ id: string; motorista_id: string | null; rota_json: string; lat: number; lng: number }>(
    ctx.db,
    `SELECT c.id, c.motorista_id, c.rota_json, d.lat, d.lng FROM cargas c JOIN destinos d ON d.id = c.destino_id
      WHERE c.status IN ('aberta','agendada','em_rota')`,
  );
  let avisados = 0;
  for (const c of cargas) {
    const paradas = JSON.parse(c.rota_json) as ParadaRota[];
    if (!rotaAfetada(c, paradas, b, b.raio_km)) continue;
    const msg = `Bloqueio na rota: ${b.descricao}. Confirme o caminho antes de sair.`;
    const destinatarios = [...new Set([c.motorista_id, ...paradas.map((p) => p.produtorId)].filter(Boolean) as string[])];
    for (const u of destinatarios) {
      if (await notificar(ctx, u, { tipo: 'estrada', titulo: 'Estrada bloqueada', mensagem: msg, chave: `bloqueio:${b.id}:${c.id}:${u}` })) avisados++;
    }
  }
  return avisados;
}
