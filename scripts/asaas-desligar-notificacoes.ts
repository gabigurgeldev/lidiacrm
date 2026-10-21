/**
 * Cala o Asaas nos clientes que JÁ existem: `notificationDisabled: true` em
 * cada `assinaturas.asaas_customer_id`.
 *
 * ═══ Por que existe ═══
 *
 * O aviso de cobrança ao cliente (fatura pendente/vencida, fim do teste) passou
 * a ser do Back Office de afiliados, pelo WhatsApp, a partir do
 * `invoice.updated` que o CRM manda (`lib/backoffice/saida.ts`). Cliente novo
 * no Asaas já nasce calado (`criarCliente`/`atualizarCliente`, em
 * `lib/billing/asaas.ts`). Este script acerta os que nasceram antes — sem ele,
 * esses clientes receberiam o mesmo aviso duas vezes: do Asaas e do Back Office.
 *
 * ═══ Seguro por padrão ═══
 *
 *   - Sem `--aplicar` é SIMULAÇÃO: lista quantos clientes seriam calados e em
 *     qual Asaas (produção/sandbox — decidido pela chave), e não chama o Asaas.
 *   - `--aplicar` recusa quando o Back Office NÃO está ligado
 *     (`BACKOFFICE_URL` + `BACKOFFICE_API_KEY`): calar o Asaas sem ninguém no
 *     lugar deixaria o cliente sem aviso nenhum.
 *   - Idempotente: rodar de novo só regrava `true` em quem já está `true`.
 *   - Deixa uma linha em `api_audit_log` (`billing.notificacoes_asaas_desligadas`,
 *     ator `script:asaas-desligar-notificacoes`) com as contagens — só id do
 *     Asaas e contagem, nenhum dado do titular.
 *
 * ═══ Quando rodar ═══
 *
 * Depois do merge, com os modelos de aviso aprovados na Meta e a chave "Avisos
 * de cobrança pelo Back Office" do produto ligada no Back Office. Antes disso,
 * calar o Asaas deixaria o cliente sem aviso.
 *
 * Uso (com o MESMO env da instalação — Supabase service role + chave do Asaas
 * + Back Office):
 *   pnpm tsx --env-file=<arquivo .env> scripts/asaas-desligar-notificacoes.ts            # simulação
 *   pnpm tsx --env-file=<arquivo .env> scripts/asaas-desligar-notificacoes.ts --aplicar  # de verdade
 */
import { z } from "zod";

import { backofficeLigado } from "@/lib/backoffice/saida";
import { ambienteDoAsaas, cobrancaLigada, desligarNotificacoesDoCliente } from "@/lib/billing/asaas";
import { createAdminClient } from "@/lib/supabase/admin";

const NOME = "asaas-desligar-notificacoes";
const PAGINA = 1000;
/** Pausa entre chamadas: o Asaas limita requisições por minuto por chave. */
const PAUSA_MS = 300;

const argsSchema = z.array(z.enum(["--aplicar"])).max(1);

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function clientesDoAsaas(admin: ReturnType<typeof createAdminClient>): Promise<string[]> {
  const ids = new Set<string>();
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin
      .from("assinaturas")
      .select("asaas_customer_id")
      .not("asaas_customer_id", "is", null)
      .order("organization_id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(`assinaturas: ${error.message}`);
    const linhas = (data ?? []) as Array<{ asaas_customer_id: string | null }>;
    for (const l of linhas) if (l.asaas_customer_id) ids.add(l.asaas_customer_id);
    if (linhas.length < PAGINA) break;
  }
  return [...ids].sort();
}

async function main(): Promise<void> {
  const args = argsSchema.safeParse(process.argv.slice(2));
  if (!args.success) {
    console.error(`uso: tsx scripts/${NOME}.ts [--aplicar]`);
    process.exit(2);
  }
  const aplicar = args.data.includes("--aplicar");

  if (!cobrancaLigada()) {
    console.error("ASAAS_API_KEY vazia: a cobrança está desligada e não há cliente no Asaas para calar.");
    process.exit(1);
  }
  const ambiente = ambienteDoAsaas();
  const admin = createAdminClient();
  const ids = await clientesDoAsaas(admin);

  console.info(`Asaas: ${ambiente} · clientes com assinatura: ${ids.length}`);
  if (!aplicar) {
    for (const id of ids) console.info(`  ${id}`);
    console.info("SIMULAÇÃO — nada foi alterado. Rode com --aplicar para calar o Asaas nesses clientes.");
    return;
  }
  if (!backofficeLigado()) {
    console.error(
      "Recusado: BACKOFFICE_URL/BACKOFFICE_API_KEY vazios. Sem o Back Office, calar o Asaas deixaria o cliente sem aviso de cobrança.",
    );
    process.exit(1);
  }

  let ok = 0;
  const falhas: Array<{ id: string; erro: string }> = [];
  for (const id of ids) {
    try {
      await desligarNotificacoesDoCliente(id);
      ok += 1;
    } catch (e) {
      falhas.push({ id, erro: e instanceof Error ? e.message.slice(0, 200) : "erro" });
    }
    await esperar(PAUSA_MS);
  }

  const { error } = await admin.from("api_audit_log").insert({
    action: "billing.notificacoes_asaas_desligadas",
    resource_type: "asaas_customer",
    bypassed_rls: true,
    metadata: {
      actor: `script:${NOME}`,
      ambiente,
      clientes: ids.length,
      desligados: ok,
      falharam: falhas.length,
      falhas_ids: falhas.map((f) => f.id),
    },
  });
  if (error) console.error(`audit não gravado: ${error.message}`);

  for (const f of falhas) console.error(`  falhou ${f.id}: ${f.erro}`);
  console.info(`Pronto: ${ok} calados, ${falhas.length} falharam (de ${ids.length}).`);
  if (falhas.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
