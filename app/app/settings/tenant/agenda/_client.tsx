"use client";

import { useT } from "@/hooks/i18n/useT";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { LOCAIS_DE_ATENDIMENTO } from "@/lib/agenda/locais";
import { apiClient } from "@/lib/api/client";

export interface TipoRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string;
  duration_minutes: number;
  location_kind: string;
  location_details: string | null;
  default_owner_user_id: string | null;
  requires_confirmation: boolean;
  is_active: boolean;
  /** Quantas pessoas o serviço ocupa ao mesmo tempo (0245): 1, ou principal + apoio. */
  professionals_required: number;
  /** De quanto em quanto tempo os horários são oferecidos; `null` = a própria duração. */
  slot_interval_minutes: number | null;
  reminder_enabled: boolean;
  reminder_minutes_before: number;
  /** As profissionais habilitadas — quem faz este serviço. */
  professional_ids: string[];
}

/** Uma profissional, como o seletor de habilitação a mostra. */
export interface ProfissionalDoTipo {
  id: string;
  nome: string;
  ativo: boolean;
}

/**
 * Os intervalos oferecidos. Vazio = "igual à duração", que é o padrão do banco
 * (`slot_interval_minutes` nulo) e o que a maioria quer: consulta de 30 min a
 * cada 30 min. Intervalo MENOR que a duração é o que permite oferecer 9h, 9h15,
 * 9h30 para um procedimento de uma hora.
 */
const INTERVALOS = [10, 15, 20, 30, 45, 60, 90, 120] as const;

/** A antecedência do lembrete, nas unidades em que a recepção pensa. */
const ANTECEDENCIAS: ReadonlyArray<{ minutos: number; rotulo: string }> = [
  { minutos: 60, rotulo: "1 hora antes" },
  { minutos: 120, rotulo: "2 horas antes" },
  { minutos: 180, rotulo: "3 horas antes" },
  { minutos: 360, rotulo: "6 horas antes" },
  { minutos: 720, rotulo: "12 horas antes" },
  { minutos: 1440, rotulo: "1 dia antes" },
  { minutos: 2880, rotulo: "2 dias antes" },
];

/**
 * As dez do CHECK da tabela, com o nome que o dono do negócio usa.
 *
 * ⚠️ O VALOR é o do banco e o RÓTULO é da tela — e os dois não se misturam. A
 * tabela guarda `reuniao` sem acento porque é chave; quem lê vê "Reunião". Se o
 * rótulo virasse valor, o CHECK recusaria e a recusa apareceria como erro
 * interno para quem está usando.
 */
const CATEGORIAS: Array<{ valor: string; rotulo: string }> = [
  { valor: "consulta", rotulo: "Consulta" },
  { valor: "procedimento", rotulo: "Procedimento" },
  { valor: "retorno", rotulo: "Retorno" },
  { valor: "visita", rotulo: "Visita" },
  { valor: "vistoria", rotulo: "Vistoria" },
  { valor: "reuniao", rotulo: "Reunião" },
  { valor: "call", rotulo: "Call" },
  { valor: "orcamento", rotulo: "Orçamento" },
  { valor: "demonstracao", rotulo: "Demonstração" },
  { valor: "outro", rotulo: "Outro" },
];

// Fonte única: a tela que MARCA precisa do mesmo vocabulário, e copiá-lo para lá
// faria uma das duas mostrar o código cru no dia em que um valor entrasse no
// CHECK do banco. Ver o cabeçalho de `lib/agenda/locais.ts`.
const LOCAIS = LOCAIS_DE_ATENDIMENTO;

const rotuloDe = (lista: ReadonlyArray<{ valor: string; rotulo: string }>, valor: string) =>
  lista.find((c) => c.valor === valor)?.rotulo ?? valor;

interface Rascunho {
  name: string;
  category: string;
  duration_minutes: number;
  location_kind: string;
  default_owner_user_id: string;
  professionals_required: 1 | 2;
  professional_ids: string[];
}

const VAZIO: Rascunho = {
  name: "",
  category: "consulta",
  duration_minutes: 30,
  location_kind: "in_person",
  default_owner_user_id: "",
  professionals_required: 1,
  professional_ids: [],
};

/**
 * QUEM FAZ ESTE SERVIÇO — uma caixa por profissional ativa.
 *
 * É a habilitação da 0245: o horário livre do tipo é a união da agenda das
 * habilitadas, e marcar com quem não está aqui é recusado com 422. Nenhuma
 * marcada = o tipo segue o responsável padrão, como antes da 0245.
 *
 * `name` repetido para o `FormData.getAll` do formulário de edição; o de criação
 * é controlado e usa `onChange`. As duas formas do mesmo campo porque os dois
 * formulários já eram assim — não é hora de trocar o de edição.
 */
function CaixasDeProfissionais({
  profissionais,
  marcadas,
  onChange,
  testid,
}: {
  profissionais: ProfissionalDoTipo[];
  marcadas: string[];
  onChange?: (ids: string[]) => void;
  testid: string;
}) {
  const t = useT();
  const ativas = profissionais.filter((p) => p.ativo || marcadas.includes(p.id));
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid={testid}>
      <legend className="mb-1 text-xs font-medium text-text-muted">{t("Profissionais que fazem este serviço")}</legend>
      {ativas.length === 0 ? (
        <p className="text-xs text-text-subtle">
          {t("Nenhuma profissional cadastrada.")}{" "}
          <Link
            href="/app/settings/tenant/agenda/profissionais"
            className="font-medium text-accent underline underline-offset-2"
          >
            {t("Cadastrar profissionais")}
          </Link>
        </p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {ativas.map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 text-sm text-text">
              <input
                type="checkbox"
                name="professional_ids"
                value={p.id}
                data-testid={`${testid}-${p.id}`}
                {...(onChange
                  ? {
                      checked: marcadas.includes(p.id),
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                        onChange(
                          e.target.checked ? [...marcadas, p.id] : marcadas.filter((x) => x !== p.id),
                        ),
                    }
                  : { defaultChecked: marcadas.includes(p.id) })}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              {p.nome}
              {!p.ativo ? <span className="text-[11px] text-text-subtle">({t("desativada")})</span> : null}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export function TiposDeAgendamentoClient({
  tiposIniciais,
  pessoas,
  profissionais,
  podeEditar,
  usuarioAtualId,
}: {
  tiposIniciais: TipoRow[];
  pessoas: Array<{ id: string; papel: string; nome: string }>;
  profissionais: ProfissionalDoTipo[];
  podeEditar: boolean;
  usuarioAtualId: string;
}) {
  const t = useT();
  const router = useRouter();
  const [criando, setCriando] = React.useState(false);
  /**
   * O RASCUNHO NASCE COM QUEM ESTÁ CRIANDO.
   *
   * O tipo nascia sem dono por padrão DA PRÓPRIA TELA: `VAZIO` trazia
   * `default_owner_user_id: ""`, o POST omitia o campo, a coluna não tem default
   * no banco — e a lista passava a acusar "sem responsável — não aparece para
   * marcar", um estado que a tela mesma fabricou. Foi assim que "Call
   * Estratégica" nasceu inútil na instalação do dono do produto.
   *
   * A migration 0195 não alcança este caso por construção: o trigger dela é
   * `after insert on user_organizations`, guardado ao PRIMEIRO membro ativo. Ele
   * dispara quando entra MEMBRO, nunca quando entra TIPO — e a org do dono já
   * tinha membro havia tempo.
   *
   * O default vive AQUI e não no POST de propósito: forçar o criador na rota
   * transformaria "Definir depois" num controle decorativo, e deixar um tipo sem
   * dono continua sendo escolha legítima de quem opera.
   */
  const [rascunho, setRascunho] = React.useState<Rascunho>(() => ({
    ...VAZIO,
    default_owner_user_id: usuarioAtualId,
  }));
  const [salvando, setSalvando] = React.useState(false);
  const [editandoId, setEditandoId] = React.useState<string | null>(null);

  async function comErro(acao: () => Promise<unknown>, mensagem: string) {
    setSalvando(true);
    try {
      await acao();
      toast.success(mensagem);
      // `refresh` e não estado local: quem sabe o que ficou gravado é o servidor.
      router.refresh();
      return true;
    } catch (err) {
      showApiError(err);
      return false;
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="tipos-de-agendamento-config">
      {podeEditar ? (
        <div>
          {criando ? (
            <form
              data-testid="form-novo-tipo"
              className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const feito = await comErro(
                  () =>
                    apiClient.post("/api/v1/agenda/tipos", {
                      name: rascunho.name.trim(),
                      category: rascunho.category,
                      duration_minutes: Number(rascunho.duration_minutes),
                      location_kind: rascunho.location_kind,
                      ...(rascunho.default_owner_user_id
                        ? { default_owner_user_id: rascunho.default_owner_user_id }
                        : {}),
                      professionals_required: rascunho.professionals_required,
                      // Só quando escolhido: omitir deixa a rota habilitar o
                      // responsável padrão, que é o comportamento de antes.
                      ...(rascunho.professional_ids.length > 0
                        ? { professional_ids: rascunho.professional_ids }
                        : {}),
                    }),
                  t("Tipo de agendamento criado."),
                );
                if (feito) {
                  setCriando(false);
                  setRascunho({ ...VAZIO, default_owner_user_id: usuarioAtualId });
                }
              }}
            >
              <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                {t("Nome")}
                <input
                  data-testid="novo-tipo-nome"
                  required
                  minLength={2}
                  value={rascunho.name}
                  onChange={(e) => setRascunho((r) => ({ ...r, name: e.target.value }))}
                  placeholder={t("Retorno")}
                  className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text outline-none focus:border-border-strong"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                {t("Categoria")}
                <select
                  data-testid="novo-tipo-categoria"
                  value={rascunho.category}
                  onChange={(e) => setRascunho((r) => ({ ...r, category: e.target.value }))}
                  className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text outline-none focus:border-border-strong"
                >
                  {CATEGORIAS.map((c) => (
                    <option key={c.valor} value={c.valor}>
                      {t(c.rotulo)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                {t("Duração (minutos)")}
                <input
                  data-testid="novo-tipo-duracao"
                  type="number"
                  min={5}
                  max={1440}
                  value={rascunho.duration_minutes}
                  onChange={(e) =>
                    setRascunho((r) => ({ ...r, duration_minutes: Number(e.target.value) }))
                  }
                  className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text outline-none focus:border-border-strong"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                {t("Onde acontece")}
                <select
                  data-testid="novo-tipo-local"
                  value={rascunho.location_kind}
                  onChange={(e) => setRascunho((r) => ({ ...r, location_kind: e.target.value }))}
                  className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text outline-none focus:border-border-strong"
                >
                  {LOCAIS.map((l) => (
                    <option key={l.valor} value={l.valor}>
                      {l.rotulo}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-text-muted sm:col-span-2">
                {/* ⚠️ SEM RESPONSÁVEL NÃO HÁ AGENDA. `lib/agenda/consulta.ts` exige
                    dono para saber de QUEM é a jornada; sem ele a rota devolve
                    `sem_responsavel` e a tela de marcar não oferece horário nenhum.
                    Era exatamente o estado dos três tipos semeados. */}
                {t("Quem atende (sem isto, não há horário para oferecer)")}
                <select
                  data-testid="novo-tipo-dono"
                  value={rascunho.default_owner_user_id}
                  onChange={(e) =>
                    setRascunho((r) => ({ ...r, default_owner_user_id: e.target.value }))
                  }
                  className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text outline-none focus:border-border-strong"
                >
                  <option value="">{t("Definir depois")}</option>
                  {pessoas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                {t("Pessoas por atendimento")}
                <select
                  data-testid="novo-tipo-necessarias"
                  value={rascunho.professionals_required}
                  onChange={(e) =>
                    setRascunho((r) => ({ ...r, professionals_required: e.target.value === "2" ? 2 : 1 }))
                  }
                  className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text outline-none focus:border-border-strong"
                >
                  <option value="1">{t("Uma profissional")}</option>
                  <option value="2">{t("Duas — principal e apoio")}</option>
                </select>
              </label>
              <div className="sm:col-span-2">
                <CaixasDeProfissionais
                  profissionais={profissionais}
                  marcadas={rascunho.professional_ids}
                  onChange={(ids) => setRascunho((r) => ({ ...r, professional_ids: ids }))}
                  testid="novo-tipo-profissionais"
                />
              </div>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setCriando(false)}>
                  {t("Cancelar")}
                </Button>
                <Button type="submit" size="sm" data-testid="salvar-novo-tipo" disabled={salvando}>
                  {salvando ? t("Criando…") : t("Criar tipo")}
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" data-testid="abrir-novo-tipo" onClick={() => setCriando(true)}>
              {t("Novo tipo de agendamento")}
            </Button>
          )}
        </div>
      ) : null}

      <ul className="flex flex-col gap-2" data-testid="lista-de-tipos">
        {tiposIniciais.length === 0 ? (
          <li data-testid="sem-tipos" className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
            {t("Nenhum tipo de agendamento ainda. Crie o primeiro para que a Agenda tenha o que oferecer.")}
          </li>
        ) : null}
        {tiposIniciais.map((tipo) => (
          <li
            key={tipo.id}
            data-testid={`tipo-${tipo.id}`}
            className={`rounded-lg border border-border bg-surface p-3 ${tipo.is_active ? "" : "opacity-60"}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-text">{t(tipo.name)}</span>
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">
                {rotuloDe(CATEGORIAS, tipo.category)}
              </span>
              <span className="text-xs tabular-nums text-text-muted">{tipo.duration_minutes} min</span>
              <span className="text-xs text-text-muted">{rotuloDe(LOCAIS, tipo.location_kind)}</span>
              {tipo.professionals_required === 2 ? (
                <span
                  data-testid={`duas-pessoas-${tipo.id}`}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted"
                >
                  {t("principal + apoio")}
                </span>
              ) : null}
              {tipo.professional_ids.length > 0 ? (
                <span className="text-xs text-text-muted" data-testid={`habilitadas-${tipo.id}`}>
                  {t("com")}{" "}
                  {tipo.professional_ids
                    .map((id) => profissionais.find((p) => p.id === id)?.nome)
                    .filter(Boolean)
                    .join(", ")}
                </span>
              ) : null}
              {tipo.reminder_enabled ? (
                <span className="text-xs text-text-subtle" data-testid={`lembrete-${tipo.id}`}>
                  {t("lembrete")}{" "}
                  {t(
                    ANTECEDENCIAS.find((a) => a.minutos === tipo.reminder_minutes_before)?.rotulo ??
                      "antes do horário",
                  )}
                </span>
              ) : null}
              {/* SEM QUEM ATENDA = sem dono E sem habilitada. Com habilitada, o
                  motor da 0245 já tem de quem ler a jornada. */}
              {!tipo.default_owner_user_id && tipo.professional_ids.length === 0 ? (
                // O aviso existe porque o sintoma é MUDO: sem dono, a tela de
                // marcar simplesmente não mostra horário, sem dizer por quê.
                //
                // E ele É A PORTA quando há como resolver. Antes era um `<span>`
                // inerte: acusava o estado e a única saída era descobrir sozinho
                // que o botão "Editar" abre um seletor de responsável. Acusar sem
                // oferecer caminho é o mesmo defeito do aviso da Agenda que não
                // levava aos horários — dito duas vezes no mesmo produto.
                //
                // Mesmo `data-testid` nos dois ramos: ele é contrato de quem lê a
                // tela, e trocá-lo faria a cerca existente parar de encontrar o
                // aviso sem nada acusar.
                podeEditar ? (
                  <button
                    type="button"
                    data-testid={`sem-dono-${tipo.id}`}
                    onClick={() => setEditandoId(tipo.id)}
                    className="text-xs text-warning underline underline-offset-2 hover:text-warning/80"
                  >
                    {t("sem responsável — definir quem atende")}
                  </button>
                ) : (
                  <span data-testid={`sem-dono-${tipo.id}`} className="text-xs text-warning">
                    {t("sem responsável — não aparece para marcar")}
                  </span>
                )
              ) : null}
              {!tipo.is_active ? <span className="text-xs text-text-subtle">{t("desativado")}</span> : null}
              {podeEditar ? (
                <span className="ml-auto flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`editar-${tipo.id}`}
                    onClick={() => setEditandoId(editandoId === tipo.id ? null : tipo.id)}
                  >
                    {editandoId === tipo.id ? t("Fechar") : t("Editar")}
                  </Button>
                  {tipo.is_active ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`desativar-${tipo.id}`}
                      disabled={salvando}
                      onClick={() =>
                        void comErro(
                          () => apiClient.delete("/api/v1/agenda/tipos", { id: tipo.id }),
                          t("Tipo desativado."),
                        )
                      }
                    >
                      {t("Desativar")}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`reativar-${tipo.id}`}
                      disabled={salvando}
                      onClick={() =>
                        void comErro(
                          () => apiClient.patch("/api/v1/agenda/tipos", { id: tipo.id, is_active: true } as never),
                          t("Tipo reativado."),
                        )
                      }
                    >
                      {t("Reativar")}
                    </Button>
                  )}
                </span>
              ) : null}
            </div>

            {editandoId === tipo.id ? (
              <form
                data-testid={`form-editar-${tipo.id}`}
                className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const dados = new FormData(e.currentTarget);
                  const feito = await comErro(
                    () =>
                      apiClient.patch("/api/v1/agenda/tipos", {
                        id: tipo.id,
                        name: String(dados.get("name") ?? "").trim(),
                        category: String(dados.get("category") ?? tipo.category),
                        duration_minutes: Number(dados.get("duration_minutes") ?? tipo.duration_minutes),
                        // `|| null`, e NÃO omitir quando vazio.
                        //
                        // A tela oferece `<option value="">{t("Sem responsável")}</option>`
                        // logo abaixo, e omitir o campo fazia essa escolha não
                        // chegar ao servidor: depois de definido, o responsável não
                        // podia mais ser removido. Controle que a tela oferece e o
                        // código ignora é o pior dos dois — pior que não existir,
                        // porque quem clica conclui que salvou.
                        //
                        // `alterarSchema` aceita `nullish()`, então o nulo é
                        // contrato, não contorno. O efeito de limpar é a agenda
                        // daquele tipo parar de oferecer horário e o aviso amarelo
                        // voltar — que é o laço de retorno correto.
                        //
                        // ⚠️ E SÓ QUANDO MUDOU (0245). A rota trata "gravar o
                        // responsável" como "habilitar a profissional dele" — e,
                        // reenviado a cada salvar, o dono voltava marcado em
                        // "Profissionais que fazem este serviço" toda vez que
                        // alguém o desmarcava. Mandar só a mudança mantém as duas
                        // escolhas independentes; limpar continua chegando como nulo.
                        ...((String(dados.get("default_owner_user_id") ?? "") || null) !==
                        tipo.default_owner_user_id
                          ? { default_owner_user_id: String(dados.get("default_owner_user_id") ?? "") || null }
                          : {}),
                        professionals_required: dados.get("professionals_required") === "2" ? 2 : 1,
                        // Vazio = "igual à duração" — e o nulo é contrato, não
                        // ausência: omitir faria a escolha não chegar ao banco,
                        // o mesmo defeito do responsável logo acima.
                        slot_interval_minutes: Number(dados.get("slot_interval_minutes") ?? "") || null,
                        // O CONJUNTO inteiro, sempre: a rota substitui. Mandar só
                        // quando mudou exigiria comparar, e desmarcar a última
                        // caixa precisa chegar como lista vazia.
                        professional_ids: dados.getAll("professional_ids").map(String),
                        reminder_enabled: dados.get("reminder_enabled") === "on",
                        reminder_minutes_before: Number(
                          dados.get("reminder_minutes_before") ?? tipo.reminder_minutes_before,
                        ),
                      }),
                    t("Tipo alterado."),
                  );
                  if (feito) setEditandoId(null);
                }}
              >
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                  {t("Nome")}
                  <input
                    name="name"
                    defaultValue={tipo.name}
                    data-testid={`editar-nome-${tipo.id}`}
                    className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                  {t("Duração")}
                  <input
                    name="duration_minutes"
                    type="number"
                    min={5}
                    max={1440}
                    defaultValue={tipo.duration_minutes}
                    data-testid={`editar-duracao-${tipo.id}`}
                    className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                  {t("Quem atende")}
                  <select
                    name="default_owner_user_id"
                    defaultValue={tipo.default_owner_user_id ?? ""}
                    data-testid={`editar-dono-${tipo.id}`}
                    className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
                  >
                    <option value="">{t("Sem responsável")}</option>
                    {pessoas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                  {t("Pessoas por atendimento")}
                  <select
                    name="professionals_required"
                    defaultValue={String(tipo.professionals_required)}
                    data-testid={`editar-necessarias-${tipo.id}`}
                    className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
                  >
                    <option value="1">{t("Uma profissional")}</option>
                    <option value="2">{t("Duas — principal e apoio")}</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                  {t("Horários oferecidos a cada")}
                  <select
                    name="slot_interval_minutes"
                    defaultValue={tipo.slot_interval_minutes ? String(tipo.slot_interval_minutes) : ""}
                    data-testid={`editar-intervalo-${tipo.id}`}
                    className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
                  >
                    <option value="">{t("Igual à duração")}</option>
                    {/* O valor gravado sempre aparece, mesmo fora da lista — senão
                        abrir e salvar trocaria um intervalo que ninguém tocou. */}
                    {[...new Set([...INTERVALOS, ...(tipo.slot_interval_minutes ? [tipo.slot_interval_minutes] : [])])]
                      .sort((a, b) => a - b)
                      .map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                  </select>
                </label>
                <div className="flex flex-col gap-1 text-xs text-text-muted">
                  <span>{t("Lembrete no WhatsApp")}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="reminder_enabled"
                      defaultChecked={tipo.reminder_enabled}
                      data-testid={`editar-lembrete-${tipo.id}`}
                      aria-label={t("Enviar lembrete ao cliente")}
                      className="h-4 w-4 accent-[var(--color-accent)]"
                    />
                    <select
                      name="reminder_minutes_before"
                      defaultValue={String(tipo.reminder_minutes_before)}
                      data-testid={`editar-antecedencia-${tipo.id}`}
                      aria-label={t("Antecedência do lembrete")}
                      className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
                    >
                      {ANTECEDENCIAS.some((a) => a.minutos === tipo.reminder_minutes_before) ? null : (
                        <option value={tipo.reminder_minutes_before}>
                          {tipo.reminder_minutes_before} {t("min antes")}
                        </option>
                      )}
                      {ANTECEDENCIAS.map((a) => (
                        <option key={a.minutos} value={a.minutos}>
                          {t(a.rotulo)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="sm:col-span-3">
                  <CaixasDeProfissionais
                    profissionais={profissionais}
                    marcadas={tipo.professional_ids}
                    testid={`editar-profissionais-${tipo.id}`}
                  />
                </div>
                <div className="flex justify-end sm:col-span-3">
                  <Button type="submit" size="sm" data-testid={`salvar-${tipo.id}`} disabled={salvando}>
                    {salvando ? t("Salvando…") : t("Salvar")}
                  </Button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
