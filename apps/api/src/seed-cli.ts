import fs from 'node:fs';
import { criarApp } from './app.js';
import { carregarConfig } from './config.js';
import { bancoVazio, popular } from './seed.js';

const config = carregarConfig();
if (process.argv.includes('--reset')) {
  for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(config.caminhoBanco + sufixo, { force: true });
  console.log(`Banco apagado: ${config.caminhoBanco}`);
}

const { ctx } = await criarApp();
if (!bancoVazio(ctx)) {
  console.log('O banco já tem dados. Use "npm run seed -- --reset" para recriar.');
} else {
  await popular(ctx);
  console.log('Dados de demonstração criados.');
}
ctx.db.close();
