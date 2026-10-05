"use client";

import { useT } from "@/hooks/i18n/useT";
/**
 * OS SISTEMAS QUE ESTE ASSISTENTE CONSULTA (Integrações via API, 0223).
 *
 * Mesmo molde de `BasesDoAgente`: a lista vem com a página (nada de piscar
 * vazia), o estado vazio é nomeado, e o que está marcado mas não vai funcionar
 * é dito AQUI — no lugar em que o dono marca — e não descoberto no atendimento.
 *
 * Três avisos, cada um uma configuração que pareceria valer e não vale:
 *   - integração falhando (circuito aberto ou último teste ruim);
 *   - endpoint que exige conta verificada numa integração sem verificação;
 *   - verificação por e-mail sem e-mail configurado na instalação.
 */
import * as React from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { TETO_ENDPOINTS_POR_AGENTE } from "@/lib/ai/integracoes/schema";

export interface EndpointDaIntegracao {
  id: string;
  slug: string;
  titulo: string;
  modo: "leitura" | "acao" | "identidade";
  exige_identidade: boolean;
  ativo: boolean;
}

export interface IntegracaoDoAcervo {
  id: string;
  nome: string;
  identidade_modo: "nenhuma" | "email_otp";
  identidade_endpoint_id: string | null;
  ultimo_teste_ok: boolean | null;
  circuito_aberto_ate: string | null;
  endpoints: EndpointDaIntegracao[];
}

interface Props {
  integracoes: IntegracaoDoAcervo[];
  emailConfigurado: boolean;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

export function IntegracoesDoAgente({ integracoes, emailConfigurado, value, onChange, disabled = false }: Props) {
  const t = useT();
  const marcados = new Set(value);
  // Lido uma vez (estado): render tem de ser puro.
  const [agora] = React.useState(() => Date.now());

  function alternar(id: string, marcado: boolean): void {
    const proximo = new Set(marcados);
    if (marcado) proximo.add(id);
    else proximo.delete(id);
    onChange([...proximo]);
  }

  const visiveis = integracoes
    .map((i) => ({ ...i, endpoints: i.endpoints.filter((e) => e.ativo && e.modo !== "identidade") }))
    .filter((i) => i.endpoints.length > 0);

  const falhando = visiveis.filter(
    (i) =>
      i.endpoints.some((e) => marcados.has(e.id)) &&
      ((i.circuito_aberto_ate !== null && new Date(i.circuito_aberto_ate).getTime() > agora) ||
        i.ultimo_teste_ok === false),
  );
  const semVerificacao = visiveis.filter(
    (i) =>
      i.endpoints.some((e) => marcados.has(e.id) && e.exige_identidade) &&
      (i.identidade_modo !== "email_otp" || !i.identidade_endpoint_id),
  );
  const precisaEmail =
    !emailConfigurado && visiveis.some((i) => i.identidade_modo === "email_otp" && i.endpoints.some((e) => marcados.has(e.id)));
  const acima = value.length > TETO_ENDPOINTS_POR_AGENTE;

  return (
    <Card className="space-y-3 p-4" data-testid="agente-integracoes">
      <div>
        <h3 className="text-sm font-medium">{t("Sistemas que ele consulta")}</h3>
        <p className="text-xs text-muted-foreground">
          {t(
            "Marque o que este assistente pode buscar nos seus sistemas para responder — e as correções que ele pode aplicar. Correção só roda depois que o cliente responde SIM.",
          )}
        </p>
      </div>

      {visiveis.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="agente-sem-integracao">
          {t("Nenhuma integração cadastrada.")}{" "}
          <Link href="/app/ai/integracoes" className="font-medium text-foreground underline underline-offset-4">
            {t("Conectar um sistema")}
          </Link>
        </p>
      ) : (
        <div className="space-y-3">
          {visiveis.map((i) => (
            <div key={i.id} className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{i.nome}</p>
              {i.endpoints.map((e) => (
                <div key={e.id} className="flex items-center gap-2">
                  <input
                    id={`endpoint-${e.id}`}
                    data-testid={`endpoint-${e.id}`}
                    type="checkbox"
                    className="h-4 w-4 shrink-0 rounded border-border accent-primary"
                    checked={marcados.has(e.id)}
                    onChange={(ev) => alternar(e.id, ev.target.checked)}
                    disabled={disabled}
                    aria-label={e.titulo}
                  />
                  <Label htmlFor={`endpoint-${e.id}`} className="text-sm font-normal">
                    {e.titulo}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {e.modo === "acao" ? t("correção, pede SIM") : t("consulta")}
                      {e.exige_identidade ? ` · ${t("exige conta verificada")}` : ""}
                    </span>
                  </Label>
                </div>
              ))}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {value.length} {t("de")} {TETO_ENDPOINTS_POR_AGENTE} {t("marcados")}
          </p>
        </div>
      )}

      {acima ? (
        <p className="text-xs text-destructive">
          {t("Passou do limite de endpoints por agente. Desmarque alguns.")}
        </p>
      ) : null}
      {falhando.map((i) => (
        <p key={`f-${i.id}`} className="text-xs text-warning-fg" data-testid="agente-integracao-falhando">
          &quot;{i.nome}&quot; {t("está falhando — enquanto não voltar, o agente transfere quem precisar dela para a equipe.")}{" "}
          <Link href={`/app/ai/integracoes/${i.id}`} className="font-medium text-foreground underline underline-offset-4">
            {t("Testar conexão")}
          </Link>
        </p>
      ))}
      {semVerificacao.map((i) => (
        <p key={`v-${i.id}`} className="text-xs text-warning-fg" data-testid="agente-integracao-sem-verificacao">
          &quot;{i.nome}&quot;{" "}
          {t("tem consulta que exige conta verificada, mas a integração não faz verificação por e-mail — o agente não vai conseguir usá-la.")}
        </p>
      ))}
      {precisaEmail ? (
        <p className="text-xs text-warning-fg" data-testid="agente-integracao-sem-email">
          {t(
            "A verificação manda um código por e-mail, e o envio de e-mail não está configurado nesta instalação. Sem ele, o agente não consegue confirmar quem é o dono da conta.",
          )}
        </p>
      ) : null}
    </Card>
  );
}
