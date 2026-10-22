"use client";

import { format } from "date-fns";
import * as React from "react";

import { GATILHO_DA_ABA, SEGMENTADO_ABAS } from "@/components/ajustes";
import { AvatarDaPessoa } from "@/components/agenda/AvatarDaPessoa";
import { EditorDeJornada, resumoDaJornada, type JornadaEditavel } from "@/components/agenda/EditorDeJornada";
import { TRILHAS } from "@/components/agenda/paleta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFolgas, useLancarFolga, useRemoverFolga, type Folga } from "@/hooks/agenda/useFolgas";
import { pessoasDe } from "@/hooks/agenda/usePessoasDaAgenda";
import {
  useDesativarProfissional,
  useProfissionais,
  useSalvarProfissional,
  type ProfissionalDaApi,
} from "@/hooks/agenda/useProfissionais";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import type { TrilhaDaAgenda } from "@/lib/agenda/tipos";
import { Plus, Trash } from "@/lib/ui/icons";

/** O fuso de quem nunca escolheu um — o mesmo padrão do editor de Equipe. */
const FUSO_PADRAO = "America/Sao_Paulo";

const CAMPO =
  "h-9 rounded-md border border-border bg-surface-elevated px-2 text-sm text-text outline-none focus:border-border-strong";

interface Membro {
  id: string;
  nome: string;
}

interface TipoResumo {
  id: string;
  nome: string;
  ativo: boolean;
}

/** "HH:MM" → minutos desde a meia-noite; vazio = nulo. */
function minutosDe(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function hhmmDe(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

/**
 * A tela de Profissionais. A lista mostra o essencial de cada uma (cor, se tem
 * login, a jornada em uma linha, os serviços); o resto — dados, jornada, folgas,
 * serviços — abre numa folha lateral, uma aba por pergunta.
 */
export function ProfissionaisClient({
  podeEditar,
  usuarioAtualId,
  membros,
  tipos,
}: {
  podeEditar: boolean;
  usuarioAtualId: string;
  membros: Membro[];
  tipos: TipoResumo[];
}) {
  const t = useT();
  const { data: profissionais, isLoading, isError } = useProfissionais();
  const [criando, setCriando] = React.useState(false);
  const [abertaId, setAbertaId] = React.useState<string | null>(null);

  const lista = profissionais ?? [];
  // A cor que a AGENDA mostra — a mesma derivação, para a pessoa se reconhecer.
  const corPorId = new Map(pessoasDe(lista.map((p) => ({ ...p, ativo: true }))).map((p) => [p.id, p.trilha]));
  const aberta = lista.find((p) => p.id === abertaId) ?? null;
  const vinculados = new Set(lista.map((p) => p.user_id).filter(Boolean));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="profissionais-da-agenda">
      {podeEditar ? (
        criando ? (
          <FormularioNova
            membrosLivres={membros.filter((m) => !vinculados.has(m.id))}
            onFechar={() => setCriando(false)}
          />
        ) : (
          <div>
            <Button size="sm" data-testid="nova-profissional" onClick={() => setCriando(true)}>
              <Plus size={16} aria-hidden />
              {t("Nova profissional")}
            </Button>
          </div>
        )
      ) : null}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
          {t("Não consegui carregar as profissionais. Tente de novo em instantes.")}
        </p>
      ) : lista.length === 0 ? (
        <p data-testid="sem-profissionais" className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
          {t("Nenhuma profissional ainda. Cadastre quem atende para a Agenda e o agente terem horários para oferecer.")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="lista-de-profissionais">
          {lista.map((p) => {
            const trilha = (p.trilha ?? corPorId.get(p.id) ?? 1) as TrilhaDaAgenda;
            const servicos = p.tipos
              .map((id) => tipos.find((tp) => tp.id === id)?.nome)
              .filter((n): n is string => Boolean(n));
            return (
              <li
                key={p.id}
                data-testid={`profissional-${p.id}`}
                className={`rounded-lg border border-border bg-surface p-3 ${p.ativo ? "" : "opacity-60"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <AvatarDaPessoa pessoa={{ id: p.id, nome: p.nome, trilha }} tamanho="sm" />
                  <span className="text-sm font-medium text-text">{p.nome}</span>
                  <Badge variant="neutral">{p.user_id ? t("com login") : t("sem login")}</Badge>
                  {!p.ativo ? <Badge variant="warning">{t("desativada")}</Badge> : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    data-testid={`abrir-profissional-${p.id}`}
                    onClick={() => setAbertaId(p.id)}
                  >
                    {podeEditar || p.user_id === usuarioAtualId ? t("Editar") : t("Ver")}
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-text-muted">
                  <span className="font-medium">{t("Jornada")}:</span>{" "}
                  {resumoDaJornada(p.jornada?.windows ?? [], t)}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  <span className="font-medium">{t("Serviços")}:</span>{" "}
                  {servicos.length > 0 ? servicos.join(", ") : t("nenhum — não aparece para marcar")}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={aberta !== null} onOpenChange={(o) => (o ? undefined : setAbertaId(null))}>
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
          {aberta ? (
            <EditorDaProfissional
              key={aberta.id}
              profissional={aberta}
              trilha={(aberta.trilha ?? corPorId.get(aberta.id) ?? 1) as TrilhaDaAgenda}
              podeEditar={podeEditar}
              podeLancarFolga={podeEditar || aberta.user_id === usuarioAtualId}
              membrosLivres={membros.filter((m) => !vinculados.has(m.id))}
              tipos={tipos}
              onDesativada={() => setAbertaId(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SeletorDeCor({ valor, onChange, testid }: { valor: number | null; onChange: (t: number | null) => void; testid: string }) {
  const t = useT();
  return (
    <select
      data-testid={testid}
      value={valor ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={CAMPO}
    >
      <option value="">{t("Automática")}</option>
      {TRILHAS.map((tr) => (
        <option key={tr.trilha} value={tr.trilha}>
          {t(tr.nome)}
        </option>
      ))}
    </select>
  );
}

function FormularioNova({ membrosLivres, onFechar }: { membrosLivres: Membro[]; onFechar: () => void }) {
  const t = useT();
  const salvar = useSalvarProfissional();
  const [nome, setNome] = React.useState("");
  const [trilha, setTrilha] = React.useState<number | null>(null);
  const [membro, setMembro] = React.useState("");

  return (
    <form
      data-testid="form-nova-profissional"
      className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate(
          {
            id: null,
            dados: { nome: nome.trim(), trilha, ...(membro ? { user_id: membro } : {}) },
          },
          { onSuccess: onFechar },
        );
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
        {t("Nome")}
        <input
          data-testid="nova-profissional-nome"
          required
          maxLength={120}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={t("Ex.: Ana Prado")}
          className={CAMPO}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
        {t("Cor na agenda")}
        <SeletorDeCor valor={trilha} onChange={setTrilha} testid="nova-profissional-cor" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
        {t("Login no sistema")}
        <select
          data-testid="nova-profissional-membro"
          value={membro}
          onChange={(e) => setMembro(e.target.value)}
          className={CAMPO}
        >
          <option value="">{t("Sem login — só agenda")}</option>
          {membrosLivres.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[11px] leading-4 text-text-subtle sm:col-span-3">
        {t(
          "Sem login, ela não ocupa vaga de usuário: tem agenda, cor e serviços, e a recepção marca por ela. Com login, a jornada é a mesma de Equipe › Atendimento.",
        )}
      </p>
      <div className="flex justify-end gap-2 sm:col-span-3">
        <Button type="button" variant="ghost" size="sm" onClick={onFechar}>
          {t("Cancelar")}
        </Button>
        <Button type="submit" size="sm" data-testid="salvar-nova-profissional" disabled={salvar.isPending || !nome.trim()}>
          {salvar.isPending ? t("Salvando…") : t("Cadastrar")}
        </Button>
      </div>
    </form>
  );
}

function EditorDaProfissional({
  profissional,
  trilha,
  podeEditar,
  podeLancarFolga,
  membrosLivres,
  tipos,
  onDesativada,
}: {
  profissional: ProfissionalDaApi;
  trilha: TrilhaDaAgenda;
  podeEditar: boolean;
  podeLancarFolga: boolean;
  membrosLivres: Membro[];
  tipos: TipoResumo[];
  onDesativada: () => void;
}) {
  const t = useT();
  const salvar = useSalvarProfissional();
  const desativar = useDesativarProfissional();
  const [nome, setNome] = React.useState(profissional.nome);
  const [cor, setCor] = React.useState<number | null>(profissional.trilha);
  const [membro, setMembro] = React.useState("");
  const [jornada, setJornada] = React.useState<JornadaEditavel>({
    timezone: profissional.jornada?.timezone || FUSO_PADRAO,
    windows: profissional.jornada?.windows ?? [],
  });
  const [servicos, setServicos] = React.useState<string[]>(profissional.tipos);

  const salvarCampos = (dados: Parameters<typeof salvar.mutate>[0]) => salvar.mutate(dados);

  return (
    <div className="flex flex-col gap-4" data-testid="editor-da-profissional" data-id={profissional.id}>
      <SheetHeader>
        <div className="flex items-center gap-2 pr-6">
          <AvatarDaPessoa pessoa={{ id: profissional.id, nome: profissional.nome, trilha }} tamanho="sm" />
          <SheetTitle>{profissional.nome}</SheetTitle>
        </div>
        <SheetDescription>
          {profissional.user_id
            ? t("Tem login: a jornada é a mesma de Equipe › Atendimento.")
            : t("Sem login: a jornada mora aqui, e só aqui.")}
        </SheetDescription>
      </SheetHeader>

      <Tabs defaultValue="jornada">
        <TabsList className={`${SEGMENTADO_ABAS} max-w-full self-start overflow-x-auto`}>
          <TabsTrigger value="jornada" className={GATILHO_DA_ABA} data-testid="aba-jornada">
            {t("Jornada")}
          </TabsTrigger>
          <TabsTrigger value="folgas" className={GATILHO_DA_ABA} data-testid="aba-folgas">
            {t("Folgas")}
          </TabsTrigger>
          <TabsTrigger value="servicos" className={GATILHO_DA_ABA} data-testid="aba-servicos">
            {t("Serviços")}
          </TabsTrigger>
          <TabsTrigger value="dados" className={GATILHO_DA_ABA} data-testid="aba-dados">
            {t("Dados")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="jornada" className="mt-4 space-y-4">
          <fieldset disabled={!podeEditar} className="space-y-4">
            <EditorDeJornada
              valor={jornada}
              onChange={setJornada}
              idDoFuso={`fuso-${profissional.id}`}
              avisoSemJanelas={t("Nenhuma janela publicada — a agenda não oferece horário com ela.")}
            />
          </fieldset>
          {podeEditar ? (
            <div className="flex justify-end">
              <Button
                size="sm"
                data-testid="salvar-jornada"
                disabled={salvar.isPending}
                onClick={() => salvarCampos({ id: profissional.id, dados: { jornada } })}
              >
                {salvar.isPending ? t("Salvando…") : t("Salvar jornada")}
              </Button>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="folgas" className="mt-4">
          <FolgasDaProfissional profissionalId={profissional.id} podeLancar={podeLancarFolga} />
        </TabsContent>

        <TabsContent value="servicos" className="mt-4 space-y-3">
          <p className="text-xs leading-4 text-text-muted">
            {t("Os serviços que ela faz. Só aparecem horários dela nos tipos marcados aqui — e a IA só a oferece para eles.")}
          </p>
          {tipos.length === 0 ? (
            <p className="text-xs text-text-subtle">{t("Nenhum tipo de agendamento cadastrado.")}</p>
          ) : (
            <fieldset disabled={!podeEditar} className="flex flex-col gap-1.5" data-testid="servicos-da-profissional">
              {tipos
                .filter((tp) => tp.ativo || servicos.includes(tp.id))
                .map((tp) => (
                  <label key={tp.id} className="flex items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      data-testid={`servico-${tp.id}`}
                      checked={servicos.includes(tp.id)}
                      onChange={(e) =>
                        setServicos((atual) =>
                          e.target.checked ? [...atual, tp.id] : atual.filter((x) => x !== tp.id),
                        )
                      }
                      className="h-4 w-4 accent-[var(--color-accent)]"
                    />
                    {tp.nome}
                    {!tp.ativo ? <span className="text-[11px] text-text-subtle">({t("desativado")})</span> : null}
                  </label>
                ))}
            </fieldset>
          )}
          {podeEditar ? (
            <div className="flex justify-end">
              <Button
                size="sm"
                data-testid="salvar-servicos"
                disabled={salvar.isPending}
                onClick={() => salvarCampos({ id: profissional.id, dados: { tipos: servicos } })}
              >
                {t("Salvar serviços")}
              </Button>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="dados" className="mt-4 space-y-4">
          <fieldset disabled={!podeEditar} className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
              {t("Nome")}
              <input
                data-testid="editar-nome-profissional"
                value={nome}
                maxLength={120}
                onChange={(e) => setNome(e.target.value)}
                className={CAMPO}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
              {t("Cor na agenda")}
              <SeletorDeCor valor={cor} onChange={setCor} testid="editar-cor-profissional" />
            </label>
            {/* VINCULAR é de mão única: depois de ligada a um membro, a
                profissional não se desvincula (a rota recusa) — o histórico
                de quem atendeu cada agendamento depende desse vínculo. */}
            {!profissional.user_id ? (
              <label className="flex flex-col gap-1 text-xs font-medium text-text-muted sm:col-span-2">
                {t("Vincular a um membro da equipe")}
                <select value={membro} onChange={(e) => setMembro(e.target.value)} className={CAMPO}>
                  <option value="">{t("Continuar sem login")}</option>
                  {membrosLivres.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </fieldset>
          {podeEditar ? (
            <div className="flex flex-wrap justify-between gap-2">
              {profissional.ativo ? (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="desativar-profissional"
                  disabled={desativar.isPending}
                  onClick={() => desativar.mutate(profissional.id, { onSuccess: onDesativada })}
                >
                  {t("Desativar")}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="reativar-profissional"
                  disabled={salvar.isPending}
                  onClick={() => salvarCampos({ id: profissional.id, dados: { ativo: true } })}
                >
                  {t("Reativar")}
                </Button>
              )}
              <Button
                size="sm"
                data-testid="salvar-dados-profissional"
                disabled={salvar.isPending || !nome.trim()}
                onClick={() =>
                  salvarCampos({
                    id: profissional.id,
                    dados: { nome: nome.trim(), trilha: cor, ...(membro ? { user_id: membro } : {}) },
                  })
                }
              >
                {t("Salvar")}
              </Button>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * FOLGAS — as datas em que a jornada semanal não vale.
 *
 * Dois sentidos: a folga TIRA horas (férias, consulta médica) e o horário extra
 * ACRESCENTA (o sábado de mutirão). O dia inteiro é o caso comum, então os
 * horários só aparecem quando a pessoa desmarca "o dia todo".
 */
function FolgasDaProfissional({ profissionalId, podeLancar }: { profissionalId: string; podeLancar: boolean }) {
  const t = useT();
  const localeDaData = useLocaleDeData();
  const { data: folgas, isLoading } = useFolgas(profissionalId);
  const lancar = useLancarFolga(profissionalId);
  const remover = useRemoverFolga(profissionalId);
  const [data, setData] = React.useState("");
  const [diaTodo, setDiaTodo] = React.useState(true);
  const [inicio, setInicio] = React.useState("08:00");
  const [fim, setFim] = React.useState("12:00");
  const [extra, setExtra] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");

  const intervaloValido = diaTodo || ((minutosDe(inicio) ?? 0) < (minutosDe(fim) ?? 0));

  return (
    <div className="space-y-4" data-testid="folgas-da-profissional">
      {isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : (folgas ?? []).length === 0 ? (
        <p className="text-xs text-text-subtle">{t("Nenhuma folga lançada.")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {(folgas ?? []).map((f: Folga) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-2" data-testid={`folga-${f.id}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text first-letter:uppercase">
                  {format(new Date(`${f.data}T12:00:00`), t("EEEE, d 'de' MMMM"), { locale: localeDaData })}
                </p>
                <p className="text-[11px] text-text-muted">
                  {f.indisponivel ? t("Folga") : t("Horário extra")}
                  {" · "}
                  {f.inicio_minuto === null || f.fim_minuto === null
                    ? t("o dia todo")
                    : `${hhmmDe(f.inicio_minuto)}–${hhmmDe(f.fim_minuto)}`}
                  {f.motivo ? ` · ${f.motivo}` : ""}
                </p>
              </div>
              {podeLancar ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("Remover folga")}
                  disabled={remover.isPending}
                  onClick={() => remover.mutate(f.id)}
                >
                  <Trash size={16} />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {podeLancar ? (
        <form
          data-testid="form-nova-folga"
          className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            lancar.mutate(
              {
                data,
                indisponivel: !extra,
                inicio_minuto: diaTodo ? null : minutosDe(inicio),
                fim_minuto: diaTodo ? null : minutosDe(fim),
                motivo: motivo.trim() || null,
              },
              {
                onSuccess: () => {
                  setData("");
                  setMotivo("");
                },
              },
            );
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
            {t("Data")}
            <input
              type="date"
              required
              data-testid="folga-data"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className={CAMPO}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
            {t("O que é")}
            <select
              data-testid="folga-sentido"
              value={extra ? "extra" : "folga"}
              onChange={(e) => setExtra(e.target.value === "extra")}
              className={CAMPO}
            >
              <option value="folga">{t("Folga — não atende")}</option>
              <option value="extra">{t("Horário extra — atende além da jornada")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-text sm:col-span-2">
            <input
              type="checkbox"
              data-testid="folga-dia-todo"
              checked={diaTodo}
              onChange={(e) => setDiaTodo(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            {t("O dia todo")}
          </label>
          {!diaTodo ? (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                {t("Início")}
                <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} className={CAMPO} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                {t("Fim")}
                <input type="time" value={fim} onChange={(e) => setFim(e.target.value)} className={CAMPO} />
              </label>
            </>
          ) : null}
          <label className="flex flex-col gap-1 text-xs font-medium text-text-muted sm:col-span-2">
            {t("Motivo (opcional)")}
            <input
              value={motivo}
              maxLength={200}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={t("Ex.: férias")}
              className={CAMPO}
            />
          </label>
          {!intervaloValido ? (
            <p className="text-xs text-warning sm:col-span-2">{t("O fim precisa ser depois do início.")}</p>
          ) : null}
          <div className="flex justify-end sm:col-span-2">
            <Button
              type="submit"
              size="sm"
              data-testid="lancar-folga"
              disabled={lancar.isPending || !data || !intervaloValido}
            >
              {t("Lançar")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
