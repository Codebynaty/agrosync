import { useState } from 'react';
import { post } from '../../api';
import { Estado, useConfirmacao } from '../../components/Comuns';
import { MapaEscolha } from '../../components/Mapa';
import { quando, useApi } from '../../util';

type Bloqueio = { id: string; descricao: string; lat: number; lng: number; raio_km: number; criado_em: string };

export default function Bloqueios() {
  const { dados, erro, carregando, recarregar } = useApi<Bloqueio[]>('/bloqueios');
  const [ponto, setPonto] = useState<{ lat: number; lng: number } | null>(null);
  const [descricao, setDescricao] = useState('');
  const [raio, setRaio] = useState(2);
  const { mostrar, el } = useConfirmacao();

  async function salvar() {
    if (!ponto) return;
    try {
      const r = await post<{ avisados: number }>('/bloqueios', { descricao, lat: ponto.lat, lng: ponto.lng, raioKm: raio });
      mostrar({ tipo: 'ok', texto: `Bloqueio registrado. ${r.avisados} pessoa(s) com carga nessa rota foram avisadas.` });
      setDescricao('');
      setPonto(null);
      void recarregar();
    } catch (e) {
      mostrar({ tipo: 'bad', texto: (e as Error).message });
    }
  }

  async function encerrar(id: string) {
    await post(`/bloqueios/${id}/encerrar`);
    void recarregar();
  }

  return (
    <div className="pilha">
      <h1>Estradas bloqueadas</h1>
      <p className="muted">Toque no mapa onde está o bloqueio. Motoristas e produtores com carga passando por ali são avisados na hora.</p>
      {el}
      <MapaEscolha
        centro={{ lat: -23.62, lng: -47.1 }}
        marcado={ponto}
        raioKm={raio}
        outros={(dados ?? []).map((b) => ({ lat: b.lat, lng: b.lng, raioKm: b.raio_km, rotulo: b.descricao }))}
        onEscolher={setPonto}
      />
      <form className="card pilha" onSubmit={(e) => (e.preventDefault(), void salvar())}>
        <label className="campo">
          O que aconteceu
          <input placeholder="Ex.: ponte interditada na estrada do Paiol" value={descricao} onChange={(e) => setDescricao(e.target.value)} minLength={3} required />
        </label>
        <label className="campo">
          Raio de impacto: {raio} km
          <input type="range" min={0.5} max={10} step={0.5} value={raio} onChange={(e) => setRaio(Number(e.target.value))} style={{ minHeight: 0 }} />
        </label>
        <button className="btn primario" disabled={!ponto || descricao.length < 3}>
          {ponto ? 'Registrar bloqueio e avisar' : 'Toque no mapa para marcar o local'}
        </button>
      </form>

      <section className="pilha">
        <h2>Ativos</h2>
        <Estado carregando={carregando && !dados} erro={erro} vazio={dados?.length === 0 && 'Nenhum bloqueio ativo.'}>
          <div className="lista">
            {dados?.map((b) => (
              <div key={b.id} className="card linha entre">
                <div><b>🚧 {b.descricao}</b><div className="muted peq">raio {b.raio_km} km · {quando(b.criado_em)}</div></div>
                <button className="btn peq" onClick={() => void encerrar(b.id)}>Liberada</button>
              </div>
            ))}
          </div>
        </Estado>
      </section>
    </div>
  );
}
