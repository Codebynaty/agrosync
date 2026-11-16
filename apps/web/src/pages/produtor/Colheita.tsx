import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { post } from '../../api';
import { SeloQualidade } from '../../components/Comuns';
import { enfileirar, useFila, uuid } from '../../offline';
import { analisarFoto, dicaLocal, type Caracteristicas, type ResultadoTriagem } from '../../triagem';
import type { Destino } from '../../tipos';
import { CULTURAS, culturaPorId, dataBR, hojeISO, kg, useApi } from '../../util';

type SR = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const SpeechRec = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;

const UNIDADES = [
  { id: 'kg', rotulo: 'kg', fator: 1 },
  { id: 'cx', rotulo: 'caixas (20 kg)', fator: 20 },
  { id: 'sc', rotulo: 'sacas (60 kg)', fator: 60 },
];

export default function Colheita() {
  const fila = useFila();
  const destinos = useApi<Destino[]>('/destinos');
  const [cultura, setCultura] = useState<string | null>(null);
  const [qtd, setQtd] = useState(0);
  const [unidade, setUnidade] = useState(UNIDADES[0]);
  const [pedirFrete, setPedirFrete] = useState(true);
  const [destinoId, setDestinoId] = useState('');
  const [data, setData] = useState(hojeISO(1));
  const [origem, setOrigem] = useState<'app' | 'voz'>('app');
  const [ouvindo, setOuvindo] = useState(false);
  const [transcricao, setTranscricao] = useState('');
  const [erroVoz, setErroVoz] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);
  const [foto, setFoto] = useState<{ caracteristicas: Caracteristicas; miniatura?: string } | null>(null);
  const [previa, setPrevia] = useState<ResultadoTriagem | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [dica, setDica] = useState<string | null>(null);
  const rec = useRef<SR | null>(null);
  const fotoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!destinoId && destinos.dados?.length) setDestinoId(destinos.dados.find((d) => d.id === 'ceagesp')?.id ?? destinos.dados[0].id);
  }, [destinos.dados, destinoId]);

  const totalKg = Math.round(qtd * unidade.fator);

  // Classifica a foto no servidor (fonte única) assim que há foto e produto escolhidos.
  useEffect(() => {
    if (!foto || !cultura || !navigator.onLine) {
      setPrevia(null);
      return;
    }
    let vivo = true;
    post<ResultadoTriagem>('/triagem/classificar', { cultura, caracteristicas: foto.caracteristicas })
      .then((r) => vivo && setPrevia(r))
      .catch(() => vivo && setPrevia(null));
    return () => {
      vivo = false;
    };
  }, [foto, cultura]);

  async function escolherFoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAnalisando(true);
    setPrevia(null);
    setDica(null);
    try {
      const r = await analisarFoto(file);
      if (!r) {
        setDica('Não consegui ler a foto. Tente outra.');
        setFoto(null);
        return;
      }
      setFoto(r);
      setDica(dicaLocal(r.caracteristicas));
    } finally {
      setAnalisando(false);
    }
  }

  function ouvir() {
    if (!SpeechRec) {
      setErroVoz('Seu navegador não reconhece voz. Use os ícones abaixo.');
      return;
    }
    if (!navigator.onLine) {
      setErroVoz('O reconhecimento de voz precisa de internet. Sem sinal, use os ícones: o registro fica guardado no celular.');
      return;
    }
    setErroVoz(null);
    const r = new SpeechRec();
    r.lang = 'pt-BR';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = async (e) => {
      const t = e.results[0][0].transcript;
      setTranscricao(t);
      try {
        const res = await post<{ entendido: boolean; cultura?: string; quantidadeKg?: number }>('/interpretar', { texto: t });
        if (res.entendido && res.cultura && res.quantidadeKg) {
          setCultura(res.cultura);
          setUnidade(UNIDADES[0]);
          setQtd(res.quantidadeKg);
          setOrigem('voz');
        } else setErroVoz(`Não entendi “${t}”. Tente: “colhi 300 quilos de tomate”.`);
      } catch (err) {
        setErroVoz((err as Error).message);
      }
    };
    r.onerror = (e) => setErroVoz(e.error === 'not-allowed' ? 'Permita o uso do microfone.' : 'Não consegui ouvir. Tente de novo.');
    r.onend = () => setOuvindo(false);
    rec.current = r;
    setOuvindo(true);
    r.start();
  }

  async function salvar() {
    if (!cultura || totalKg <= 0) return;
    const c = culturaPorId(cultura)!;
    const safraId = uuid();
    const descricao = `${kg(totalKg)} de ${c.nome.toLowerCase()}`;
    await enfileirar([
      {
        tipo: 'criar_safra',
        dados: { id: safraId, cultura, quantidadeKg: totalKg, origem, colhidoEm: new Date().toISOString(), ...(foto ? { triagem: foto } : {}) },
        descricao: `Colheita: ${descricao}`,
      },
      ...(pedirFrete
        ? [{ tipo: 'criar_pedido' as const, dados: { id: uuid(), safraId, destinoId: destinoId || undefined, dataDesejada: data }, descricao: `Frete: ${descricao}` }]
        : []),
    ]);
    setSalvo(
      navigator.onLine
        ? `${descricao} registrado${pedirFrete ? ` e frete pedido para ${dataBR(data)}` : ''}. Vamos te avisar quando o caminhão coletivo fechar.`
        : `${descricao} guardado no celular. Será enviado quando houver sinal.`,
    );
    setCultura(null);
    setQtd(0);
    setTranscricao('');
    setOrigem('app');
    setFoto(null);
    setPrevia(null);
    setDica(null);
  }

  return (
    <div className="pilha">
      <h1>Registrar colheita</h1>

      {salvo && (
        <div className="aviso ok" role="status">
          ✅ {salvo} <Link to="/fretes">Ver fretes</Link>
        </div>
      )}
      {fila.falhas.length > 0 && (
        <div className="aviso bad">
          {fila.falhas.map((f) => <div key={f.opId}>Não foi possível salvar “{f.descricao}”: {f.erro}</div>)}
        </div>
      )}

      <button type="button" className={`microfone ${ouvindo ? 'ouvindo' : ''}`} onClick={() => (ouvindo ? rec.current?.stop() : ouvir())} aria-pressed={ouvindo}>
        <span style={{ fontSize: '2rem' }} aria-hidden>🎤</span>
        {ouvindo ? 'Ouvindo… fale o que colheu' : 'Falar: “colhi 300 quilos de tomate”'}
      </button>
      {transcricao && <div className="muted peq">Você disse: “{transcricao}”</div>}
      {erroVoz && <div className="aviso warn peq">{erroVoz}</div>}

      <section className="pilha">
        <h2>1. O que colheu?</h2>
        <div className="culturas">
          {CULTURAS.map((c) => (
            <button key={c.id} type="button" className="cultura" aria-pressed={cultura === c.id} onClick={() => setCultura(c.id)}>
              <span className="em" aria-hidden>{c.emoji}</span>
              {c.nome}
            </button>
          ))}
        </div>
      </section>

      <section className="pilha">
        <h2>2. Quanto?</h2>
        <div className="contador">
          <button type="button" className="btn" onClick={() => setQtd((q) => Math.max(0, q - (unidade.fator === 1 ? 50 : 1)))} aria-label="Diminuir">−</button>
          <input type="number" inputMode="numeric" min={0} value={qtd || ''} placeholder="0" onChange={(e) => setQtd(Math.max(0, Number(e.target.value)))} aria-label="Quantidade" />
          <button type="button" className="btn" onClick={() => setQtd((q) => q + (unidade.fator === 1 ? 50 : 1))} aria-label="Aumentar">+</button>
        </div>
        <div className="linha">
          {UNIDADES.map((u) => (
            <button key={u.id} type="button" className={`btn peq ${unidade.id === u.id ? 'primario' : ''}`} onClick={() => setUnidade(u)}>{u.rotulo}</button>
          ))}
        </div>
        {unidade.fator > 1 && qtd > 0 && <div className="muted">= {kg(totalKg)}</div>}
      </section>

      <section className="pilha">
        <h2>3. Foto da colheita <span className="muted peq" style={{ fontWeight: 400 }}>(opcional)</span></h2>
        <p className="muted peq">A foto é analisada aqui no aparelho e classifica a qualidade do lote (cor, maturação e manchas). Ajuda a mostrar o padrão ao comprador.</p>
        <input ref={fotoRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void escolherFoto(e)} />
        <button type="button" className="btn bloco" onClick={() => fotoRef.current?.click()}>
          📷 {foto ? 'Trocar foto' : 'Tirar ou escolher foto'}
        </button>
        {analisando && <div className="muted peq">Analisando a foto…</div>}
        {foto && (
          <div className="card foto-previa">
            {foto.miniatura && <img src={foto.miniatura} alt="Foto da colheita" />}
            <div className="pilha" style={{ gap: 6 }}>
              {!cultura && <div className="muted peq">Escolha o produto acima para ver a classificação.</div>}
              {previa && (
                <>
                  <div className="linha" style={{ gap: 8 }}>
                    <SeloQualidade classe={previa.classe} pontuacao={previa.pontuacao} />
                    {previa.confiavel && previa.ajustePrecoPct !== 0 && (
                      <span className="peq muted">preço de referência {previa.ajustePrecoPct > 0 ? '+' : ''}{previa.ajustePrecoPct}%</span>
                    )}
                  </div>
                  {previa.observacoes.map((o, i) => <div key={i} className="peq">• {o}</div>)}
                </>
              )}
              {cultura && !previa && navigator.onLine && <div className="muted peq">Classificando…</div>}
              {cultura && !navigator.onLine && <div className="muted peq">Sem sinal: a classificação é feita quando o registro subir.</div>}
              {dica && <div className="aviso warn peq" style={{ padding: '6px 10px' }}>{dica}</div>}
            </div>
          </div>
        )}
      </section>

      <section className="card pilha">
        <label className="linha" style={{ fontWeight: 650 }}>
          <input type="checkbox" checked={pedirFrete} onChange={(e) => setPedirFrete(e.target.checked)} style={{ width: 24, minHeight: 24 }} />
          Pedir frete coletivo
        </label>
        {pedirFrete && (
          <div className="grade-2 empilha">
            <label className="campo">
              Levar para
              <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
                {(destinos.dados ?? []).map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
                {!destinos.dados && <option value="">Mais próximo (offline)</option>}
              </select>
            </label>
            <label className="campo">
              Data da coleta
              <input type="date" value={data} min={hojeISO(0)} max={hojeISO(30)} onChange={(e) => setData(e.target.value)} />
            </label>
          </div>
        )}
        <p className="muted peq">O AgroSync procura vizinhos indo para o mesmo destino em até 48 h e divide o caminhão.</p>
      </section>

      <button className="btn primario grande bloco" disabled={!cultura || totalKg <= 0} onClick={() => void salvar()}>
        {cultura && totalKg > 0 ? `Confirmar ${kg(totalKg)} de ${culturaPorId(cultura)!.nome.toLowerCase()}` : 'Escolha o produto e a quantidade'}
      </button>
    </div>
  );
}
