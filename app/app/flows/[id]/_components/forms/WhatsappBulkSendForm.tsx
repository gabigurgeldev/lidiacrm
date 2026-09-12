"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";

import { CampoComVariavel } from "./CampoComVariavel";
import { ImportadorDeLista } from "./ImportadorDeLista";
import { SeletorDeCanal, useConexoesParaEnvio } from "./SeletorDeCanal";
import { SeletorDeModelo } from "./SeletorDeModelo";
import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

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
 * ## A lista de modelos, e o defeito que ela tinha
 *
 * Ela sai agora de `SeletorDeModelo`, compartilhado com os dois blocos de envio
 * 1:1 — e a rota é escolhida pela CONEXÃO, não pela conta mais antiga da
 * organização. Duas coisas mudaram junto:
 *
 *   1. Este formulário lia `r.data.filter(...)` de uma rota que devolve
 *      `{ data: { waba, templates } }`. O `select` do react-query LANÇAVA, a
 *      query virava erro, e a tela renderizava "Nenhum modelo aprovado nesta
 *      conta. Crie e aprove o modelo na Meta…" — mandando o operador arrumar uma
 *      conta que estava certa. O modo de modelo do disparo por fluxo estava
 *      morto, e o sintoma acusava o inocente.
 *   2. A rota aceita `?canal_id=`, então uma organização com duas contas
 *      oficiais passa a ver os modelos da conexão que escolheu.
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


  const audiencia = String(config.audiencia ?? "tags");
  const tags = Array.isArray(config.tags) ? (config.tags as string[]) : [];
  const contatos = Array.isArray(config.contatos) ? (config.contatos as string[]) : [];

  return (
    <div className="flex flex-col gap-4">
      <Secao titulo={t("A campanha")}>
        <Campo rotulo={t("Nome da campanha")}>
          <CampoComVariavel
            valor={String(config.nome ?? "")}
            maxLength={120}
            aoMudar={(v) => mudar({ nome: v })}
            testid="campo-nome-do-disparo"
          />
          <Dica
            texto={t(
              "Aparece na tela de Disparos. Aceita variável — é o que distingue uma execução da outra.",
            )}
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
            <CampoComVariavel
              multilinha
              linhas={5}
              maxLength={4096}
              valor={String(config.texto ?? "")}
              aoMudar={(v) => mudar({ texto: v })}
              testid="campo-texto-do-disparo"
            />
          </Campo>
        )}

        {exigeModelo && <SeletorDeModelo canalId={canalId} config={config} mudar={mudar} />}
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
