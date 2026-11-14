import { Estado } from '../../components/Comuns';
import { brl, useApi } from '../../util';

type Score = {
  score: number;
  faixa: 'A' | 'B' | 'C' | 'D';
  probabilidade: number;
  limiteSugeridoCentavos: number;
  historicoInsuficiente: boolean;
  modeloVersao: string;
  fatores: { chave: string; rotulo: string; valor: number; impacto: number }[];
};

const FAIXA: Record<string, string> = { A: 'Excelente', B: 'Bom', C: 'Regular', D: 'Em construção' };

function valorFator(chave: string, v: number) {
  if (chave === 'pontualidade') return `${Math.round(v * 100)}%`;
  if (chave === 'volumeMedioKg') return `${Math.round(v).toLocaleString('pt-BR')} kg`;
  return String(v);
}

export default function Credito() {
  const { dados: s, erro, carregando } = useApi<Score>('/agroscore');
  const maxImpacto = Math.max(0.01, ...(s?.fatores.map((f) => Math.abs(f.impacto)) ?? [0]));

  return (
    <div className="pilha">
      <h1>Crédito</h1>
      <Estado carregando={carregando && !s} erro={erro}>
        {s && (
          <>
            <div className="card gauge pilha">
              <span className="muted">Seu AgroScore</span>
              <b>{s.score}</b>
              <span className={`chip ${s.faixa === 'A' || s.faixa === 'B' ? 'ok' : s.faixa === 'C' ? 'warn' : 'bad'}`} style={{ justifySelf: 'center' }}>
                Faixa {s.faixa} · {FAIXA[s.faixa]}
              </span>
              <div className="muted peq">escala de 300 a 900</div>
            </div>

            <div className="card pilha">
              <span className="muted">Microcrédito pré-aprovado</span>
              <b style={{ fontSize: '1.8rem' }}>{brl(s.limiteSugeridoCentavos)}</b>
              {s.historicoInsuficiente && <div className="aviso info peq">Você ainda tem pouco histórico. Cada entrega e pagamento em dia aumenta seu score.</div>}
              <p className="muted peq">
                Pré-aprovação indicativa. A concessão depende da instituição parceira (cooperativa de crédito ou banco). O AgroScore usa só sua operação no AgroSync, não exige histórico bancário.
              </p>
            </div>

            <div className="card pilha">
              <h2>O que pesa no seu score</h2>
              {s.fatores.map((f) => {
                const larg = (Math.abs(f.impacto) / maxImpacto) * 50;
                const ajuda = f.impacto >= 0;
                return (
                  <div key={f.chave} className="fator" title={`${f.rotulo}: ${ajuda ? 'ajuda' : 'pesa contra'}`}>
                    <div>
                      <div>{f.rotulo}: <b>{valorFator(f.chave, f.valor)}</b></div>
                      <div className="peq" style={{ color: ajuda ? 'var(--ok)' : 'var(--bad)' }}>{ajuda ? '▲ ajuda' : '▼ pesa contra'}</div>
                    </div>
                    <div className="fator-trilho" aria-hidden>
                      <div className="fator-barra" style={{ background: ajuda ? 'var(--ok)' : 'var(--bad)', width: `${larg}%`, left: ajuda ? '50%' : `${50 - larg}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="muted peq">Modelo: regressão logística ({s.modeloVersao}) · probabilidade estimada de bom pagamento {Math.round(s.probabilidade * 100)}%.</div>
            </div>
          </>
        )}
      </Estado>
    </div>
  );
}
