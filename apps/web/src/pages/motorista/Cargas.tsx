import { Link } from 'react-router-dom';
import { useAuth } from '../../App';
import { Chip, Estado } from '../../components/Comuns';
import { ROTULO_CARGA, type CargaResumo } from '../../tipos';
import { brl, dataBR, kg, useApi } from '../../util';

export function CartaoCarga({ c }: { c: CargaResumo }) {
  return (
    <Link to={`/cargas/${c.id}`} className="card item" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="cab">
        <b>{c.destino_nome}</b>
        <Chip status={c.status}>{ROTULO_CARGA[c.status] ?? c.status}</Chip>
      </div>
      <div className="peq">
        {dataBR(c.data_coleta)} · {c.paradas} parada(s) · {kg(c.volume_kg)} · {Math.round(c.distancia_m / 1000)} km
      </div>
      <div className="peq">
        Frete <b>{brl(c.custo_total_centavos)}</b>
        {c.paradas > 1 && <span className="muted"> · produtores economizam {brl(c.custo_individual_total_centavos - c.custo_total_centavos)}</span>}
      </div>
      {c.valor_estimado_total_centavos > 0 && (
        <div className="peq">Carga vale ≈ <b>{brl(c.valor_estimado_total_centavos)}</b> <span className="muted">a preço de hoje</span></div>
      )}
      {c.motorista_nome && <div className="muted peq">Motorista: {c.motorista_nome}</div>}
    </Link>
  );
}

export default function CargasMotorista() {
  const { usuario } = useAuth();
  const { dados, erro, carregando } = useApi<CargaResumo[]>('/cargas');
  const minhas = (dados ?? []).filter((c) => c.motorista_id === usuario?.id && !['liquidada', 'cancelada'].includes(c.status));
  const abertas = (dados ?? []).filter((c) => c.status === 'aberta');
  const concluidas = (dados ?? []).filter((c) => c.motorista_id === usuario?.id && c.status === 'liquidada');

  return (
    <div className="pilha">
      <h1>Cargas</h1>
      <Estado carregando={carregando && !dados} erro={erro}>
        <section className="pilha">
          <h2>Minhas cargas</h2>
          {minhas.length ? <div className="lista">{minhas.map((c) => <CartaoCarga key={c.id} c={c} />)}</div> : <div className="vazio">Nenhuma carga aceita.</div>}
        </section>
        <section className="secao pilha">
          <h2>Disponíveis</h2>
          {abertas.length ? <div className="lista">{abertas.map((c) => <CartaoCarga key={c.id} c={c} />)}</div> : <div className="vazio">Nenhuma carga disponível agora. Você será avisado.</div>}
        </section>
        {concluidas.length > 0 && <p className="muted peq secao">{concluidas.length} carga(s) concluída(s) e liquidada(s).</p>}
      </Estado>
    </div>
  );
}
