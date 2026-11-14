import QRCode from 'qrcode';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Previsao } from '../tipos';
import { diaSemana } from '../util';

export function Estado({ carregando, erro, vazio, children }: { carregando?: boolean; erro?: string | null; vazio?: boolean | string; children?: ReactNode }) {
  if (erro) return <div className="aviso bad" role="alert">⚠️ {erro}</div>;
  if (carregando) return <div className="carregando">Carregando…</div>;
  if (vazio) return <div className="vazio">{typeof vazio === 'string' ? vazio : 'Nada por aqui ainda.'}</div>;
  return <>{children}</>;
}

export function Stat({ valor, rotulo }: { valor: ReactNode; rotulo: string }) {
  return (
    <div className="card stat">
      <b>{valor}</b>
      <span>{rotulo}</span>
    </div>
  );
}

const TOM: Record<string, string> = {
  solicitado: 'warn', agrupado: 'info', agendado: 'info', coletado: 'info', entregue: 'warn', pago: 'ok', expirado: 'bad', cancelado: '',
  aberta: 'warn', agendada: 'info', em_rota: 'info', liquidada: 'ok', cancelada: '', removido: '',
};
export function Chip({ status, children }: { status: string; children: ReactNode }) {
  return <span className={`chip ${TOM[status] ?? ''}`}>{children}</span>;
}

/** Barras horizontais de série única: valor escrito na ponta, tooltip nativo por barra. */
export function Barras({ dados, formatar }: { dados: { rotulo: string; valor: number }[]; formatar: (n: number) => string }) {
  const max = Math.max(1, ...dados.map((d) => d.valor));
  if (!dados.length) return <div className="vazio">Sem dados.</div>;
  return (
    <div className="barras" role="list">
      {dados.map((d) => {
        const pct = (d.valor / max) * 100;
        return (
          <div className="barra-linha" role="listitem" key={d.rotulo} title={`${d.rotulo}: ${formatar(d.valor)}`}>
            <span>{d.rotulo}</span>
            <div className="barra-trilho">
              <div className="barra" style={{ width: `${Math.max(pct * 0.78, 0.5)}%` }} />
              <span className="barra-valor" style={{ left: `${Math.max(pct * 0.78, 0.5)}%` }}>{formatar(d.valor)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function QR({ texto, tamanho = 200 }: { texto: string; tamanho?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) void QRCode.toCanvas(ref.current, texto, { width: tamanho, margin: 1 });
  }, [texto, tamanho]);
  return <canvas ref={ref} aria-label={`QR Code ${texto}`} />;
}

export function Clima({ previsoes }: { previsoes: Previsao[] }) {
  const icone = (p: Previsao) => (p.severo ? '⛈️' : p.chuvaMm >= 20 ? '🌧️' : p.chuvaMm >= 2 ? '🌦️' : '☀️');
  return (
    <div className="grade-4" style={{ gridTemplateColumns: `repeat(${previsoes.length}, minmax(0,1fr))` }}>
      {previsoes.map((p) => (
        <div key={p.data} className={`card stat ${p.severo ? 'aviso bad' : ''}`} style={{ display: 'block' }}>
          <div className="peq muted">{diaSemana(p.data)}</div>
          <div style={{ fontSize: '1.8rem' }} aria-hidden>{icone(p)}</div>
          <div className="peq"><b style={{ fontSize: '1rem', display: 'inline' }}>{p.tempMaxC}°</b> · {p.chuvaMm} mm</div>
          <div className="peq muted">{p.descricao}</div>
        </div>
      ))}
    </div>
  );
}

export function useConfirmacao() {
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'bad' | 'info'; texto: string } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(t);
  }, [msg]);
  const el = msg ? <div className={`aviso ${msg.tipo}`} role="status">{msg.texto}</div> : null;
  return { mostrar: setMsg, el };
}
