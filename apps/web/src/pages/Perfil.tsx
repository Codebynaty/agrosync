import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, sessao, type Usuario } from '../api';
import { useAuth } from '../App';
import { useFila } from '../offline';

const PAPEL: Record<string, string> = { produtor: 'Produtor(a)', motorista: 'Motorista', cooperativa: 'Cooperativa' };

export default function Perfil() {
  const { usuario, sair, entrar } = useAuth();
  const fila = useFila();
  const [salvo, setSalvo] = useState(false);
  if (!usuario) return null;

  async function mudarCanal(canal: string) {
    const u = await api<Usuario>('/me', { method: 'PATCH', body: { canalPreferido: canal } });
    entrar(sessao.token()!, u);
    setSalvo(true);
  }

  return (
    <div className="pilha">
      <h1>Perfil</h1>
      <div className="card pilha">
        <div><b>{usuario.nome}</b><div className="muted">{PAPEL[usuario.papel]} · +{usuario.telefone}</div></div>
        <label className="campo">
          Receber avisos por
          <select value={usuario.canal_preferido} onChange={(e) => void mudarCanal(e.target.value)}>
            <option value="sms">SMS (funciona sem internet)</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="push">Notificação no app</option>
          </select>
        </label>
        {salvo && <div className="aviso ok peq">Preferência salva.</div>}
      </div>

      {usuario.papel === 'produtor' && (
        <div className="card pilha">
          <h2>No celular</h2>
          <p className="muted peq">
            {fila.pendentes.length
              ? `${fila.pendentes.length} registro(s) guardado(s) no aparelho, aguardando sinal.`
              : 'Tudo enviado. Os registros feitos sem internet ficam guardados aqui até o sinal voltar.'}
          </p>
          <p className="muted peq">Para instalar: no navegador, toque em “Adicionar à tela inicial”.</p>
        </div>
      )}

      <Link to="/bot" className="btn bloco">💬 Simulador do bot (WhatsApp / SMS / USSD)</Link>
      <button className="btn perigo bloco" disabled={fila.pendentes.length > 0} onClick={sair}>
        Sair
      </button>
      {fila.pendentes.length > 0 && (
        <div className="aviso warn peq">Há registros ainda não enviados. Conecte-se à internet para enviá-los antes de sair, para que não fiquem na conta de outra pessoa.</div>
      )}
    </div>
  );
}
