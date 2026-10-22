"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";

import { useT } from "@/hooks/i18n/useT";

import { addDays, endOfMonth, format, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import * as React from "react";

import { AvisoDaConexaoGoogle } from "./_components/AvisoDaConexaoGoogle";
import { CartaoDaConexaoGoogle } from "./_components/CartaoDaConexaoGoogle";

import { AgendaInterativa } from "@/components/agenda/AgendaInterativa";
import { DetalheDoAgendamento } from "@/components/agenda/DetalheDoAgendamento";
import { FiltroDePessoas } from "@/components/agenda/FiltroDePessoas";
import { HistoricoDaAgenda } from "@/components/agenda/HistoricoDaAgenda";
import {
  filtrarPorEscolha,
  horariosPorDiaComQuem,
  idsParaMarcar,
  responsavelDaGrade,
  type EscolhaDeProfissionais,
} from "@/components/agenda/profissionais-na-tela";
import { SeletorDeCliente, type ClienteEscolhido } from "@/components/agenda/SeletorDeCliente";
import { SeletorDeProfissionais } from "@/components/agenda/SeletorDeProfissionais";
import type { Agendamento, HorarioLivre, Pessoa, VisaoDaAgenda } from "@/components/agenda/tipos";
import { EmptyAgenda } from "@/components/empty";
import { rotuloDoLocal } from "@/lib/agenda/locais";
import { Button } from "@/components/ui/button";
import { PainelDeMarcacao } from "@/components/agenda/PainelDeMarcacao";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAgendaAoVivo } from "@/hooks/agenda/useAgendaAoVivo";
import { useAgendamentos } from "@/hooks/agenda/useAgendamentos";
import { useHorariosLivres } from "@/hooks/agenda/useHorariosLivres";
import { useMarcarAgendamento } from "@/hooks/agenda/useMarcarAgendamento";
import {
  useCancelarAgendamento,
  useRegistrarDesfecho,
  useRemarcarAgendamento,
} from "@/hooks/agenda/useRemarcarAgendamento";
import { usePessoasDaAgenda } from "@/hooks/agenda/usePessoasDaAgenda";
import type { ProfissionalDaApi } from "@/hooks/agenda/useProfissionais";
import { CalendarPlus, CaretLeft, CaretRight } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

const VISOES: Array<{ id: VisaoDaAgenda; rotulo: string }> = [
  { id: "dia", rotulo: "Dia" },
  { id: "semana", rotulo: "Semana" },
  { id: "mes", rotulo: "Mês" },
  // O DIA por pessoa, uma coluna por profissional (0245). Fica por último: é a
  // visão de quem distribui o dia, não a de quem só consulta.
  { id: "profissionais", rotulo: "Profissionais" },
];

/** O dia de uma visão "de dia" — as duas desenham uma data só. */
const EH_UM_DIA: Record<VisaoDaAgenda, boolean> = {
  dia: true,
  semana: false,
  mes: false,
  profissionais: true,
};

const SEM_ESCOLHA: EscolhaDeProfissionais = { principalId: null, apoioId: null };

/**
 * Põe ou tira `?agendamento=` da barra sem navegar.
 *
 * `history.replaceState` e não `router.replace`: o segundo refaria o RSC da
 * página inteira (quatro consultas no servidor) para mudar um parâmetro que só
 * o cliente lê. O App Router sincroniza `replaceState` com o roteador desde o
 * Next 14.1, então o voltar do navegador e o `useSearchParams` seguem coerentes.
 */
function trocarParametroDoAgendamento(id: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("agendamento", id);
  else url.searchParams.delete("agendamento");
  window.history.replaceState(window.history.state, "", url.toString());
}

/**
 * A tela da Agenda.
 *
 * ⚠️ SEM DADO NENHUM até a frente 1 (API + motor) integrar. A tela cai no
 * estado vazio de propósito, e a razão é de SEGURANÇA PERCEBIDA, não de
 * pureza:
 *
 * dado falso PLAUSÍVEL numa tela real de produto multi-tenant é
 * indistinguível de VAZAMENTO. "Ana Prado", "Marina Alves", "Visita ao imóvel"
 * são nomes brasileiros críveis nos nichos que este produto atende — e o
 * relato que chega de quem vê isso não é "tem dado de teste na tela", é
 * "estou vendo paciente de outra clínica na minha agenda". O time então queima
 * horas caçando um furo de RLS que não existe. Achado do QAVivo, decisão 18.
 *
 * Repare na inversão, porque ela é o ponto: os MESMOS nomes são ACERTO na
 * vitrine (`/vitrine-agenda`), onde tornam o desenho julgável, e o pior
 * formato possível aqui. Mesmo dado, valor oposto conforme onde está pendurado.
 *
 * E o vazio é mais VERDADEIRO: numa instalação nova a agenda está vazia mesmo.
 * De quebra exercita o estado vazio, que é onde mora a primeira impressão.
 *
 * `data-fonte` declara isso no DOM para ser verificável de fora — e
 * `tests/unit/telas-sem-dado-de-mentira.test.ts` impede que alguém religue os
 * imports sem querer.
 */
export function AgendaClient({
  organizationId,
  profissionaisIniciais,
  agendamentoInicial,
  fusoDeApresentacao,
  googleConfigurado,
  contaConectada,
  enderecoDeRetorno,
  faltaNoGoogle,
  linkDeConfiguracaoDoGoogle,
  tiposIniciais,
  agendamentosIniciais,
}: {
  /** Escopo do canal de tempo real — ver `useAgendaAoVivo`. */
  organizationId: string;
  /** As profissionais, lidas no servidor para a primeira pintura (sem piscar a barra de pessoas). */
  profissionaisIniciais?: ProfissionalDaApi[];
  /** `?agendamento=<id>` — o link da Central e de quem compartilhou abre o detalhe direto. */
  agendamentoInicial?: string | null;
  fusoDeApresentacao: string | null;
  googleConfigurado: boolean;
  contaConectada?: string | null;
  enderecoDeRetorno?: string;
  faltaNoGoogle: string[];
  /** Preenchido só para quem administra a instalação — ver `page.tsx`. */
  linkDeConfiguracaoDoGoogle?: string;
  /** Tipos ativos, resolvidos no servidor: não há rota que os liste ainda. */
  tiposIniciais: Array<{
    id: string;
    nome: string;
    duracaoMin: number;
    donoId: string | null;
    localKind: string | null;
    localDetalhes: string | null;
    /** Quantas pessoas o serviço pede (`professionals_required`, 0245). */
    profissionaisNecessarios: 1 | 2;
    /** As profissionais habilitadas neste tipo. Vazio = o tipo ainda não usa habilitação. */
    habilitadas: string[];
  }>;
  /** A semana corrente, resolvida no servidor: `GET /agendamentos` não existe. */
  agendamentosIniciais: Agendamento[];
}) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const [marcando, setMarcando] = React.useState(false);
  // O horário que veio de um CLIQUE NA GRADE. Preenchido, o painel abre já em
  // "confirmando" naquele instante; vazio, ele abre pedindo o dia, como sempre.
  const [horarioEscolhido, setHorarioEscolhido] = React.useState<HorarioLivre | null>(null);
  // REMARCAR reusa o painel de marcação: escolher horário novo é o MESMO gesto
  // de escolher o primeiro, e uma segunda tela para a mesma pergunta seria duas
  // coisas para manter em sincronia. Quando `remarcandoId` está preenchido, a
  // confirmação vira PATCH em vez de POST.
  const [remarcandoId, setRemarcandoId] = React.useState<string | null>(null);
  // Quem atende o compromisso que se está remarcando. Remarcar não troca a
  // profissional (limite declarado da 0245), então os horários oferecidos têm de
  // ser os DELA — oferecer a agenda de qualquer habilitada daria um 409 depois
  // do clique, porque a rota valida contra os participantes atuais.
  const [remarcandoProfissionais, setRemarcandoProfissionais] = React.useState<string[] | null>(null);
  // O QUE SE PERGUNTA ANTES DO HORÁRIO (0245): para quem, com quem, e uma nota.
  const [escolha, setEscolha] = React.useState<EscolhaDeProfissionais>(SEM_ESCOLHA);
  const [cliente, setCliente] = React.useState<ClienteEscolhido | null>(null);
  const [notas, setNotas] = React.useState("");
  // O DETALHE aberto. Nasce do `?agendamento=` — é por ele que o aviso da
  // Central ("a IA marcou…") abre o compromisso certo.
  const [abertoId, setAbertoId] = React.useState<string | null>(agendamentoInicial ?? null);
  const abrirDetalhe = React.useCallback((id: string | null) => {
    setAbertoId(id);
    trocarParametroDoAgendamento(id);
  }, []);
  // CANCELAR pede motivo, e o motivo é obrigatório na rota. Não é burocracia: é
  // o que a equipe lê ao ver o horário vago.
  const [cancelandoId, setCancelandoId] = React.useState<string | null>(null);
  // O resumo do que se cancela quando o pedido vem do DETALHE: aberto por link,
  // o compromisso pode ser de uma semana que a grade não carregou, e a frase
  // "não está mais na lista" mentiria sobre ele.
  const [resumoDoCancelamento, setResumoDoCancelamento] = React.useState<string | null>(null);
  const [motivo, setMotivo] = React.useState("");
  const marcar = useMarcarAgendamento();
  const remarcar = useRemarcarAgendamento();
  const cancelar = useCancelarAgendamento();
  const desfecho = useRegistrarDesfecho();
  // ⚠️ ERA `tiposIniciais[0] ?? null` — uma constante, sem seletor em lugar
  // nenhum. `page.tsx` ordena os tipos por NOME, então a tela marcava sempre o
  // primeiro em ordem alfabética e não havia como marcar outro: numa org com
  // "Atendimento", "Consulta", "Reunião", só "Atendimento" era alcançável pela
  // tela. As categorias existiam no banco, no seed e na API — e a tela oferecia
  // uma. Achado escrevendo a spec de marcar, não lendo o código.
  const [tipoId, setTipoId] = React.useState<string | null>(() => tiposIniciais[0]?.id ?? null);
  const tipo = tiposIniciais.find((t) => t.id === tipoId) ?? tiposIniciais[0] ?? null;
  const [visao, setVisao] = React.useState<VisaoDaAgenda>("semana");
  const [isolada, setIsolada] = React.useState<string | null>(null);
  const [ancora, setAncora] = React.useState(() => new Date());

  // AS PESSOAS SÃO REAIS: vêm de `/api/v1/team`, com a trilha de cor derivada do
  // `user_id`. Até esta linha o filtro por pessoa era invisível na tela do
  // produto — `FiltroDePessoas` devolve `null` com menos de duas pessoas, e a
  // lista estava vazia. Ele existia, estava provado na vitrine, e ninguém o via
  // aqui.
  const { data: pessoas = [] } = usePessoasDaAgenda(profissionaisIniciais);

  // AO VIVO: o que a IA marca numa conversa aparece aqui sem recarregar.
  useAgendaAoVivo(organizationId);

  /**
   * Quem pode atender o tipo escolhido — o que o seletor oferece.
   *
   * As habilitadas, quando o tipo as tem; senão a profissional do dono padrão,
   * que é exatamente o candidato que o motor usa nesse caso. Oferecer a equipe
   * inteira para um tipo sem habilitação deixaria escolher quem o motor não
   * consulta, e a lista de horários viria vazia sem explicação.
   */
  const habilitadas: Pessoa[] = React.useMemo(() => {
    if (!tipo) return [];
    if (tipo.habilitadas.length > 0) return pessoas.filter((p) => tipo.habilitadas.includes(p.id));
    return pessoas.filter((p) => p.userId && p.userId === tipo.donoId);
  }, [pessoas, tipo]);

  // A JANELA DE BUSCA PRECISA SER ESTÁVEL, e não era.
  //
  // ⚠️ Isto era `de: new Date().toISOString()` calculado no CORPO do render. A
  // chave do React Query inclui o recorte, e `new Date()` devolve milissegundos
  // diferentes a cada passagem — então cada resposta causava re-render, que
  // gerava chave nova, que disparava outra busca. O painel nunca estabilizava:
  // `horarios` ficava `undefined` entre as idas, `horariosPorDia` nascia vazio e
  // TODO dia aparecia "sem horário" — com a rota respondendo 200 e slots reais.
  //
  // Medido pela spec de marcar, que capturou as respostas: cinco 200 seguidos
  // com vagas, e a tela mostrando 42 dias apagados. Em produção isto é um laço
  // de requisições por usuário com o painel aberto.
  //
  // `useMemo` sem dependência de tempo: a janela é fixada quando o painel abre.
  const janelaDeBusca = React.useMemo(
    () => ({ de: new Date().toISOString(), ate: addDays(new Date(), 30).toISOString() }),
    // A janela só precisa mudar quando o painel REABRE ou o tipo muda — nunca a
    // cada render. `marcando` na lista é o que a renova entre duas aberturas.
    [marcando, tipo?.id],
  );

  // Os horários vêm da rota real — a mesma que a IA usa, então tela e agente
  // oferecem exatamente os mesmos horários. Só consulta quando o painel abre.
  // `isError` junto, e não só `data`: sem ele a tela MENTE por default. O
  // `publicouHorarios={horarios?.publicou_horarios ?? true}` abaixo transforma
  // "a consulta falhou" em "publicou, só não tem vaga" — dias travados e aviso
  // nenhum, que é exatamente o que uma instalação fresca produz (a rota devolve
  // 422 porque ninguém está em `attendant_availability`).
  //
  // A ESCOLHA DE PROFISSIONAL NÃO ENTRA NA CHAVE da consulta: a rota devolve
  // todas as combinações de cada horário e o recorte é feito aqui
  // (`filtrarPorEscolha`). Trocar "Ana" por "Bia" no seletor não refaz a busca —
  // e a escolha parcial ("a Ana, com qualquer apoio") funciona sem a rota
  // precisar entender meio pedido.
  const { data: horarios, isError: horariosFalharam } = useHorariosLivres(
    marcando && tipo
      ? {
          event_type_id: tipo.id,
          de: janelaDeBusca.de,
          ate: janelaDeBusca.ate,
          ...(remarcandoProfissionais ? { professional_ids: remarcandoProfissionais } : {}),
        }
      : null,
  );

  const horariosPorDia = React.useMemo(() => {
    const nomes = new Map<string, string>(pessoas.map((p) => [p.id, p.nome]));
    for (const p of horarios?.profissionais ?? []) nomes.set(p.id, p.nome);
    return horariosPorDiaComQuem(filtrarPorEscolha(horarios?.slots ?? [], escolha), nomes, {
      dia: (d) => format(d, "yyyy-MM-dd"),
      hora: (d) => format(d, "HH:mm"),
    });
  }, [horarios, escolha, pessoas]);

  // OS AGENDAMENTOS SÃO REAIS, e agora TAMBÉM se atualizam sem recarregar.
  //
  // ⚠️ O comentário que estava aqui dizia que `GET /api/v1/agenda/agendamentos`
  // "ainda não existe (a rota tem POST, PATCH e DELETE)". Era verdade quando foi
  // escrito e VENCEU: `grep -n "^export async function" app/api/v1/agenda/agendamentos/route.ts`
  // devolve GET:95. A prosa descrevia um estado, o estado mudou, e a frase ficou
  // — junto com o `useAgendamentos`, que existia inteiro e não era montado por
  // ninguém (1 ocorrência no repo: a própria definição).
  //
  // A prop do RSC segue sendo a PRIMEIRA pintura (sem piscar, sem spinner) e o
  // hook assume dali: `useMarcarAgendamento` já invalida `["agenda"]`, então
  // marcar pela tela repinta a grade sozinho.
  // O recorte acompanha o que a grade DESENHA — mesma visão, mesma âncora.
  // Instante ISO, nunca o filtro `dia`: o cabeçalho do hook mede por que
  // (`dia=` corta em UTC e some com o compromisso das 22h no fuso de São Paulo).
  const recorteDaGrade = React.useMemo(() => {
    const inicio =
      visao === "mes"
        ? startOfMonth(ancora)
        : EH_UM_DIA[visao]
          ? startOfDay(ancora)
          : startOfWeek(ancora, { weekStartsOn: 0 });
    const fim =
      visao === "mes" ? addDays(endOfMonth(ancora), 1) : addDays(inicio, EH_UM_DIA[visao] ? 1 : 7);
    return { de: inicio.toISOString(), ate: fim.toISOString() };
  }, [visao, ancora]);

  // A janela que o SERVIDOR pintou. Sem esta comparação, navegar para outra
  // semana mostraria os compromissos DESTA por um instante — o fallback estaria
  // respondendo a uma pergunta que ninguém fez. Cair para lista vazia é pior de
  // aparência e melhor de verdade: a grade fica vazia por um piscar, em vez de
  // mostrar compromisso no dia errado.
  // ⚠️ `useState` com inicializador, e NÃO `useRef(...).current`.
  //
  // A intenção é a mesma — congelar a janela da primeira pintura —, mas ler
  // `.current` durante o render é violação de regra do React, e o `pnpm lint`
  // reprova com "Cannot access refs during render". Foi o CI que me disse: eu
  // tinha rodado typecheck e vitest e NÃO tinha rodado lint. O `verify` cai nos
  // três, e eu só olhei dois.
  //
  // `useState(() => x)[0]` faz o mesmo congelamento sem tocar em ref no render.
  const [recorteDoServidor] = React.useState(() => recorteDaGrade);
  const naJanelaDoServidor =
    recorteDaGrade.de === recorteDoServidor.de && recorteDaGrade.ate === recorteDoServidor.ate;

  const { data: agendamentosVivos } = useAgendamentos(recorteDaGrade);
  // `responsavelDaGrade`: a ocupação do Google e o agendamento legado chegam com
  // o MEMBRO, e a grade pinta por PROFISSIONAL. Sem a tradução o bloco cai na
  // trilha 1 e some do filtro por pessoa.
  const todos: Agendamento[] = React.useMemo(
    () => responsavelDaGrade(agendamentosVivos ?? (naJanelaDoServidor ? agendamentosIniciais : []), pessoas),
    [agendamentosVivos, naJanelaDoServidor, agendamentosIniciais, pessoas],
  );

  const agendamentos = React.useMemo(
    // Isolar uma pessoa mostra também onde ela é APOIO: a agenda dela inclui
    // o procedimento em que ela ajuda.
    () =>
      isolada === null
        ? todos
        : todos.filter((a) => a.responsavelId === isolada || a.apoioId === isolada),
    [isolada, todos],
  );

  const passo = visao === "mes" ? 30 : EH_UM_DIA[visao] ? 1 : 7;
  // O PADRÃO de formato também muda de idioma, não só o locale: em português
  // "d 'de' MMMM" tem a preposição escrita à mão dentro do padrão, e em
  // espanhol ela também é "de" — mas quem garante isso é a chave no dicionário,
  // não a coincidência. Passando o padrão por `t()`, um idioma que ordene a
  // data de outro jeito não precisa de código novo aqui.
  const periodo =
    visao === "mes"
      ? format(ancora, t("MMMM 'de' yyyy"), { locale: localeDaData })
      : EH_UM_DIA[visao]
        ? format(ancora, t("EEEE, d 'de' MMMM"), { locale: localeDaData })
        : `${format(startOfWeek(ancora, { weekStartsOn: 0 }), t("d 'de' MMM"), { locale: localeDaData })} — ${format(addDays(startOfWeek(ancora, { weekStartsOn: 0 }), 6), t("d 'de' MMM"), { locale: localeDaData })}`;

  return (
    <div
      data-testid="tela-agenda"
      data-fonte={agendamentosIniciais.length > 0 ? "api" : "api-sem-dado"}
      data-fuso={fusoDeApresentacao ?? "organizacao"}
      className="flex h-full flex-col gap-4 p-6"
    >
      {/*
        Em Suspense porque `useSearchParams` obriga: sem a fronteira, o Next
        reprova o build da rota. Fallback nulo porque a ausência do aviso é o
        estado normal — quem chega pela navegação não tem query nenhuma.
      */}
      <React.Suspense fallback={null}>
        <AvisoDaConexaoGoogle />
      </React.Suspense>

      <CartaoDaConexaoGoogle
        configurado={googleConfigurado}
        falta={faltaNoGoogle}
        linkDeConfiguracao={linkDeConfiguracaoDoGoogle}
        contaConectada={contaConectada}
        enderecoDeRetorno={enderecoDeRetorno}
      />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Agenda")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("O que está marcado, com quem, e quem atende — seu e da equipe.")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAncora(new Date())}>
            {t("Hoje")}
          </Button>
          {/*
            DESABILITADO COM O MOTIVO À VISTA, e não ligado a um `onClick` vazio.
            Enquanto a frente 1 não expõe `/api/v1/agenda` não há o que marcar, e
            um botão primário, com cor de ação e sem `disabled`, que não faz nada
            ao clique é pior do que não existir: quem clica conclui que o produto
            está quebrado e não tem o que reportar além de "não abre". É o
            anti-pattern de controle decorativo, e esta base já pagou por ele.

            O motivo vai em texto ao lado, não só no `title`: atributo de
            hover não existe para quem usa toque, que é o dono de clínica no
            celular.
          */}
          {!tipo && (
            // Sem NENHUM tipo de agendamento cadastrado não há o que marcar — e
            // isto é diferente de "a API não existe": a ação faz sentido, falta
            // configuração. Por isso o motivo à vista, e não um botão mudo.
            <span
              data-testid="motivo-novo-agendamento"
              className="hidden text-xs text-text-subtle sm:inline"
            >
              {t("Cadastre um tipo de agendamento para começar")}
            </span>
          )}
          <Button
            size="sm"
            disabled={!tipo}
            // `data-testid` porque o RÓTULO deixou de ser estável: até este PR
            // ele era literal, e `agenda-escopo-da-organizacao.spec.ts` o acha
            // por `getByRole("button", { name: /Novo agendamento/i })`. Com o
            // texto passando por `t()`, casar por rótulo passa a depender do
            // idioma da conta de teste — hoje passa porque a conta nasce em
            // português, mas é acoplamento que não precisa existir. O testid é
            // o caminho estável; trocar a spec para usá-lo é decisão de quem a
            // escreveu, e vai anotada no PR.
            data-testid="novo-agendamento"
            title={tipo ? undefined : t("Cadastre um tipo de agendamento para começar")}
            onClick={() => setMarcando(true)}
          >
            <CalendarPlus size={16} weight="bold" aria-hidden />
            <span>{t("Novo agendamento")}</span>
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Período anterior")}
              data-testid="periodo-anterior"
              onClick={() => setAncora((d) => addDays(d, -passo))}
            >
              <CaretLeft size={16} weight="bold" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Próximo período")}
              data-testid="periodo-seguinte"
              onClick={() => setAncora((d) => addDays(d, passo))}
            >
              <CaretRight size={16} weight="bold" aria-hidden />
            </Button>
          </div>
          {/*
            `first-letter:uppercase` e NÃO `capitalize`: o `capitalize` do CSS
            maiúscula toda palavra, e o date-fns em pt-br devolve "23 de ago" —
            virava "23 De Ago". Preposição com maiúscula é o detalhe que faz o
            produto parecer traduzido em vez de escrito, e fica na primeira
            linha abaixo do título.
          */}
          <span
            data-testid="periodo"
            className="truncate text-sm font-semibold first-letter:uppercase"
          >
            {periodo}
          </span>
        </div>

        {/* `flex-wrap` pelo mesmo motivo da vitrine, e aqui é conserto de CLASSE e
            não de instância: esta linha passou no gate por sorte de largura (a
            organização de teste tem cinco pessoas), não por estar certa. Com mais
            gente no filtro, ela estoura igual — e o `overflow-x: hidden` corta o
            alternador de visão em silêncio. */}
        <div className="flex flex-wrap items-center gap-3">
          <FiltroDePessoas pessoas={pessoas} isolada={isolada} onIsolar={setIsolada} />
          <div
            data-testid="alternador-de-visao"
            className="flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5"
          >
            {VISOES.map((v) => (
              <button
                key={v.id}
                type="button"
                data-testid={`visao-${v.id}`}
                aria-pressed={visao === v.id}
                onClick={() => setVisao(v.id)}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-xs transition-colors duration-fast ease-out",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500",
                  visao === v.id
                    ? "bg-accent font-semibold text-accent-fg"
                    : "text-text-muted hover:bg-surface-elevated hover:text-text",
                )}
              >
                {t(v.rotulo)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/*
        O HISTÓRICO na tela do produto, e não só na vitrine. Ele aparece mesmo
        sem dado: as quatro abas com contador zero respondem "não há nada" sem
        gastar um clique, e some-lo faria a tela parecer menor do que é.
      */}
      <Sheet
        open={marcando}
        onOpenChange={(aberto) => {
          setMarcando(aberto);
          // Fechar sem confirmar volta ao modo normal — senão o próximo "Novo
          // agendamento" remarcaria o compromisso anterior em silêncio. O
          // horário vindo da grade some pela mesma razão: abrir o painel pelo
          // botão depois de fechar um bloco reabriria no horário do bloco.
          if (!aberto) {
            setRemarcandoId(null);
            setRemarcandoProfissionais(null);
            setHorarioEscolhido(null);
            // Cliente, profissional e nota são DESTA marcação: carregá-los para
            // a próxima marcaria o paciente anterior no horário de outro.
            setEscolha(SEM_ESCOLHA);
            setCliente(null);
            setNotas("");
          }
        }}
      >
        {/*
          `lg:max-w-[1040px]` — o painel de marcar precisa de 980px para as três
          colunas (contexto 280 + calendário 420 + horários 280), e cabia num
          Sheet de 768px cortando 239px em silêncio.
          
          O `sm:max-w-3xl` fica para as telas menores DE PROPÓSITO: lá o painel
          empilha os horários sob o calendário, então 768px bastam e um Sheet
          maior só roubaria contexto da tela atrás.
        */}
        {/*
          A CADEIA DE ALTURAS, e ela é o que faz a lista de horários rolar.
          
          O `overflow-y-auto` da lista (`PainelDeMarcacao`) sempre esteve no
          elemento certo e era INERTE: `overflow-y-auto` cujo pai tem altura
          `auto` não rola — o filho cresce, `scrollHeight === clientHeight`, e os
          últimos horários ficavam abaixo da dobra sem nenhum jeito de alcançá-los.
          E a página também não rolava: o `SheetContent` é `position: fixed`, e
          transbordo de elemento fixo não estende a área rolável do documento.
          
          Abaixo de `lg` o próprio Sheet rola (ali o painel empilha e a lista é
          uma seção, não uma coluna). De `lg` para cima o Sheet segura a altura e
          a LISTA rola, com calendário e contexto parados.
          
          ⚠️ `lg:overflow-hidden` e não `overflow-y-auto` em todo breakpoint: em
          `lg` o Sheet tem 1040px com `p-6` → 992px de caixa contra ~980px de
          painel. Uma barra vertical come essa folga, e como o CSS computa
          `overflow-x: visible` como `auto` quando `overflow-y` não é `visible`,
          nasceria barra HORIZONTAL exatamente no breakpoint que o conserto de
          largura acabou de reparar.
        */}
        <SheetContent
          side="right"
          className="flex w-full flex-col overflow-y-auto sm:max-w-3xl lg:max-w-[1040px] lg:overflow-hidden"
        >
          <SheetHeader>
            <SheetTitle>{remarcandoId ? t("Remarcar agendamento") : t("Novo agendamento")}</SheetTitle>
          </SheetHeader>
          {tiposIniciais.length > 1 && (
            <div className="mt-4" data-testid="tipos-de-agendamento">
              <p className="mb-2 text-xs font-medium text-text-muted">{t("Tipo de agendamento")}</p>
              <div className="flex flex-wrap gap-1.5">
                {tiposIniciais.map((opcao) => (
                  <button
                    key={opcao.id}
                    type="button"
                    data-testid={`tipo-${opcao.id}`}
                    aria-pressed={opcao.id === tipo?.id}
                    onClick={() => {
                      setTipoId(opcao.id);
                      // A profissional escolhida pode não fazer o outro serviço.
                      setEscolha(SEM_ESCOLHA);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors duration-fast",
                      opcao.id === tipo?.id
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
          )}
          {tipo && (
            <div className="mt-4 lg:min-h-0 lg:flex-1">
              <PainelDeMarcacao
                className="lg:h-full"
                ancora={new Date()}
                agora={new Date()}
                responsavel={
                  // QUEM ESTÁ ESCOLHIDA, e mais ninguém. Era "o dono do tipo, ou
                  // a primeira da lista, ou 'Você'" — e com profissionais (0245)
                  // e "qualquer habilitada" isso afirmaria um nome que o horário
                  // pode desmentir. Sem escolha, quem atende aparece EM CADA
                  // horário, que é onde a resposta de fato existe.
                  // Remarcando, é a principal de agora: remarcar não troca quem atende.
                  pessoas.find((p) => p.id === (escolha.principalId ?? remarcandoProfissionais?.[0])) ??
                  (habilitadas.length === 1 ? habilitadas[0] : undefined)
                }
                extras={
                  remarcandoId ? undefined : (
                    <>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-text-muted">{t("Cliente")}</p>
                        <SeletorDeCliente valor={cliente} onChange={setCliente} />
                      </div>
                      {habilitadas.length !== 1 || tipo.profissionaisNecessarios === 2 ? (
                        <SeletorDeProfissionais
                          habilitadas={habilitadas}
                          necessarias={tipo.profissionaisNecessarios}
                          valor={escolha}
                          onChange={setEscolha}
                        />
                      ) : null}
                      {(horarios?.profissionais_com_problema?.length ?? 0) > 0 ? (
                        // Quem ficou FORA da oferta, e por quê: sem isto a
                        // recepção procura a Ana nos horários e não entende por
                        // que ela não aparece.
                        <p data-testid="profissionais-com-problema" className="text-[11px] leading-4 text-warning">
                          {t("Fora dos horários por jornada mal configurada:")}{" "}
                          {(horarios?.profissionais_com_problema ?? []).map((p) => p.nome).join(", ")}
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
                  )
                }
                tipo={tipo.nome}
                duracaoMin={tipo.duracaoMin}
                // O LOCAL e o FUSO de verdade, que a tela tinha e não passava.
                //
                // `PainelDeMarcacao` trazia `local = "Presencial · Sala 2"` e
                // `fuso = "America/Sao_Paulo"` como defaults de parâmetro, e
                // estas duas props nunca eram passadas: os defaults venciam em
                // 100% das marcações do produto. É o que o cabeçalho deste
                // arquivo proíbe — dado falso plausível numa tela multi-tenant é
                // indistinguível de vazamento.
                //
                // `fuso_da_regra` já vinha da rota e já era tipado pelo hook;
                // ninguém em tela o lia. Chutar São Paulo para quem atende em
                // Manaus é uma hora de diferença no horário oferecido ao cliente.
                local={rotuloDoLocal(tipo.localKind, tipo.localDetalhes)}
                fuso={horarios?.fuso_da_regra}
                horariosPorDia={horariosPorDia}
                publicouHorarios={horarios?.publicou_horarios ?? true}
                erroAoCarregar={horariosFalharam}
                fusoSuposto={horarios?.fuso_suposto ?? false}
                fontesDefasadas={horarios?.fontes_defasadas}
                horarioInicial={horarioEscolhido ?? undefined}
                // ESTE é o fio que faltava. Sem ele o "Marcado ✓" era estado
                // local do React e nenhuma linha nascia no banco.
                onConfirmar={(instante) => {
                  // ⚠️ SEM `owner_user_id`, e é isto que conserta o 422.
                  //
                  // Isto mandava `pessoas[0]?.id` — a PRIMEIRA pessoa da lista.
                  // Os horários oferecidos vêm de `useHorariosLivres`, que NÃO
                  // manda dono, então a rota resolve `tipo.default_owner_user_id`.
                  // A tela oferecia a agenda de um e marcava na de outro: medido
                  // nesta org, 5 pessoas e só o dono do tipo com jornada, e o POST
                  // devolvia `agenda_disponibilidade_invalida` ("expected object,
                  // received undefined") enquanto a tela dizia "Marcado ✓".
                  //
                  // Omitir é o que faz oferta e marcação resolverem o dono pela
                  // MESMA regra (`_handler.ts:96`), por construção e não por sorte.
                  // Remarcar é PATCH com o id; marcar é POST. A escolha do
                  // horário é o mesmo gesto, e por isso o mesmo painel.
                  if (remarcandoId) {
                    return remarcar
                      .mutateAsync({ id: remarcandoId, starts_at: instante })
                      .then((r) => {
                        setRemarcandoId(null);
                        setRemarcandoProfissionais(null);
                        setMarcando(false);
                        return r;
                      });
                  }
                  // O QUE SE VIU É O QUE SE MARCA: os ids da combinação que o
                  // horário mostrou (ou da escolha explícita), o cliente e a nota.
                  const horario = Object.values(horariosPorDia)
                    .flat()
                    .find((h) => h.instante === instante);
                  const profissionais = idsParaMarcar(escolha, horario ?? {});
                  return marcar.mutateAsync({
                    event_type_id: tipo.id,
                    starts_at: instante,
                    ...(profissionais ? { professional_ids: profissionais } : {}),
                    ...(cliente ? { contact_id: cliente.id } : {}),
                    ...(notas.trim() ? { notes: notas.trim() } : {}),
                  });
                }}
                // "VER NA AGENDA" — o botão que não fazia nada.
                //
                // Ele não tinha `onClick`: parecia ativo e o clique era mudo. E
                // fechar o painel sozinho não bastaria — o compromisso recém
                // marcado costuma ser de OUTRA semana (o do relato era 8 de
                // setembro), e a grade abre na semana corrente. Voltar para uma
                // grade que não mostra o que acabou de nascer é o mesmo "nada
                // acontece" com um passo a mais.
                //
                // Por isso a âncora vai junto: fecha o painel E leva a grade até
                // o dia do compromisso. `startOfDay` porque a âncora é o DIA de
                // referência da visão — mandar o instante exato funcionaria por
                // acidente na visão de semana e escolheria a hora errada na de
                // dia.
                onVerNaAgenda={(instante) => {
                  setAncora(startOfDay(new Date(instante)));
                  setMarcando(false);
                  setRemarcandoId(null);
                  setRemarcandoProfissionais(null);
                  setEscolha(SEM_ESCOLHA);
                  setCliente(null);
                  setNotas("");
                }}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* CANCELAR pede motivo, e o motivo é OBRIGATÓRIO na rota (mínimo 3).
          Não é burocracia: é o que a equipe lê ao ver o horário vago. "Cancelado"
          sem motivo faz alguém ligar para o cliente perguntando o que houve — ou,
          pior, não ligar. */}
      <Sheet
        open={cancelandoId !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setCancelandoId(null);
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t("Cancelar agendamento")}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3" data-testid="painel-de-cancelamento">
            <p className="text-sm text-text-muted">
              {(() => {
                const alvo = todos.find((a) => a.id === cancelandoId);
                if (!alvo) return resumoDoCancelamento ?? t("Este agendamento não está mais na lista.");
                const quem = alvo.quemSeraAtendido ? ` ${t("de")} ${alvo.quemSeraAtendido}` : "";
                return `${t(alvo.titulo)}${quem}, ${format(new Date(alvo.comeca), t("d 'de' MMMM 'às' HH:mm"), { locale: localeDaData })}.`;
              })()}
            </p>
            <label className="block text-xs font-medium text-text-muted" htmlFor="motivo-do-cancelamento">
              {t("Por que está cancelando?")}
            </label>
            <textarea
              id="motivo-do-cancelamento"
              data-testid="motivo-do-cancelamento"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-surface p-2 text-sm outline-none focus:border-border-strong"
              placeholder={t("O paciente pediu para remarcar por telefone")}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCancelandoId(null)}>
                {t("Voltar")}
              </Button>
              <Button
                size="sm"
                data-testid="confirmar-cancelamento"
                // O mínimo de 3 é o da rota. Desabilitar aqui evita um 422 que a
                // pessoa não tem como prever — o botão diz o que falta pelo estado.
                disabled={motivo.trim().length < 3 || cancelar.isPending}
                onClick={() => {
                  const id = cancelandoId;
                  if (!id) return;
                  void cancelar.mutateAsync({ id, reason: motivo.trim() }).then(
                    () => setCancelandoId(null),
                    () => undefined,
                  );
                }}
              >
                {cancelar.isPending ? t("Cancelando…") : t("Cancelar agendamento")}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <HistoricoDaAgenda
        agendamentos={agendamentos}
        pessoas={pessoas}
        agora={new Date()}
        className="max-h-[320px]"
        // ⚠️ ESTAS DUAS PROPS FALTAVAM, e a ausência tinha cara de permissão.
        // `HistoricoDaAgenda` usa `disabled={!onRemarcar}`; sem elas os botões
        // nasciam cinzas em toda linha, de toda organização — e o `title` dizia
        // "Disponível quando a agenda estiver conectada", que é falso: PATCH e
        // DELETE não tocam o Google. Só a IA conseguia remarcar ou cancelar.
        onRemarcar={(id) => {
          const alvo = todos.find((a) => a.id === id);
          setRemarcandoId(id);
          // Só ids que SÃO de profissional: um agendamento legado cujo dono não
          // virou profissional chega com o user_id, e pedir horários com ele
          // daria 422. Sem nenhum, a rota decide como antes.
          const deQuem = alvo
            ? [alvo.responsavelId, ...(alvo.apoioId ? [alvo.apoioId] : [])].filter((x) =>
                pessoas.some((p) => p.id === x),
              )
            : [];
          setRemarcandoProfissionais(deQuem.length > 0 ? deQuem : null);
          if (alvo?.eventTypeId && tiposIniciais.some((x) => x.id === alvo.eventTypeId)) {
            setTipoId(alvo.eventTypeId);
          }
          setMarcando(true);
        }}
        // A linha do histórico abre o MESMO detalhe que o card da grade.
        onAbrir={abrirDetalhe}
        onCancelar={(id) => {
          setMotivo("");
          setResumoDoCancelamento(null);
          setCancelandoId(id);
        }}
        // E ESTAS DUAS TAMBÉM FALTAVAM — o conserto acima alcançou 2 dos 4
        // botões do MESMO componente, e "Realizado"/"Faltou" ficaram cinzas,
        // com a mesma frase falsa, por mais tempo ainda. Conserto por instância
        // custa a segunda passada; a varredura custaria um `grep`.
        //
        // Sem cerimônia de confirmação, ao contrário de cancelar: registrar
        // desfecho não avisa ninguém e se desfaz voltando o status. Cancelar
        // exige motivo porque é o que a equipe lê ao ver o horário vago.
        onRealizado={(id) => desfecho.mutate({ id, status: "completed" })}
        onFaltou={(id) => desfecho.mutate({ id, status: "no_show" })}
      />

      {/* ⚠️ O VAZIO NÃO ESCONDE MAIS A GRADE, e o achado veio do CI.
          Isto era um ternário: com zero agendamentos, `EmptyAgenda` entrava NO
          LUGAR de `GradeDaAgenda`. Numa instalação nova — que é o estado de
          primeira impressão — a pessoa abria a Agenda e não via calendário
          NENHUM: sem semana, sem horários, e com o alternador de visão ligado a
          nada, que é controle decorativo.

          A mensagem continua, porque ela é boa: diz de ONDE vem o próximo
          agendamento em vez de constatar a ausência. Ela virou aviso ACIMA da
          grade, e a grade fica.

          Achado porque a cerca nova das três visões passou aqui (banco com
          dados de execuções anteriores) e reprovou no CI, onde o banco nasce
          limpo. O mesmo formato do defeito que `agenda-tela-do-produto` já
          tinha pago: verde por banco sujo. */}
      {agendamentos.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <EmptyAgenda />
        </div>
      ) : null}
      {/* A GRADE INTERATIVA — clicar num bloco livre marca ali, arrastar um card
          remarca. Toda a fiação (a consulta de horários da janela desenhada, a
          proposta de remarcação, o otimismo com volta atrás) mora em
          `AgendaInterativa`; aqui fica só o que esta tela já sabia. */}
      <AgendaInterativa
        visao={visao}
        ancora={ancora}
        agora={new Date()}
        pessoas={pessoas}
        agendamentos={agendamentos}
        recorte={recorteDaGrade}
        tipos={tiposIniciais.map((t) => ({ id: t.id, nome: t.nome, duracaoMin: t.duracaoMin }))}
        tipo={tipo ? { id: tipo.id, duracaoMin: tipo.duracaoMin } : null}
        onEscolherTipo={setTipoId}
        onMarcarEm={(instante) => {
          setHorarioEscolhido({ instante, rotulo: format(new Date(instante), "HH:mm") });
          setRemarcandoId(null);
          setMarcando(true);
        }}
        // O CLIQUE NO CARD, que era mudo: a grade aceitava a prop desde que
        // nasceu e esta tela não a passava.
        onAbrirAgendamento={abrirDetalhe}
        className="min-h-0 flex-1"
      />

      <DetalheDoAgendamento
        id={abertoId}
        pessoas={pessoas}
        agora={new Date()}
        onFechar={() => abrirDetalhe(null)}
        onRemarcar={(d) => {
          abrirDetalhe(null);
          setRemarcandoId(d.id);
          // Os horários oferecidos são os de QUEM JÁ ATENDE — ver o estado.
          setRemarcandoProfissionais(d.profissionais.length > 0 ? d.profissionais.map((p) => p.id) : null);
          if (d.tipo && tiposIniciais.some((x) => x.id === d.tipo?.id)) setTipoId(d.tipo.id);
          setMarcando(true);
        }}
        onCancelar={(d) => {
          abrirDetalhe(null);
          setMotivo("");
          setResumoDoCancelamento(
            `${d.contato?.nome ?? t(d.titulo)}, ${format(new Date(d.iniciaEm), t("d 'de' MMMM 'às' HH:mm"), { locale: localeDaData })}.`,
          );
          setCancelandoId(d.id);
        }}
      />

    </div>
  );
}
