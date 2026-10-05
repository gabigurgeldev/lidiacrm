/**
 * POST /suporte/v1/identidade/buscar — quais contas um e-mail administra.
 *
 * Lista vazia quando não há conta — nunca 404, nunca outra frase: quem testa
 * e-mails não aprende quais existem. A busca é auditada em CADA organização
 * achada (sem o e-mail em claro), para o dono ver na trilha que alguém pediu
 * acesso pelo suporte.
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { contasPorEmail, erro, lerJson, rotaDeSuporte } from "@/lib/suporte/rota";

export const dynamic = "force-dynamic";

const CorpoSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();

export async function POST(req: Request) {
  return rotaDeSuporte(
    req,
    { auditoria: "suporte.identidade_buscada", recurso: "suporte_identidade" },
    async ({ admin, corpo, requestId }) => {
      const dados = lerJson(corpo, CorpoSchema);
      if (!dados) return erro(422, "params_invalidos", "Informe um e-mail válido.");
      const contas = await contasPorEmail(admin, dados.email);
      for (const c of contas) {
        void audit({
          action: "suporte.identidade_buscada",
          organizationId: c.organization_id,
          resourceType: "suporte_identidade",
          bypassedRls: true,
          requestId,
          metadata: { via: "suporte_v1", papel: c.papel },
        });
      }
      return {
        status: 200,
        body: { contas: contas.map((c) => ({ subject_id: c.organization_id, nome: c.nome, papel: c.papel })) },
      };
    },
  );
}
