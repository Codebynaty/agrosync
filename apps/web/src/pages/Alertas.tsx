import { post } from '../api';
import { Estado } from '../components/Comuns';
import type { Alerta } from '../tipos';
import { quando, useApi } from '../util';

const ICONE: Record<string, string> = { carga: '🚚', coleta: '📦', pagamento: '💸', clima: '⛈️', estrada: '🚧', sensor: '🌱', credito: '💳', sistema: 'ℹ️' };
const CANAL: Record<string, string> = { sms: 'SMS', whatsapp: 'WhatsApp', push: 'App' };

export default function Alertas() {
  const { dados, erro, carregando, recarregar } = useApi<Alerta[]>('/alertas');

  async function marcarTodos() {
    await post('/alertas/lidos');
    void recarregar();
  }

  return (
    <div className="pilha">
      <div className="linha entre">
        <h1>Alertas</h1>
        {dados?.some((a) => !a.lido) && <button className="btn peq" onClick={() => void marcarTodos()}>Marcar todos como lidos</button>}
      </div>
      <Estado carregando={carregando && !dados} erro={erro} vazio={dados?.length === 0 && 'Nenhum alerta.'}>
        <div className="lista">
          {dados?.map((a) => (
            <div key={a.id} className="card item" style={a.lido ? { opacity: 0.75 } : { borderLeft: '4px solid var(--brand)' }}>
              <div className="cab">
                <b><span aria-hidden>{ICONE[a.tipo] ?? '🔔'}</span> {a.titulo}</b>
                <span className="muted peq">{quando(a.criado_em)}</span>
              </div>
              <div>{a.mensagem}</div>
              <div className="muted peq">Enviado por {CANAL[a.canal] ?? a.canal}{a.lido ? '' : ' · novo'}</div>
            </div>
          ))}
        </div>
      </Estado>
    </div>
  );
}
