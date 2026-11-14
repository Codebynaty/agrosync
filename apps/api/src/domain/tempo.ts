export const FUSO = 'America/Sao_Paulo';

const fmtData = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Data local (São Paulo) no formato YYYY-MM-DD. */
export function dataLocal(d: Date): string {
  return fmtData.format(d);
}

export function somarDias(dataISO: string, dias: number): string {
  const d = new Date(`${dataISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function formatarDataBR(dataISO: string): string {
  const [a, m, d] = dataISO.split('-');
  return `${d}/${m}/${a}`;
}
