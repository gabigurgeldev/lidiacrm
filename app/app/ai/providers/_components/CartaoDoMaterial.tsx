"use client";

/**
 * "Seu material" — o modelo que indexa e consulta os documentos do agente.
 *
 * É um cartão à parte, e não mais um ponto da lista, por três razões que a
 * pessoa precisa ver ANTES de clicar em salvar:
 *
 *  - indexar e buscar mudam juntos (um sem o outro faz o agente parar de
 *    achar o material, sem erro nenhum);
 *  - trocar de modelo reindexa todo o material — e isso custa dinheiro, então
 *    a estimativa aparece na confirmação;
 *  - durante a reindexação o agente continua achando tudo (a busca usa o
 *    modelo de cada material), e o progresso fica visível aqui.
 *
 * A gravação passa por `/api/v1/ai/providers/embedding`, que prova o modelo
 * com uma chamada de verdade antes de gravar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Campo, Dica, Grupo, Linha } from "@/components/ajustes";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";

interface DadosDoMaterial {
  atual: {
    mapa: string;
    rotulo: string;
    provider: string | null;
    model_id: string | null;
    credential_id: string | null;
    escolhido_no_painel: boolean;
    chave: { explicacao: string; avisos: string[] } | null;
  };
  progresso: { materiais: number; no_modelo_atual: number };
  estimativa: {
    mapa: string;
    materiais_para_reindexar: number;
    trechos: number;
    tokens: number;
    custo_estimado_centavos: number | null;
  } | null;
  catalogo: Array<{
    mapa: string;
    rotulo: string;
    quando_usar: string;
    centavos_por_milhao: number;
    provedores: Array<{ provider: string; model_id: string }>;
  }>;
  provedores: string[];
  pode_editar: boolean;
}

interface Credencial {
  id: string;
  provider: string;
  label: string;
  api_key_last4: string | null;
}

const NOME: Record<string, string> = { openai: "OpenAI", openrouter: "OpenRouter", google: "Google" };
const OUTRO = "__outro__";

function custoLegivel(centavos: number | null, t: (s: string) => string): string {
  if (centavos === null) return t("custo desconhecido");
  if (centavos < 1) return t("menos de 1 centavo de dólar");
  return `${t("cerca de")} US$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;
}

export function CartaoDoMaterial({ credenciais }: { credenciais: Credencial[] }) {
  const t = useT();
  const [dados, setDados] = useState<DadosDoMaterial | null>(null);
  const [provider, setProvider] = useState("");
  const [modelo, setModelo] = useState("");
  const [modeloProprio, setModeloProprio] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [confirmando, setConfirmando] = useState<DadosDoMaterial["estimativa"]>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async (consulta = "") => {
    const res = await fetch(`/api/v1/ai/providers/embedding${consulta}`);
    if (!res.ok) return null;
    return ((await res.json()) as { data: DadosDoMaterial }).data;
  }, []);

  useEffect(() => {
    let vivo = true;
    void carregar().then((d) => {
      if (!vivo || !d) return;
      setDados(d);
      setProvider(d.atual.provider ?? "openai");
      setModelo(d.atual.model_id ?? "");
      setCredentialId(d.atual.credential_id ?? "");
    });
    return () => {
      vivo = false;
    };
  }, [carregar]);

  const modelosDoProvedor = useMemo(
    () =>
      (dados?.catalogo ?? []).flatMap((m) =>
        m.provedores.filter((p) => p.provider === provider).map((p) => ({ ...m, model_id: p.model_id })),
      ),
    [dados, provider],
  );
  const idEscolhido = modelo === OUTRO ? modeloProprio.trim() : modelo;
  const chavesDoProvedor = credenciais.filter((c) => c.provider === provider);

  if (!dados) {
    return (
      <Grupo titulo={t("Seu material")} testid="cartao-material">
        <Linha titulo={t("Carregando…")} />
      </Grupo>
    );
  }

  const emTransicao = dados.progresso.materiais > 0 && dados.progresso.no_modelo_atual < dados.progresso.materiais;
  const igualAoAtual =
    idEscolhido === (dados.atual.model_id ?? "") &&
    provider === (dados.atual.provider ?? "") &&
    credentialId === (dados.atual.credential_id ?? "");

  async function pedirConfirmacao() {
    const d = await carregar(`?provider=${encodeURIComponent(provider)}&model_id=${encodeURIComponent(idEscolhido)}`);
    if (!d) {
      toast.error(t("não consegui calcular a estimativa"));
      return;
    }
    if (d.estimativa === null) {
      // Mesmo mapa (só trocou a chave ou o provedor que serve o mesmo modelo):
      // nada a reindexar, salva direto.
      await salvar();
      return;
    }
    setConfirmando(d.estimativa);
  }

  async function salvar() {
    setSalvando(true);
    try {
      const res = await fetch("/api/v1/ai/providers/embedding", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, model_id: idEscolhido, credential_id: credentialId || null }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ? t(json.error.message) : t("não consegui salvar"));
        return;
      }
      const r = json.data as { rotulo: string; materiais_para_reindexar: number; avisos: string[] };
      toast.success(
        r.materiais_para_reindexar > 0
          ? `${t("Agora o material usa")} ${r.rotulo}. ${r.materiais_para_reindexar} ${t("material(is) sendo reindexado(s).")}`
          : `${t("Agora o material usa")} ${r.rotulo}.`,
      );
      r.avisos.forEach((a) => toast.warning(t(a)));
      const novo = await carregar();
      if (novo) setDados(novo);
    } finally {
      setSalvando(false);
      setConfirmando(null);
    }
  }

  return (
    <>
      <Grupo
        titulo={t("Seu material")}
        testid="cartao-material"
        rodape={t(
          "Embedding transforma texto em números para o agente achar o trecho certo dos seus documentos. Não é o modelo que conversa com o cliente. Indexar e buscar usam sempre o mesmo modelo, com 1536 dimensões.",
        )}
      >
        <Linha
          titulo={t("Modelo em uso")}
          descricao={dados.atual.chave ? t(dados.atual.chave.explicacao) : t("Sem chave: o material não é indexado nem consultado.")}
          valor={<span data-testid="material-modelo-atual">{dados.atual.rotulo}</span>}
        />
        {dados.progresso.materiais > 0 && (
          <Linha
            titulo={t("Materiais no modelo em uso")}
            descricao={
              emTransicao
                ? t("Reindexando. Enquanto isso o agente continua achando tudo, cada material pelo seu modelo.")
                : t("Todo o material está no modelo em uso.")
            }
            valor={<span data-testid="material-progresso">{`${dados.progresso.no_modelo_atual} / ${dados.progresso.materiais}`}</span>}
          />
        )}
        {dados.atual.chave?.avisos.map((a) => <Linha key={a} titulo={t("Atenção")} descricao={t(a)} />)}

        {dados.pode_editar && (
          <>
            <Campo rotulo={t("Provedor")}>
              <Select
                value={provider}
                onValueChange={(v) => {
                  setProvider(v);
                  setModelo("");
                  setCredentialId("");
                }}
              >
                <SelectTrigger data-testid="material-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dados.provedores.map((p) => (
                    <SelectItem key={p} value={p}>
                      {NOME[p] ?? p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo rotulo={t("Modelo")}>
              <Select value={modelo} onValueChange={setModelo}>
                <SelectTrigger data-testid="material-modelo">
                  <SelectValue placeholder={t("escolha")} />
                </SelectTrigger>
                <SelectContent>
                  {modelosDoProvedor.map((m) => (
                    <SelectItem key={m.model_id} value={m.model_id}>
                      {m.rotulo}
                    </SelectItem>
                  ))}
                  <SelectItem value={OUTRO}>{t("Outro (digitar o nome)")}</SelectItem>
                </SelectContent>
              </Select>
              {modelo === OUTRO ? (
                <>
                  <Input
                    value={modeloProprio}
                    onChange={(e) => setModeloProprio(e.target.value)}
                    placeholder="ex.: qwen/qwen3-embedding-8b"
                    data-testid="material-modelo-proprio"
                  />
                  <Dica
                    texto={t(
                      "Ao salvar, testamos o modelo com uma chamada de verdade: ele precisa entregar 1536 dimensões com a sua chave.",
                    )}
                  />
                </>
              ) : (
                modelosDoProvedor.find((m) => m.model_id === modelo) && (
                  <Dica texto={t(modelosDoProvedor.find((m) => m.model_id === modelo)!.quando_usar)} />
                )
              )}
            </Campo>
            <Campo rotulo={t("Chave")}>
              <Select value={credentialId || "instalacao"} onValueChange={(v) => setCredentialId(v === "instalacao" ? "" : v)}>
                <SelectTrigger data-testid="material-chave">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instalacao">
                    {provider === "google" ? t("a cadastrada em Credenciais") : t("a da organização ou da instalação")}
                  </SelectItem>
                  {chavesDoProvedor.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label} ••{c.api_key_last4 ?? "??"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <div className="px-4 py-3">
              <Button
                size="sm"
                disabled={salvando || idEscolhido === "" || igualAoAtual}
                onClick={() => void pedirConfirmacao()}
                data-testid="material-salvar"
              >
                {salvando ? t("Testando e salvando…") : t("Salvar")}
              </Button>
            </div>
          </>
        )}
      </Grupo>

      <AlertDialog open={confirmando !== null} onOpenChange={(aberto) => !aberto && setConfirmando(null)}>
        <AlertDialogContent data-testid="material-confirmacao">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Trocar o modelo do seu material?")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {confirmando
                    ? `${confirmando.materiais_para_reindexar} ${t("material(is) será(ão) reindexado(s) automaticamente")} (${confirmando.trechos} ${t("trechos")}).`
                    : null}
                </p>
                <p data-testid="material-custo">
                  {`${t("Custo estimado:")} ${custoLegivel(confirmando?.custo_estimado_centavos ?? null, t)}`}
                </p>
                <p>
                  {t(
                    "Enquanto isso, o agente continua achando o conteúdo pelo modelo atual. Nada é apagado: cada material troca de modelo quando a reindexação dele termina.",
                  )}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void salvar()} data-testid="material-confirmar">
              {t("Trocar e reindexar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
