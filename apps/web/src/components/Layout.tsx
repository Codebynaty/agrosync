import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App';
import { useFila } from '../offline';

const NAV = {
  produtor: [
    { to: '/', ic: '🏠', t: 'Início' },
    { to: '/colher', ic: '🧺', t: 'Colher' },
    { to: '/fretes', ic: '🚚', t: 'Fretes' },
    { to: '/credito', ic: '💳', t: 'Crédito' },
    { to: '/alertas', ic: '🔔', t: 'Alertas' },
  ],
  motorista: [
    { to: '/', ic: '🚚', t: 'Cargas' },
    { to: '/alertas', ic: '🔔', t: 'Alertas' },
    { to: '/perfil', ic: '👤', t: 'Perfil' },
  ],
  cooperativa: [
    { to: '/', ic: '📊', t: 'Painel' },
    { to: '/cargas', ic: '🚚', t: 'Cargas' },
    { to: '/estradas', ic: '🚧', t: 'Estradas' },
    { to: '/alertas', ic: '🔔', t: 'Alertas' },
    { to: '/perfil', ic: '👤', t: 'Perfil' },
  ],
};

export function StatusRede() {
  const f = useFila();
  if (!f.online) return <span className="status-rede"><span className="ponto off" />Offline{f.pendentes.length ? ` · ${f.pendentes.length} no celular` : ''}</span>;
  if (f.sincronizando || f.pendentes.length) return <span className="status-rede"><span className="ponto sync" />Enviando {f.pendentes.length}…</span>;
  return <span className="status-rede"><span className="ponto" />Online</span>;
}

export default function Layout() {
  const { usuario } = useAuth();
  const loc = useLocation();
  const [naoLidos, setNaoLidos] = useState(0);

  useEffect(() => {
    let vivo = true;
    const buscar = () =>
      api<{ lido: number }[]>('/alertas')
        .then((a) => vivo && setNaoLidos(a.filter((x) => !x.lido).length))
        .catch(() => {});
    buscar();
    const t = setInterval(buscar, 15_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [loc.pathname]);

  if (!usuario) return null;
  const itens = NAV[usuario.papel];
  const largo = usuario.papel === 'cooperativa';

  return (
    <div className="app">
      <header className="topo">
        <img src="/logo.jpg" alt="" />
        <span className="marca">AgroSync</span>
        <span className="espaco" />
        <StatusRede />
        {usuario.papel === 'produtor' && (
          <Link to="/perfil" className="btn peq" aria-label="Perfil">👤</Link>
        )}
      </header>
      <main className={`conteudo${largo ? ' largo' : ''}`}>
        <Outlet />
      </main>
      <nav className="nav" aria-label="Navegação principal">
        {itens.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/'}>
            <span className="ic" aria-hidden>{i.ic}</span>
            {i.t}
            {i.to === '/alertas' && naoLidos > 0 && <span className="badge-num">{naoLidos}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
