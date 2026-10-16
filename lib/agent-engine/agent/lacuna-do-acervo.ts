/**
 * Lacuna do acervo — a pergunta que o cliente fez e o material do agente não
 * sabia responder (migration 0245).
 *
 * ═══ POR QUE ISTO EXISTE ═══
 *
 * A Onda 1 fez o agente parar de inventar: sem fonte, ele chama a equipe ou diz
 * que não sabe. Isso protege o cliente de hoje e abandona o de amanhã — a mesma
 * pergunta cai no mesmo buraco até alguém, por acaso, perceber. Aqui o buraco
 * vira aviso na Central, com contador: a pergunta que cinco clientes fizeram
 * aparece com "(5 vezes)", e o dono responde uma vez para todos.
 *
 * ═══ PII ═══
 *
 * A pergunta é a fala do CLIENTE, e pode ter nome, telefone, e-mail, CPF. Ela
 * passa por `anonymize` antes de virar linha; se mesmo assim sobrar dado
 * pessoal detectável (`detectResidualPii`), a lacuna NÃO é registrada — perder
 * um aviso é recuperável, gravar o CPF de alguém numa tela da equipe não é.
 * Nada daqui vai a log além de contagens.
 *
 * ═══ A CHAVE ═══
 *
 * "Vocês têm na cor azul?" e "voces tem na cor azul" são a MESMA lacuna. A
 * chave é a pergunta anonimizada, sem acento, minúscula, sem pontuação e sem
 * palavras vazias. Pergunta que fica sem nenhuma palavra de conteúdo ("oi?",
 * "e aí") não é lacuna de material — é conversa — e não é registrada.
 *
 * NUNCA lança: roda no fim do turno, depois de tudo que importa ao cliente.
 */
import { anonymize, detectResidualPii } from '@/lib/ai/anonymize';
import { copyDaLacuna } from '@/lib/ai/agent-inbox-copy';

import { insertInboxItem } from '../db/repository';
import type { Logger } from '../obs/logger';
import type { Queryable } from '../queue/queue';

/** Teto do exemplo guardado: é para o dono reconhecer a pergunta, não para arquivar a conversa. */
export const TETO_DA_PERGUNTA = 300;
/** Teto da chave: duas perguntas iguais nos primeiros 200 caracteres são a mesma lacuna. */
const TETO_DA_CHAVE = 200;

/**
 * Palavras que não mudam o assunto da pergunta. Lista curta e fechada: tirar
 * palavra de CONTEÚDO juntaria lacunas diferentes ("tem entrega" ≠ "tem troca").
 */
const PALAVRAS_VAZIAS = new Set(
  (
    'a o as os um uma uns umas de do da dos das no na nos nas em por para pra pro com sem e ou que se ' +
    'me te lhe nos vos voce voces vc vcs eu ele ela eles elas meu minha seu sua isso isto esse essa este esta ' +
    'aqui ai la oi ola bom boa dia tarde noite tudo bem obrigado obrigada por favor pfv pf gostaria queria ' +
    'quero saber sabe poderia pode podem consegue conseguem tem tenho ter ha hoje entao ja so mais muito ' +
    'qual quais quando onde como quanto quanta quantos quantas'
  ).split(' '),
);

/** Mínimo de palavras de conteúdo para ser uma pergunta sobre o negócio. */
const MINIMO_DE_PALAVRAS = 1;

/**
 * A chave de dedupe de uma pergunta JÁ anonimizada. Vazia = não é lacuna.
 * Os marcadores do anonimizador (`[NOME]`, `[TELEFONE]`…) somem com a
 * pontuação e as palavras vazias — dois clientes com nomes diferentes
 * perguntando a mesma coisa caem na mesma chave.
 */
export function chaveDaPergunta(perguntaAnonimizada: string): string {
  const palavras = perguntaAnonimizada
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\[[a-z_]+\]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((p) => p.length > 0 && !PALAVRAS_VAZIAS.has(p));
  if (palavras.length < MINIMO_DE_PALAVRAS) return '';
  return palavras.join(' ').slice(0, TETO_DA_CHAVE).trimEnd();
}

export type DesfechoDaLacuna =
  | { registrada: true; lacunaId: string; ocorrencias: number }
  | { registrada: false; porque: 'sem_pergunta' | 'dado_pessoal' | 'descartada' | 'erro' };

export async function registrarLacuna(
  db: Queryable,
  tenantId: string,
  perguntaDoCliente: string,
  log: Logger,
): Promise<DesfechoDaLacuna> {
  try {
    const { anonymized } = anonymize(perguntaDoCliente.trim());
    if (detectResidualPii(anonymized) !== null) return { registrada: false, porque: 'dado_pessoal' };
    const chave = chaveDaPergunta(anonymized);
    if (chave === '') return { registrada: false, porque: 'sem_pergunta' };
    const pergunta = anonymized.replace(/\s+/g, ' ').slice(0, TETO_DA_PERGUNTA).trim();

    // Respondida e voltou: o par ensinado não cobriu esta forma de perguntar
    // (ou a indexação ainda não terminou) — reabre, e o dono vê que voltou.
    // Descartada fica descartada: o dono disse que não quer ouvir dela.
    const { rows } = await db.query<{ id: string; pergunta: string; ocorrencias: number; status: string }>(
      `insert into knowledge_gaps (organization_id, chave, pergunta)
       values ($1, $2, $3)
       on conflict (organization_id, chave) do update
         set ocorrencias = knowledge_gaps.ocorrencias + 1,
             ultima_em = now(),
             status = case when knowledge_gaps.status = 'descartada' then 'descartada' else 'aberta' end
       returning id, pergunta, ocorrencias, status`,
      [tenantId, chave, pergunta],
    );
    const lacuna = rows[0];
    if (lacuna === undefined) return { registrada: false, porque: 'erro' };
    if (lacuna.status === 'descartada') return { registrada: false, porque: 'descartada' };

    // Um aviso por lacuna ABERTA: se já há um, só o texto muda (o contador).
    const { title, body } = copyDaLacuna(lacuna.pergunta, lacuna.ocorrencias);
    const atualizado = await db.query(
      `update agent_inbox_items
          set title = $3, body = $4
        where organization_id = $1
          and kind = 'knowledge_gap'
          and ref_kind = 'knowledge_gap'
          and ref_id = $2
          and status = 'open'`,
      [tenantId, lacuna.id, title, body],
    );
    if ((atualizado.rowCount ?? 0) === 0) {
      await insertInboxItem(
        db,
        tenantId,
        { kind: 'knowledge_gap', severity: 'warn', title, body, refKind: 'knowledge_gap', refId: lacuna.id },
        'kind_e_ref',
      );
    }
    return { registrada: true, lacunaId: lacuna.id, ocorrencias: lacuna.ocorrencias };
  } catch (err) {
    log.warn('lacuna do acervo não registrada', {
      error: err instanceof Error ? err.message.slice(0, 160) : 'erro desconhecido',
    });
    return { registrada: false, porque: 'erro' };
  }
}
