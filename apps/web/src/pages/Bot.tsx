import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, post } from '../api';

type Msg = { de: 'eu' | 'bot'; texto: string };
type Demo = { nome: string; telefone: string; papel: string };

export default function Bot() {
  const [demo, setDemo] = useState<Demo[]>([]);
  const [telefone, setTelefone] = useState('5511900000001');
  const [texto, setTexto] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Demo[]>('/dev/usuarios-demo').then((d) => setDemo(d.filter((u) => u.papel === 'produtor'))).catch(() => {});
  }, []);
  useEffect(() => fim.current?.scrollIntoView({ behavior: 'smooth' }), [msgs]);

  async function enviar(t: string) {
    if (!t.trim()) return;
    setMsgs((m) => [...m, { de: 'eu', texto: t }]);
    setTexto('');
    setEnviando(true);
    try {
      const r = await post<{ resposta: string }>('/bot/mensagem', { telefone, texto: t });
      setMsgs((m) => [...m, { de: 'bot', texto: r.resposta }]);
    } catch (e) {
      setMsgs((m) => [...m, { de: 'bot', texto: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="conteudo pilha" style={{ paddingBottom: 24 }}>
      <div className="linha entre">
        <h1>Bot AgroSync</h1>
        <Link to="/" className="btn peq">Voltar</Link>
      </div>
      <p className="muted peq">
        Simula o atendimento por WhatsApp, SMS ou USSD para quem não tem smartphone ou internet. As mensagens passam pela mesma API do app.
      </p>
      <label className="campo">
        Falando como
        <select
          value={telefone}
          onChange={(e) => {
            setTelefone(e.target.value);
            setMsgs([]);
          }}
        >
          {demo.length ? demo.map((d) => <option key={d.telefone} value={d.telefone}>{d.nome} (+{d.telefone})</option>) : <option value={telefone}>+{telefone}</option>}
        </select>
      </label>
      <div className="chat" aria-live="polite">
        {msgs.length === 0 && <div className="muted peq">Envie “oi” para ver o menu.</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.de}`}>{m.texto}</div>
        ))}
        <div ref={fim} />
      </div>
      <div className="linha">
        {['oi', 'colhi 300 kg de tomate', 'frete', 'status', 'economia', 'score'].map((s) => (
          <button key={s} className="btn peq" disabled={enviando} onClick={() => void enviar(s)}>{s}</button>
        ))}
      </div>
      <form className="linha" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => (e.preventDefault(), void enviar(texto))}>
        <input placeholder="Mensagem" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={300} />
        <button className="btn primario" disabled={enviando || !texto.trim()}>Enviar</button>
      </form>
    </div>
  );
}
