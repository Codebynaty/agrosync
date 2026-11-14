import { useState } from 'react';
import { post } from '../../api';
import { Chip, Estado, useConfirmacao } from '../../components/Comuns';
import type { CargaResumo, Pedido } from '../../tipos';
import { dataBR, kg, nomeCultura, useApi } from '../../util';
import { CartaoCarga } from '../motorista/Cargas';

const FILTROS = [
  { id: 'andamento', rotulo: 'Em andamento', status: ['aberta', 'agendada', 'em_rota', 'entregue'] },
  { id: 'liquidada', rotulo: 'Liquidadas', status: ['liquidada'] },
  { id: 'cancelada', rotulo: 'Canceladas', status: ['cancelada'] },
];

export default function CargasCooperativa() {
  const cargas = useApi<CargaResumo[]>('/cargas');
  const pedidos = useApi<(Pedido & { produtor_id: string })[]>('/pedidos');
  const [filtro, setFiltro] = useState(FILTROS[0]);
  const { mostrar, el } = useConfirmacao();

  const lista = (cargas.dados ?? []).filter((c) => filtro.status.includes(c.status));
  const aguardando = (pedidos.dados ?? []).filter((p) => p.status === 'solicitado' || p.status === 'expirado');

  async function cancelar(id: string) {
    try {
      await post(`/cargas/${id}/cancelar`);
      mostrar({ tipo: 'ok', texto: 'Carga cancelada. Pedidos voltaram a aguardar grupo.' });
      void cargas.recarregar();
      void pedidos.recarregar();
    } catch (e) {
      mostrar({ tipo: 'bad', texto: (e as Error).message });
    }
  }

  return (
    <div className="pilha">
      <h1>Cargas</h1>
      {el}
      <div className="linha">
        {FILTROS.map((f) => (
          <button key={f.id} className={`btn peq ${filtro.id === f.id ? 'primario' : ''}`} onClick={() => setFiltro(f)}>{f.rotulo}</button>
        ))}
      </div>
      <Estado carregando={cargas.carregando && !cargas.dados} erro={cargas.erro} vazio={lista.length === 0 && 'Nenhuma carga.'}>
        <div className="grade-2 empilha">
          {lista.map((c) => (
            <div key={c.id} className="pilha">
              <CartaoCarga c={c} />
              {['aberta', 'agendada'].includes(c.status) && (
                <button className="btn peq perigo" onClick={() => void cancelar(c.id)}>Cancelar carga</button>
              )}
            </div>
          ))}
        </div>
      </Estado>

      <section className="secao pilha">
        <h2>Pedidos sem grupo</h2>
        <Estado carregando={pedidos.carregando && !pedidos.dados} erro={pedidos.erro} vazio={aguardando.length === 0 && 'Todos os pedidos estão em cargas.'}>
          <div className="card tabela-rolagem">
            <table>
              <thead><tr><th>Município</th><th>Produto</th><th>Data</th><th>Destino</th><th>Situação</th></tr></thead>
              <tbody>
                {aguardando.map((p) => (
                  <tr key={p.id}>
                    <td>{p.municipio}</td>
                    <td>{kg(p.volume_kg)} {nomeCultura(p.cultura).toLowerCase()}</td>
                    <td>{dataBR(p.data_desejada)}</td>
                    <td>{p.destino_nome}</td>
                    <td><Chip status={p.status}>{p.status_rotulo}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Estado>
      </section>
    </div>
  );
}
