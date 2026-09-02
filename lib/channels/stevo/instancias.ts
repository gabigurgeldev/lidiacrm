/**
 * A conta do intermediário e as INSTÂNCIAS dentro dela.
 *
 * ═══ Por que este canal se conecta por conta, e não por número ═══
 *
 * Os outros canais pedem uma credencial POR NÚMERO: o operador vai ao painel da
 * plataforma, copia três valores, cola aqui, repete para o próximo. Este
 * intermediário emite uma chave de CONTA (`stevo_sk_…`) que enxerga todas as
 * instâncias — então o CRM consegue perguntar "quais números você tem?" e
 * mostrar a lista. O operador escolhe quais quer atender aqui; ele não redigita
 * nada.
 *
 * Isso muda a tela e muda o modelo: uma linha de `channel_sessions` por
 * instância importada, todas com a mesma chave cifrada (ver `credentials.ts`
 * para o porquê da repetição).
 *
 * ═══ `is_official_api` é o campo que decide a REGRA DE ENVIO ═══
 *
 * A mesma conta hospeda instância oficial (WABA da Meta: janela de 24h, fora
 * dela só modelo aprovado) e número ligado por QR (texto livre, risco de
 * banimento). São regras opostas, e é este booleano que diz qual vale — por isso
 * ele vira `provider_mode` na linha, e não uma dedução em tempo de envio.
 *
 * ═══ O que NÃO foi medido, e por isso não está aqui ═══
 *
 * O formato do payload de webhook de entrada não consta de nenhum dos specs
 * publicados (nem o da gestão, nem o do StevoManager, nem o da API oficial). Ele
 * é lido em `webhook.ts` de forma DEFENSIVA, e o que este arquivo faz é só
 * registrar a URL — nunca supor o corpo que vai chegar nela.
 */

const TIMEOUT_MS = 15_000;

export interface StevoInstancia {
  id: string;
  nome: string | null;
  /** Estado relatado pela conta. Vocabulário ABERTO — ele cria valores novos. */
  status: string | null;
  conectada: boolean;
  telefone: string | null;
  /** Nome do perfil do WhatsApp, quando a instância já pareou. */
  nomeDoPerfil: string | null;
  /** `true` = instância oficial (janela de 24h). `false` = número por QR. */
  oficial: boolean;
}

export interface ContaStevo {
  ok: true;
  instancias: StevoInstancia[];
}

export interface ContaStevoRecusada {
  ok: false;
  /** Frase pronta para a tela. Nunca contém a chave. */
  motivo: string;
}

export type ValidacaoDaConta = ContaStevo | ContaStevoRecusada;

function cabecalhos(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}`, accept: "application/json" };
}

/**
 * Lê um campo que pode chegar com mais de um nome.
 *
 * A doc lista `name` e `instance_name`, `phone_number` e `profile_name`, e um
 * intermediário costuma renomear campo entre versões sem avisar. Preferir o
 * primeiro presente é mais barato que um schema estrito que reprova a conta
 * inteira por causa de um apelido — e o que falta vira `null`, que a tela sabe
 * desenhar.
 */
function texto(o: Record<string, unknown>, ...chaves: string[]): string | null {
  for (const k of chaves) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function normalizar(bruta: Record<string, unknown>): StevoInstancia | null {
  const id = texto(bruta, "id");
  // Sem id não há o que endereçar: nem envio, nem webhook, nem saúde. Descartar
  // uma linha malformada é melhor que importar um canal que não fala com nada.
  if (!id) return null;
  return {
    id,
    nome: texto(bruta, "name", "instance_name"),
    status: texto(bruta, "status"),
    conectada: bruta.connected === true,
    telefone: texto(bruta, "phone_number"),
    nomeDoPerfil: texto(bruta, "profile_name"),
    // ⚠️ Comparação ESTRITA com `true`, e não coerção: a ausência do campo (uma
    // versão antiga da API, um erro de serialização) cairia em "não é oficial"
    // por acidente, e o canal nasceria com a regra de envio errada — texto livre
    // liberado onde a Meta recusa a entrega. Na dúvida, não é oficial, e o pior
    // que acontece é o aviso de janela aparecer onde não precisava.
    oficial: bruta.is_official_api === true,
  };
}

/**
 * A chave presta? E, se presta, quais instâncias ela alcança?
 *
 * Uma chamada só responde as duas perguntas: `GET /v1/instances` já exige a
 * chave válida, então validar antes com `/v1/me` seria uma ida a mais para saber
 * o que a próxima resposta diria de qualquer jeito.
 *
 * **Valida ANTES de gravar** (mesma regra do canal oficial e do outro
 * intermediado): gravar primeiro e descobrir depois é o que faz o operador achar
 * que conectou e só entender que não na primeira mensagem que não sai.
 */
export async function validarContaStevo(input: {
  apiKey: string;
  baseUrl: string;
}): Promise<ValidacaoDaConta> {
  let resposta: Response;
  try {
    resposta = await fetch(`${input.baseUrl}/v1/instances`, {
      headers: cabecalhos(input.apiKey),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // Rede caída e chave errada pedem ações OPOSTAS — tentar de novo mais tarde
    // versus ir buscar outra chave —, e uma mensagem só para os dois manda o
    // operador para o caminho errado metade das vezes.
    return {
      ok: false,
      motivo: "não foi possível falar com o provedor — verifique a conexão do servidor e tente de novo",
    };
  }

  if (resposta.status === 401 || resposta.status === 403) {
    return { ok: false, motivo: "chave de API recusada pelo provedor — confira se ela foi copiada inteira" };
  }
  if (!resposta.ok) {
    return { ok: false, motivo: `o provedor respondeu ${resposta.status} ao listar as instâncias` };
  }

  const corpo = (await resposta.json().catch(() => null)) as
    | { data?: unknown }
    | unknown[]
    | null;
  // O envelope varia entre `{data: [...]}` e a lista crua conforme o endpoint.
  // Aceitar as duas formas custa duas linhas e evita que uma mudança de envelope
  // devolva "nenhuma instância" — que se lê como "a conta está vazia".
  const lista = Array.isArray(corpo)
    ? corpo
    : Array.isArray((corpo as { data?: unknown })?.data)
      ? ((corpo as { data: unknown[] }).data)
      : null;

  if (lista === null) {
    return { ok: false, motivo: "o provedor respondeu num formato que este CRM não reconhece" };
  }

  const instancias = lista
    .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
    .map(normalizar)
    .filter((i): i is StevoInstancia => i !== null);

  return { ok: true, instancias };
}

/**
 * O detalhe de UMA instância — usado como health check.
 *
 * `null` quando não deu para perguntar. Não é o mesmo que "desconectada": a
 * ação é outra (verificar a rede do servidor, não reparear o número), e
 * sobrescrever o estado com um erro de rede transitório trocaria informação boa
 * por ruído.
 */
export async function lerInstanciaStevo(input: {
  apiKey: string;
  baseUrl: string;
  instanceId: string;
}): Promise<StevoInstancia | null> {
  try {
    const r = await fetch(`${input.baseUrl}/v1/instances/${encodeURIComponent(input.instanceId)}`, {
      headers: cabecalhos(input.apiKey),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const corpo = (await r.json().catch(() => null)) as { data?: unknown } | null;
    const bruta = (corpo?.data ?? corpo) as Record<string, unknown> | null;
    return bruta && typeof bruta === "object" ? normalizar(bruta) : null;
  } catch {
    return null;
  }
}

/**
 * Aponta o webhook da instância para ESTA instalação.
 *
 * Feito pelo CRM e não pelo operador de propósito: o endereço carrega o
 * `webhook_path_token` da linha, que é um segredo gerado aqui e que o operador
 * não tem por que ver nem colar. É também o que faz a conexão terminar
 * FUNCIONANDO — o canal oficial precisa dessa etapa manual no painel da Meta, e
 * é onde as instalações emperram.
 *
 * Devolve `false` quando o provedor recusou. O chamador NÃO desfaz a importação
 * por causa disso: o canal já consegue ENVIAR, e um canal que envia e não recebe
 * é ruim mas é melhor que canal nenhum — desde que a tela diga.
 */
export async function apontarWebhookStevo(input: {
  apiKey: string;
  baseUrl: string;
  instanceId: string;
  url: string;
}): Promise<boolean> {
  try {
    const r = await fetch(
      `${input.baseUrl}/v1/instances/${encodeURIComponent(input.instanceId)}/webhook`,
      {
        method: "PUT",
        headers: { ...cabecalhos(input.apiKey), "content-type": "application/json" },
        // `events` explícito: o default do provedor é `["MESSAGE","CONNECTION"]`,
        // e sem `SEND_MESSAGE` a mensagem que o operador manda pelo CELULAR não
        // chega ao CRM — a conversa fica pela metade, com as respostas dele
        // faltando. É o mesmo motivo pelo qual o transporte por QR assina
        // `message.any` e não `message`.
        body: JSON.stringify({
          url: input.url,
          events: ["MESSAGE", "SEND_MESSAGE", "CONNECTION"],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    return r.ok;
  } catch {
    return false;
  }
}
