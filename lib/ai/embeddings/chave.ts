/**
 * DE ONDE VEM A CHAVE QUE INDEXA E CONSULTA O SEU MATERIAL.
 *
 * ## O defeito que este arquivo existe para acabar
 *
 * `lib/ai/embed.ts` lia `AI_GATEWAY_API_KEY`/`OPENAI_API_KEY` do `process.env` e
 * mais nada. Ou seja: **cadastrar a chave da OpenAI pela tela não habilitava a
 * base de conhecimento.** Só editar o `.env` da instalação habilitava.
 *
 * Isso é pior do que parece, porque o produto PROMETE o contrário em dois
 * lugares que a pessoa lê antes de tentar:
 *
 *  - `lib/ai/pontos/provedores.ts` descreve a OpenAI como *"necessário para
 *    transcrever áudio e **para indexar o seu material**"*;
 *  - o painel `/app/ai/providers` lista `embedding_indexar` e
 *    `embedding_consultar` entre os pontos de IA da organização.
 *
 * Tela que oferece e motor que ignora é o anti-pattern que este repo mais
 * persegue. E o desfecho era mudo: sem chave o worker devolvia
 * `skipped: openai_key_missing`, o drain tratava `skipped` como sucesso, e a
 * linha da fonte continuava dizendo `status='ready'` para sempre.
 *
 * ## A escada, do mais específico ao mais genérico
 *
 *  1. **Binding do ponto** (`ai_purpose_bindings`) — a escolha explícita feita
 *     no painel de provedores. É a superfície que o operador enxerga, então ela
 *     vence.
 *  2. **Credencial OpenAI da organização** (`ai_provider_credentials`, ativa e
 *     validada). É o degrau que faz "cadastrei a chave na tela e funcionou"
 *     virar verdade sem exigir que ninguém entenda o que é um binding.
 *  2b. **Credencial OpenRouter da organização** — quando ela não tem chave da
 *     OpenAI. A OpenRouter serve o MESMO `openai/text-embedding-3-small` (1536
 *     dimensões) pelo endpoint OpenAI-compatível, então o índice é o mesmo mapa
 *     e nada precisa ser reindexado. Antes disto, uma organização cuja única
 *     chave era a da OpenRouter subia material que nunca ficava pronto.
 *  3. **Gateway da Vercel** (`AI_GATEWAY_API_KEY`) — quando a instalação roteia
 *     tudo por ele.
 *  4. **Chave da instalação** (`OPENAI_API_KEY`) — o que o `install.sh` pede.
 *  4b. **Chave OpenRouter da instalação** (`OPENROUTER_API_KEY`).
 *  5. Nada. E "nada" é uma resposta legítima que o chamador precisa saber
 *     mostrar, não um erro para engolir.
 *
 * A decisão devolve a ORIGEM junto com a chave. Não é enfeite: é o que permite
 * a tela responder *"está usando a chave X **porque**…"* em vez de deixar o dono
 * do negócio adivinhando por que a indexação não anda.
 *
 * ## O modelo agora É escolha (2026-10-12) — com o mapa amarrado
 *
 * Até aqui o modelo era fixo (`text-embedding-3-small`) e o binding governava
 * só a chave. Hoje o painel escolhe provedor E modelo
 * (`lib/ai/embeddings/catalogo.ts`), sempre com 1536 dimensões, e a chave
 * devolvida carrega o MODELO junto (`ChaveDeEmbedding.modelo`) — quem embeda
 * não decide modelo nenhum, usa o que veio com a chave. Indexação e busca
 * continuam sendo coordenadas de um mesmo mapa: os dois pontos são gravados
 * juntos, a versão de índice grava o mapa com que foi calculada
 * (`ai_knowledge_versions.embedding_model`), e a busca embeda a pergunta no
 * mapa de cada material (`resolverChaveParaMapa`) — material ainda não
 * reindexado segue sendo achado pelo modelo antigo.
 *
 * Sem modelo escolhido, tudo funciona como antes: mapa legado, escada abaixo.
 */
import { byteaToBuffer, decryptKey } from "@/lib/crypto/aes_gcm";
import { OPENROUTER_BASE_URL } from "@/lib/ai/gateway";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  DIMENSOES,
  MAPA_LEGADO,
  modeloDoBinding,
  modeloDoMapa,
  provedoresDoMapa,
  rotuloDoMapa,
  type ModeloDeEmbedding,
  type ProvedorDeEmbedding,
} from "./catalogo";

export type { ProvedorDeEmbedding } from "./catalogo";

/** Os dois pontos de IA que consomem embedding (`lib/ai/pontos/registro.ts`). */
export type PontoDeEmbedding = "embedding_indexar" | "embedding_consultar";

/**
 * O mapa LEGADO — o único até 2026-10-12. Não é mais "o modelo": é o que vale
 * sem escolha no painel, e o valor gravado pelas versões antigas. Quem precisa
 * do modelo em vigor lê `ChaveDeEmbedding.modelo`.
 */
export const MODELO_DE_EMBEDDING = MAPA_LEGADO;
export const DIMENSOES_DO_EMBEDDING = DIMENSOES;

export type OrigemDaChave =
  | "binding_do_ponto"
  | "credencial_da_organizacao"
  | "credencial_openrouter_da_organizacao"
  | "credencial_google_da_organizacao"
  | "gateway_da_instalacao"
  | "chave_da_instalacao"
  | "chave_openrouter_da_instalacao";

export const EXPLICACAO_DA_ORIGEM: Record<OrigemDaChave, string> = {
  binding_do_ponto: "Escolhida por você no painel de Provedores.",
  credencial_da_organizacao: "Usando a chave OpenAI cadastrada em Credenciais.",
  credencial_openrouter_da_organizacao: "Usando a chave OpenRouter cadastrada em Credenciais.",
  credencial_google_da_organizacao: "Usando a chave Google cadastrada em Credenciais.",
  gateway_da_instalacao: "Usando o gateway de IA configurado nesta instalação.",
  chave_da_instalacao: "Usando a chave que veio na instalação.",
  chave_openrouter_da_instalacao: "Usando a chave OpenRouter que veio na instalação.",
};

export interface ChaveDeEmbedding {
  /** O modelo da chamada — mapa, provedor, id e parâmetro de corte. */
  modelo: ModeloDeEmbedding;
  /** Plaintext. Vive só no escopo de quem chamou — nunca logada nem persistida. */
  apiKey: string | null;
  /** `null` = falar direto com a OpenAI. */
  baseUrl: string | null;
  /**
   * A OpenAI quer o id sem prefixo (`text-embedding-3-small`); a OpenRouter quer
   * o id com o fornecedor (`openai/text-embedding-3-small`). O formato trocado
   * é modelo inexistente para qualquer uma das duas.
   */
  provedor: ProvedorDeEmbedding;
  /** Quando true, a chamada vai pelo gateway (o SDK lê a chave do process.env). */
  viaGateway: boolean;
  origem: OrigemDaChave;
  /** Rótulo da credencial, quando houver — a tela mostra qual chave está valendo. */
  rotulo: string | null;
  /** Incoerências que não impedem a chamada mas alguém precisa ver. */
  avisos: string[];
}

/**
 * Resolve a chave de embedding da organização, ou `null` quando não há nenhuma.
 *
 * `organizationId` é obrigatório: um resolvedor que aceitasse organização
 * opcional acabaria chamado sem ela justamente no caminho que mais importa,
 * aplicando a configuração de ninguém.
 */
export async function resolverChaveDeEmbedding(
  organizationId: string,
  ponto: PontoDeEmbedding = "embedding_indexar",
): Promise<ChaveDeEmbedding | null> {
  const avisos: string[] = [];
  const binding = await lerBindingDeEmbedding(ponto, organizationId);

  // A · O painel escolheu um MODELO: a chave tem de servir esse mapa.
  const alvo = modeloDoBinding(binding);
  if (binding && alvo) {
    const chave = await chaveParaOModelo(organizationId, alvo, binding, avisos);
    if (chave === null) {
      logger.warn("[embedding] nenhuma chave serve o modelo escolhido no painel", {
        organization_id: organizationId,
        purpose: ponto,
        mapa: alvo.mapa,
        provider: alvo.provedor,
      });
    }
    return chave;
  }

  // B · Sem modelo escolhido: o mapa legado e a escada de sempre.
  return resolverLegado(organizationId, binding, avisos);
}

/**
 * A chave para embedar no mapa `mapa` — o da versão ATIVA de um material. A
 * busca usa isto para achar material ainda não reindexado depois de uma troca
 * de modelo: a pergunta é embedada no mapa de cada material, e cada grupo é
 * buscado com o seu vetor.
 */
export async function resolverChaveParaMapa(
  organizationId: string,
  mapa: string,
): Promise<ChaveDeEmbedding | null> {
  const atual = await resolverChaveDeEmbedding(organizationId, "embedding_consultar");
  if (atual?.modelo.mapa === mapa) return atual;
  if (mapa === MAPA_LEGADO) return resolverLegado(organizationId, null, []);
  for (const provedor of provedoresDoMapa(mapa)) {
    const modelo = modeloDoMapa(mapa, provedor);
    const chave = modelo ? await chaveDoProvedor(organizationId, provedor, null) : null;
    if (modelo && chave) {
      return {
        modelo,
        apiKey: chave.apiKey,
        baseUrl: provedor === "openrouter" ? OPENROUTER_BASE_URL : null,
        provedor,
        viaGateway: false,
        origem: chave.origem,
        rotulo: chave.rotulo,
        avisos: [],
      };
    }
  }
  return null;
}

/**
 * A chave EXATA para um modelo e provedor, sem descer para outro provedor —
 * é o que a prova de salvar usa: ela precisa testar a escolha da tela, não
 * uma alternativa que a escada encontraria.
 */
export async function chaveParaProva(
  organizationId: string,
  modelo: ModeloDeEmbedding,
  credentialId: string | null,
): Promise<ChaveDeEmbedding | null> {
  const chave = await chaveDoProvedor(organizationId, modelo.provedor, credentialId);
  if (!chave) return null;
  return {
    modelo,
    apiKey: chave.apiKey,
    baseUrl: modelo.provedor === "openrouter" ? OPENROUTER_BASE_URL : null,
    provedor: modelo.provedor,
    viaGateway: false,
    origem: chave.origem,
    rotulo: chave.rotulo,
    avisos: [],
  };
}

/**
 * Caminho A. Primeiro o provedor escolhido (credencial do binding → da
 * organização → da instalação); sem chave nenhuma para ele, outro provedor que
 * sirva o MESMO mapa (o Gemini sai pela Google ou pela OpenRouter; o
 * text-embedding-3 pela OpenAI ou pela OpenRouter) — é o mesmo vetor, então
 * nada precisa ser reindexado. Nunca um mapa diferente do escolhido.
 */
async function chaveParaOModelo(
  organizationId: string,
  alvo: ModeloDeEmbedding,
  binding: LinhaDeBinding,
  avisos: string[],
): Promise<ChaveDeEmbedding | null> {
  const ordem = [alvo.provedor, ...provedoresDoMapa(alvo.mapa).filter((p) => p !== alvo.provedor)];
  for (const provedor of ordem) {
    const modelo = provedor === alvo.provedor ? alvo : modeloDoMapa(alvo.mapa, provedor);
    if (!modelo) continue;
    const ehOProvedorDoBinding = provedor === binding.provider;
    const chave = await chaveDoProvedor(organizationId, provedor, ehOProvedorDoBinding ? binding.credential_id : null, avisos);
    if (!chave) continue;
    if (provedor !== alvo.provedor) {
      avisos.push(
        `Não há chave de ${NOME[alvo.provedor]} para "${rotuloDoMapa(alvo.mapa)}". Usando ${NOME[provedor]}, ` +
          `que serve o mesmo modelo — o material continua no mesmo mapa.`,
      );
    }
    const baseUrlDoBinding = ehOProvedorDoBinding ? binding.base_url : null;
    return {
      modelo,
      apiKey: chave.apiKey,
      baseUrl: baseUrlDoBinding ?? (provedor === "openrouter" ? OPENROUTER_BASE_URL : null),
      provedor,
      viaGateway: false,
      origem: chave.origem,
      rotulo: chave.rotulo,
      avisos,
    };
  }
  return null;
}

const NOME: Record<ProvedorDeEmbedding, string> = { openai: "OpenAI", openrouter: "OpenRouter", google: "Google" };

const ORIGEM_DA_CREDENCIAL: Record<ProvedorDeEmbedding, OrigemDaChave> = {
  openai: "credencial_da_organizacao",
  openrouter: "credencial_openrouter_da_organizacao",
  google: "credencial_google_da_organizacao",
};

/** A chave de UM provedor: a escolhida, a da organização, a da instalação. */
async function chaveDoProvedor(
  organizationId: string,
  provedor: ProvedorDeEmbedding,
  credentialId: string | null,
  avisos: string[] = [],
): Promise<{ apiKey: string; origem: OrigemDaChave; rotulo: string | null } | null> {
  if (credentialId) {
    const escolhida = await decifrarCredencial(credentialId, organizationId);
    if (escolhida && escolhida.provider === provedor) {
      return { apiKey: escolhida.apiKey, origem: "binding_do_ponto", rotulo: escolhida.rotulo };
    }
    avisos.push(
      "A chave escolhida no painel de Provedores para o seu material não está utilizável " +
        "(desativada, apagada ou ainda não validada). Seguindo com a próxima chave disponível.",
    );
  }
  const daOrg = await credencialDaOrganizacao(organizationId, provedor);
  if (daOrg) return { apiKey: daOrg.apiKey, origem: ORIGEM_DA_CREDENCIAL[provedor], rotulo: daOrg.rotulo };
  if (provedor === "openai" && env.OPENAI_API_KEY) {
    return { apiKey: env.OPENAI_API_KEY, origem: "chave_da_instalacao", rotulo: null };
  }
  if (provedor === "openrouter" && env.OPENROUTER_API_KEY) {
    return { apiKey: env.OPENROUTER_API_KEY, origem: "chave_openrouter_da_instalacao", rotulo: null };
  }
  return null;
}

/** O mapa legado servido por um provedor (OpenAI ou OpenRouter). */
function legadoPor(provedor: "openai" | "openrouter"): ModeloDeEmbedding {
  return modeloDoMapa(MAPA_LEGADO, provedor)!;
}

/**
 * Caminho B — a escada de sempre, com o mapa legado. Um binding SEM modelo de
 * embedding (formato antigo: só chave) ainda escolhe a chave no degrau 1.
 */
async function resolverLegado(
  organizationId: string,
  binding: LinhaDeBinding | null,
  avisos: string[],
): Promise<ChaveDeEmbedding | null> {
  // 1 · A chave escolhida no painel.
  if (binding?.credential_id) {
    const credencial = await decifrarCredencial(binding.credential_id, organizationId);
    if (credencial && (credencial.provider === "openai" || credencial.provider === "openrouter")) {
      if (binding.model_id && !/embed/i.test(binding.model_id)) {
        avisos.push(
          `O painel aponta "${binding.model_id}" para o seu material, mas esse não é um modelo de embedding — ` +
            `valendo ${rotuloDoMapa(MAPA_LEGADO)}. Escolha o modelo do material em Provedores.`,
        );
      }
      const ehOpenRouter = credencial.provider === "openrouter";
      return {
        modelo: legadoPor(ehOpenRouter ? "openrouter" : "openai"),
        apiKey: credencial.apiKey,
        // Chave da OpenRouter sem endpoint próprio iria para api.openai.com e
        // voltaria 401: o binding sem `base_url` herda o endpoint do provedor.
        baseUrl: binding.base_url ?? (ehOpenRouter ? OPENROUTER_BASE_URL : null),
        provedor: ehOpenRouter ? "openrouter" : "openai",
        viaGateway: false,
        origem: "binding_do_ponto",
        rotulo: credencial.rotulo,
        avisos,
      };
    }
    avisos.push(
      "A chave escolhida no painel de Provedores para este ponto não está utilizável " +
        "(desativada, apagada ou ainda não validada). Seguindo com a próxima chave disponível.",
    );
  }

  // 2 · A credencial OpenAI da organização, sem exigir binding nenhum.
  const daOrg = await credencialDaOrganizacao(organizationId, "openai");
  if (daOrg) {
    if (daOrg.quantas > 1) {
      avisos.push(
        `Esta organização tem ${daOrg.quantas} chaves OpenAI cadastradas e nenhuma escolhida para ` +
          `a base de conhecimento. Usando "${daOrg.rotulo}" — escolha uma em Provedores para não depender disso.`,
      );
    }
    return {
      modelo: legadoPor("openai"),
      apiKey: daOrg.apiKey,
      baseUrl: null,
      provedor: "openai",
      viaGateway: false,
      origem: "credencial_da_organizacao",
      rotulo: daOrg.rotulo,
      avisos,
    };
  }

  // 2b · A credencial OpenRouter da organização. Depois da OpenAI de propósito:
  // quem tem as duas continua falando direto com a OpenAI, como antes.
  const daOrgOpenRouter = await credencialDaOrganizacao(organizationId, "openrouter");
  if (daOrgOpenRouter) {
    if (daOrgOpenRouter.quantas > 1) {
      avisos.push(
        `Esta organização tem ${daOrgOpenRouter.quantas} chaves OpenRouter cadastradas e nenhuma escolhida ` +
          `para a base de conhecimento. Usando "${daOrgOpenRouter.rotulo}".`,
      );
    }
    return {
      modelo: legadoPor("openrouter"),
      apiKey: daOrgOpenRouter.apiKey,
      baseUrl: OPENROUTER_BASE_URL,
      provedor: "openrouter",
      viaGateway: false,
      origem: "credencial_openrouter_da_organizacao",
      rotulo: daOrgOpenRouter.rotulo,
      avisos,
    };
  }

  // 3 · O gateway da instalação. A chave não sai daqui: o SDK a lê do process.env.
  if (env.AI_GATEWAY_API_KEY) {
    return {
      modelo: legadoPor("openai"),
      apiKey: null,
      baseUrl: env.AI_GATEWAY_BASE_URL || null,
      provedor: "openai",
      viaGateway: true,
      origem: "gateway_da_instalacao",
      rotulo: null,
      avisos,
    };
  }

  // 4 · A chave que o install.sh pediu.
  if (env.OPENAI_API_KEY) {
    return {
      modelo: legadoPor("openai"),
      apiKey: env.OPENAI_API_KEY,
      baseUrl: null,
      provedor: "openai",
      viaGateway: false,
      origem: "chave_da_instalacao",
      rotulo: null,
      avisos,
    };
  }

  // 4b · A chave da OpenRouter da instalação.
  if (env.OPENROUTER_API_KEY) {
    return {
      modelo: legadoPor("openrouter"),
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL,
      provedor: "openrouter",
      viaGateway: false,
      origem: "chave_openrouter_da_instalacao",
      rotulo: null,
      avisos,
    };
  }

  return null;
}

/**
 * Existe chave utilizável para esta organização?
 *
 * Substitui `isEmbeddingProviderConfigured()`, cuja assinatura SEM organização
 * é a raiz do defeito: ela respondia "não" para toda organização que tivesse
 * cadastrado a chave pela tela.
 */
export async function temChaveDeEmbedding(organizationId: string): Promise<boolean> {
  return (await resolverChaveDeEmbedding(organizationId)) !== null;
}

// ---------------------------------------------------------------------------
// Leitura do banco — admin client, filtro de organização SEMPRE programático
// (o service role bypassa RLS; CLAUDE.md, anti-pattern 10).
// ---------------------------------------------------------------------------

interface LinhaDeBinding {
  provider: string;
  credential_id: string | null;
  model_id: string;
  base_url: string | null;
}

async function lerBindingDeEmbedding(
  ponto: PontoDeEmbedding,
  organizationId: string,
): Promise<LinhaDeBinding | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("ai_purpose_bindings")
      .select("provider, credential_id, model_id, base_url")
      .eq("organization_id", organizationId)
      .eq("purpose", ponto)
      .eq("is_enabled", true)
      .maybeSingle();
    return (data as LinhaDeBinding | null) ?? null;
  } catch (err) {
    // Tabela ausente (clone sem o baseline aplicado) não pode derrubar a
    // indexação — mas também não pode passar em silêncio.
    logger.warn("[embedding] não consegui ler o binding do ponto", {
      organization_id: organizationId,
      purpose: ponto,
      motivo: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function decifrarCredencial(
  credentialId: string,
  organizationId: string,
): Promise<{ apiKey: string; rotulo: string; provider: string } | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("ai_provider_credentials")
      .select("label, provider, api_key_encrypted, api_key_iv, api_key_tag")
      .eq("id", credentialId)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .not("validated_at", "is", null)
      .maybeSingle();
    if (!data) return null;
    return {
      apiKey: decryptKey({
        ciphertext: byteaToBuffer(data.api_key_encrypted),
        iv: byteaToBuffer(data.api_key_iv),
        tag: byteaToBuffer(data.api_key_tag),
      }),
      rotulo: String((data as { label?: string }).label ?? ""),
      provider: String((data as { provider?: string }).provider ?? ""),
    };
  } catch {
    // Sem detalhe no log: qualquer eco aqui corre o risco de carregar material
    // da credencial.
    return null;
  }
}

/**
 * A credencial ativa e validada da organização para aquele provedor.
 *
 * Desempate DETERMINÍSTICO pela mais antiga: com duas chaves e nenhuma escolha,
 * "a mais recente" faria o comportamento mudar sozinho no dia em que alguém
 * cadastrasse outra. A tela evita o caso oferecendo a escolha; aqui o que
 * importa é não variar.
 */
async function credencialDaOrganizacao(
  organizationId: string,
  provider: ProvedorDeEmbedding,
): Promise<{ apiKey: string; rotulo: string; quantas: number } | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("ai_provider_credentials")
      .select("id, label, api_key_encrypted, api_key_iv, api_key_tag")
      .eq("organization_id", organizationId)
      .eq("provider", provider)
      .eq("is_active", true)
      .not("validated_at", "is", null)
      .order("created_at", { ascending: true });

    const linhas = (data ?? []) as Array<{
      id: string;
      label: string;
      api_key_encrypted: unknown;
      api_key_iv: unknown;
      api_key_tag: unknown;
    }>;
    const primeira = linhas[0];
    if (!primeira) return null;

    return {
      apiKey: decryptKey({
        ciphertext: byteaToBuffer(primeira.api_key_encrypted),
        iv: byteaToBuffer(primeira.api_key_iv),
        tag: byteaToBuffer(primeira.api_key_tag),
      }),
      rotulo: primeira.label,
      quantas: linhas.length,
    };
  } catch {
    return null;
  }
}
