import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { sessao, type Usuario } from './api';
import Layout from './components/Layout';
import Alertas from './pages/Alertas';
import Bot from './pages/Bot';
import Login from './pages/Login';
import Perfil from './pages/Perfil';
import Bloqueios from './pages/cooperativa/Bloqueios';
import CargasCooperativa from './pages/cooperativa/Cargas';
import Painel from './pages/cooperativa/Painel';
import CargaDetalhe from './pages/motorista/Carga';
import CargasMotorista from './pages/motorista/Cargas';
import Colheita from './pages/produtor/Colheita';
import Credito from './pages/produtor/Credito';
import Fretes from './pages/produtor/Fretes';
import Inicio from './pages/produtor/Inicio';

type Auth = { usuario: Usuario | null; entrar: (token: string, u: Usuario) => void; sair: () => void };
const AuthCtx = createContext<Auth>(null as unknown as Auth);
export const useAuth = () => useContext(AuthCtx);

export default function App() {
  const [usuario, setUsuario] = useState<Usuario | null>(() => (sessao.token() ? sessao.usuario() : null));

  useEffect(() => {
    const f = () => setUsuario(null);
    window.addEventListener('agrosync:sessao-expirada', f);
    return () => window.removeEventListener('agrosync:sessao-expirada', f);
  }, []);

  const auth: Auth = {
    usuario,
    entrar: (token, u) => {
      sessao.salvar(token, u);
      setUsuario(u);
    },
    sair: () => {
      void sessao.sair();
      setUsuario(null);
    },
  };

  return (
    <AuthCtx.Provider value={auth}>
      <Routes>
        <Route path="/bot" element={<Bot />} />
        {!usuario ? (
          <Route path="*" element={<Login />} />
        ) : (
          <Route element={<Layout />}>
            {usuario.papel === 'produtor' && (
              <>
                <Route path="/" element={<Inicio />} />
                <Route path="/colher" element={<Colheita />} />
                <Route path="/fretes" element={<Fretes />} />
                <Route path="/credito" element={<Credito />} />
              </>
            )}
            {usuario.papel === 'motorista' && (
              <>
                <Route path="/" element={<CargasMotorista />} />
                <Route path="/cargas/:id" element={<CargaDetalhe />} />
              </>
            )}
            {usuario.papel === 'cooperativa' && (
              <>
                <Route path="/" element={<Painel />} />
                <Route path="/cargas" element={<CargasCooperativa />} />
                <Route path="/cargas/:id" element={<CargaDetalhe />} />
                <Route path="/estradas" element={<Bloqueios />} />
              </>
            )}
            <Route path="/alertas" element={<Alertas />} />
            <Route path="/perfil" element={<Perfil />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
    </AuthCtx.Provider>
  );
}
