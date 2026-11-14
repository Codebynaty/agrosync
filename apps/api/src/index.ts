import { criarApp } from './app.js';
import { agendarJobs } from './services/jobs.js';
import { bancoVazio, popular } from './seed.js';

const { app, ctx } = await criarApp({ logger: true });

if (ctx.config.seedAutomatico && bancoVazio(ctx)) {
  app.log.info('Banco vazio: gerando dados de demonstração...');
  await popular(ctx);
  app.log.info('Dados de demonstração prontos.');
}

agendarJobs(ctx);

await app.listen({ port: ctx.config.porta, host: ctx.config.host });

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, async () => {
    await app.close();
    ctx.db.close();
    process.exit(0);
  });
}
