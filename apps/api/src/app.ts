import fs from 'node:fs';
import path from 'node:path';
import fastifyJwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ClimaOpenMeteo, ClimaSimulado, type ProvedorClima } from './adapters/clima.js';
import { CotacoesSimuladas } from './adapters/cotacoes.js';
import { NotificadorSimulado } from './adapters/notificacao.js';
import { PixSimulado } from './adapters/pix.js';
import { carregarConfig, type Config } from './config.js';
import { abrirBanco, type DB } from './db.js';
import { registrarRotas } from './routes.js';
import { ErroApp, type Contexto } from './services/contexto.js';

export type OpcoesApp = {
  config?: Partial<Config>;
  db?: DB;
  agora?: () => Date;
  clima?: ProvedorClima;
  logger?: boolean;
};

export async function criarApp(op: OpcoesApp = {}): Promise<{ app: FastifyInstance; ctx: Contexto }> {
  const config = { ...carregarConfig(), ...op.config };
  const app = Fastify({ logger: op.logger ?? false, bodyLimit: 1_048_576 });
  const log = (m: string) => app.log.info(m);

  // Guarda o corpo bruto: necessário para validar a assinatura HMAC dos webhooks.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, corpo, feito) => {
    const texto = corpo as string;
    req.rawBody = texto;
    if (!texto) return feito(null, {});
    try {
      feito(null, JSON.parse(texto));
    } catch {
      feito(new ErroApp(400, 'JSON inválido.'), undefined);
    }
  });

  const ctx: Contexto = {
    db: op.db ?? abrirBanco(config.caminhoBanco),
    config,
    notificador: new NotificadorSimulado(log),
    clima: op.clima ?? (config.climaProvider === 'open-meteo' ? new ClimaOpenMeteo() : new ClimaSimulado()),
    cotacoes: new CotacoesSimuladas(),
    agora: op.agora ?? (() => new Date()),
    log,
    pix: null as unknown as Contexto['pix'],
  };

  // O provedor simulado entrega o webhook pela própria pilha HTTP (assinatura incluída),
  // exatamente como um PSP externo faria.
  ctx.pix = new PixSimulado(config.pixWebhookSecret, async (corpo, assinatura) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/webhooks/pix',
      headers: { 'content-type': 'application/json', 'x-assinatura': assinatura },
      payload: corpo,
    });
    if (r.statusCode >= 500) throw new Error(`webhook falhou: ${r.statusCode}`);
  });

  await app.register(fastifyJwt, { secret: config.jwtSecret });

  app.setErrorHandler((err, _req, rep) => {
    if (err instanceof ZodError) {
      return rep.code(400).send({ erro: 'Dados inválidos.', detalhes: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    if (err instanceof ErroApp) return rep.code(err.status).send({ erro: err.message, codigo: err.codigo });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return rep.code(e.statusCode).send({ erro: e.message });
    app.log.error(err);
    return rep.code(500).send({ erro: 'Erro interno. Tente novamente.' });
  });

  registrarRotas(app, ctx);

  // Em produção, a API também serve o front-end (PWA) já compilado.
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, rep) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return rep.sendFile('index.html');
      return rep.code(404).send({ erro: 'Rota não encontrada.' });
    });
  } else {
    app.setNotFoundHandler((_req, rep) => rep.code(404).send({ erro: 'Rota não encontrada.' }));
  }

  return { app, ctx };
}
