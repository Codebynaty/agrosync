const CHAVE_TOKEN = 'agrosync.token';
const CHAVE_USUARIO = 'agrosync.usuario';

export type Papel = 'produtor' | 'motorista' | 'cooperativa';
export type Usuario = { id: string; nome: string; telefone: string; papel: Papel; canal_preferido: string };

export class ErroApi extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string | null) {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  } catch {
    /* armazenamento indisponível: sessão vale só nesta aba */
  }
}

let tokenMemoria = ler(CHAVE_TOKEN);

export const sessao = {
  token: () => tokenMemoria,
  usuario: (): Usuario | null => {
    const u = ler(CHAVE_USUARIO);
    try {
      return u ? (JSON.parse(u) as Usuario) : null;
    } catch {
      return null;
    }
  },
  salvar(token: string, usuario: Usuario) {
    tokenMemoria = token;
    gravar(CHAVE_TOKEN, token);
    gravar(CHAVE_USUARIO, JSON.stringify(usuario));
  },
  async sair() {
    tokenMemoria = null;
    gravar(CHAVE_TOKEN, null);
    gravar(CHAVE_USUARIO, null);
    try {
      if ('caches' in window) await caches.delete('api-get');
    } catch {
      /* ignora */
    }
  },
};

export async function api<T>(caminho: string, opcoes: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (tokenMemoria) headers.authorization = `Bearer ${tokenMemoria}`;
  if (opcoes.body !== undefined) headers['content-type'] = 'application/json';

  let r: Response;
  try {
    r = await fetch(`/api${caminho}`, {
      method: opcoes.method ?? (opcoes.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined,
    });
  } catch {
    throw new ErroApi(0, 'Sem conexão. Tente de novo quando tiver sinal.');
  }

  const texto = await r.text();
  let dados: unknown = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }
  if (r.status === 401 && tokenMemoria && !caminho.startsWith('/auth')) {
    await sessao.sair();
    window.dispatchEvent(new Event('agrosync:sessao-expirada'));
  }
  if (!r.ok) throw new ErroApi(r.status, (dados as { erro?: string } | null)?.erro ?? `Erro ${r.status}`);
  return dados as T;
}

export const post = <T>(caminho: string, body: unknown = {}) => api<T>(caminho, { method: 'POST', body });
