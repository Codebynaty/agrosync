import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARAMETROS_PADRAO, type ParametrosFrete } from './domain/frete.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));

export type Config = {
  porta: number;
  host: string;
  caminhoBanco: string;
  jwtSecret: string;
  pixWebhookSecret: string;
  /** Em demo/desenvolvimento, devolve o código OTP na resposta (não há SMS real). */
  otpEcho: boolean;
  climaProvider: 'simulado' | 'open-meteo';
  autoAgrupar: boolean;
  intervaloJobsMs: number;
  seedAutomatico: boolean;
  frete: ParametrosFrete;
  webDist: string;
};

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const producao = env.NODE_ENV === 'production';
  const jwtSecret = env.JWT_SECRET ?? (producao ? '' : 'dev-secret-troque-em-producao');
  if (!jwtSecret) throw new Error('Defina JWT_SECRET em produção.');

  return {
    porta: Number(env.PORT ?? 3333),
    host: env.HOST ?? '0.0.0.0',
    caminhoBanco: env.DATABASE_PATH ?? path.resolve(aqui, '../../../data/agrosync.db'),
    jwtSecret,
    pixWebhookSecret: env.PIX_WEBHOOK_SECRET ?? 'dev-pix-webhook-secret',
    otpEcho: (env.OTP_DEV_ECHO ?? 'true') === 'true',
    climaProvider: env.CLIMA_PROVIDER === 'open-meteo' ? 'open-meteo' : 'simulado',
    autoAgrupar: (env.AUTO_AGRUPAR ?? 'true') === 'true',
    intervaloJobsMs: Number(env.JOBS_INTERVAL_MS ?? 60_000),
    seedAutomatico: (env.SEED ?? 'true') === 'true',
    frete: {
      ...PARAMETROS_PADRAO,
      capacidadeKg: Number(env.FRETE_CAPACIDADE_KG ?? PARAMETROS_PADRAO.capacidadeKg),
      raioKm: Number(env.FRETE_RAIO_KM ?? PARAMETROS_PADRAO.raioKm),
    },
    webDist: env.WEB_DIST ?? path.resolve(aqui, '../../web/dist'),
  };
}
