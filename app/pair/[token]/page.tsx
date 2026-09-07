import { marcaDaSaida } from "@/lib/branding/saida";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

import { PareamentoClient } from "./_components/PareamentoClient";

/**
 * A página que o DONO DO NÚMERO abre — fora do CRM, sem login.
 *
 * ─── Por que não vive em `(public)` ────────────────────────────────────────
 *
 * Aquele grupo é a casca de ACESSO (login, cadastro, MFA): `max-w-sm`, estreito
 * para um formulário. Aqui cabem um QR de 16rem, três passos e um aviso de
 * privacidade — e a `logo-da-fachada` daquele layout é vigiada por spec de
 * marca que fala sobre telas de acesso. Herdá-la traria a spec junto, medindo
 * uma tela que não é a dela.
 *
 * ─── Por que a marca aparece, mas a organização não ────────────────────────
 *
 * Quem abre isto é o cliente do operador, e ele precisa reconhecer de quem é a
 * página — daí `marcaDaSaida(null)`, a mesma resolução sem DOM usada em e-mail.
 * O que ele NÃO vê é qualquer dado do tenant: nome da empresa, telefone, id do
 * canal. O apelido da linha aparece, e só, para ele conferir que está
 * conectando o número certo.
 *
 * `null` porque não há organização resolvida aqui: quem entra não tem sessão. O
 * resolvedor degrada para o padrão do produto e nunca lança (doutrina de marca
 * própria) — um throw aqui seria 500 na única tela que o cliente vê.
 */
export const dynamic = "force-dynamic";

export default async function PaginaDePareamento({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const marca = await marcaDaSaida(null);

  return (
    <IdiomaProvider locale={null}>
      <div className="flex min-h-screen justify-center bg-background p-4 sm:p-6">
        <div className="w-full max-w-xl space-y-4">
          <div className="flex items-center gap-3">
            {marca.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-testid="logo-do-pareamento"
                src={marca.logoUrl}
                alt={marca.nome}
                className="h-8 w-auto max-w-[10rem] object-contain"
              />
            )}
            <span className="text-sm font-medium text-muted-foreground">{marca.nome}</span>
          </div>
          <PareamentoClient token={token} />
        </div>
      </div>
    </IdiomaProvider>
  );
}
