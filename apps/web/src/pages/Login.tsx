import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, post, type Usuario } from '../api';
import { useAuth } from '../App';

type Demo = { nome: string; telefone: string; papel: string };
const PAPEL: Record<string, string> = { produtor: '🧑‍🌾 Produtor(a)', motorista: '🚚 Motorista', cooperativa: '🏢 Cooperativa' };

export default function Login() {
  const { entrar } = useAuth();
  const [telefone, setTelefone] = useState('');
  const [codigo, setCodigo] = useState('');
  const [etapa, setEtapa] = useState<'telefone' | 'codigo'>('telefone');
  const [codigoDev, setCodigoDev] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [demo, setDemo] = useState<Demo[]>([]);

  useEffect(() => {
    api<Demo[]>('/dev/usuarios-demo').then(setDemo).catch(() => setDemo([]));
  }, []);

  async function pedirCodigo(tel = telefone) {
    setErro(null);
    setOcupado(true);
    try {
      const r = await post<{ codigoDev?: string }>('/auth/codigo', { telefone: tel });
      setCodigoDev(r.codigoDev ?? null);
      setEtapa('codigo');
      return r.codigoDev;
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar(tel = telefone, cod = codigo) {
    setErro(null);
    setOcupado(true);
    try {
      const r = await post<{ token: string; usuario: Usuario }>('/auth/entrar', { telefone: tel, codigo: cod });
      entrar(r.token, r.usuario);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function entrarComo(d: Demo) {
    setTelefone(d.telefone);
    const c = await pedirCodigo(d.telefone);
    if (c) await confirmar(d.telefone, c);
  }

  return (
    <div className="login">
      <div className="pilha" style={{ width: '100%', maxWidth: 440 }}>
        <div className="card pilha">
          <div className="linha">
            <img src="/logo.jpg" alt="" width={56} height={56} style={{ borderRadius: 12 }} />
            <div>
              <h1 style={{ margin: 0 }}>AgroSync</h1>
              <div className="muted peq">Frete coletivo, crédito justo e alertas para quem planta.</div>
            </div>
          </div>

          {etapa === 'telefone' ? (
            <form className="pilha" onSubmit={(e) => (e.preventDefault(), void pedirCodigo())}>
              <label className="campo">
                Seu celular
                <input inputMode="tel" autoComplete="tel" placeholder="(11) 90000-0001" value={telefone} onChange={(e) => setTelefone(e.target.value)} required />
              </label>
              <button className="btn primario grande bloco" disabled={ocupado || telefone.replace(/\D/g, '').length < 10}>
                Receber código
              </button>
            </form>
          ) : (
            <form className="pilha" onSubmit={(e) => (e.preventDefault(), void confirmar())}>
              <p className="muted">Enviamos um código de 6 dígitos para {telefone}.</p>
              {codigoDev && <div className="aviso info peq">Ambiente de demonstração: o código é <b className="mono">{codigoDev}</b> (não há SMS real).</div>}
              <label className="campo">
                Código
                <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} autoFocus required />
              </label>
              <button className="btn primario grande bloco" disabled={ocupado || codigo.length !== 6}>Entrar</button>
              <button type="button" className="btn bloco" onClick={() => setEtapa('telefone')}>Trocar número</button>
            </form>
          )}
          {erro && <div className="aviso bad" role="alert">{erro}</div>}
        </div>

        {demo.length > 0 && (
          <div className="card pilha">
            <h2>Entrar como (demonstração)</h2>
            <div className="demo-usuarios">
              {demo.map((d) => (
                <button key={d.telefone} className="btn bloco" disabled={ocupado} onClick={() => void entrarComo(d)}>
                  <span>{d.nome}</span>
                  <span className="muted peq">{PAPEL[d.papel]}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <Link to="/bot" className="btn bloco">💬 Testar o bot de WhatsApp / SMS</Link>
      </div>
    </div>
  );
}
