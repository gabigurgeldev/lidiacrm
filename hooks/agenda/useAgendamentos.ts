"use client";

import { useQuery } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { AgendamentoListado as AgendamentoDoContrato } from "@/lib/agenda/contrato";
import { ORIGENS_DO_AGENDAMENTO, type OrigemDoAgendamento } from "@/lib/agenda/tipos";
import { apiClient } from "@/lib/api/client";

import type { Agendamento } from "@/components/agenda/tipos";

/**
 * A forma que a rota devolve — lida do CÓDIGO dela, não da descrição.
 *
 * Os campos são `iniciaEm`/`terminaEm`/`donoId`, e não o `snake_case` que a
 * mensagem de handoff sugeria. Escrever contra o que uma mensagem descreve já me
 * custou duas vezes hoje (um import contra nome mencionado, uma frase de erro
 * contra o nome do código). O SHA da branch estava alcançável, então li lá.
 *
 * ⚠️ OS CAMPOS DA MIGRATION 0245 CHEGAM OPCIONAIS AQUI, de propósito. O contrato
 * (`lib/agenda/contrato.ts`) os declara obrigatórios, e a rota nova os manda;
 * mas um servidor mais velho que o cliente (a VPS atualiza a imagem, o browser
 * ainda tem o bundle anterior em cache, ou o contrário) não os teria — e o
 * mapeamento abaixo degrada para o comportamento de antes em vez de quebrar.
 */
type AgendamentoListado = Omit<
  AgendamentoDoContrato,
  "profissionais" | "eventTypeId" | "origem" | "autor" | "conversaId"
> &
  Partial<Pick<AgendamentoDoContrato, "profissionais" | "eventTypeId" | "origem" | "autor" | "conversaId">>;

export interface RecorteDaGrade {
  /** INSTANTE ISO com offset — nunca o filtro `dia`. Ver o comentário abaixo. */
  de: string;
  ate: string;
  owner_user_id?: string;
  /** Só os compromissos em que esta profissional atende (principal OU apoio). */
  professional_id?: string;
}

/**
 * A ORIGEM DE VERDADE, e não `"ui"` fixo.
 *
 * Isto era `origem: "ui" as const` para TODO compromisso — e era o defeito que o
 * plano da 0245 lista entre os consertos de tela: o que a IA marcou e o que veio
 * do Google desenhavam igual ao que a equipe marcou, e o selo "marcado pela IA"
 * não tinha como existir. Valor fora do vocabulário cai em `"ui"`, que é o que
 * a tela sempre supôs: degradar para o antigo, nunca para um selo inventado.
 */
function origemDe(valor: string | undefined): OrigemDoAgendamento {
  return (ORIGENS_DO_AGENDAMENTO as readonly string[]).includes(valor ?? "")
    ? (valor as OrigemDoAgendamento)
    : "ui";
}

/** O item da rota, na forma que a grade desenha. Exportado para o teste de travessia. */
export function paraAGrade(a: AgendamentoListado): Agendamento {
  const principal = a.profissionais?.find((p) => p.papel === "principal");
  const apoio = a.profissionais?.find((p) => p.papel === "apoio");
  return {
    id: a.id,
    titulo: a.titulo,
    // A PRINCIPAL, quando a rota já fala de profissionais. Sem participante
    // (agendamento anterior à 0245 que o backfill não alcançou, ou servidor
    // velho), o dono — que `responsavelDaGrade` traduz para a profissional dele.
    responsavelId: principal?.id ?? a.donoId ?? "",
    ...(apoio ? { apoioId: apoio.id } : {}),
    comeca: a.iniciaEm,
    termina: a.terminaEm,
    origem: origemDe(a.origem),
    situacao: a.situacao as Agendamento["situacao"],
    // Sem esta linha, montar o hook REGREDIRIA o conserto do "com quem":
    // a prop do servidor traz o nome, e o refetch o apagaria da grade.
    // Campo novo é optional e a rota pode ainda não mandá-lo — `?? undefined`
    // mantém o wire tolerante a servidor mais velho que o cliente.
    quemSeraAtendido: a.contatoNome ?? undefined,
    ...(a.contatoId ? { contatoId: a.contatoId } : {}),
    ...(a.eventTypeId ? { eventTypeId: a.eventTypeId } : {}),
    ...(a.conversaId ? { conversaId: a.conversaId } : {}),
  };
}

/**
 * Os agendamentos de um período.
 *
 * ## Por que `de`/`ate` e NUNCA `dia`
 *
 * A rota também aceita `dia=YYYY-MM-DD`, e ele corta em **UTC**. Medido pelo
 * autor enquanto escrevia: para America/Sao_Paulo, pedir o dia 12 devolve de
 * 11/03 21:00 a 12/03 20:59 na parede de quem olha — três horas do dia anterior
 * ENTRAM, e as três últimas do dia pedido FICAM DE FORA. Um compromisso das 22h
 * some da lista do próprio dia.
 *
 * Mandando INSTANTE, quem calcula o começo e o fim é a tela, no fuso de
 * APRESENTAÇÃO — o mesmo `AuthUser.timezone` que a página já resolve. A rota não
 * precisa adivinhar em que fuso o dia foi pedido, e o instante vira a moeda
 * entre a regra (num fuso) e a apresentação (noutro).
 *
 * E a grade é semanal/mensal: o filtro por dia exigiria sete requisições para
 * desenhar uma semana, mesmo se o fuso não fosse problema.
 *
 * ## O 422 sem recorte NÃO é erro de sistema
 *
 * Sem período, a rota devolve 422 `agenda_listagem_sem_recorte` em vez de lista
 * vazia — e está certa: vazio faria a grade dizer "nada marcado" quando a
 * verdade é que a pergunta não tinha alvo. Por isso `enabled` só dispara com o
 * recorte montado: um 422 previsível não deve virar toast na cara de quem abriu
 * a tela.
 */
export function useAgendamentos(recorte: RecorteDaGrade | null) {
  return useQuery({
    queryKey: ["agenda", "agendamentos", recorte],
    enabled: recorte !== null,
    queryFn: async (): Promise<Agendamento[]> => {
      const qs = new URLSearchParams({ de: recorte!.de, ate: recorte!.ate });
      if (recorte!.owner_user_id) qs.set("owner_user_id", recorte!.owner_user_id);
      if (recorte!.professional_id) qs.set("professional_id", recorte!.professional_id);
      try {
        const r = await apiClient.get<{ data: AgendamentoListado[] }>(
          `/api/v1/agenda/agendamentos?${qs.toString()}`,
        );
        const lista =
          (r as unknown as { data?: AgendamentoListado[] }).data ??
          (r as unknown as AgendamentoListado[]);
        return (lista ?? []).map(paraAGrade);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
  });
}
