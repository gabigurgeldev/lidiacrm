import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * `fn_publish_ai_agent_version` ACEITA "A CHAVE DESTA INSTALAÇÃO" (migration 0232).
 *
 * O editor grava `credential_id` nulo quando a chave vem do `.env` do servidor,
 * e o motor sabe usá-la. A função recusava nulo com `credential_missing` — o
 * agente salvava e nunca publicava, e o do onboarding (criado já publicado, por
 * fora da função) não podia ser republicado depois da primeira edição.
 *
 * O banco não enxerga o `.env`: quem confere que HÁ chave é `publishAgentVersion`
 * (`tests/unit/publicar-com-chave-da-instalacao.test.ts`). Aqui se prova o lado
 * do banco: nulo publica, e credencial ESCOLHIDA continua conferida inteira — o
 * conserto não pode virar porta para publicar com credencial desativada.
 *
 * Sabotagem prevista: voltar o `raise 'credential_missing'` para o nulo → o 1º
 * caso reprova; tirar o bloco `if v_version.credential_id is not null` inteiro
 * (sem conferir nada) → o 2º reprova.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = "f3f3f3f3-0000-4000-8000-000000000001";
const SESSION = "f3f3f3f3-0000-4000-8000-000000000002";
const AGENTE_NULO = "f3f3f3f3-0000-4000-8000-000000000003";
const VERSAO_NULA = "f3f3f3f3-0000-4000-8000-000000000004";
const AGENTE_DESATIVADA = "f3f3f3f3-0000-4000-8000-000000000005";
const VERSAO_DESATIVADA = "f3f3f3f3-0000-4000-8000-000000000006";
const CREDENCIAL_DESATIVADA = "f3f3f3f3-0000-4000-8000-000000000007";
const MODELO = "claude-teste-0232";

async function agenteComVersao(
  agente: string,
  versao: string,
  credencial: string | null,
  // `ai_agents_name_unique`: o nome é único por organização.
  nome: string,
): Promise<void> {
  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt, kind)
     values ($1, $2, $3, 'você é um atendente', 'mcp_agent') on conflict (id) do nothing`,
    [agente, ORG, nome],
  );
  await pool.query(
    `insert into ai_agent_versions (id, organization_id, agent_id, version_number, system_prompt,
                                    provider, model, credential_id, channel_session_id, status)
     values ($1, $2, $3, 1, 'você é um atendente', 'anthropic', $4, $5, $6, 'draft')
     on conflict (id) do nothing`,
    [versao, ORG, agente, MODELO, credencial, SESSION],
  );
}

async function publica(agente: string, versao: string): Promise<string | null> {
  try {
    await pool.query("select * from public.fn_publish_ai_agent_version($1, $2, $3)", [ORG, agente, versao]);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'chave-instalacao', 'Chave', 'Chave') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, 'chave-instalacao-session', 'WORKING', '\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  await pool.query(
    `insert into ai_models (provider, model_id, display_name)
     select 'anthropic', $1, 'Modelo de teste 0232'
      where not exists (select 1 from ai_models where provider = 'anthropic' and model_id = $1)`,
    [MODELO],
  );
  await pool.query(
    `insert into ai_provider_credentials (id, organization_id, provider, label, api_key_encrypted,
                                          api_key_iv, api_key_tag, api_key_last4, is_active, validated_at)
     values ($1, $2, 'anthropic', 'desativada', '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, '0000', false, now())
     on conflict (id) do nothing`,
    [CREDENCIAL_DESATIVADA, ORG],
  );
  await agenteComVersao(AGENTE_NULO, VERSAO_NULA, null, "Agente 0232 sem credencial");
  await agenteComVersao(AGENTE_DESATIVADA, VERSAO_DESATIVADA, CREDENCIAL_DESATIVADA, "Agente 0232 desativada");
});

afterAll(async () => {
  await pool.end();
});

describe("fn_publish_ai_agent_version e a chave desta instalação", () => {
  it("versão sem credencial escolhida PUBLICA", async () => {
    expect(await publica(AGENTE_NULO, VERSAO_NULA)).toBeNull();
    const { rows } = await pool.query<{ status: string; publicada: string | null }>(
      `select v.status, a.published_version_id as publicada
         from ai_agent_versions v join ai_agents a on a.id = v.agent_id
        where v.id = $1`,
      [VERSAO_NULA],
    );
    expect(rows[0]).toEqual({ status: "published", publicada: VERSAO_NULA });
  });

  it("credencial ESCOLHIDA continua conferida: desativada não publica", async () => {
    expect(await publica(AGENTE_DESATIVADA, VERSAO_DESATIVADA)).toMatch(/credential_inactive/);
  });

  it("segue fora do alcance da anon key (hardening reemitido)", async () => {
    const { rows } = await pool.query<{ pode: boolean }>(
      `select has_function_privilege('anon', 'public.fn_publish_ai_agent_version(uuid, uuid, uuid)', 'EXECUTE') as pode`,
    );
    expect(rows[0]?.pode).toBe(false);
  });
});
