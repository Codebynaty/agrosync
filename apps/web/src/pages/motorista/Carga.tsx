import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { post } from '../../api';
import { useAuth } from '../../App';
import { Chip, Estado, useConfirmacao } from '../../components/Comuns';
import { MapaRota } from '../../components/Mapa';
import { ROTULO_CARGA, type CargaDetalhe } from '../../tipos';
import { brl, dataBR, kg, nomeCultura, useApi } from '../../util';

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
const BarcodeDetectorCls = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;

/** Lê QR pela câmera quando o navegador suporta (Chrome Android); senão o motorista digita o código. */
function Leitor({ aoLer, fechar }: { aoLer: (codigo: string) => void; fechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let ativo = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const det = new BarcodeDetectorCls!({ formats: ['qr_code'] });
        while (ativo) {
          const r = await det.detect(video.current).catch(() => []);
          if (r[0]?.rawValue) {
            aoLer(r[0].rawValue);
            return;
          }
          await new Promise((res) => setTimeout(res, 300));
        }
      } catch {
        setErro('Não foi possível abrir a câmera. Digite o código.');
      }
    })();
    return () => {
      ativo = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [aoLer]);

  return (
    <div className="pilha">
      {erro ? <div className="aviso warn peq">{erro}</div> : <video ref={video} className="scanner" muted playsInline />}
      <button className="btn peq" onClick={fechar}>Fechar câmera</button>
    </div>
  );
}

export default function CargaDetalhePagina() {
  const { id } = useParams();
  const { usuario } = useAuth();
  const { dados: c, erro, carregando, recarregar, setDados } = useApi<CargaDetalhe>(`/cargas/${id}`);
  const [codigo, setCodigo] = useState('');
  const [camera, setCamera] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const { mostrar, el } = useConfirmacao();

  const souMotorista = usuario?.papel === 'motorista';
  const minha = c?.motorista_id === usuario?.id;

  async function acao(caminho: string, body: unknown, ok: string) {
    setOcupado(true);
    try {
      setDados(await post<CargaDetalhe>(caminho, body));
      mostrar({ tipo: 'ok', texto: ok });
    } catch (e) {
      mostrar({ tipo: 'bad', texto: (e as Error).message });
      void recarregar();
    } finally {
      setOcupado(false);
    }
  }

  const checkin = (cod: string) => {
    setCamera(false);
    setCodigo('');
    void acao(`/cargas/${id}/checkin`, { codigo: cod }, `Coleta ${cod.toUpperCase()} confirmada.`);
  };

  return (
    <div className="pilha">
      <Link to={souMotorista ? '/' : '/cargas'} className="peq">← Voltar</Link>
      <Estado carregando={carregando && !c} erro={erro}>
        {c && (
          <>
            <div className="linha entre">
              <h1 style={{ margin: 0 }}>{c.destino_nome}</h1>
              <Chip status={c.status}>{ROTULO_CARGA[c.status] ?? c.status}</Chip>
            </div>
            <div className="muted">
              {dataBR(c.data_coleta)} · {kg(c.volume_kg)} · {Math.round(c.distancia_m / 1000)} km · frete {brl(c.custo_total_centavos)}
              {c.motorista_nome ? ` · ${c.motorista_nome}` : ''}
            </div>
            {c.valor_estimado_total_centavos > 0 && (
              <div className="peq">
                Carga vale ≈ <b>{brl(c.valor_estimado_total_centavos)}</b> <span className="muted">a preço de hoje, ajustado pela qualidade das safras</span>
              </div>
            )}
            {el}

            <MapaRota
              destino={{ lat: c.destino_lat, lng: c.destino_lng, nome: c.destino_nome }}
              paradas={c.paradas.map((p) => ({ lat: p.lat, lng: p.lng, rotulo: `${p.produtorNome} · ${kg(p.volumeKg)}`, feito: ['coletado', 'entregue', 'pago'].includes(p.status) }))}
            />

            {souMotorista && c.status === 'aberta' && (
              <button className="btn primario grande bloco" disabled={ocupado} onClick={() => void acao(`/cargas/${id}/aceitar`, {}, 'Carga aceita. Os produtores foram avisados.')}>
                Aceitar carga
              </button>
            )}

            {souMotorista && minha && ['agendada', 'em_rota'].includes(c.status) && (
              <div className="card pilha">
                <h2>Check-in na coleta</h2>
                <p className="muted peq">Leia o QR no celular do produtor ou digite o código de 8 caracteres.</p>
                {camera && BarcodeDetectorCls ? (
                  <Leitor aoLer={checkin} fechar={() => setCamera(false)} />
                ) : (
                  BarcodeDetectorCls && <button className="btn bloco" onClick={() => setCamera(true)}>📷 Ler QR com a câmera</button>
                )}
                <form className="linha" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => (e.preventDefault(), codigo && checkin(codigo))}>
                  <input className="mono" placeholder="Código (ex.: A1B2C3D4)" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} maxLength={12} />
                  <button className="btn primario" disabled={ocupado || codigo.length < 4}>Confirmar</button>
                </form>
                {c.status === 'em_rota' && (
                  <button className="btn primario bloco" disabled={ocupado} onClick={() => void acao(`/cargas/${id}/entregar`, {}, 'Entrega registrada. Os produtores receberam a cobrança Pix.')}>
                    🏁 Confirmar entrega no destino
                  </button>
                )}
              </div>
            )}

            <section className="pilha">
              <h2>Paradas</h2>
              <div className="lista">
                {c.paradas.map((p, i) => (
                  <div key={p.pedidoId} className="card item">
                    <div className="cab">
                      <b>{i + 1}. {p.produtorNome}</b>
                      <Chip status={p.status}>{p.status}</Chip>
                    </div>
                    <div className="peq">{p.propriedadeNome} · {p.municipio}</div>
                    <div className="peq">{kg(p.volumeKg)} de {nomeCultura(p.cultura).toLowerCase()}</div>
                    {p.valorEstimadoCentavos > 0 && (
                      <div className="peq">
                        ≈ <b>{brl(p.valorEstimadoCentavos)}</b>
                        {p.ajustePct ? <span className="muted"> ({p.ajustePct > 0 ? '+' : ''}{p.ajustePct}% qualidade)</span> : null}
                      </div>
                    )}
                    <a className="peq" href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`} target="_blank" rel="noopener">Abrir no mapa ↗</a>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </Estado>
    </div>
  );
}
