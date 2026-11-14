import { todos, um } from '../db.js';
import { CULTURA_POR_ID } from '../domain/culturas.js';
import { formatarBRL } from '../domain/dinheiro.js';
import { ROTULO_PEDIDO, type StatusPedido } from '../domain/estados.js';
import { interpretarColheita, normalizar } from '../domain/linguagem.js';
import { formatarDataBR } from '../domain/tempo.js';
import { ErroApp, type Contexto } from './contexto.js';
import { criarPedido } from './fretes.js';
import { painelProdutor } from './painel.js';
import { criarSafra, propriedadePadrao } from './safras.js';
import { agroScoreDoProdutor } from './score.js';

export const MENU =
  'AgroSync 🌱\n' +
  '1 - Registrar colheita (ex.: "colhi 300 kg de tomate")\n' +
  '2 - Pedir frete da última colheita (FRETE)\n' +
  '3 - Ver meus fretes (STATUS)\n' +
  '4 - Quanto economizei (ECONOMIA)\n' +
  '5 - Meu AgroScore (SCORE)';

/** Normaliza telefone para dígitos com DDI 55. */
export function normalizarTelefone(t: string): string {
  const d = t.replace(/\D/g, '');
  return d.startsWith('55') ? d : `55${d}`;
}

/**
 * Bot conversacional para WhatsApp, SMS e USSD. Recebe texto livre ou
 * números do menu e devolve uma resposta curta (baixo consumo de dados).
 */
export async function responderBot(ctx: Contexto, telefone: string, texto: string): Promise<string> {
  const u = um<{ id: string; nome: string; papel: string }>(
    ctx.db,
    'SELECT id, nome, papel FROM usuarios WHERE telefone = ?',
    normalizarTelefone(telefone),
  );
  if (!u) return 'Número não cadastrado no AgroSync. Procure sua cooperativa para fazer o cadastro.';
  if (u.papel !== 'produtor') return 'O atendimento por mensagem é para produtores. Use o app AgroSync.';

  const t = normalizar(texto);
  const primeiro = u.nome.split(' ')[0];

  if (!t || ['oi', 'ola', 'menu', 'ajuda', '0', 'inicio'].includes(t)) return `Olá, ${primeiro}!\n${MENU}`;
  if (t === '1') return 'Diga o que colheu, por exemplo: "colhi 300 kg de tomate" ou "10 caixas de morango".';

  const colheita = interpretarColheita(texto);
  if (colheita) {
    if (!propriedadePadrao(ctx, u.id)) return 'Você ainda não tem propriedade cadastrada. Procure sua cooperativa.';
    const { safra } = criarSafra(ctx, u.id, { cultura: colheita.cultura.id, quantidadeKg: colheita.quantidadeKg, origem: 'bot' });
    return `Registrado: ${colheita.entendido}. ✅\nResponda FRETE (ou 2) para pedir a coleta para amanhã.\nCódigo: ${safra.id.slice(0, 8)}`;
  }

  if (t === '2' || t.startsWith('frete')) {
    const safra = um<{ id: string; cultura: string; quantidade_kg: number }>(
      ctx.db,
      `SELECT s.id, s.cultura, s.quantidade_kg FROM safras s
        WHERE s.produtor_id = ? AND NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.safra_id = s.id AND p.status <> 'cancelado')
        ORDER BY s.criado_em DESC LIMIT 1`,
      u.id,
    );
    if (!safra) return 'Não encontrei colheita sem frete. Registre primeiro, ex.: "colhi 200 kg de alface".';
    try {
      const { pedido } = await criarPedido(ctx, u.id, { safraId: safra.id });
      const status = ROTULO_PEDIDO[pedido.status as StatusPedido];
      return (
        `Frete pedido: ${safra.quantidade_kg} kg de ${CULTURA_POR_ID[safra.cultura]?.nome.toLowerCase()} para ${formatarDataBR(pedido.data_desejada)}.\n` +
        `Situação: ${status}. Vamos te avisar quando o caminhão coletivo fechar.`
      );
    } catch (e) {
      if (e instanceof ErroApp) return `Não foi possível pedir o frete: ${e.message}`;
      throw e;
    }
  }

  if (t === '3' || t.startsWith('status')) {
    const ps = todos<{ cultura: string; volume_kg: number; status: StatusPedido; data_desejada: string }>(
      ctx.db,
      `SELECT cultura, volume_kg, status, data_desejada FROM pedidos WHERE produtor_id = ?
        AND status NOT IN ('pago','cancelado') ORDER BY data_desejada LIMIT 5`,
      u.id,
    );
    if (!ps.length) return 'Você não tem fretes em andamento.';
    return ps
      .map((p) => `• ${p.volume_kg} kg ${CULTURA_POR_ID[p.cultura]?.nome.toLowerCase()} (${formatarDataBR(p.data_desejada)}): ${ROTULO_PEDIDO[p.status]}`)
      .join('\n');
  }

  if (t === '4' || t.startsWith('economia') || t.startsWith('saldo')) {
    const p = await painelProdutor(ctx, u.id);
    return `Com o frete coletivo você já economizou ${formatarBRL(p.economiaCentavos)} e enviou ${p.kgEnviados.toLocaleString('pt-BR')} kg.` +
      (p.pagamentosPendentes ? `\nFrete a pagar: ${formatarBRL(p.valorPendenteCentavos)} (pague pelo Pix no app).` : '');
  }

  if (t === '5' || t.startsWith('score') || t.startsWith('credito')) {
    const s = agroScoreDoProdutor(ctx, u.id);
    return `Seu AgroScore: ${s.score} (faixa ${s.faixa}). Microcrédito pré-aprovado: até ${formatarBRL(s.limiteSugeridoCentavos)}.`;
  }

  return `Não entendi. ${MENU}`;
}
