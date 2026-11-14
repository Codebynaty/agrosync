import { useCallback, useState } from 'react';
import { post } from '../../api';
import { Chip, Estado, QR, useConfirmacao } from '../../components/Comuns';
import { useAoSincronizar, useFila } from '../../offline';
import type { Pedido, Safra } from '../../tipos';
import { brl, dataBR, hojeISO, kg, nomeCultura, useApi } from '../../util';

function Pix({ p, aoPagar }: { p: Pedido; aoPagar: () => void }) {
  const [duplicar, setDuplicar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function pagar() {
    setOcupado(true);
    try {
      await post(`/pix-sandbox/pagar/${p.txid}`, { duplicar });
      setResultado(duplicar ? 'Pix confirmado. O banco enviou o aviso duas vezes e o sistema processou só uma.' : 'Pix confirmado.');
      aoPagar();
    } catch (e) {
      setResultado((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="pilha" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <b>Pagar {brl(p.rateio_centavos ?? 0)} via Pix</b>
      <div className="qr"><QR texto={p.copia_e_cola ?? ''} tamanho={180} /></div>
      <button
        className="btn peq"
        onClick={() => {
          void navigator.clipboard?.writeText(p.copia_e_cola ?? '');
          setCopiado(true);
        }}
      >
        {copiado ? 'Copiado ✓' : 'Copiar Pix copia e cola'}
      </button>
      <div className="aviso info peq">Ambiente de testes (sandbox): nenhum dinheiro real é movimentado. O botão abaixo simula a confirmação do seu banco.</div>
      <label className="linha peq">
        <input type="checkbox" checked={duplicar} onChange={(e) => setDuplicar(e.target.checked)} style={{ width: 20, minHeight: 20 }} />
        Simular aviso duplicado do banco (teste de confiabilidade)
      </label>
      <button className="btn primario bloco" disabled={ocupado} onClick={() => void pagar()}>Confirmar pagamento no banco (sandbox)</button>
      {resultado && <div className="aviso ok peq">{resultado}</div>}
    </div>
  );
}

function CartaoPedido({ p, recarregar }: { p: Pedido; recarregar: () => void }) {
  const [qr, setQr] = useState(false);
  const [novaData, setNovaData] = useState(hojeISO(1));
  const { mostrar, el } = useConfirmacao();

  async function acao(caminho: string, body: unknown = {}, ok = 'Feito.') {
    try {
      await post(caminho, body);
      mostrar({ tipo: 'ok', texto: ok });
      recarregar();
    } catch (e) {
      mostrar({ tipo: 'bad', texto: (e as Error).message });
    }
  }

  const economia = p.custo_individual_centavos != null && p.rateio_centavos != null ? p.custo_individual_centavos - p.rateio_centavos : 0;

  return (
    <div className="card item">
      <div className="cab">
        <b>{kg(p.volume_kg)} de {nomeCultura(p.cultura).toLowerCase()}</b>
        <Chip status={p.status}>{p.status_rotulo}</Chip>
      </div>
      <div className="muted peq">
        {p.destino_nome} · coleta {dataBR(p.data_coleta ?? p.data_desejada)}
        {p.motorista_nome ? ` · motorista ${p.motorista_nome}` : ''}
      </div>
      {p.rateio_centavos != null && (
        <div className="peq">
          Sua parte do frete: <b>{brl(p.rateio_centavos)}</b>
          {p.pedidos_na_carga > 1 && economia > 0 && <> · sozinho seria {brl(p.custo_individual_centavos!)} · <b style={{ color: 'var(--ok)' }}>economia de {brl(economia)}</b></>}
        </div>
      )}
      {p.pedidos_na_carga > 1 && <div className="peq muted">Carga coletiva com {p.pedidos_na_carga - 1} vizinho(s).</div>}

      {p.status === 'agendado' && (
        <>
          <button className="btn peq" onClick={() => setQr((v) => !v)}>{qr ? 'Esconder' : 'Mostrar'} QR para o motorista</button>
          {qr && (
            <div className="qr">
              <QR texto={p.qr_token} />
              <span className="codigo-qr mono">{p.qr_token}</span>
              <span className="peq">Mostre ao motorista na coleta</span>
            </div>
          )}
        </>
      )}

      {p.status === 'entregue' && p.pagamento_status === 'pendente' && p.txid && <Pix p={p} aoPagar={recarregar} />}
      {p.status === 'entregue' && !p.txid && <div className="muted peq">Gerando cobrança Pix…</div>}

      {p.status === 'expirado' && (
        <div className="pilha">
          <div className="aviso warn peq">Nenhum vizinho no trajeto a tempo. Escolha:</div>
          <button className="btn" onClick={() => void acao(`/pedidos/${p.id}/frete-individual`, {}, 'Frete individual criado. Aguardando motorista.')}>Frete individual</button>
          <div className="linha" style={{ flexWrap: 'nowrap' }}>
            <input type="date" value={novaData} min={hojeISO(0)} max={hojeISO(30)} onChange={(e) => setNovaData(e.target.value)} />
            <button className="btn" onClick={() => void acao(`/pedidos/${p.id}/nova-data`, { dataDesejada: novaData }, 'Nova data registrada.')}>Tentar nova data</button>
          </div>
        </div>
      )}

      {['solicitado', 'agrupado', 'agendado', 'expirado'].includes(p.status) && (
        <button className="btn peq perigo" onClick={() => void acao(`/pedidos/${p.id}/cancelar`, {}, 'Frete cancelado.')}>Cancelar frete</button>
      )}
      {el}
    </div>
  );
}

export default function Fretes() {
  const fila = useFila();
  const pedidos = useApi<Pedido[]>('/pedidos');
  const safras = useApi<Safra[]>('/safras');
  const { mostrar, el } = useConfirmacao();

  const recarregar = useCallback(() => {
    void pedidos.recarregar();
    void safras.recarregar();
  }, [pedidos.recarregar, safras.recarregar]); // eslint-disable-line react-hooks/exhaustive-deps
  useAoSincronizar(recarregar);

  const semFrete = (safras.dados ?? []).filter((s) => !s.pedido_id).slice(0, 5);
  const ativos = (pedidos.dados ?? []).filter((p) => !['pago', 'cancelado'].includes(p.status));
  const historico = (pedidos.dados ?? []).filter((p) => ['pago', 'cancelado'].includes(p.status));

  async function pedirFrete(s: Safra) {
    try {
      await post('/pedidos', { safraId: s.id, dataDesejada: hojeISO(1) });
      mostrar({ tipo: 'ok', texto: 'Frete pedido.' });
      recarregar();
    } catch (e) {
      mostrar({ tipo: 'bad', texto: (e as Error).message });
    }
  }

  return (
    <div className="pilha">
      <h1>Fretes</h1>
      {el}
      {fila.pendentes.length > 0 && (
        <div className="aviso warn">
          <div>
            <b>Guardado no celular, aguardando sinal:</b>
            {fila.pendentes.map((o) => <div key={o.opId} className="peq">• {o.descricao}</div>)}
          </div>
        </div>
      )}

      {semFrete.length > 0 && (
        <section className="pilha">
          <h2>Colheitas sem frete</h2>
          {semFrete.map((s) => (
            <div key={s.id} className="card linha entre">
              <div><b>{kg(s.quantidade_kg)} de {nomeCultura(s.cultura).toLowerCase()}</b><div className="muted peq">colhido em {dataBR(s.colhido_em)}</div></div>
              <button className="btn primario peq" onClick={() => void pedirFrete(s)}>Pedir frete p/ amanhã</button>
            </div>
          ))}
        </section>
      )}

      <section className="pilha">
        <h2>Em andamento</h2>
        <Estado carregando={pedidos.carregando && !pedidos.dados} erro={pedidos.erro} vazio={ativos.length === 0 && 'Nenhum frete em andamento.'}>
          <div className="lista">{ativos.map((p) => <CartaoPedido key={p.id} p={p} recarregar={recarregar} />)}</div>
        </Estado>
      </section>

      {historico.length > 0 && (
        <section className="secao pilha">
          <h2>Histórico</h2>
          <div className="card tabela-rolagem">
            <table>
              <thead><tr><th>Data</th><th>Produto</th><th>Frete</th><th>Economia</th><th>Situação</th></tr></thead>
              <tbody>
                {historico.slice(0, 30).map((p) => (
                  <tr key={p.id}>
                    <td>{dataBR(p.data_desejada)}</td>
                    <td>{kg(p.volume_kg)} {nomeCultura(p.cultura).toLowerCase()}</td>
                    <td>{p.rateio_centavos != null ? brl(p.rateio_centavos) : '—'}</td>
                    <td>{p.custo_individual_centavos != null && p.rateio_centavos != null ? brl(p.custo_individual_centavos - p.rateio_centavos) : '—'}</td>
                    <td>{p.status_rotulo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
