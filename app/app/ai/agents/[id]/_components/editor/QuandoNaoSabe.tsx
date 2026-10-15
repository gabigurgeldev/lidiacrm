"use client";
import { Campo, Dica, Grupo, Segmentado } from "@/components/ajustes";
import { useQuandoNaoSabe, useSalvarQuandoNaoSabe } from "@/hooks/ai/useQuandoNaoSabe";
import { useT } from "@/hooks/i18n/useT";
import { resolverModoSemFonte } from "@/lib/agent-engine/agent/modo-sem-fonte";
import type { ModoSemFonte } from "@/lib/schemas/settings";

/**
 * "Quando o agente não souber responder" — o modo de fallback da ORGANIZAÇÃO.
 *
 * Mora no editor do agente porque é aqui que o dono pensa nisso, mas não é
 * campo da versão: grava na hora, em `organizations.settings.ai`, e vale para
 * todos os agentes. A tela diz as duas coisas, senão o dono procura o efeito no
 * "Publicar" e acha que não salvou.
 *
 * Sem escolha, mostra o que vale HOJE e por quê — uma opção marcada que ninguém
 * escolheu, sem explicação, é a tela mentindo sobre de onde veio a decisão.
 */
export function QuandoNaoSabe({ handoffLigado, disabled }: { handoffLigado: boolean; disabled: boolean }) {
  const t = useT();
  const { data, isLoading } = useQuandoNaoSabe();
  const salvar = useSalvarQuandoNaoSabe();

  if (isLoading || data === undefined) return null;

  const resolvido = resolverModoSemFonte({
    escolhaDaOrg: data.escolha ?? undefined,
    equipeConfigurada: data.equipe_configurada,
    handoffDisponivel: handoffLigado,
  });

  const porque =
    resolvido.origem === "sem_ferramenta_de_passagem"
      ? t("Este agente não pode chamar uma pessoa (a opção acima está desligada), então ele diz que não sabe e segue.")
      : resolvido.origem === "escolha"
        ? null
        : resolvido.origem === "equipe_configurada"
          ? t("Ainda não escolhido: hoje o agente chama a equipe, porque há gente com disponibilidade cadastrada para atender.")
          : t("Ainda não escolhido: hoje o agente diz que não sabe, porque ninguém tem disponibilidade cadastrada para atender.");

  return (
    <Grupo
      titulo={t("Quando o agente não souber responder")}
      rodape={t(
        "Vale para todos os agentes da empresa e é salvo na hora. O agente só afirma o que está no material, nas ferramentas ou nas instruções dele — o resto ele nunca inventa.",
      )}
      testid="quando-nao-sabe"
    >
      <Campo rotulo={t("O que fazer quando o material não tem a resposta")}>
        <Segmentado<ModoSemFonte>
          valor={resolvido.modo}
          aoMudar={(v) => salvar.mutate({ fallback_sem_fonte: v })}
          rotuloAcessivel={t("Quando o agente não souber responder")}
          desabilitado={disabled || salvar.isPending || !handoffLigado}
          testid="quando-nao-sabe-modo"
          opcoes={[
            { valor: "equipe", rotulo: t("Chamar alguém da equipe"), testid: "quando-nao-sabe-equipe" },
            { valor: "so_agente", rotulo: t("Dizer que não sabe e seguir"), testid: "quando-nao-sabe-so-agente" },
          ]}
        />
        {porque !== null ? <Dica texto={porque} /> : null}
        {salvar.isError ? <Dica texto={t("Não foi possível salvar. Tente de novo.")} /> : null}
      </Campo>
    </Grupo>
  );
}
