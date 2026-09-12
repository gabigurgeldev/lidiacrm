"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { useAttendants } from "@/hooks/team/useAttendants";

import { CampoComVariavel } from "./CampoComVariavel";
import { SeletorDeCanal, useConexoesParaEnvio } from "./SeletorDeCanal";
import { SeletorDeModelo } from "./SeletorDeModelo";
import { Campo, Dica, Secao, type PropsDoFormulario } from "./shared";

/**
 * `whatsapp.notify_user` — avisa a EQUIPE, nunca o cliente.
 *
 * ## Duas mudanças que se encontraram aqui
 *
 * O destinatário por número fixo veio de outra frente (o bloco tinha um
 * destinatário só, o dono atual do lead, e quem quisesse avisar o gerente ou o
 * plantão não tinha caminho). O arquivo-por-bloco veio desta. As duas tocaram o
 * mesmo painel, e o conflito foi resolvido mantendo a estrutura nova e trazendo
 * a funcionalidade inteira para cá — que é o ponto do arquivo-por-bloco: a
 * próxima mudança neste bloco mexe só neste arquivo.
 *
 * ## Por que o telefone não tem máscara nem regex aqui
 *
 * Porque o valor pode ser um template (`{{vars.plantao}}`), e o `+` literal só
 * existe depois do `ctx.render`. Quem valida é `telefoneEmE164`, no `execute` —
 * e número fora do formato sai pela saída "Sem telefone cadastrado", que já
 * existe. Validar na tela recusaria a variável que é o caso mais útil.
 *
 * ## Por onde enviar, e por que faltava
 *
 * Sem o seletor, o aviso saía sempre pela conexão mais ANTIGA da organização —
 * e, quando nenhuma estava conectada, por qualquer uma. Numa instalação com dois
 * números (o do comercial e o do suporte, digamos), o aviso ia pelo errado sem
 * nada dizer, e não havia onde escolher.
 *
 * ## Avisar uma PESSOA, e o alerta de quem não tem telefone
 *
 * A terceira opção manda para alguém da equipe que não é quem está com o lead.
 * A tela marca quem ainda não tem telefone de aviso cadastrado porque esse é o
 * caso que o bloco não consegue resolver — e descobrir isso só quando o lead
 * chega, sem mensagem nenhuma, é o defeito que este bloco já teve.
 */
export function WhatsappNotifyUserForm({ config, aoMudarConfig }: PropsDoFormulario) {
  const t = useT();
  const { data } = useAttendants();
  const equipe = data?.data ?? [];
  const mudar = (patch: Record<string, unknown>) => aoMudarConfig({ ...config, ...patch });

  const destinatario = (config.destinatario ?? { tipo: "dono_do_lead" }) as {
    tipo?: string;
    telefone?: string;
    user_id?: string;
  };
  const tipo = destinatario.tipo ?? "dono_do_lead";
  const escolhida = equipe.find((a) => a.user_id === destinatario.user_id);

  const canalId = (config.canal_id as string | null) ?? null;
  const { data: conexoes } = useConexoesParaEnvio();
  const conexao = (conexoes ?? []).find((c) => c.id === canalId) ?? null;
  // A conexão que SÓ entrega modelo tira a escolha, como no envio ao cliente.
  const soModelo = conexao?.modo === "template";
  const modo = soModelo ? "template" : String(config.modo ?? "freeform");
  const porModelo = modo === "template";

  const trocarTipo = (v: string) => {
    if (v === "telefone") {
      mudar({ destinatario: { tipo: "telefone", telefone: destinatario.telefone ?? "" } });
      return;
    }
    if (v === "usuario") {
      // Nasce com a primeira pessoa da equipe, e não vazio: `user_id` tem
      // `min(1)` no schema, e um bloco que nasce inválido não desenha as saídas.
      const primeira = equipe[0]?.user_id ?? "";
      mudar({ destinatario: { tipo: "usuario", user_id: destinatario.user_id ?? primeira } });
      return;
    }
    mudar({ destinatario: { tipo: "dono_do_lead" } });
  };

  return (
    <div className="flex flex-col gap-4">
      <Secao>
        <Campo rotulo={t("Para quem")}>
          <Select value={tipo} onValueChange={trocarTipo}>
            <SelectTrigger data-testid="campo-destinatario-do-aviso">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dono_do_lead">{t("Quem está com o lead")}</SelectItem>
              <SelectItem value="usuario">{t("Uma pessoa da equipe")}</SelectItem>
              <SelectItem value="telefone">{t("Um número fixo")}</SelectItem>
            </SelectContent>
          </Select>
        </Campo>

        {tipo === "telefone" && (
          <Campo rotulo={t("Número que recebe o aviso")}>
            <CampoComVariavel
              valor={String(destinatario.telefone ?? "")}
              maxLength={64}
              placeholder="+55 11 99999-8888"
              aoMudar={(v) => mudar({ destinatario: { tipo: "telefone", telefone: v } })}
              testid="campo-telefone-do-aviso"
            />
            <Dica
              texto={t(
                "Com DDI. Número fora do formato segue pela saída 'Sem telefone cadastrado'.",
              )}
            />
          </Campo>
        )}

        {tipo === "usuario" && (
          <Campo rotulo={t("Quem da equipe recebe o aviso")}>
            {equipe.length === 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="sem-equipe-para-avisar">
                {t("Ninguém na equipe ainda. Convide alguém em Equipe para poder escolher.")}
              </p>
            ) : (
              <Select
                value={String(destinatario.user_id ?? "")}
                onValueChange={(v) => mudar({ destinatario: { tipo: "usuario", user_id: v } })}
              >
                <SelectTrigger data-testid="campo-pessoa-do-aviso">
                  <SelectValue placeholder={t("Escolha a pessoa")} />
                </SelectTrigger>
                <SelectContent>
                  {equipe.map((a) => (
                    <SelectItem key={a.user_id} value={a.user_id}>
                      {a.name ?? a.email ?? a.user_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {escolhida !== undefined && escolhida.notification_phone === null && (
              <Dica
                texto={t(
                  "Esta pessoa ainda não tem telefone de aviso. Cadastre em Equipe › Atendimento, no botão Editar horário — sem ele o aviso não sai.",
                )}
              />
            )}
          </Campo>
        )}

        {tipo === "dono_do_lead" && (
          <Campo rotulo={t("De onde vem o telefone")}>
            <Dica
              texto={t(
                "O telefone de aviso de cada pessoa fica em Equipe › Atendimento, no botão Editar horário. Sem ele, o fluxo segue pela saída 'Sem telefone cadastrado'.",
              )}
            />
          </Campo>
        )}

        <Campo rotulo={t("Como enviar")}>
          {soModelo ? (
            <p className="text-xs text-muted-foreground" data-testid="so-modelo">
              {t(
                "Esta conexão só entrega modelo aprovado — é regra da plataforma. Escolha o modelo abaixo.",
              )}
            </p>
          ) : (
            <Select value={modo} onValueChange={(v) => mudar({ modo: v })}>
              <SelectTrigger data-testid="campo-modo-de-envio">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="freeform">{t("Escrever a mensagem")}</SelectItem>
                <SelectItem value="template">{t("Usar um modelo aprovado")}</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Dica
            texto={t(
              "Numa conexão oficial, o vendedor que não escreve há mais de 24 horas só recebe modelo aprovado — e é ele quem precisa ser avisado.",
            )}
          />
        </Campo>

        {porModelo && <SeletorDeModelo canalId={canalId} config={config} mudar={mudar} />}

        {!porModelo && (
          <Campo rotulo={t("Mensagem para o vendedor")}>
            <CampoComVariavel
              multilinha
              linhas={6}
              maxLength={4000}
              valor={String(config.mensagem ?? "")}
              aoMudar={(v) => mudar({ mensagem: v })}
              testid="campo-mensagem-do-aviso"
            />
          </Campo>
        )}
      </Secao>

      <div className="space-y-1.5">
        <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("Por onde enviar")}
        </p>
        <SeletorDeCanal
          valor={canalId}
          aoEscolher={(id) => {
            // Mesma razão do bloco de envio ao cliente: trocar para uma conexão
            // que só entrega modelo GRAVA o modo. Sem isto, a tela mostraria o
            // seletor e o grafo publicado continuaria dizendo "freeform".
            const nova = (conexoes ?? []).find((c) => c.id === id) ?? null;
            mudar({ canal_id: id, ...(nova?.modo === "template" ? { modo: "template" } : {}) });
          }}
        />
      </div>
    </div>
  );
}
