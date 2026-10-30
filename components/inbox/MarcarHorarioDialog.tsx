"use client";

import { addDays, format } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { PainelDeMarcacao } from "@/components/agenda/PainelDeMarcacao";
import {
  filtrarPorEscolha,
  horariosPorDiaComQuem,
  idsParaMarcar,
  type EscolhaDeProfissionais,
} from "@/components/agenda/profissionais-na-tela";
import { SeletorDeProfissionais } from "@/components/agenda/SeletorDeProfissionais";
import type { Pessoa } from "@/components/agenda/tipos";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useHorariosLivres } from "@/hooks/agenda/useHorariosLivres";
import { useMarcarAgendamento } from "@/hooks/agenda/useMarcarAgendamento";
import { usePessoasDaAgenda } from "@/hooks/agenda/usePessoasDaAgenda";
import { useTiposDeAgendamento, type TipoParaMarcar } from "@/hooks/agenda/useTiposDeAgendamento";
import { useAuth, usePermission } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { rotuloDoLocal } from "@/lib/agenda/locais";
import { cn } from "@/lib/utils";

const SEM_ESCOLHA: EscolhaDeProfissionais = { principalId: null, apoioId: null };

/** Quem pode atender o tipo — a mesma regra da Agenda (`app/app/agenda/_client.tsx`). */
function habilitadasDo(tipo: TipoParaMarcar | null, pessoas: Pessoa[]): Pessoa[] {
  if (!tipo) return [];
  if (tipo.habilitadas.length > 0) return pessoas.filter((p) => tipo.habilitadas.includes(p.id));
  return pessoas.filter((p) => p.userId && p.userId === tipo.donoId);
}

/**
 * MARCAR HORÁRIO A PARTIR DA CONVERSA — o atendente combina com o cliente no
 * WhatsApp e marca ali mesmo, sem abrir a Agenda e procurar o cliente de novo.
 *
 * O cliente e a conversa vêm FIXOS: a conversa é a fonte confiável de "quem é
 * atendido" (e a `fn_agenda_marcar` confere que ela é daquele contato), e é por
 * ela que sai o lembrete. A profissional padrão é QUEM ESTÁ LOGADO, quando faz o
 * serviço; trocar por um colega mostra só os horários livres dele — a agenda do
 * colega continua dele (0249), e quem marcou vê o que marcou.
 *
 * Os horários são os da MESMA rota que a Agenda e a IA usam: a tela do inbox
 * não oferece horário que a escrita recusaria.
 *
 * Fechado, não monta nada: o header e o painel da conversa o carregam o tempo
 * todo, e nenhuma consulta de tipos, pessoas ou horários deve sair enquanto
 * ninguém pediu para marcar. Desmontar ao fechar também zera tipo, escolha e
 * nota — carregá-los para a próxima conversa marcaria o recado de um cliente
 * no horário de outro.
 */
export function MarcarHorarioDialog(props: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  contactId: string;
  contactName: string;
  conversationId: string;
}) {
  return props.open ? <MarcarHorarioAberto {...props} /> : null;
}

function MarcarHorarioAberto({
  open,
  onOpenChange,
  contactId,
  contactName,
  conversationId,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  contactId: string;
  contactName: string;
  conversationId: string;
}) {
  const t = useT();
  const router = useRouter();
  const { user } = useAuth();
  const podeConfigurar = usePermission("agenda.view_all");
  const { data: tipos, isLoading: carregandoTipos } = useTiposDeAgendamento();
  const { data: pessoas = [] } = usePessoasDaAgenda();
  const marcar = useMarcarAgendamento();

  const [tipoId, setTipoId] = React.useState<string | null>(null);
  // `null` = ninguém escolheu à mão: vale o padrão abaixo.
  const [escolhaManual, setEscolhaManual] = React.useState<EscolhaDeProfissionais | null>(null);
  const [notas, setNotas] = React.useState("");

  const tipo = (tipos ?? []).find((x) => x.id === tipoId) ?? tipos?.[0] ?? null;
  const habilitadas = React.useMemo(() => habilitadasDo(tipo, pessoas), [tipo, pessoas]);
  const minha = pessoas.find((p) => p.userId === user.id) ?? null;

  // A própria profissional já vem escolhida quando faz o serviço — o caso comum.
  // Derivado, não efeito: trocar de tipo zera a escolha manual e o padrão volta.
  const souHabilitada = Boolean(
    minha && tipo?.profissionaisNecessarios === 1 && habilitadas.some((p) => p.id === minha.id),
  );
  const escolha: EscolhaDeProfissionais =
    escolhaManual ?? (souHabilitada && minha ? { principalId: minha.id, apoioId: null } : SEM_ESCOLHA);

  // Fechar desmonta (ver `MarcarHorarioDialog`), e com isso tipo, escolha e nota somem.
  const fechar = onOpenChange;

  // Janela estável enquanto o painel está aberto — ver o comentário igual em
  // `app/app/agenda/_client.tsx` (sem isto a chave do React Query muda a cada
  // render). Fixada na montagem, que é a abertura.
  const [janela] = React.useState(() => ({
    de: new Date().toISOString(),
    ate: addDays(new Date(), 30).toISOString(),
  }));
  const { data: horarios, isError: horariosFalharam } = useHorariosLivres(
    open && tipo ? { event_type_id: tipo.id, de: janela.de, ate: janela.ate } : null,
  );

  const horariosPorDia = React.useMemo(() => {
    const nomes = new Map<string, string>(pessoas.map((p) => [p.id, p.nome]));
    for (const p of horarios?.profissionais ?? []) nomes.set(p.id, p.nome);
    return horariosPorDiaComQuem(filtrarPorEscolha(horarios?.slots ?? [], escolha), nomes, {
      dia: (d) => format(d, "yyyy-MM-dd"),
      hora: (d) => format(d, "HH:mm"),
    });
  }, [horarios, escolha, pessoas]);

  const escolhida = pessoas.find((p) => p.id === escolha.principalId) ?? null;
  const ehColega = Boolean(escolhida && escolhida.userId && escolhida.userId !== user.id);

  return (
    <Sheet open={open} onOpenChange={fechar}>
      <SheetContent
        side="right"
        data-testid="marcar-horario-do-inbox"
        className="flex w-full flex-col overflow-y-auto sm:max-w-3xl lg:max-w-[1040px] lg:overflow-hidden"
      >
        <SheetHeader>
          <SheetTitle>{t("Marcar horário")}</SheetTitle>
          <SheetDescription>
            {t("Com")} <span className="font-medium text-text">{contactName}</span> —{" "}
            {t("o lembrete sai por esta conversa.")}
          </SheetDescription>
        </SheetHeader>

        {carregandoTipos ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !tipo ? (
          <div className="mt-6 rounded-md border border-border bg-surface p-4 text-sm" data-testid="sem-tipo-de-agendamento">
            <p className="font-medium">{t("Nenhum tipo de agendamento ativo.")}</p>
            <p className="mt-1 text-text-muted">
              {podeConfigurar ? (
                <>
                  {t("Cadastre o primeiro em")}{" "}
                  <Link href="/app/settings/tenant/agenda" className="underline">
                    {t("Tipos de agendamento")}
                  </Link>
                  .
                </>
              ) : (
                t("Peça à gerência para cadastrar um tipo de agendamento (consulta, visita, reunião).")
              )}
            </p>
          </div>
        ) : (
          <>
            {(tipos ?? []).length > 1 ? (
              <div className="mt-4" data-testid="tipos-de-agendamento">
                <p className="mb-2 text-xs font-medium text-text-muted">{t("Tipo de agendamento")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(tipos ?? []).map((opcao) => (
                    <button
                      key={opcao.id}
                      type="button"
                      data-testid={`tipo-${opcao.id}`}
                      aria-pressed={opcao.id === tipo.id}
                      onClick={() => {
                        setTipoId(opcao.id);
                        // A profissional escolhida pode não fazer o outro serviço.
                        setEscolhaManual(null);
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors duration-fast",
                        opcao.id === tipo.id
                          ? "border-transparent bg-accent text-accent-foreground"
                          : "border-border text-text-muted hover:border-border-strong hover:text-text",
                      )}
                    >
                      {opcao.nome}
                      <span className="ml-1 opacity-70 tabular-nums">{opcao.duracaoMin}min</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 lg:min-h-0 lg:flex-1">
              <PainelDeMarcacao
                className="lg:h-full"
                ancora={new Date()}
                agora={new Date()}
                responsavel={escolhida ?? (habilitadas.length === 1 ? habilitadas[0] : undefined)}
                quemSeraAtendido={{ nome: contactName, aceitaMensagem: true }}
                extras={
                  <>
                    {habilitadas.length !== 1 || tipo.profissionaisNecessarios === 2 ? (
                      <SeletorDeProfissionais
                        habilitadas={habilitadas}
                        necessarias={tipo.profissionaisNecessarios}
                        valor={escolha}
                        onChange={setEscolhaManual}
                      />
                    ) : null}
                    {ehColega ? (
                      <p data-testid="aviso-agenda-do-colega" className="text-[11px] leading-4 text-text-muted">
                        {t("Você vê só os horários livres. O agendamento fica na agenda de")} {escolhida?.nome}{" "}
                        {t("e aparece para você no painel deste cliente.")}
                      </p>
                    ) : null}
                    <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                      {t("Observações")}
                      <textarea
                        data-testid="notas-da-marcacao"
                        value={notas}
                        onChange={(e) => setNotas(e.target.value)}
                        rows={2}
                        maxLength={2000}
                        placeholder={t("Opcional — o que a equipe precisa saber")}
                        className="w-full resize-none rounded-md border border-border bg-surface-elevated p-2 text-sm font-normal text-text outline-none focus:border-border-strong"
                      />
                    </label>
                  </>
                }
                tipo={tipo.nome}
                duracaoMin={tipo.duracaoMin}
                local={rotuloDoLocal(tipo.localKind, tipo.localDetalhes)}
                fuso={horarios?.fuso_da_regra}
                horariosPorDia={horariosPorDia}
                publicouHorarios={horarios?.publicou_horarios ?? true}
                erroAoCarregar={horariosFalharam}
                fusoSuposto={horarios?.fuso_suposto ?? false}
                fontesDefasadas={horarios?.fontes_defasadas}
                onConfirmar={(instante) => {
                  const horario = Object.values(horariosPorDia)
                    .flat()
                    .find((h) => h.instante === instante);
                  const profissionais = idsParaMarcar(escolha, horario ?? {});
                  return marcar.mutateAsync({
                    event_type_id: tipo.id,
                    starts_at: instante,
                    contact_id: contactId,
                    conversation_id: conversationId,
                    ...(profissionais ? { professional_ids: profissionais } : {}),
                    ...(notas.trim() ? { notes: notas.trim() } : {}),
                  });
                }}
                onVerNaAgenda={() => {
                  fechar(false);
                  router.push("/app/agenda");
                }}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
