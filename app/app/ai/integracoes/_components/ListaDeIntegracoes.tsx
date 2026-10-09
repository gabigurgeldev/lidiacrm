"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useApiErrorHandler } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Grupo, Linha } from "@/components/ajustes";
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
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { PlugsConnected, Plus } from "@/lib/ui/icons";

export interface IntegracaoDaLista {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: "generica" | "suporte_v1";
  base_url: string;
  auth_tipo: string;
  segredo_last4: string | null;
  identidade_modo: "nenhuma" | "email_otp";
  ativo: boolean;
  ultimo_teste_em: string | null;
  ultimo_teste_ok: boolean | null;
  ultimo_teste_erro: string | null;
  falhas_consecutivas: number;
  circuito_aberto_ate: string | null;
  endpoints: Array<{ id: string; modo: string; ativo: boolean }>;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function SeloDeSaude({ i }: { i: Pick<IntegracaoDaLista, "ativo" | "ultimo_teste_ok" | "circuito_aberto_ate" | "ultimo_teste_em"> }) {
  const t = useT();
  // O instante é lido UMA vez (estado), não a cada render: render tem de ser puro.
  const [agora] = useState(() => Date.now());
  if (!i.ativo) return <Badge variant="neutral">{t("Desligada")}</Badge>;
  if (i.circuito_aberto_ate && new Date(i.circuito_aberto_ate).getTime() > agora) {
    return <Badge variant="error">{t("Falhando — pausada")}</Badge>;
  }
  if (i.ultimo_teste_ok === false) return <Badge variant="warning">{t("Último teste falhou")}</Badge>;
  if (i.ultimo_teste_ok === true) return <Badge variant="success">{t("Conectada")}</Badge>;
  return <Badge variant="neutral">{t("Nunca testada")}</Badge>;
}

export function ListaDeIntegracoes({ integracoes, podeEscrever }: { integracoes: IntegracaoDaLista[]; podeEscrever: boolean }) {
  const t = useT();
  const [aberto, setAberto] = useState(false);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {podeEscrever ? (
        <div className="flex sm:justify-end">
          <Button onClick={() => setAberto(true)} className="w-full sm:w-auto" data-testid="nova-integracao">
            <Plus size={14} aria-hidden className="mr-2" /> {t("Nova integração")}
          </Button>
        </div>
      ) : null}

      {integracoes.length === 0 ? (
        <div className="ios-grupo flex flex-col items-center gap-3 p-10 text-center" data-testid="integracoes-vazio">
          <PlugsConnected size={28} aria-hidden className="text-muted-foreground" />
          <h2 className="font-medium">{t("Nenhum sistema conectado ainda")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {t(
              "Cadastre o endereço da API do seu sistema e os pontos que o agente pode chamar. Depois, marque esses pontos na tela do agente.",
            )}
          </p>
        </div>
      ) : (
        <Grupo testid="integracoes-lista">
          {integracoes.map((i) => {
            const leituras = i.endpoints.filter((e) => e.modo === "leitura" && e.ativo).length;
            const acoes = i.endpoints.filter((e) => e.modo === "acao" && e.ativo).length;
            return (
              <Linha
                key={i.id}
                href={`/app/ai/integracoes/${i.id}`}
                testid={`integracao-${i.id}`}
                titulo={i.nome}
                descricao={
                  <>
                    <span className="block truncate">{host(i.base_url)}</span>
                    {leituras} {leituras === 1 ? t("consulta") : t("consultas")} · {acoes}{" "}
                    {acoes === 1 ? t("correção") : t("correções")}
                    {i.identidade_modo === "email_otp" ? ` · ${t("verifica o dono por e-mail")}` : ""}
                    {i.tipo === "suporte_v1" ? ` · ${t("Contrato de Suporte v1")}` : ""}
                  </>
                }
                controle={<SeloDeSaude i={i} />}
              />
            );
          })}
        </Grupo>
      )}

      <NovaIntegracaoDialog open={aberto} onOpenChange={setAberto} />
    </div>
  );
}

function NovaIntegracaoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const router = useRouter();
  const tratarErro = useApiErrorHandler();
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<"generica" | "suporte_v1">("generica");
  const [baseUrl, setBaseUrl] = useState("https://");
  const [auth, setAuth] = useState<"nenhuma" | "bearer" | "header" | "hmac_sha256">("bearer");
  const [header, setHeader] = useState("");
  const [segredo, setSegredo] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(): Promise<void> {
    setSalvando(true);
    try {
      const criada = await apiClient.post<{ data: { id: string } }>("/api/v1/ai/integracoes", {
        nome,
        tipo,
        base_url: baseUrl,
        auth_tipo: tipo === "suporte_v1" ? "suporte_v1" : auth,
        ...(tipo !== "suporte_v1" && auth === "header" ? { auth_header_nome: header } : {}),
        identidade_modo: tipo === "suporte_v1" ? "email_otp" : "nenhuma",
      });
      if (segredo.trim().length > 0) {
        await apiClient.put(`/api/v1/ai/integracoes/${criada.data.id}/segredo`, { segredo: segredo.trim() });
      }
      toast.success(t("Integração criada."));
      onOpenChange(false);
      router.push(`/app/ai/integracoes/${criada.data.id}`);
    } catch (err) {
      tratarErro(err);
    } finally {
      setSalvando(false);
    }
  }

  const precisaSegredo = tipo === "suporte_v1" || auth !== "nenhuma";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Nova integração")}</DialogTitle>
          <DialogDescription>
            {t("O endereço e a chave ficam guardados; a chave é criptografada e não aparece de novo.")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="int-nome">{t("Nome do sistema")}</Label>
            <Input id="int-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder={t("ex.: Minha loja")} />
          </div>
          <div className="space-y-1">
            <Label>{t("Tipo")}</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
              <SelectTrigger data-testid="int-tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="generica">{t("API qualquer (eu cadastro os endpoints)")}</SelectItem>
                <SelectItem value="suporte_v1">{t("Contrato de Suporte v1 (importa o catálogo)")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="int-url">{t("Endereço base da API")}</Label>
            <Input id="int-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.exemplo.com/v1" />
          </div>
          {tipo === "generica" ? (
            <div className="space-y-1">
              <Label>{t("Como autenticar")}</Label>
              <Select value={auth} onValueChange={(v) => setAuth(v as typeof auth)}>
                <SelectTrigger data-testid="int-auth">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bearer">{t("Token no cabeçalho Authorization (Bearer)")}</SelectItem>
                  <SelectItem value="header">{t("Chave num cabeçalho próprio")}</SelectItem>
                  <SelectItem value="hmac_sha256">{t("Assinatura HMAC-SHA256")}</SelectItem>
                  <SelectItem value="nenhuma">{t("Sem autenticação")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {tipo === "generica" && auth === "header" ? (
            <div className="space-y-1">
              <Label htmlFor="int-header">{t("Nome do cabeçalho")}</Label>
              <Input id="int-header" value={header} onChange={(e) => setHeader(e.target.value)} placeholder="X-Api-Key" />
            </div>
          ) : null}
          {precisaSegredo ? (
            <div className="space-y-1">
              <Label htmlFor="int-segredo">{t("Chave de acesso")}</Label>
              <Input id="int-segredo" type="password" autoComplete="off" value={segredo} onChange={(e) => setSegredo(e.target.value)} />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancelar")}
          </Button>
          <Button onClick={() => void salvar()} disabled={salvando || nome.trim().length === 0} data-testid="int-salvar">
            {salvando ? t("Salvando…") : t("Criar integração")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
