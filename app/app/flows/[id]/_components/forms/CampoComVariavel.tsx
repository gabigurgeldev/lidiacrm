"use client";

import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { usePipelines } from "@/hooks/webhooks/useWebhookSources";
import {
  caminhoCompleto,
  folhasDeCamposDoFunil,
  RAIZES_EM_ORDEM,
  type FolhaDeVariavel,
} from "@/lib/flow-engine/catalogo-de-variaveis";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";

/**
 * UM CAMPO QUE ACEITA VARIÁVEL, com a lista do lado.
 *
 * ## O defeito que isto fecha
 *
 * Todo campo de fluxo que passa por `ctx.render` aceita `{{lead.title}}` e afins
 * — e a única pista disso era uma frase de ajuda escrita à mão em cada
 * formulário. As frases divergiam (o de aviso citava três campos, o de envio
 * citava outros três), nenhuma mencionava `{{vars.*}}`, e os campos do FUNIL —
 * que são os que carregam o dado do nicho — não apareciam em nenhuma.
 *
 * O custo disso não é conveniência. `{{lead.nome}}` não existe (o campo é
 * `title`), e `interpolar` troca marcador ausente por VAZIO de propósito —
 * mandar a chave crua ao cliente é pior que a lacuna. Ou seja: o erro de
 * digitação sai como mensagem torta, sem erro em lugar nenhum, para o cliente.
 *
 * ## Por que o componente desenha o CAMPO, e não só o botão
 *
 * Porque a alternativa era cada formulário criar o seu `useRef`, escrever o
 * splice do cursor e lembrar de pendurar o botão — dez vezes, e a décima
 * primeira esqueceria. Assim o par campo+botão nasce junto, e
 * `tests/unit/campo-que-interpola-tem-seletor.test.ts` consegue cobrar a
 * presença lendo o formulário.
 *
 * ## Os dois modos, e por que a diferença não é cosmética
 *
 * `marcador` insere o caminho entre chaves duplas: é o que `ctx.render` procura.
 * `caminho` insere o caminho cru: é o que o campo da regra do bloco "Decidir"
 * espera — `lib/flow-engine/condicoes.ts` RESOLVE o caminho, não interpola. Pôr
 * chaves ali produz uma regra que nunca casa, e isso não dá erro: a condição
 * devolve falso, e o fluxo segue pelo outro lado para sempre.
 */
export type ModoDaVariavel = "marcador" | "caminho";

export function CampoComVariavel({
  valor,
  aoMudar,
  modo = "marcador",
  multilinha = false,
  linhas = 4,
  maxLength,
  placeholder,
  type,
  testid,
}: {
  valor: string;
  aoMudar: (valor: string) => void;
  modo?: ModoDaVariavel;
  multilinha?: boolean;
  linhas?: number;
  maxLength?: number;
  placeholder?: string;
  type?: string;
  testid?: string;
}) {
  const alvo = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  /**
   * Insere na POSIÇÃO DO CURSOR, não no fim. Quem escreve uma frase e volta o
   * cursor para o meio espera a variável ali — concatenar no fim obrigaria a
   * recortar e colar, que é justamente o que o botão existe para evitar.
   * Mecânica copiada de `app/app/webhooks/_components/ActionConfigForm.tsx`.
   */
  const inserir = (trecho: string) => {
    const el = alvo.current;
    const inicio = el?.selectionStart ?? valor.length;
    const fim = el?.selectionEnd ?? valor.length;
    const proximo = valor.slice(0, inicio) + trecho + valor.slice(fim);
    aoMudar(proximo);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(inicio + trecho.length, inicio + trecho.length);
    });
  };

  return (
    <div className="space-y-1.5">
      {multilinha ? (
        <Textarea
          ref={alvo}
          rows={linhas}
          maxLength={maxLength}
          placeholder={placeholder}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          data-testid={testid}
        />
      ) : (
        <Input
          ref={alvo}
          type={type}
          maxLength={maxLength}
          placeholder={placeholder}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          data-testid={testid}
        />
      )}
      <SeletorDeVariavel modo={modo} aoEscolher={inserir} />
    </div>
  );
}

/** O botão e a lista. Separado para o teste poder montá-lo sozinho. */
export function SeletorDeVariavel({
  modo,
  aoEscolher,
}: {
  modo: ModoDaVariavel;
  aoEscolher: (trecho: string) => void;
}) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [digitando, setDigitando] = useState<string | null>(null);
  const [livre, setLivre] = useState("");

  // Os campos do funil são a metade do catálogo que não cabe numa constante:
  // cada instalação tem os seus, e é ali que mora o dado do nicho (número do
  // pedido, data da consulta). Sem eles o seletor ofereceria o schema do
  // produto e esconderia o do cliente.
  const pipelines = usePipelines();
  const camposDoLead = useMemo(
    () =>
      folhasDeCamposDoFunil((pipelines.data?.data ?? []).flatMap((p) => camposDoFunil(p.settings))),
    [pipelines.data],
  );

  const limpar = () => {
    setBusca("");
    setDigitando(null);
    setLivre("");
  };

  const escolher = (raiz: string, caminho: string) => {
    const completo = caminhoCompleto(raiz, caminho);
    aoEscolher(modo === "marcador" ? "{{" + completo + "}}" : completo);
    setAberto(false);
    limpar();
  };

  const casa = (rotulo: string, caminho: string) => {
    const q = busca.trim().toLowerCase();
    return q === "" || rotulo.toLowerCase().includes(q) || caminho.toLowerCase().includes(q);
  };

  return (
    <Popover
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) limpar();
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" size="sm" data-testid="abrir-variaveis">
          {t("Inserir variável")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b p-2">
          <Input
            value={busca}
            placeholder={t("Procurar variável…")}
            onChange={(e) => setBusca(e.target.value)}
            data-testid="buscar-variavel"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {RAIZES_EM_ORDEM.map((grupo) => {
            const folhas: readonly FolhaDeVariavel[] =
              grupo.raiz === "lead" ? [...grupo.folhas, ...camposDoLead] : grupo.folhas;
            const visiveis = folhas.filter((f) => casa(f.rotulo, f.caminho));
            const mostrarGrupo = grupo.aberta ? busca.trim() === "" : visiveis.length > 0;
            if (!mostrarGrupo) return null;

            return (
              <div key={grupo.raiz} className="mb-1">
                <p className="px-2 pb-0.5 pt-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t(grupo.rotulo)}
                </p>

                {visiveis.map((f) => (
                  <button
                    key={f.caminho}
                    type="button"
                    onClick={() => escolher(grupo.raiz, f.caminho)}
                    data-testid={"variavel-" + caminhoCompleto(grupo.raiz, f.caminho)}
                    className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span>{t(f.rotulo)}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {caminhoCompleto(grupo.raiz, f.caminho)}
                    </span>
                  </button>
                ))}

                {/*
                  Raiz aberta: o conteúdo depende do fluxo, não do schema. Uma
                  lista fixa aqui mentiria — o que os blocos anteriores gravaram
                  só quem montou o fluxo sabe.
                */}
                {grupo.aberta &&
                  (digitando === grupo.raiz ? (
                    <div className="flex gap-1.5 px-2 py-1.5">
                      <Input
                        autoFocus
                        value={livre}
                        placeholder={t("nome_da_variavel")}
                        onChange={(e) => setLivre(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && livre.trim() !== "") {
                            e.preventDefault();
                            escolher(grupo.raiz, livre.trim());
                          }
                        }}
                        data-testid={"digitar-" + grupo.raiz}
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={livre.trim() === ""}
                        onClick={() => escolher(grupo.raiz, livre.trim())}
                      >
                        {t("Usar")}
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDigitando(grupo.raiz);
                        setLivre("");
                      }}
                      data-testid={"abrir-livre-" + grupo.raiz}
                      className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      <span className="text-muted-foreground">{t(grupo.descricao)}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {grupo.raiz}
                      </span>
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
