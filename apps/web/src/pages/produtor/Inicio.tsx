import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../App';
import { Chip, Clima, Estado, Stat } from '../../components/Comuns';
import { useAoSincronizar, useFila } from '../../offline';
import type { Pedido, Previsao, Propriedade } from '../../tipos';
import { brl, dataBR, kg, nomeCultura, useApi } from '../../util';

type Painel = {
  economiaCentavos: number;
  kgEnviados: number;
  receitaEstimadaCentavos: number;
  pedidosAtivos: number;
  pagamentosPendentes: number;
  valorPendenteCentavos: number;
};
type Cotacao = { cultura: string; nome: string; precoCentavosKg: number; variacaoPct: number; fonte: string };
type Leitura = { tipo: string; valor: number; medido_em: string };

export default function Inicio() {
  const { usuario } = useAuth();
  const fila = useFila();
  const painel = useApi<Painel>('/painel/produtor');
  const pedidos = useApi<Pedido[]>('/pedidos');
  const props = useApi<Propriedade[]>('/propriedades');
  const prop = props.dados?.[0];
  const clima = useApi<Previsao[]>(prop ? `/clima?lat=${prop.lat}&lng=${prop.lng}&dias=3` : null);
  const leituras = useApi<Leitura[]>(prop ? `/propriedades/${prop.id}/leituras` : null);
  const cotacoes = useApi<Cotacao[]>('/cotacoes');

  const recarregar = useCallback(() => {
    void painel.recarregar();
    void pedidos.recarregar();
  }, [painel.recarregar, pedidos.recarregar]); // eslint-disable-line react-hooks/exhaustive-deps
  useAoSincronizar(recarregar);

  const ativos = (pedidos.dados ?? []).filter((p) => ['solicitado', 'agrupado', 'agendado', 'coletado', 'entregue', 'expirado'].includes(p.status));
  const umidade = leituras.dados?.find((l) => l.tipo === 'umidade_solo');
  const p = painel.dados;

  return (
    <div className="pilha">
      <div>
        <h1>Olá, {usuario?.nome.split(' ')[0]} 👋</h1>
        {prop && <div className="muted">{prop.nome} · {prop.municipio}</div>}
      </div>

      <Link to="/colher" className="btn primario grande bloco">🎤 Registrar colheita</Link>

      {fila.pendentes.length > 0 && (
        <div className="aviso warn">📱 {fila.pendentes.length} registro(s) guardado(s) no celular. Serão enviados automaticamente quando houver sinal.</div>
      )}

      {p && p.pagamentosPendentes > 0 && (
        <Link to="/fretes" className="aviso warn" style={{ textDecoration: 'none' }}>
          💸 Você tem {brl(p.valorPendenteCentavos)} de frete para pagar via Pix. Toque para pagar.
        </Link>
      )}

      <Estado carregando={painel.carregando && !p} erro={painel.erro}>
        {p && (
          <div className="grade-2">
            <Stat valor={brl(p.economiaCentavos)} rotulo="economizados com frete coletivo" />
            <Stat valor={kg(p.kgEnviados)} rotulo="entregues pelo AgroSync" />
          </div>
        )}
      </Estado>

      <section className="secao pilha">
        <div className="linha entre"><h2>Seus fretes</h2><Link to="/fretes" className="peq">Ver todos</Link></div>
        <Estado carregando={pedidos.carregando && !pedidos.dados} erro={pedidos.erro} vazio={ativos.length === 0 && 'Nenhum frete em andamento.'}>
          <div className="lista">
            {ativos.slice(0, 3).map((x) => (
              <Link key={x.id} to="/fretes" className="card item" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="cab">
                  <b>{kg(x.volume_kg)} de {nomeCultura(x.cultura).toLowerCase()}</b>
                  <Chip status={x.status}>{x.status_rotulo}</Chip>
                </div>
                <div className="muted peq">{x.destino_nome} · coleta {dataBR(x.data_coleta ?? x.data_desejada)}{x.pedidos_na_carga > 1 ? ` · com ${x.pedidos_na_carga - 1} vizinho(s)` : ''}</div>
              </Link>
            ))}
          </div>
        </Estado>
      </section>

      {clima.dados && (
        <section className="secao pilha">
          <h2>Tempo na propriedade</h2>
          <Clima previsoes={clima.dados} />
          <div className="muted peq">Fonte: {clima.dados[0]?.fonte}</div>
        </section>
      )}

      {umidade && (
        <section className="secao">
          <div className={`card linha entre ${umidade.valor < 20 ? 'aviso bad' : ''}`}>
            <div>
              <b>🌱 Umidade do solo</b>
              <div className="muted peq">Sensor LoRaWAN · {new Date(umidade.medido_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            <b style={{ fontSize: '1.6rem' }}>{Math.round(umidade.valor)}%</b>
          </div>
        </section>
      )}

      {cotacoes.dados && (
        <section className="secao pilha">
          <h2>Preços de hoje</h2>
          <div className="card">
            <table>
              <thead><tr><th>Produto</th><th>R$/kg</th><th>Variação</th></tr></thead>
              <tbody>
                {cotacoes.dados.slice(0, 6).map((c) => (
                  <tr key={c.cultura}>
                    <td>{c.nome}</td>
                    <td>{brl(c.precoCentavosKg)}</td>
                    <td>{c.variacaoPct > 0 ? '▲' : c.variacaoPct < 0 ? '▼' : '•'} {Math.abs(c.variacaoPct).toLocaleString('pt-BR')}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="muted peq" style={{ marginTop: 8 }}>{cotacoes.dados[0]?.fonte}</div>
          </div>
        </section>
      )}
    </div>
  );
}
