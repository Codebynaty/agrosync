/**
 * Simula um gateway LoRaWAN enviando leituras de sensores de campo para a API.
 * Uso: npm run sim:sensores [-- --url http://localhost:3333 --intervalo 10]
 */
import { carregarConfig } from './config.js';
import { abrirBanco, todos } from './db.js';

const arg = (nome: string, padrao: string) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 ? process.argv[i + 1] : padrao;
};

const url = arg('url', 'http://localhost:3333');
const intervalo = Number(arg('intervalo', '10')) * 1000;
const db = abrirBanco(carregarConfig().caminhoBanco);
const dispositivos = todos<{ nome: string; chave_dispositivo: string }>(db, 'SELECT nome, chave_dispositivo FROM propriedades');
db.close();

if (!dispositivos.length) {
  console.error('Nenhuma propriedade cadastrada. Rode a API uma vez para gerar os dados.');
  process.exit(1);
}

const umidade = new Map(dispositivos.map((d) => [d.chave_dispositivo, 30 + Math.random() * 20]));

async function enviar() {
  for (const d of dispositivos) {
    const u = Math.max(5, (umidade.get(d.chave_dispositivo) ?? 30) - Math.random() * 3);
    umidade.set(d.chave_dispositivo, u < 12 ? 45 : u);
    const leituras = [
      { tipo: 'umidade_solo', valor: Math.round(u) },
      { tipo: 'temperatura', valor: Math.round(18 + Math.random() * 12) },
    ];
    try {
      const r = await fetch(`${url}/api/sensores/leituras`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-chave-dispositivo': d.chave_dispositivo },
        body: JSON.stringify({ leituras }),
      });
      console.log(`${d.nome}: umidade ${Math.round(u)}% → ${r.status}`);
    } catch (e) {
      console.error(`${d.nome}: falha (${(e as Error).message})`);
    }
  }
}

await enviar();
setInterval(enviar, intervalo);
