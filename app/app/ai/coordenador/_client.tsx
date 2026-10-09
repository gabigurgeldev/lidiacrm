"use client";
/**
 * Tela do coordenador de atendimento.
 *
 *   Configurar  modo, destinos (agentes e fluxos), regras, permissões, limites
 *               — um RASCUNHO local; nada muda até "Publicar" (admin).
 *   Simular     o que o coordenador faria com uma mensagem, sobre o rascunho,
 *               sem efeito nenhum.
 *   Atividade   as últimas trocas de responsável, em linguagem de quem opera.
 *
 * O schema que valida aqui é o mesmo da rota (`politicaSchema`): o que a tela
 * aceita é o que o servidor grava.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { LinhaDeAtividade, Painel } from "@/lib/coordenador/painel";
import {
  chaveDoNome,
  politicaSchema,
  type Destino,
  type ModoDoCoordenador,
  type Politica,
} from "@/lib/coordenador/politica/schema";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { Plus, Trash } from "@/lib/ui/icons";

interface Props {
  painelInicial: Painel;
  podePublicar: boolean;
}

const MODOS: { valor: ModoDoCoordenador; rotulo: string; efeito: string }[] = [
  {
    valor: "off",
    rotulo: "Desligado",
    efeito: "Tudo funciona como antes: roteadores, fluxos e agentes decidem sozinhos.",
  },
  {
    valor: "shadow",
    rotulo: "Observar",
    efeito:
      "O coordenador decide em silêncio e registra o que teria feito na Atividade. Nada muda para o cliente — use para conferir antes de ligar.",
  },
  {
    valor: "active",
    rotulo: "Ativo",
    efeito:
      "O coordenador passa a decidir quem conduz cada conversa. Fluxos que conversam com o cliente só começam por ele, e quem perdeu a vez não envia mais nada.",
  },
];

const linhas = (texto: string) =>
  texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function rotuloDoDestino(d: Destino, painel: Painel): string {
  if (d.tipo === "agente") return painel.agentes.find((a) => a.id === d.agent_id)?.nome ?? d.chave;
  return painel.fluxos.find((f) => f.id === d.flow_id)?.nome ?? d.chave;
}

export function CoordenadorClient({ painelInicial, podePublicar }: Props) {
  const t = useT();
  const router = useRouter();
  const painel = painelInicial;
  const [politica, setPolitica] = React.useState<Politica>(painelInicial.politica);
  const [confirmar, setConfirmar] = React.useState(false);
  const [publicando, setPublicando] = React.useState(false);

  const validacao = politicaSchema.safeParse(politica);
  const alterado = JSON.stringify(politica) !== JSON.stringify(painelInicial.politica);

  const chaves = new Set(politica.destinos.map((d) => d.chave));
  const config = politica.config;
  const setConfig = (c: Partial<Politica["config"]>) => setPolitica((p) => ({ ...p, config: { ...p.config, ...c } }));
  const setDestino = (i: number, d: Partial<Destino>) =>
    setPolitica((p) => ({ ...p, destinos: p.destinos.map((x, j) => (j === i ? { ...x, ...d } : x)) }));

  function adicionarAgente(id: string) {
    const a = painel.agentes.find((x) => x.id === id);
    if (!a || politica.destinos.some((d) => d.agent_id === id)) return;
    const destino: Destino = {
      chave: chaveDoNome(a.nome, chaves),
      tipo: "agente",
      agent_id: a.id,
      flow_id: null,
      quando_usar: "",
      exemplos: [],
      nao_usar: [],
      prioridade: 0,
      permite_conduzir: true,
      permite_tarefa: false,
    };
    setPolitica((p) => ({ ...p, destinos: [...p.destinos, destino] }));
  }

  function adicionarFluxo(id: string) {
    const f = painel.fluxos.find((x) => x.id === id);
    if (!f || politica.destinos.some((d) => d.flow_id === id)) return;
    const destino: Destino = {
      chave: chaveDoNome(f.nome, chaves),
      tipo: "fluxo",
      agent_id: null,
      flow_id: f.id,
      quando_usar: "",
      exemplos: [],
      nao_usar: [],
      prioridade: 0,
      permite_conduzir: true,
      permite_tarefa: false,
    };
    setPolitica((p) => ({ ...p, destinos: [...p.destinos, destino] }));
  }

  function removerDestino(i: number) {
    const chave = politica.destinos[i]?.chave;
    setPolitica((p) => {
      const permissoes = Object.fromEntries(
        Object.entries(p.config.permissoes)
          .filter(([origem]) => origem !== chave)
          .map(([origem, perm]) => [
            origem,
            {
              pode_chamar: perm.pode_chamar.filter((c) => c !== chave),
              pode_transferir: perm.pode_transferir.filter((c) => c !== chave),
            },
          ]),
      );
      return {
        ...p,
        destinos: p.destinos.filter((_, j) => j !== i),
        config: {
          ...p.config,
          destino_padrao: p.config.destino_padrao === chave ? null : p.config.destino_padrao,
          regras_de_entrada: p.config.regras_de_entrada.filter((r) => r.destino !== chave),
          permissoes,
        },
      };
    });
  }

  function alternarPermissao(origem: string, tipo: "pode_chamar" | "pode_transferir", destino: string) {
    const atual = config.permissoes[origem] ?? { pode_chamar: [], pode_transferir: [] };
    const lista = atual[tipo].includes(destino) ? atual[tipo].filter((c) => c !== destino) : [...atual[tipo], destino];
    setConfig({ permissoes: { ...config.permissoes, [origem]: { ...atual, [tipo]: lista } } });
  }

  async function publicar() {
    if (!validacao.success) return;
    setPublicando(true);
    try {
      const r = await apiClient.post<{ data: { numero: number } }>("/api/v1/ai/coordenador", validacao.data);
      toast.success(t("Versão publicada.") + ` #${r.data.numero}`);
      setConfirmar(false);
      router.refresh();
    } catch (err) {
      showApiError(err);
    } finally {
      setPublicando(false);
    }
  }

  const agentesNaPolitica = politica.destinos.filter((d) => d.tipo === "agente");
  const fluxosNaPolitica = politica.destinos.filter((d) => d.tipo === "fluxo");
  const modoAtual = MODOS.find((m) => m.valor === politica.modo) ?? MODOS[0]!;

  return (
    <Tabs defaultValue="configurar" className="flex flex-col gap-4">
      <TabsList className="w-full sm:w-auto">
        <TabsTrigger value="configurar">{t("Configurar")}</TabsTrigger>
        <TabsTrigger value="simular">{t("Simular")}</TabsTrigger>
        <TabsTrigger value="atividade">{t("Atividade")}</TabsTrigger>
      </TabsList>

      <TabsContent value="configurar" className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-sm font-medium">{t("Modo")}</span>
              <span className="text-xs text-muted-foreground">
                {painel.versaoAtual
                  ? `${t("Versão em vigor")} #${painel.versaoAtual.numero} · ${t(
                      MODOS.find((m) => m.valor === painel.versaoAtual?.modo)?.rotulo ?? "Desligado",
                    )}`
                  : t("Nenhuma versão publicada ainda.")}
              </span>
            </div>
            <div className="flex gap-2 text-xs text-muted-foreground">
              <span>
                {t("Últimas 24h")}: {painel.resumo24h.aplicadas} {t("trocas")} · {painel.resumo24h.shadow}{" "}
                {t("observadas")} · {painel.resumo24h.falhas} {t("sem destino")}
              </span>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODOS.map((m) => (
              <button
                key={m.valor}
                type="button"
                onClick={() => setPolitica((p) => ({ ...p, modo: m.valor }))}
                className={`rounded-md border p-3 text-left text-sm transition-colors ${
                  politica.modo === m.valor ? "border-primary bg-primary/5" : "hover:bg-muted"
                }`}
                aria-pressed={politica.modo === m.valor}
              >
                <span className="font-medium">{t(m.rotulo)}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{t(m.efeito)}</span>
              </button>
            ))}
          </div>
          {painel.numerosComPoliticaPropria.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("Alguns números seguem uma política própria e não mudam com esta:")}{" "}
              {painel.numerosComPoliticaPropria.length}
            </p>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{t("Destinos")}</span>
            <span className="text-xs text-muted-foreground">
              {t(
                "Quem pode conduzir as conversas. Descreva quando usar cada um — é o que o coordenador lê para escolher.",
              )}
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value="" onValueChange={adicionarAgente}>
              <SelectTrigger className="sm:w-64" aria-label={t("Adicionar agente")}>
                <SelectValue placeholder={t("Adicionar agente")} />
              </SelectTrigger>
              <SelectContent>
                {painel.agentes
                  .filter((a) => !politica.destinos.some((d) => d.agent_id === a.id))
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome}
                      {a.publicado ? "" : ` · ${t("rascunho")}`}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select value="" onValueChange={adicionarFluxo}>
              <SelectTrigger className="sm:w-64" aria-label={t("Adicionar fluxo")}>
                <SelectValue placeholder={t("Adicionar fluxo")} />
              </SelectTrigger>
              <SelectContent>
                {painel.fluxos
                  .filter((f) => !politica.destinos.some((d) => d.flow_id === f.id))
                  .map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                      {f.ativo ? "" : ` · ${t("desligado")}`}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {politica.destinos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("Nenhum destino ainda. Adicione os agentes e fluxos que podem atender.")}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {politica.destinos.map((d, i) => {
                const agente = d.agent_id ? painel.agentes.find((a) => a.id === d.agent_id) : undefined;
                const fluxo = d.flow_id ? painel.fluxos.find((f) => f.id === d.flow_id) : undefined;
                const inelegivel = d.tipo === "agente" ? agente?.publicado !== true : fluxo?.ativo !== true;
                return (
                  <div key={d.chave} className="flex flex-col gap-2 rounded-md border p-3" data-testid={`destino-${d.chave}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{rotuloDoDestino(d, painel)}</span>
                        <Badge variant="secondary">{d.tipo === "agente" ? t("Agente") : t("Fluxo")}</Badge>
                        {inelegivel && (
                          <Badge variant="outline">
                            {d.tipo === "agente" ? t("Sem versão publicada — não recebe conversa") : t("Fluxo desligado — não recebe conversa")}
                          </Badge>
                        )}
                        {fluxo?.interativo === false && (
                          <Badge variant="outline">{t("Não fala com o cliente")}</Badge>
                        )}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => removerDestino(i)} aria-label={t("Remover destino")}>
                        <Trash />
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="flex flex-col gap-1 sm:col-span-2">
                        <Label htmlFor={`quando-${d.chave}`}>{t("Quando usar")}</Label>
                        <Textarea
                          id={`quando-${d.chave}`}
                          value={d.quando_usar}
                          maxLength={600}
                          rows={2}
                          placeholder={t("Ex.: dúvidas sobre planos, preços e formas de pagamento.")}
                          onChange={(e) => setDestino(i, { quando_usar: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`exemplos-${d.chave}`}>{t("Exemplos de mensagem (um por linha)")}</Label>
                        <Textarea
                          id={`exemplos-${d.chave}`}
                          rows={3}
                          value={d.exemplos.join("\n")}
                          onChange={(e) => setDestino(i, { exemplos: linhas(e.target.value).slice(0, 12) })}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`nao-${d.chave}`}>{t("Não usar quando (um por linha)")}</Label>
                        <Textarea
                          id={`nao-${d.chave}`}
                          rows={3}
                          value={d.nao_usar.join("\n")}
                          onChange={(e) => setDestino(i, { nao_usar: linhas(e.target.value).slice(0, 12) })}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`prioridade-${d.chave}`}>{t("Prioridade")}</Label>
                        <Input
                          id={`prioridade-${d.chave}`}
                          type="number"
                          min={0}
                          max={100}
                          className="w-24"
                          value={d.prioridade}
                          onChange={(e) =>
                            setDestino(i, { prioridade: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })
                          }
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          id={`conduz-${d.chave}`}
                          checked={d.permite_conduzir}
                          onCheckedChange={(v) => setDestino(i, { permite_conduzir: v, permite_tarefa: v ? d.permite_tarefa : true })}
                        />
                        <Label htmlFor={`conduz-${d.chave}`}>{t("Pode conduzir a conversa")}</Label>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{t("Regras")}</span>
            <span className="text-xs text-muted-foreground">
              {t("Palavras que decidem sem consultar o modelo. A primeira regra que casar vence.")}
            </span>
          </div>
          {config.regras_de_entrada.map((r, i) => (
            <div key={r.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                aria-label={t("Palavras (separadas por vírgula)")}
                placeholder={t("Palavras (separadas por vírgula)")}
                value={r.termos.join(", ")}
                onChange={(e) =>
                  setConfig({
                    regras_de_entrada: config.regras_de_entrada.map((x, j) =>
                      j === i
                        ? { ...x, termos: e.target.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20) }
                        : x,
                    ),
                  })
                }
              />
              <Select
                value={r.quando}
                onValueChange={(v) =>
                  setConfig({
                    regras_de_entrada: config.regras_de_entrada.map((x, j) =>
                      j === i ? { ...x, quando: v as "contem" | "igual" } : x,
                    ),
                  })
                }
              >
                <SelectTrigger className="sm:w-48" aria-label={t("Como comparar")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contem">{t("Contém a palavra")}</SelectItem>
                  <SelectItem value="igual">{t("É exatamente")}</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={r.destino}
                onValueChange={(v) =>
                  setConfig({
                    regras_de_entrada: config.regras_de_entrada.map((x, j) => (j === i ? { ...x, destino: v } : x)),
                  })
                }
              >
                <SelectTrigger className="sm:w-56" aria-label={t("Vai para")}>
                  <SelectValue placeholder={t("Vai para")} />
                </SelectTrigger>
                <SelectContent>
                  {politica.destinos.map((d) => (
                    <SelectItem key={d.chave} value={d.chave}>
                      {rotuloDoDestino(d, painel)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("Remover regra")}
                onClick={() => setConfig({ regras_de_entrada: config.regras_de_entrada.filter((_, j) => j !== i) })}
              >
                <Trash />
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={politica.destinos.length === 0}
              onClick={() =>
                setConfig({
                  regras_de_entrada: [
                    ...config.regras_de_entrada,
                    {
                      id: `regra_${Date.now().toString(36)}`,
                      quando: "contem",
                      termos: [],
                      destino: politica.destinos[0]!.chave,
                    },
                  ],
                })
              }
            >
              <Plus /> {t("Adicionar regra")}
            </Button>
          </div>

          <div className="flex flex-col gap-1 sm:max-w-sm">
            <Label>{t("Quando nada decide")}</Label>
            <Select
              value={config.destino_padrao ?? "__ninguem"}
              onValueChange={(v) => setConfig({ destino_padrao: v === "__ninguem" ? null : v })}
            >
              <SelectTrigger aria-label={t("Quando nada decide")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ninguem">{t("Ninguém automático — a equipe assume")}</SelectItem>
                {politica.destinos.map((d) => (
                  <SelectItem key={d.chave} value={d.chave}>
                    {rotuloDoDestino(d, painel)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="usar-modelo"
              checked={config.decisor.usar_modelo}
              onCheckedChange={(v) => setConfig({ decisor: { usar_modelo: v } })}
            />
            <Label htmlFor="usar-modelo">{t("Usar o modelo quando as regras não bastarem")}</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("O modelo é o que você escolher em")}{" "}
            <Link href="/app/ai/providers" className="underline">
              {t("IA › Provedores")}
            </Link>{" "}
            {t("no ponto \"Escolher quem conduz a conversa\".")}
          </p>
        </Card>

        {agentesNaPolitica.length > 0 && politica.destinos.length > 1 && (
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex flex-col">
              <span className="text-sm font-medium">{t("O que cada agente pode pedir")}</span>
              <span className="text-xs text-muted-foreground">
                {t("Chamar um fluxo e voltar, ou passar a conversa de vez. Sem marcar nada, o agente atende sozinho.")}
              </span>
            </div>
            {agentesNaPolitica.map((origem) => {
              const perm = config.permissoes[origem.chave] ?? { pode_chamar: [], pode_transferir: [] };
              return (
                <div key={origem.chave} className="flex flex-col gap-2 rounded-md border p-3">
                  <span className="text-sm font-medium">{rotuloDoDestino(origem, painel)}</span>
                  {fluxosNaPolitica.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">{t("Chamar o fluxo e voltar")}</span>
                      <div className="flex flex-wrap gap-3">
                        {fluxosNaPolitica.map((f) => (
                          <label key={f.chave} className="flex items-center gap-1 text-sm">
                            <input
                              type="checkbox"
                              checked={perm.pode_chamar.includes(f.chave)}
                              onChange={() => alternarPermissao(origem.chave, "pode_chamar", f.chave)}
                            />
                            {rotuloDoDestino(f, painel)}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t("Transferir o atendimento")}</span>
                    <div className="flex flex-wrap gap-3">
                      {politica.destinos
                        .filter((d) => d.chave !== origem.chave)
                        .map((d) => (
                          <label key={d.chave} className="flex items-center gap-1 text-sm">
                            <input
                              type="checkbox"
                              checked={perm.pode_transferir.includes(d.chave)}
                              onChange={() => alternarPermissao(origem.chave, "pode_transferir", d.chave)}
                            />
                            {rotuloDoDestino(d, painel)}
                          </label>
                        ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>
        )}

        <Card className="flex flex-col gap-3 p-4">
          <span className="text-sm font-medium">{t("Limites")}</span>
          <div className="grid gap-3 sm:grid-cols-2">
            <CampoNumero
              id="transferencias"
              rotulo={t("Trocas de responsável na janela")}
              valor={config.limites.transferencias_por_janela}
              min={1}
              max={20}
              onChange={(v) => setConfig({ limites: { ...config.limites, transferencias_por_janela: v } })}
            />
            <CampoNumero
              id="janela"
              rotulo={t("Janela (minutos)")}
              valor={config.limites.janela_minutos}
              min={1}
              max={1440}
              onChange={(v) => setConfig({ limites: { ...config.limites, janela_minutos: v } })}
            />
            <CampoNumero
              id="decisoes"
              rotulo={t("Consultas ao modelo por hora, por conversa")}
              valor={config.limites.decisor_chamadas_por_hora}
              min={0}
              max={200}
              onChange={(v) => setConfig({ limites: { ...config.limites, decisor_chamadas_por_hora: v } })}
            />
            <CampoNumero
              id="prazo"
              rotulo={t("Prazo de uma tarefa chamada (horas)")}
              valor={config.limites.prazo_chamada_horas}
              min={1}
              max={168}
              onChange={(v) => setConfig({ limites: { ...config.limites, prazo_chamada_horas: v } })}
            />
          </div>
        </Card>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {!validacao.success
              ? t(validacao.error.issues[0]?.message ?? "Confira os campos.")
              : alterado
                ? t("Há mudanças não publicadas.")
                : t("Nada a publicar.")}
          </p>
          {podePublicar ? (
            <Button
              disabled={!validacao.success || !alterado || publicando}
              onClick={() => (politica.modo === "active" ? setConfirmar(true) : void publicar())}
            >
              {publicando ? t("Publicando…") : t("Publicar")}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">{t("Só administradores publicam.")}</p>
          )}
        </div>

        <Dialog open={confirmar} onOpenChange={setConfirmar}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("Ligar o coordenador?")}</DialogTitle>
              <DialogDescription>{t(modoAtual.efeito)}</DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t("Recomendado: deixe alguns dias em Observar e confira a Atividade antes de ligar.")}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmar(false)}>
                {t("Cancelar")}
              </Button>
              <Button disabled={publicando} onClick={() => void publicar()}>
                {t("Ligar e publicar")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TabsContent>

      <TabsContent value="simular">
        <Simulacao politica={politica} painel={painel} />
      </TabsContent>

      <TabsContent value="atividade">
        <Atividade />
      </TabsContent>
    </Tabs>
  );
}

function CampoNumero(props: {
  id: string;
  rotulo: string;
  valor: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={props.id}>{props.rotulo}</Label>
      <Input
        id={props.id}
        type="number"
        min={props.min}
        max={props.max}
        className="w-32"
        value={props.valor}
        onChange={(e) => props.onChange(Math.max(props.min, Math.min(props.max, Number(e.target.value) || props.min)))}
      />
    </div>
  );
}

interface ResultadoDaSimulacao {
  acao: string;
  destino: { chave: string; nome: string; tipo: "agente" | "fluxo" } | null;
  motivo_legivel: string;
  usou_modelo: boolean;
  precisou_do_modelo: boolean;
  decisor: { status: string; modelo: string | null; confianca: number | null } | null;
}

function Simulacao({ politica, painel }: { politica: Politica; painel: Painel }) {
  const t = useT();
  const [texto, setTexto] = React.useState("");
  const [dono, setDono] = React.useState("__nenhum");
  const [humano, setHumano] = React.useState(false);
  const [usarModelo, setUsarModelo] = React.useState(false);
  const [resultado, setResultado] = React.useState<ResultadoDaSimulacao | null>(null);
  const [ocupado, setOcupado] = React.useState(false);

  async function simular() {
    const destino = politica.destinos.find((d) => d.chave === dono);
    setOcupado(true);
    try {
      const r = await apiClient.post<{ data: ResultadoDaSimulacao }>("/api/v1/ai/coordenador/simular", {
        politica,
        cenario: {
          texto,
          dono:
            dono === "__pessoa"
              ? { tipo: "pessoa", chave: null }
              : destino
                ? { tipo: destino.tipo, chave: destino.chave }
                : { tipo: "nenhum", chave: null },
          humano_no_comando: humano || dono === "__pessoa",
        },
        usar_modelo: usarModelo,
      });
      setResultado(r.data);
    } catch (err) {
      showApiError(err);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="text-sm text-muted-foreground">
        {t("Teste o rascunho com uma mensagem. Nada é enviado e nenhuma conversa muda.")}
      </p>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sim-texto">{t("Mensagem do cliente")}</Label>
        <Textarea id="sim-texto" rows={3} maxLength={1500} value={texto} onChange={(e) => setTexto(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1 sm:max-w-sm">
        <Label>{t("Quem conduz agora")}</Label>
        <Select value={dono} onValueChange={setDono}>
          <SelectTrigger aria-label={t("Quem conduz agora")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__nenhum">{t("Ninguém (primeira mensagem)")}</SelectItem>
            <SelectItem value="__pessoa">{t("A equipe")}</SelectItem>
            {politica.destinos.map((d) => (
              <SelectItem key={d.chave} value={d.chave}>
                {rotuloDoDestino(d, painel)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="sim-humano" checked={humano} onCheckedChange={setHumano} />
        <Label htmlFor="sim-humano">{t("Uma pessoa assumiu a conversa")}</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="sim-modelo" checked={usarModelo} onCheckedChange={setUsarModelo} />
        <Label htmlFor="sim-modelo">{t("Consultar o modelo de verdade (gasta do orçamento de IA)")}</Label>
      </div>
      <div>
        <Button disabled={texto.trim() === "" || ocupado} onClick={() => void simular()}>
          {ocupado ? t("Simulando…") : t("Simular")}
        </Button>
      </div>
      {resultado && (
        <div className="flex flex-col gap-1 rounded-md border p-3 text-sm" data-testid="resultado-simulacao">
          <span className="font-medium">
            {resultado.destino
              ? `${t("Iria para")}: ${resultado.destino.nome}`
              : resultado.acao === "nada"
                ? t("Ninguém automático responde")
                : t("Sem destino seguro — ficaria com a equipe")}
          </span>
          <span className="text-muted-foreground">{t(resultado.motivo_legivel)}</span>
          {resultado.precisou_do_modelo && !resultado.usou_modelo && (
            <span className="text-xs text-muted-foreground">
              {t("As regras não bastaram: no atendimento real, o modelo seria consultado.")}
            </span>
          )}
          {resultado.decisor && (
            <span className="text-xs text-muted-foreground">
              {t("Modelo")}: {resultado.decisor.modelo ?? "—"} · {resultado.decisor.status}
              {resultado.decisor.confianca !== null ? ` · ${Math.round(resultado.decisor.confianca * 100)}%` : ""}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

const ROTULO_DO_STATUS: Record<string, string> = {
  aplicada: "Aplicada",
  shadow: "Observada",
  recusada: "Recusada",
  obsoleta: "Descartada",
  falhou: "Sem destino",
};

function Atividade() {
  const t = useT();
  const idioma = useIdioma();
  const [linhasDeAtividade, setLinhas] = React.useState<LinhaDeAtividade[] | null>(null);

  React.useEffect(() => {
    let vivo = true;
    apiClient
      .get<{ data: { transicoes: LinhaDeAtividade[] } }>("/api/v1/ai/coordenador/atividade?limite=50")
      .then((r) => {
        if (vivo) setLinhas(r.data.transicoes);
      })
      .catch((err: unknown) => {
        showApiError(err);
        if (vivo) setLinhas([]);
      });
    return () => {
      vivo = false;
    };
  }, []);

  if (linhasDeAtividade === null) {
    return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;
  }
  if (linhasDeAtividade.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        {t("Nenhuma troca de responsável ainda. Com o coordenador em Observar ou Ativo, elas aparecem aqui.")}
      </Card>
    );
  }
  return (
    <Card className="flex flex-col divide-y">
      {linhasDeAtividade.map((l) => (
        <div key={l.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col">
            <span>
              {t(l.de)} → <span className="font-medium">{t(l.para)}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {t(l.motivo_legivel)}
              {l.modelo ? ` · ${t("Modelo")}: ${l.modelo}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={l.status === "aplicada" ? "default" : "secondary"}>{t(ROTULO_DO_STATUS[l.status] ?? l.status)}</Badge>
            <span>{new Date(l.quando).toLocaleString(tagDeIdioma(idioma))}</span>
            <Link href={`/app/inbox?id=${l.conversation_id}`} className="underline">
              {t("Ver conversa")}
            </Link>
          </div>
        </div>
      ))}
    </Card>
  );
}
