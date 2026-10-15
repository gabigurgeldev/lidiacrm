"use client";

import { useT } from "@/hooks/i18n/useT";
/**
 * AS SITUAÇÕES QUE ESTE AGENTE SABE CONDUZIR (skills, migration 0241).
 *
 * Cada habilidade é um roteiro para uma situação do atendimento — cliente
 * irritado, "cadê meu pedido", sintoma que pode ser urgência. O agente só lê o
 * roteiro inteiro quando a situação aparece na conversa.
 *
 * Três grupos, na ordem em que o dono precisa entendê-los:
 *
 *  1. **Sempre ligadas** — as universais da plataforma. Aparecem marcadas e
 *     travadas: não há o que decidir, e escondê-las faria o dono achar que o
 *     agente não sabe lidar com uma reclamação.
 *  2. **Da sua organização** — as que ela instalou do catálogo ou importou.
 *  3. **Por ramo** — as de nicho, agrupadas pelo MESMO rótulo do quadro pronto
 *     do onboarding ("Clínica, consultório ou salão").
 *
 * `value === null` é o PADRÃO (universais + as da organização) — o que todo
 * agente anterior a esta seção tem. O primeiro clique transforma o padrão numa
 * lista explícita, partindo do que a tela mostrava marcado: o dono nunca vê uma
 * caixa mudar sozinha.
 */
import Link from "next/link";

import { Label } from "@/components/ui/label";
import { PACOTES } from "@/lib/onboarding/pacotes-de-funil";

export interface HabilidadeDoCatalogo {
  name: string;
  description: string;
  /** Ramos da skill (vazio na universal). */
  nichos: string[];
  /** Universal da plataforma: vale sempre, não entra em `skill_names`. */
  universal: boolean;
  /** A organização tem versão própria (instalada do catálogo ou importada). */
  daOrganizacao: boolean;
}

interface Props {
  habilidades: HabilidadeDoCatalogo[];
  value: string[] | null;
  onChange: (nomes: string[] | null) => void;
  disabled?: boolean;
}

/** "loja-rastreio-de-pedido" → "Loja rastreio de pedido". O nome é dado, não interface. */
function rotuloDoNome(nome: string): string {
  const texto = nome.replace(/[-_]+/g, " ").trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function HabilidadesDoAgente({ habilidades, value, onChange, disabled = false }: Props) {
  const t = useT();
  const universais = habilidades.filter((h) => h.universal);
  const opcionais = habilidades.filter((h) => !h.universal);
  const daOrganizacao = opcionais.filter((h) => h.daOrganizacao);
  const porRamo = PACOTES.map((p) => ({
    pacote: p,
    itens: opcionais.filter((h) => !h.daOrganizacao && h.nichos.includes(p.id)),
  })).filter((g) => g.itens.length > 0);
  const marcadas = new Set(value ?? daOrganizacao.map((h) => h.name));

  function alternar(nome: string, marcado: boolean): void {
    const proximo = new Set(marcadas);
    if (marcado) proximo.add(nome);
    else proximo.delete(nome);
    onChange([...proximo].sort());
  }

  // Função de render, não componente: um componente declarado aqui dentro seria
  // um TIPO novo a cada render, e o React remontaria as caixas a cada clique.
  function caixa(h: HabilidadeDoCatalogo, travada = false) {
    const id = `habilidade-${h.name}`;
    return (
      <div key={h.name} className="flex items-start gap-2">
        {/* `input` nativo, como o ToolPicker e as bases ao lado: uma aparência só
            para o mesmo controle na mesma página. */}
        <input
          id={id}
          data-testid={id}
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
          checked={travada ? true : marcadas.has(h.name)}
          onChange={(e) => alternar(h.name, e.target.checked)}
          disabled={disabled || travada}
          aria-label={rotuloDoNome(h.name)}
        />
        <Label htmlFor={id} className="text-sm font-normal">
          <span className="font-medium">{rotuloDoNome(h.name)}</span>
          {travada ? <span className="ml-2 text-xs text-muted-foreground">{t("sempre ligada")}</span> : null}
          <span className="block text-xs text-muted-foreground">{h.description}</span>
        </Label>
      </div>
    );
  }

  return (
    <div className="ios-grupo space-y-4 p-4" data-testid="agente-habilidades">
      <div>
        <h3 className="text-sm font-medium">{t("Situações que ele sabe conduzir")}</h3>
        <p className="text-xs text-muted-foreground">
          {t(
            "Cada habilidade é um roteiro para uma situação do atendimento. O agente só lê o roteiro quando a situação aparece na conversa.",
          )}
        </p>
      </div>

      {habilidades.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="agente-sem-habilidades">
          {t("Nenhuma habilidade disponível ainda.")}
        </p>
      ) : null}

      {universais.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("Sempre ligadas")}</p>
          {universais.map((h) => caixa(h, true))}
        </div>
      ) : null}

      {daOrganizacao.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("Da sua organização")}
          </p>
          {daOrganizacao.map((h) => caixa(h))}
        </div>
      ) : null}

      {porRamo.map(({ pacote, itens }) => (
        <div key={pacote.id} className="space-y-2" data-testid={`habilidades-ramo-${pacote.id}`}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t(pacote.comoSeApresenta)}
          </p>
          {itens.map((h) => caixa(h))}
        </div>
      ))}

      {value === null && opcionais.length > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="agente-habilidades-padrao">
          {t(
            "Usando o padrão: as sempre ligadas e as da sua organização. Marque as do seu ramo para ele conduzir essas situações também.",
          )}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        <Link href="/app/ai/skills" className="font-medium text-foreground underline underline-offset-4">
          {t("Ver o catálogo de habilidades")}
        </Link>
      </p>
    </div>
  );
}
