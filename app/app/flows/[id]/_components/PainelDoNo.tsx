"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { OPERADORES, operadorPedeValor, type Operador } from "@/lib/flow-engine/condicoes";
import { EVENTOS_QUE_ACORDAM } from "@/lib/flow-engine/nodes/paralelo";

/**
 * O nome humano de cada evento que o bloco de espera oferece.
 *
 * Só os RÓTULOS moram aqui; a lista de valores vem do registry. É a divisão que
 * `nodeIcons.ts` já usa: o backend decide o que existe, o cliente decide como
 * chamar — e um evento novo aparece na tela mesmo que alguém esqueça deste mapa
 * (cai no próprio identificador, feio mas funcional).
 */
const ROTULO_DO_EVENTO: Record<string, string> = {
  "message.received": "O cliente responder",
  "lead.stage_changed": "O lead mudar de etapa",
  "lead.won": "O lead ser ganho",
  "lead.lost": "O lead ser perdido",
};

/**
 * Os ajustes de cada bloco.
 *
 * Um formulário POR TIPO, e não um formulário genérico gerado do schema Zod. O
 * genérico pareceria mais elegante e seria pior de usar: "duracao_ms" viraria um
 * campo numérico pedindo milissegundos, e "saidas[0].quando.itens[0].campo" uma
 * árvore de JSON. Quem monta o fluxo não conhece o schema — conhece o funil.
 */

/** Um bloco do MESMO fluxo, oferecido como alvo de reencontro. */
export interface BlocoAlcancavel {
  id: string;
  rotulo: string;
}

/** Um fluxo da organização, oferecido para "chamar outro fluxo". */
export interface FluxoChamavel {
  id: string;
  nome: string;
  publicado: boolean;
}

interface Props {
  tipo: string;
  rotulo: string;
  config: Record<string, unknown>;
  aoMudarRotulo: (rotulo: string) => void;
  aoMudarConfig: (config: Record<string, unknown>) => void;
  aoApagar: () => void;
  podeApagar: boolean;
  /**
   * Os blocos de reencontro DESTE fluxo.
   *
   * ⚠️ Sem isto o campo era texto livre pedindo o `id` do bloco — e a pessoa vê
   * "Reencontro" no quadro, não `junta`. Ela teria de descobrir um identificador
   * que a tela nunca mostra, para um campo sem o qual o fluxo não publica.
   */
  blocosDeReencontro?: readonly BlocoAlcancavel[];
  /** Os fluxos da organização, para o bloco "Chamar outro fluxo". */
  fluxosChamaveis?: readonly FluxoChamavel[];
}

export function PainelDoNo(props: Props) {
  const t = useT();

  return (
    <aside
      className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l bg-background p-4"
      data-testid="painel-do-no"
    >
      <div className="space-y-1.5">
        <Label htmlFor="rotulo-do-no">{t("Nome deste bloco")}</Label>
        <Input
          id="rotulo-do-no"
          value={props.rotulo}
          maxLength={80}
          onChange={(e) => props.aoMudarRotulo(e.target.value)}
          data-testid="campo-rotulo-do-no"
        />
        <p className="text-xs text-muted-foreground">
          {t("É só o nome que aparece no quadro. Mudar não desliga nenhuma ligação.")}
        </p>
      </div>

      <Ajustes {...props} />

      {props.podeApagar && (
        <Button
          variant="outline"
          size="sm"
          className="mt-auto"
          onClick={props.aoApagar}
          data-testid="apagar-no"
        >
          {t("Remover este bloco")}
        </Button>
      )}
    </aside>
  );
}

function Ajustes({ tipo, config, aoMudarConfig, blocosDeReencontro, fluxosChamaveis }: Props) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });

  switch (tipo) {
    case "trigger.lead_created":
      return (
        <Aviso texto={t("Este fluxo começa sozinho toda vez que um lead novo entra no funil.")} />
      );

    case "logic.if":
      return <AjustesDaDecisao config={config} aoMudarConfig={aoMudarConfig} />;

    case "logic.wait": {
      const minutos = Math.round(Number(config.duracao_ms ?? 300_000) / 60_000);
      return (
        <Campo rotulo={t("Esperar quantos minutos?")}>
          <Input
            type="number"
            min={5}
            max={129_600}
            value={minutos}
            onChange={(e) => mudar({ duracao_ms: Math.max(5, Number(e.target.value)) * 60_000 })}
            data-testid="campo-espera-minutos"
          />
          <Dica texto={t("Mínimo de 5 minutos — abaixo disso o relógio do sistema não distingue.")} />
        </Campo>
      );
    }

    case "logic.end":
      return (
        <Campo rotulo={t("Como registrar o fim")}>
          <Input
            value={String(config.desfecho ?? "concluido")}
            maxLength={40}
            onChange={(e) => mudar({ desfecho: e.target.value })}
            data-testid="campo-desfecho"
          />
          <Dica texto={t("Aparece na tela de Execuções, para você separar o que deu certo do que não deu.")} />
        </Campo>
      );

    case "logic.fork":
      return (
        <AjustesDaBifurcacao
          config={config}
          aoMudarConfig={aoMudarConfig}
          blocosDeReencontro={blocosDeReencontro ?? []}
        />
      );

    case "logic.merge":
      return (
        <Aviso
          texto={t(
            "Aqui os caminhos que correm ao mesmo tempo voltam a ser um só. Aponte a bifurcação para este bloco.",
          )}
        />
      );

    case "logic.loop": {
      return (
        <>
          <Campo rotulo={t("Lista a percorrer")}>
            <Input
              value={String(config.lista ?? "")}
              maxLength={120}
              placeholder="vars.itens"
              onChange={(e) => mudar({ lista: e.target.value })}
              data-testid="campo-lista-do-laco"
            />
            <Dica
              texto={t(
                "O caminho da lista guardada por um bloco anterior — por exemplo vars.produtos.",
              )}
            />
          </Campo>
          <Campo rotulo={t("Repetir no máximo quantas vezes?")}>
            <Input
              type="number"
              min={1}
              max={100}
              value={Number(config.max ?? 10)}
              onChange={(e) =>
                mudar({ max: Math.min(100, Math.max(1, Number(e.target.value))) })
              }
              data-testid="campo-teto-do-laco"
            />
            <Dica
              texto={t(
                "O teto é obrigatório: é ele que garante que a repetição termina, mesmo se a lista vier maior do que o esperado.",
              )}
            />
          </Campo>
        </>
      );
    }

    case "logic.await_event": {
      const horas = Math.round(Number(config.prazo_ms ?? 3_600_000) / 3_600_000);
      return (
        <>
          <Campo rotulo={t("Esperar o quê?")}>
            <Select
              value={String(config.evento ?? "message.received")}
              onValueChange={(v) => mudar({ evento: v })}
            >
              <SelectTrigger data-testid="campo-evento-esperado">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/*
                  As opções saem de `EVENTOS_QUE_ACORDAM`, a mesma lista que o
                  handler do barramento escuta. Repetir os valores aqui à mão
                  criaria a divergência mais silenciosa possível: a pessoa
                  escolheria a opção, o fluxo dormiria, o evento aconteceria — e
                  ninguém acordaria, porque o handler nunca soube dele.
                */}
                {EVENTOS_QUE_ACORDAM.map((evento) => (
                  <SelectItem key={evento} value={evento}>
                    {t(ROTULO_DO_EVENTO[evento] ?? evento)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo={t("Esperar por quantas horas?")}>
            <Input
              type="number"
              min={1}
              max={720}
              value={horas}
              onChange={(e) =>
                mudar({
                  prazo_ms: Math.min(720, Math.max(1, Number(e.target.value))) * 3_600_000,
                })
              }
              data-testid="campo-prazo-do-evento"
            />
            <Dica
              texto={t(
                "Vencido o prazo, o fluxo segue pela saída 'Venceu o prazo'. Toda espera precisa de prazo — sem ele o fluxo ficaria parado para sempre.",
              )}
            />
          </Campo>
        </>
      );
    }

    case "flow.call": {
      // ⚠️ Só os PUBLICADOS entram na lista. Um fluxo em rascunho não roda, e
      // oferecê-lo aqui produziria um bloco que publica e falha na primeira
      // execução — com a causa a dois cliques de distância de quem montou.
      const chamaveis = (fluxosChamaveis ?? []).filter((f) => f.publicado);
      return (
        <Campo rotulo={t("Qual fluxo chamar")}>
          {chamaveis.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="sem-fluxo-chamavel">
              {t(
                "Nenhum outro fluxo publicado nesta organização. Publique o fluxo que você quer chamar primeiro.",
              )}
            </p>
          ) : (
            <Select
              value={String(config.fluxo_id ?? "")}
              onValueChange={(v) => mudar({ fluxo_id: v })}
            >
              <SelectTrigger data-testid="campo-fluxo-chamado">
                <SelectValue placeholder={t("Escolha o fluxo")} />
              </SelectTrigger>
              <SelectContent>
                {chamaveis.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Dica texto={t("Ele roda inteiro, e este fluxo continua quando ele terminar.")} />
        </Campo>
      );
    }

    case "crm.add_tag":
      return (
        <Campo rotulo={t("Marcador")}>
          <Input
            value={String(config.tag ?? "")}
            maxLength={40}
            onChange={(e) => mudar({ tag: e.target.value })}
            data-testid="campo-tag"
          />
        </Campo>
      );

    case "crm.assign_owner":
      return (
        <Campo rotulo={t("Quem fica com o lead")}>
          <Input
            value={String(config.user_id ?? "")}
            onChange={(e) => mudar({ user_id: e.target.value })}
            placeholder={t("Cole o identificador, ou use a variável do bloco de distribuição")}
            data-testid="campo-dono"
          />
          <Dica
            texto={t(
              "Use {{vars.dono_escolhido}} para pegar quem o bloco de distribuição escolheu, ou cole o identificador de uma pessoa.",
            )}
          />
        </Campo>
      );

    case "crm.owner_responded":
      return (
        <Campo rotulo={t("Contar a partir de quando")}>
          <Select
            value={String(config.contar_a_partir_de ?? "desde_o_inicio_do_fluxo")}
            onValueChange={(v) => mudar({ contar_a_partir_de: v })}
          >
            <SelectTrigger data-testid="campo-contar-a-partir">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desde_o_inicio_do_fluxo">{t("Do começo do fluxo")}</SelectItem>
              <SelectItem value="desde_a_atribuicao">{t("De quando o lead foi entregue")}</SelectItem>
            </SelectContent>
          </Select>
        </Campo>
      );

    case "routing.round_robin":
    case "routing.redistribute":
      return (
        <>
          <Campo rotulo={t("Se não houver ninguém disponível")}>
            <Select
              value={String(config.quando_ninguem ?? "tentar_depois")}
              onValueChange={(v) => mudar({ quando_ninguem: v })}
            >
              <SelectTrigger data-testid="campo-quando-ninguem">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tentar_depois">{t("Esperar e tentar de novo")}</SelectItem>
                <SelectItem value="seguir_pelo_senao">{t("Seguir pela saída 'Ninguém disponível'")}</SelectItem>
              </SelectContent>
            </Select>
            <Dica
              texto={t(
                "Fora do horário comercial não há ninguém disponível, e isso não é erro — por isso o padrão é esperar.",
              )}
            />
          </Campo>
          <Campo rotulo={t("Tentar de novo depois de quantos minutos?")}>
            <Input
              type="number"
              min={1}
              max={1440}
              value={Math.round(Number(config.tentar_de_novo_em_ms ?? 300_000) / 60_000)}
              onChange={(e) =>
                mudar({ tentar_de_novo_em_ms: Math.max(1, Number(e.target.value)) * 60_000 })
              }
              data-testid="campo-tentar-de-novo"
            />
          </Campo>
        </>
      );

    case "whatsapp.notify_user": {
      const destinatario = (config.destinatario ?? { tipo: "dono_do_lead" }) as {
        tipo?: string;
        telefone?: string;
      };
      const paraNumeroFixo = destinatario.tipo === "telefone";
      return (
        <>
          <Campo rotulo={t("Para quem")}>
            <Select
              value={paraNumeroFixo ? "telefone" : "dono_do_lead"}
              onValueChange={(v) =>
                mudar({
                  destinatario:
                    v === "telefone"
                      ? { tipo: "telefone", telefone: destinatario.telefone ?? "" }
                      : { tipo: "dono_do_lead" },
                })
              }
            >
              <SelectTrigger data-testid="campo-destinatario-do-aviso">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dono_do_lead">{t("Quem está com o lead")}</SelectItem>
                <SelectItem value="telefone">{t("Um número fixo")}</SelectItem>
              </SelectContent>
            </Select>
          </Campo>

          {paraNumeroFixo ? (
            <Campo rotulo={t("Número que recebe o aviso")}>
              <Input
                value={String(destinatario.telefone ?? "")}
                maxLength={64}
                placeholder="+55 11 99999-8888"
                onChange={(e) => mudar({ destinatario: { tipo: "telefone", telefone: e.target.value } })}
                data-testid="campo-telefone-do-aviso"
              />
              <Dica
                texto={t(
                  "Com DDI. Pode usar {{contact.phone_number}} ou uma variável do fluxo. Número fora do formato segue pela saída 'Sem telefone cadastrado'.",
                )}
              />
            </Campo>
          ) : (
            <Dica
              texto={t(
                "O telefone de aviso de cada pessoa fica em Equipe › Atendimento, no botão Editar horário. Sem ele, o fluxo segue pela saída 'Sem telefone cadastrado'.",
              )}
            />
          )}

          <Campo rotulo={t("Mensagem para o vendedor")}>
            <Textarea
              rows={6}
              maxLength={4000}
              value={String(config.mensagem ?? "")}
              onChange={(e) => mudar({ mensagem: e.target.value })}
              data-testid="campo-mensagem-do-aviso"
            />
            <Dica
              texto={t(
                "Use {{lead.title}}, {{lead.score}} e {{contact.phone_number}} para incluir os dados.",
              )}
            />
          </Campo>
        </>
      );
    }

    case "notify.internal":
      return (
        <>
          <Campo rotulo={t("Título do aviso")}>
            <Input
              value={String(config.titulo ?? "")}
              maxLength={120}
              onChange={(e) => mudar({ titulo: e.target.value })}
              data-testid="campo-titulo-do-aviso"
            />
          </Campo>
          <Campo rotulo={t("Texto do aviso")}>
            <Textarea
              rows={4}
              maxLength={1000}
              value={String(config.corpo ?? "")}
              onChange={(e) => mudar({ corpo: e.target.value })}
              data-testid="campo-corpo-do-aviso"
            />
          </Campo>
          <Campo rotulo={t("Gravidade")}>
            <Select
              value={String(config.severidade ?? "warn")}
              onValueChange={(v) => mudar({ severidade: v })}
            >
              <SelectTrigger data-testid="campo-gravidade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">{t("Informação")}</SelectItem>
                <SelectItem value="warn">{t("Atenção")}</SelectItem>
                <SelectItem value="critical">{t("Urgente")}</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
        </>
      );

    default:
      return <Aviso texto={t("Este bloco não tem ajustes.")} />;
  }
}


// ────────────────────────────── a bifurcação ─────────────────────────────────

interface RamoDoFork {
  id: string;
  label: string;
}

/**
 * Os ajustes de "Fazer ao mesmo tempo".
 *
 * O campo que parece burocracia e não é: **o reencontro**. Ele é declarado, e
 * não descoberto pelo sistema, porque adivinhar onde os caminhos se juntam
 * acerta no desenho simples e erra em silêncio assim que houver duas
 * bifurcações uma dentro da outra — e errar em silêncio aqui significa um fluxo
 * que se junta no lugar errado sem nada acusar.
 */
function AjustesDaBifurcacao({
  config,
  aoMudarConfig,
  blocosDeReencontro,
}: {
  config: Record<string, unknown>;
  aoMudarConfig: (c: Record<string, unknown>) => void;
  blocosDeReencontro: readonly BlocoAlcancavel[];
}) {
  const t = useT();
  const ramos = (Array.isArray(config.ramos) ? config.ramos : []) as RamoDoFork[];

  const trocar = (novos: RamoDoFork[]) => aoMudarConfig({ ...config, ramos: novos });

  const acrescentar = () => {
    // O id nasce uma vez e nunca muda: é ele que a ligação no quadro guarda.
    // Derivá-lo do rótulo faria renomear o caminho soltar a linha.
    trocar([...ramos, { id: `c${Date.now().toString(36)}`, label: t("Novo caminho") }]);
  };

  return (
    <div className="flex flex-col gap-4">
      <Campo rotulo={t("Como os caminhos se juntam")}>
        <Select
          value={String(config.modo ?? "todas")}
          onValueChange={(v) => aoMudarConfig({ ...config, modo: v })}
        >
          <SelectTrigger data-testid="campo-modo-do-fork">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">{t("Esperar todos terminarem")}</SelectItem>
            <SelectItem value="primeira">{t("Seguir com o primeiro que terminar")}</SelectItem>
          </SelectContent>
        </Select>
        <Dica
          texto={
            String(config.modo ?? "todas") === "primeira"
              ? t("Quando o primeiro chegar, os outros caminhos são cancelados.")
              : t("O fluxo só continua depois que todos os caminhos chegarem ao reencontro.")
          }
        />
      </Campo>

      <Campo rotulo={t("Bloco de reencontro")}>
        {blocosDeReencontro.length === 0 ? (
          // O caso que o campo de texto escondia: não há para onde apontar
          // ainda. Dizer isso é melhor que oferecer uma caixa vazia onde a
          // pessoa digita um nome que não existe e só descobre ao publicar.
          <p className="text-xs text-muted-foreground" data-testid="sem-bloco-de-reencontro">
            {t(
              "Nenhum bloco de reencontro no fluxo ainda. Acrescente um pela paleta — é ele que junta os caminhos de volta.",
            )}
          </p>
        ) : (
          <Select
            value={String(config.encontro ?? "")}
            onValueChange={(v) => aoMudarConfig({ ...config, encontro: v })}
          >
            <SelectTrigger data-testid="campo-encontro-do-fork">
              <SelectValue placeholder={t("Escolha o bloco de reencontro")} />
            </SelectTrigger>
            <SelectContent>
              {blocosDeReencontro.map((bloco) => (
                <SelectItem key={bloco.id} value={bloco.id}>
                  {bloco.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Dica
          texto={t(
            "Onde estes caminhos voltam a ser um só. Sem ele o fluxo não publica.",
          )}
        />
      </Campo>

      {ramos.map((ramo, i) => (
        <div key={ramo.id} className="rounded-md border p-3" data-testid={`ramo-${ramo.id}`}>
          <Campo rotulo={t("Nome deste caminho")}>
            <Input
              value={ramo.label}
              maxLength={60}
              onChange={(e) => {
                const novos = [...ramos];
                novos[i] = { ...ramo, label: e.target.value };
                trocar(novos);
              }}
              data-testid={`rotulo-do-ramo-${ramo.id}`}
            />
          </Campo>
          {ramos.length > 2 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => trocar(ramos.filter((r) => r.id !== ramo.id))}
              data-testid={`apagar-ramo-${ramo.id}`}
            >
              {t("Remover este caminho")}
            </Button>
          )}
        </div>
      ))}

      {ramos.length < 6 && (
        <Button type="button" variant="outline" size="sm" onClick={acrescentar} data-testid="add-ramo">
          {t("Acrescentar caminho")}
        </Button>
      )}
    </div>
  );
}

// ─────────────────────────────── a decisão ───────────────────────────────────

interface Saida {
  id: string;
  label: string;
  quando: { combinador: "and" | "or"; itens: Array<{ campo: string; op: Operador; valor?: unknown }> };
}

/**
 * O bloco de decisão é o único com forma variável: cada saída é uma pergunta, e
 * a primeira que for verdade vence. É por isso que ele cobre tanto o "se/senão"
 * quanto o "escolha entre vários" — a mesma pergunta com mais respostas.
 */
function AjustesDaDecisao({
  config,
  aoMudarConfig,
}: {
  config: Record<string, unknown>;
  aoMudarConfig: (c: Record<string, unknown>) => void;
}) {
  const t = useT();
  const saidas = (Array.isArray(config.saidas) ? config.saidas : []) as Saida[];

  const trocar = (novas: Saida[]) => aoMudarConfig({ ...config, saidas: novas });

  const acrescentar = () => {
    // O id é gerado UMA vez e nunca muda: é ele que a ligação no quadro guarda.
    // Derivá-lo do rótulo faria renomear a saída soltar a linha.
    const id = `s${Date.now().toString(36)}`;
    trocar([
      ...saidas,
      { id, label: t("Nova condição"), quando: { combinador: "and", itens: [{ campo: "lead.score", op: "gt", valor: 70 }] } },
    ]);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {t("A primeira condição verdadeira vence. O que não bater em nenhuma sai pelo 'Nenhuma delas'.")}
      </p>

      {saidas.map((saida, i) => (
        <div key={saida.id} className="rounded-md border p-3" data-testid={`saida-${saida.id}`}>
          <Campo rotulo={t("Nome desta saída")}>
            <Input
              value={saida.label}
              maxLength={60}
              onChange={(e) => {
                const novas = [...saidas];
                novas[i] = { ...saida, label: e.target.value };
                trocar(novas);
              }}
              data-testid={`rotulo-da-saida-${saida.id}`}
            />
          </Campo>

          {saida.quando.itens.map((regra, j) => (
            <div key={j} className="mt-2 flex flex-col gap-1.5">
              <Input
                value={regra.campo}
                placeholder="lead.score"
                onChange={(e) => {
                  const novas = [...saidas];
                  const itens = [...saida.quando.itens];
                  itens[j] = { ...regra, campo: e.target.value };
                  novas[i] = { ...saida, quando: { ...saida.quando, itens } };
                  trocar(novas);
                }}
                data-testid={`campo-da-regra-${saida.id}-${j}`}
              />
              <div className="flex gap-1.5">
                <Select
                  value={regra.op}
                  onValueChange={(v) => {
                    const novas = [...saidas];
                    const itens = [...saida.quando.itens];
                    itens[j] = { ...regra, op: v as Operador };
                    novas[i] = { ...saida, quando: { ...saida.quando, itens } };
                    trocar(novas);
                  }}
                >
                  <SelectTrigger className="w-36" data-testid={`operador-${saida.id}-${j}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERADORES.map((op) => (
                      <SelectItem key={op} value={op}>
                        {t(NOME_DO_OPERADOR[op])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {operadorPedeValor(regra.op) && (
                  <Input
                    value={String(regra.valor ?? "")}
                    onChange={(e) => {
                      const novas = [...saidas];
                      const itens = [...saida.quando.itens];
                      const cru = e.target.value;
                      const numero = Number(cru);
                      itens[j] = {
                        ...regra,
                        // Número quando for número: "score > 70" comparado como
                        // texto faria "9" ser maior que "10".
                        valor: cru.trim() !== "" && Number.isFinite(numero) ? numero : cru,
                      };
                      novas[i] = { ...saida, quando: { ...saida.quando, itens } };
                      trocar(novas);
                    }}
                    data-testid={`valor-${saida.id}-${j}`}
                  />
                )}
              </div>
            </div>
          ))}

          {saidas.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => trocar(saidas.filter((s) => s.id !== saida.id))}
              data-testid={`remover-saida-${saida.id}`}
            >
              {t("Remover esta saída")}
            </Button>
          )}
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={acrescentar} data-testid="acrescentar-saida">
        {t("Acrescentar saída")}
      </Button>
    </div>
  );
}

/** Português de operação para cada operador. Nunca o nome técnico. */
const NOME_DO_OPERADOR: Record<Operador, string> = {
  eq: "é igual a",
  neq: "é diferente de",
  gt: "é maior que",
  gte: "é maior ou igual a",
  lt: "é menor que",
  lte: "é menor ou igual a",
  contains: "contém",
  not_contains: "não contém",
  starts_with: "começa com",
  ends_with: "termina com",
  empty: "está em branco",
  not_empty: "está preenchido",
  in: "está na lista",
  not_in: "não está na lista",
  regex: "casa com o padrão",
  before: "é antes de",
  after: "é depois de",
  between: "está entre",
};

// ───────────────────────────────── enfeites ──────────────────────────────────

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{rotulo}</Label>
      {children}
    </div>
  );
}

function Dica({ texto }: { texto: string }) {
  return <p className="text-xs text-muted-foreground">{texto}</p>;
}

function Aviso({ texto }: { texto: string }) {
  return <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">{texto}</p>;
}
