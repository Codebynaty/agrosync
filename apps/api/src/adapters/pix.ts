import crypto from 'node:crypto';

export type EventoPix = {
  id: string;
  tipo: 'pix.recebido';
  txid: string;
  valorCentavos: number;
  pagoEm: string;
};

export interface ProvedorPix {
  readonly nome: string;
  criarCobranca(dados: { txid: string; valorCentavos: number; descricao: string }): Promise<{ copiaECola: string }>;
}

/** Assina o corpo do webhook (HMAC-SHA256, hex). Mesmo esquema usado por PSPs reais. */
export function assinar(corpo: string, segredo: string): string {
  return crypto.createHmac('sha256', segredo).update(corpo).digest('hex');
}

export function assinaturaValida(corpo: string, assinatura: string | undefined, segredo: string): boolean {
  if (!assinatura) return false;
  const esperado = Buffer.from(assinar(corpo, segredo), 'hex');
  const recebido = Buffer.from(assinatura, 'hex');
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
}

export type EntregadorWebhook = (corpo: string, assinatura: string) => Promise<void>;

/**
 * Provedor Pix simulado (sandbox). Fiel ao contrato de um PSP real:
 * cria cobranças e, quando "pago", entrega um webhook assinado ao nosso endpoint.
 * Permite forçar duplicatas para demonstrar a idempotência.
 */
export class PixSimulado implements ProvedorPix {
  readonly nome = 'pix-simulado';
  private cobrancas = new Map<string, number>();
  constructor(
    private segredo: string,
    private entregar: EntregadorWebhook,
  ) {}

  async criarCobranca(d: { txid: string; valorCentavos: number; descricao: string }) {
    this.cobrancas.set(d.txid, d.valorCentavos);
    const valor = (d.valorCentavos / 100).toFixed(2);
    return { copiaECola: `AGROSYNC-SANDBOX|PIX|${d.txid}|${valor}|${d.descricao.slice(0, 40)}` };
  }

  /** Simula o pagador confirmando o Pix no app do banco. */
  async simularPagamento(txid: string, valorCentavos: number, opcoes: { duplicar?: boolean } = {}) {
    const evento: EventoPix = {
      id: `evt_${crypto.randomUUID()}`,
      tipo: 'pix.recebido',
      txid,
      valorCentavos: this.cobrancas.get(txid) ?? valorCentavos,
      pagoEm: new Date().toISOString(),
    };
    const corpo = JSON.stringify(evento);
    const assinatura = assinar(corpo, this.segredo);
    await this.entregar(corpo, assinatura);
    if (opcoes.duplicar) await this.entregar(corpo, assinatura);
    return evento;
  }
}
