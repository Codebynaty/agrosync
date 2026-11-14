export type Canal = 'sms' | 'whatsapp' | 'push';

export type Mensagem = { telefone: string; canal: Canal; titulo: string; texto: string };

export interface Notificador {
  readonly nome: string;
  enviar(m: Mensagem): Promise<void>;
}

/**
 * Notificador simulado (substitui Twilio / WhatsApp Business / Web Push).
 * Guarda as mensagens numa caixa de saída consultável e escreve no log.
 */
export class NotificadorSimulado implements Notificador {
  readonly nome = 'notificador-simulado';
  readonly caixaSaida: (Mensagem & { em: string })[] = [];
  constructor(private log: (m: string) => void = () => {}) {}

  async enviar(m: Mensagem) {
    this.caixaSaida.push({ ...m, em: new Date().toISOString() });
    if (this.caixaSaida.length > 500) this.caixaSaida.shift();
    this.log(`[${m.canal.toUpperCase()} → ${m.telefone}] ${m.titulo}: ${m.texto}`);
  }
}
