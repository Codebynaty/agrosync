export type StatusPedido =
  | 'solicitado'
  | 'agrupado'
  | 'agendado'
  | 'coletado'
  | 'entregue'
  | 'pago'
  | 'expirado'
  | 'cancelado';

export type StatusCarga = 'aberta' | 'agendada' | 'em_rota' | 'entregue' | 'liquidada' | 'cancelada';

export const TRANSICOES_PEDIDO: Record<StatusPedido, StatusPedido[]> = {
  solicitado: ['agrupado', 'expirado', 'cancelado'],
  agrupado: ['agendado', 'solicitado', 'cancelado'],
  agendado: ['coletado', 'solicitado', 'cancelado'],
  coletado: ['entregue'],
  entregue: ['pago'],
  expirado: ['solicitado', 'agrupado', 'cancelado'],
  pago: [],
  cancelado: [],
};

export const TRANSICOES_CARGA: Record<StatusCarga, StatusCarga[]> = {
  aberta: ['agendada', 'cancelada'],
  agendada: ['em_rota', 'cancelada'],
  em_rota: ['entregue'],
  entregue: ['liquidada'],
  liquidada: [],
  cancelada: [],
};

export function podeTransitarPedido(de: StatusPedido, para: StatusPedido): boolean {
  return TRANSICOES_PEDIDO[de]?.includes(para) ?? false;
}

export function podeTransitarCarga(de: StatusCarga, para: StatusCarga): boolean {
  return TRANSICOES_CARGA[de]?.includes(para) ?? false;
}

export const ROTULO_PEDIDO: Record<StatusPedido, string> = {
  solicitado: 'Aguardando grupo',
  agrupado: 'Em carga coletiva',
  agendado: 'Coleta agendada',
  coletado: 'Coletado',
  entregue: 'Entregue · pagar frete',
  pago: 'Concluído',
  expirado: 'Sem grupo em 48 h',
  cancelado: 'Cancelado',
};
