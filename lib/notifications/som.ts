/**
 * O SOM DE AVISO — quando toca, e em qual aba.
 *
 * ## Por que existe
 *
 * Os tons de `sounds.ts` já existiam, mas só tocavam pelo `emitNotification`:
 * com o canal Push ligado E o navegador autorizado. Quem tinha só "No sistema"
 * via um toast mudo, e o navegador sem permissão (o padrão de quem nunca
 * clicou em "Permitir") não tocava nada. O pedido do dono do produto: tocar
 * sempre que chega mensagem ou lead novo para a pessoa, com um interruptor
 * POR PESSOA para desligar (`user_metadata.notify_sound`, ausente = ligado).
 *
 * ## As três regras
 *
 * 1. **A preferência manda.** Desligado, não toca nada — nem o som do sistema
 *    operacional na notificação Push (`emitNotification` recebe `silenciar`).
 * 2. **Uma aba só.** Quem tem três abas abertas recebe o mesmo evento do
 *    Realtime três vezes. `navigator.locks` (Web Locks, atômico entre abas)
 *    deixa só a primeira tocar; sem a API, um claim no `localStorage` com
 *    releitura faz o mesmo papel com uma janela de corrida mínima.
 * 3. **Um bip por assunto.** O mesmo cliente mandando cinco mensagens seguidas,
 *    ou a mensagem e a atribuição do mesmo lead chegando juntas, tocam UMA vez:
 *    `grupo` + janela de silêncio.
 */
import { playSound, type SoundId } from "./sounds";

let ligado = true;

/** A casca sincroniza aqui o que veio do servidor (`AuthUser.som_de_aviso`). */
export function definirSomDeAviso(valor: boolean): void {
  ligado = valor;
}

export function somDeAvisoLigado(): boolean {
  return ligado;
}

/** Quanto tempo a aba que tocou segura o direito de tocar aquele evento. */
const POSSE_DO_EVENTO_MS = 4_000;

const ultimoSomDoGrupo = new Map<string, number>();

/** Este grupo tocou nesta aba há menos de `janelaMs`? */
export function grupoTocouHaPouco(grupo: string, janelaMs: number, agora = Date.now()): boolean {
  const t = ultimoSomDoGrupo.get(grupo);
  return t !== undefined && agora - t < janelaMs;
}

/** Só para teste: zera a memória de grupos e volta ao padrão (ligado). */
export function _reiniciarSomParaTeste(): void {
  ultimoSomDoGrupo.clear();
  ligado = true;
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Claim sem Web Locks: grava um token, relê depois de um instante. */
async function ganharPeloStorage(chave: string): Promise<boolean> {
  if (typeof window === "undefined") return true;
  try {
    const k = `notify.som:${chave}`;
    const atual = window.localStorage.getItem(k);
    if (atual && Date.now() - Number(atual.split(":")[0]) < POSSE_DO_EVENTO_MS) return false;
    const meu = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(k, meu);
    await esperar(30);
    return window.localStorage.getItem(k) === meu;
  } catch {
    return true;
  }
}

/** Esta aba ganhou o direito de tocar o evento `chave`? */
function ganharOEvento(chave: string): Promise<boolean> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return ganharPeloStorage(chave);
  return new Promise<boolean>((resolve) => {
    locks
      .request(`notify-som:${chave}`, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        resolve(true);
        // Segura o lock um pouco: as outras abas recebem o MESMO evento
        // milissegundos depois e precisam encontrá-lo ocupado.
        await esperar(POSSE_DO_EVENTO_MS);
      })
      .catch(() => resolve(true));
  });
}

export interface TocarAvisoInput {
  som: SoundId;
  /** Id do evento (mensagem, conversa): o que as abas disputam. */
  chave: string;
  /** O assunto (ex.: `contato:<id>`): um bip por assunto dentro de `janelaMs`. */
  grupo?: string;
  janelaMs?: number;
}

/**
 * Toca o aviso se a preferência deixa, se o assunto não tocou há pouco e se
 * esta é a aba que ganhou o evento. Devolve se tocou.
 */
export async function tocarAviso(input: TocarAvisoInput): Promise<boolean> {
  if (!ligado || input.som === "silent") return false;
  if (input.grupo && grupoTocouHaPouco(input.grupo, input.janelaMs ?? 10_000)) return false;
  if (input.grupo) ultimoSomDoGrupo.set(input.grupo, Date.now());
  if (!(await ganharOEvento(input.chave))) return false;
  try {
    playSound(input.som, 1.0);
    return true;
  } catch {
    return false;
  }
}
