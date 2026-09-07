"use client";

import { useQuery } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

import { ImportadorDeLista } from "./ImportadorDeLista";
import { SeletorDeCanal, useConexoesParaEnvio } from "./SeletorDeCanal";
import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/** O que a lista de modelos aprovados devolve, do que esta tela precisa. */
interface ModeloAprovado {
  name: string;
  language: string;
  status: string;
  slots: Array<{ key: string; expects: string; onde: string }>;
  previews: Array<{ onde: string; text: string }>;
}

/**
 * `whatsapp.bulk_send` — a campanha que o fluxo cria.
 *
 * ## A ordem das perguntas não é estética
 *
 * A conexão vem PRIMEIRO porque ela decide as outras. Um número que só entrega
 * modelo aprovado não aceita texto livre — perguntar o texto antes seria pedir
 * para a pessoa escrever algo que vai ser jogado fora. É a mesma ordem que o
 * diálogo de disparo da tela de Disparos usa, e pelo mesmo motivo.
 *
 * ## Limite herdado, escrito para não virar surpresa
 *
 * A lista de modelos vem de `/api/v1/channels/templates`, que hoje devolve os
 * da WABA que a tela de Conexões sincroniza — a conexão oficial mais antiga da
 * organização. Numa organização com DUAS contas oficiais, os modelos da segunda
 * não aparecem aqui. É a limitação que aquela rota já tem, não uma introduzida
 * por este bloco; consertá-la é mudar a rota para aceitar a conexão escolhida.
 */
export function WhatsappBulkSendForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });

  const canalId = (config.canal_id as string | null) ?? null;
  const { data: conexoes } = useConexoesParaEnvio();
  const conexao = (conexoes ?? []).find((c) => c.id === canalId) ?? null;

  // O modo é consequência da conexão, nunca uma segunda pergunta — a mesma
  // regra que `lib/bulk-send/modo.ts` aplica no servidor.
  const modo = conexao?.modo ?? (config.modo as string | undefined) ?? "freeform";
  const exigeModelo = modo === "template";

  const { data: modelos, isLoading: carregandoModelos } = useQuery({
    queryKey: ["modelos-aprovados"],
    queryFn: async () => apiClient.get<{ data: ModeloAprovado[] }>("/api/v1/channels/templates"),
    select: (r) => r.data.filter((m) => m.status === "APPROVED"),
    enabled: exigeModelo,
  });

  const modeloEscolhido =
    (modelos ?? []).find(
      (m) => m.name === config.modelo_nome && m.language === config.modelo_idioma,
    ) ?? null;

  const audiencia = String(config.audiencia ?? "tags");
  const tags = Array.isArray(config.tags) ? (config.tags as string[]) : [];
  const contatos = Array.isArray(config.contatos) ? (config.contatos as string[]) : [];
  const valores = (config.modelo_valores ?? {}) as Record<string, string>;

  return (
    <div className="flex flex-col gap-4">
      <Secao titulo={t("A campanha")}>
        <Campo rotulo={t("Nome da campanha")}>
          <Input
            value={String(config.nome ?? "")}
            maxLength={120}
            onChange={(e) => mudar({ nome: e.target.value })}
            data-testid="campo-nome-do-disparo"
          />
          <Dica
            texto={t("Aparece na tela de Disparos. Aceita {{lead.title}} para distinguir uma execução da outra.")}
          />
        </Campo>
      </Secao>

      <div className="space-y-1.5">
        <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("Por qual número disparar")}
        </p>
        <SeletorDeCanal
          valor={canalId}
          // Campanha não escolhe número sozinha: o teto diário, o ritmo e o
          // risco são POR NÚMERO, e deixar o sistema decidir mandaria centenas
          // de mensagens por um número que quem montou não escolheu.
          permitirAutomatico={false}
          aoEscolher={(id) => {
            const conexaoNova = (conexoes ?? []).find((c) => c.id === id) ?? null;
            mudar({ canal_id: id, modo: conexaoNova?.modo ?? "freeform" });
          }}
        />
      </div>

      <Secao titulo={t("O que enviar")}>
        {!exigeModelo && (
          <Campo rotulo={t("Mensagem")}>
            <Textarea
              rows={5}
              maxLength={4096}
              value={String(config.texto ?? "")}
              onChange={(e) => mudar({ texto: e.target.value })}
              data-testid="campo-texto-do-disparo"
            />
            <Dica texto={t("Use {{contact.name}} para tratar cada pessoa pelo nome.")} />
          </Campo>
        )}

        {exigeModelo && (
          <Campo rotulo={t("Modelo aprovado")}>
            {carregandoModelos ? (
              <p className="text-xs text-muted-foreground">{t("Carregando os modelos…")}</p>
            ) : (modelos ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="sem-modelo">
                {t(
                  "Nenhum modelo aprovado nesta conta. Crie e aprove o modelo na Meta, sincronize em Conexões › Modelos, e volte.",
                )}
              </p>
            ) : (
              <Select
                value={
                  config.modelo_nome === undefined || config.modelo_nome === ""
                    ? ""
                    : `${String(config.modelo_nome)}|${String(config.modelo_idioma)}`
                }
                onValueChange={(v) => {
                  const [nome, idioma] = v.split("|");
                  // Trocar de modelo zera os valores: as variáveis de um não são
                  // as do outro, e aproveitá-las mandaria o texto errado nas
                  // lacunas certas — o pior tipo de mensagem enviada.
                  mudar({ modelo_nome: nome, modelo_idioma: idioma, modelo_valores: {} });
                }}
              >
                <SelectTrigger data-testid="campo-modelo">
                  <SelectValue placeholder={t("Escolha o modelo")} />
                </SelectTrigger>
                <SelectContent>
                  {(modelos ?? []).map((m) => (
                    <SelectItem key={`${m.name}|${m.language}`} value={`${m.name}|${m.language}`}>
                      {m.name} ({m.language})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Dica
              texto={t(
                "Fora da janela de 24 horas, este número só entrega modelo aprovado — é regra da Meta, não do produto.",
              )}
            />
          </Campo>
        )}

        {modeloEscolhido !== null &&
          modeloEscolhido.slots.map((slot) => (
            <Campo key={slot.key} rotulo={t("Valor de {k}").replace("{k}", slot.key)}>
              <Input
                value={valores[slot.key] ?? ""}
                onChange={(e) =>
                  mudar({ modelo_valores: { ...valores, [slot.key]: e.target.value } })
                }
                data-testid={`campo-valor-${slot.key}`}
              />
            </Campo>
          ))}
      </Secao>

      <Secao titulo={t("Para quem")}>
        <Campo rotulo={t("De onde vêm os números")}>
          <Select value={audiencia} onValueChange={(v) => mudar({ audiencia: v })}>
            <SelectTrigger data-testid="campo-audiencia">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tags">{t("Todo mundo com um marcador")}</SelectItem>
              <SelectItem value="lista_fixa">{t("Uma lista fixa de contatos")}</SelectItem>
            </SelectContent>
          </Select>
          <Dica
            texto={
              audiencia === "tags"
                ? t(
                    "A lista é recortada na hora de cada execução — quem ganhar o marcador depois também entra.",
                  )
                : t("A lista é a mesma toda vez, não importa quem entrou na base depois.")
            }
          />
        </Campo>

        {audiencia === "tags" ? (
          <Campo rotulo={t("Marcadores")}>
            <Input
              value={tags.join(", ")}
              placeholder={t("clientes, black-friday")}
              onChange={(e) =>
                mudar({
                  tags: e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter((x) => x !== ""),
                })
              }
              data-testid="campo-tags-do-disparo"
            />
            <Dica texto={t("Separe por vírgula. Quem tiver QUALQUER um deles entra na lista.")} />
          </Campo>
        ) : (
          <Campo rotulo={t("Planilha de contatos")}>
            <ImportadorDeLista
              quantos={contatos.length}
              aoImportar={(ids) => mudar({ contatos: ids })}
            />
            <Dica
              texto={t(
                "A planilha é resolvida em contatos AGORA, e a lista fica congelada no bloco. Quem entrar na base depois não recebe — para isso, use marcador.",
              )}
            />
          </Campo>
        )}
      </Secao>

      <Secao titulo={t("Como disparar")}>
        <Campo rotulo={t("Segundos entre uma mensagem e outra")}>
          <Input
            type="number"
            min={1}
            max={600}
            value={Math.round(Number(config.intervalo_ms ?? 5000) / 1000)}
            onChange={(e) =>
              mudar({ intervalo_ms: Math.max(1, Number(e.target.value)) * 1000 })
            }
            data-testid="campo-intervalo-do-disparo"
          />
          <Dica
            texto={t(
              "O sistema nunca dispara mais rápido que o mínimo do número escolhido, mesmo que você peça.",
            )}
          />
        </Campo>

        <Campo rotulo={t("Começar sozinho?")}>
          <Select
            value={config.comecar_sozinho === true ? "sim" : "nao"}
            onValueChange={(v) => mudar({ comecar_sozinho: v === "sim" })}
          >
            <SelectTrigger data-testid="campo-comecar-sozinho">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nao">{t("Não — deixar em rascunho para revisão")}</SelectItem>
              <SelectItem value="sim">{t("Sim — disparar assim que for criado")}</SelectItem>
            </SelectContent>
          </Select>
          <Dica
            texto={
              config.comecar_sozinho === true
                ? t(
                    "Ninguém confere a lista antes. Use só quando o fluxo já roda há tempo e você confia no recorte.",
                  )
                : t(
                    "A campanha nasce em rascunho e abre um aviso na Central. Alguém confere quantos vão receber e aperta o botão.",
                  )
            }
          />
        </Campo>
      </Secao>
    </div>
  );
}
