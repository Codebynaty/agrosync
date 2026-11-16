export type StatusPedido = 'solicitado' | 'agrupado' | 'agendado' | 'coletado' | 'entregue' | 'pago' | 'expirado' | 'cancelado';

export type Pedido = {
  id: string;
  safra_id: string | null;
  cultura: string;
  volume_kg: number;
  data_desejada: string;
  status: StatusPedido;
  status_rotulo: string;
  carga_id: string | null;
  qr_token: string;
  destino_nome: string;
  propriedade_nome: string;
  municipio: string;
  rateio_centavos: number | null;
  custo_individual_centavos: number | null;
  txid: string | null;
  pagamento_status: 'pendente' | 'confirmado' | null;
  copia_e_cola: string | null;
  carga_status: string | null;
  data_coleta: string | null;
  motorista_nome: string | null;
  pedidos_na_carga: number;
  produtor_id?: string;
};

export type Safra = {
  id: string;
  cultura: string;
  quantidade_kg: number;
  perecivel: number;
  origem: string;
  colhido_em: string;
  pedido_id: string | null;
  triagem_classe: string | null;
  triagem_pontuacao: number | null;
  triagem_maturidade: string | null;
  triagem_miniatura: string | null;
};

export type Alerta = { id: string; tipo: string; canal: string; titulo: string; mensagem: string; lido: number; criado_em: string };

export type CargaResumo = {
  id: string;
  status: string;
  data_coleta: string;
  volume_kg: number;
  distancia_m: number;
  custo_total_centavos: number;
  custo_individual_total_centavos: number;
  motorista_id: string | null;
  destino_nome: string;
  motorista_nome: string | null;
  paradas: number;
};

export type Parada = {
  pedidoId: string;
  produtorId: string;
  produtorNome: string;
  propriedadeNome: string;
  municipio: string;
  cultura: string;
  volumeKg: number;
  lat: number;
  lng: number;
  status: string;
};

export type CargaDetalhe = Omit<CargaResumo, 'paradas'> & {
  destino_municipio: string;
  destino_lat: number;
  destino_lng: number;
  paradas: Parada[];
};

export type Previsao = { data: string; chuvaMm: number; ventoKmh: number; tempMaxC: number; severo: boolean; descricao: string; fonte: string };

export type Destino = { id: string; nome: string; municipio: string; lat: number; lng: number };

export type Propriedade = { id: string; nome: string; municipio: string; lat: number; lng: number; chave_dispositivo: string };

export const ROTULO_CARGA: Record<string, string> = {
  aberta: 'Aguardando motorista',
  agendada: 'Agendada',
  em_rota: 'Em rota',
  entregue: 'Entregue · aguardando Pix',
  liquidada: 'Liquidada',
  cancelada: 'Cancelada',
};
