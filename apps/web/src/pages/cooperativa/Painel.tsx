import { useState } from 'react';
import { post } from '../../api';
import { Barras, Estado, SeloQualidade, Stat, useConfirmacao } from '../../components/Comuns';
import { brl, kg, nomeCultura, quando, useApi } from '../../util';

type Painel = {
  produtores: number;
  motoristas: number;
  kgMovimentados: number;
  economiaCentavos: number;
  economiaPct: number;
  pedidosPorStatus: { status: string; n: number }[];
  cargasPorStatus: { status: string; n: number }[];
  kgPorCultura: { cultura: string; kg: number }[];
  kgPorMunicipio: { municipio: string; kg: number; produtores: number }[];
  kgPorMes: { mes: string; kg: number }[];
  qualidadePorClasse: { classe: string; n: number; kg: number }[];
};
type Evento = { event_id: string; tipo: string; resultado: string; recebido_em: string };

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

export default function PainelCooperativa() {
  const painel = useApi<Painel>('/painel/cooperativa');
  const eventos = useApi<Evento[]>('/webhooks/eventos');
  const [ocupado, setOcupado] = useState(false);
  const { mostrar, el } = useConfirmacao();
  const p = painel.dados;

  async function agrupar() {
    setOcupado(true);
    try {
      const r = await post<{ cargas: string[]; pedidosAgrupados: number }>('/agrupamento');
      mostrar({
        tipo: r.cargas.length ? 'ok' : 'info',
        texto: r.cargas.length ? `${r.cargas.length} carga(s) coletiva(s) criada(s) com ${r.pedidosAgrupados} pedido(s).` : 'Nenhum novo grupo viável agora.',
      });
      void painel.recarregar();
    } finally {
      setOcupado(false);
    }
  }

  async function verificar() {
    setOcupado(true);
    try {
      const r = await post<{ expirados: number; cargasCriadas: number; alertasClima: number }>('/jobs/executar');
      mostrar({ tipo: 'info', texto: `Verificação: ${r.cargasCriadas} carga(s) criada(s), ${r.expirados} pedido(s) expirado(s), ${r.alertasClima} alerta(s) de clima.` });
      void painel.recarregar();
    } finally {
      setOcupado(false);
    }
  }

  const n = (lista: { status: string; n: number }[] | undefined, s: string) => lista?.find((x) => x.status === s)?.n ?? 0;

  return (
    <div className="pilha">
      <div className="linha entre">
        <h1 style={{ margin: 0 }}>Painel da cooperativa</h1>
        <div className="linha">
          <button className="btn primario" disabled={ocupado} onClick={() => void agrupar()}>Agrupar pedidos agora</button>
          <button className="btn" disabled={ocupado} onClick={() => void verificar()}>Rodar verificações</button>
        </div>
      </div>
      {el}
      <Estado carregando={painel.carregando && !p} erro={painel.erro}>
        {p && (
          <>
            <div className="grade-4">
              <Stat valor={p.produtores} rotulo="produtores cadastrados" />
              <Stat valor={kg(p.kgMovimentados)} rotulo="entregues no total" />
              <Stat valor={brl(p.economiaCentavos)} rotulo={`economia em frete (${p.economiaPct.toLocaleString('pt-BR')}%)`} />
              <Stat valor={n(p.cargasPorStatus, 'aberta') + n(p.cargasPorStatus, 'agendada') + n(p.cargasPorStatus, 'em_rota')} rotulo="cargas em andamento" />
            </div>

            <div className="grade-4">
              <Stat valor={n(p.pedidosPorStatus, 'solicitado')} rotulo="pedidos aguardando grupo" />
              <Stat valor={n(p.pedidosPorStatus, 'expirado')} rotulo="pedidos sem grupo (48 h)" />
              <Stat valor={n(p.pedidosPorStatus, 'entregue')} rotulo="entregues aguardando Pix" />
              <Stat valor={n(p.cargasPorStatus, 'liquidada')} rotulo="cargas liquidadas" />
            </div>

            <div className="grade-2 empilha">
              <div className="card pilha">
                <h2>Volume entregue por produto</h2>
                <Barras dados={p.kgPorCultura.map((c) => ({ rotulo: nomeCultura(c.cultura), valor: c.kg }))} formatar={kg} />
              </div>
              <div className="card pilha">
                <h2>Volume entregue por município</h2>
                <Barras dados={p.kgPorMunicipio.map((c) => ({ rotulo: c.municipio, valor: c.kg }))} formatar={kg} />
                <div className="muted peq">Base para políticas públicas e compras institucionais (PNAE).</div>
              </div>
            </div>

            <div className="card pilha">
              <h2>Volume entregue por mês</h2>
              <Barras dados={p.kgPorMes.map((m) => ({ rotulo: mes(m.mes), valor: m.kg }))} formatar={kg} />
            </div>

            {p.qualidadePorClasse.length > 0 && (
              <div className="card pilha">
                <h2>Qualidade das colheitas (triagem visual)</h2>
                <p className="muted peq">Classificação por foto, feita no aparelho do produtor e conferida no servidor.</p>
                <div className="linha" style={{ flexWrap: 'wrap', gap: 10 }}>
                  {['A', 'B', 'C', 'refugo'].map((cl) => {
                    const q = p.qualidadePorClasse.find((x) => x.classe === cl);
                    if (!q) return null;
                    return (
                      <div key={cl} className="linha" style={{ gap: 6 }}>
                        <SeloQualidade classe={cl} /> <b>{q.n}</b> <span className="muted peq">({kg(q.kg)})</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </Estado>

      <div className="card pilha">
        <h2>Webhooks Pix recebidos</h2>
        <p className="muted peq">Prova de idempotência: avisos repetidos do banco aparecem como recebidos uma vez só e nunca confirmam duas vezes.</p>
        <Estado carregando={eventos.carregando && !eventos.dados} erro={eventos.erro} vazio={eventos.dados?.length === 0 && 'Nenhum webhook ainda.'}>
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Evento</th><th>Resultado</th><th>Quando</th></tr></thead>
              <tbody>
                {eventos.dados?.slice(0, 12).map((e) => (
                  <tr key={e.event_id}>
                    <td className="mono peq">{e.event_id.slice(0, 22)}</td>
                    <td>{e.resultado}</td>
                    <td>{quando(e.recebido_em)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Estado>
      </div>
    </div>
  );
}
