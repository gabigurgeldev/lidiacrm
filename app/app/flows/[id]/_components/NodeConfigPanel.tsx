"use client";

import { useT } from "@/hooks/i18n/useT";
import { Question } from "@/lib/ui/icons";

import { Aviso, type PropsDoFormulario } from "./forms/shared";
import { FORMULARIO_DO_TIPO } from "./nodeFormRegistry";
import {
  ICONE_DA_CATEGORIA,
  ICONE_DO_TIPO,
  VISUAL_DA_CATEGORIA,
  VISUAL_PADRAO,
} from "./nodeVisuals";

interface Props extends PropsDoFormulario {
  tipo: string;
  categoria: string;
}

/**
 * O cabeçalho do bloco e o formulário dele.
 *
 * Fino de propósito: escolhe o formulário no `nodeFormRegistry` e desenha em
 * volta. Toda a inteligência de cada bloco mora no arquivo do próprio bloco,
 * em `forms/` — este aqui nunca sabe o que é um "reencontro" ou um "operador".
 *
 * O disco do ícone repete a cor da categoria que o cartão no quadro usa. Não é
 * enfeite: é o que liga o que a pessoa clicou ao que ela está vendo aqui, sem
 * precisar ler o nome duas vezes.
 */
export function NodeConfigPanel({ tipo, categoria, ...props }: Props) {
  const t = useT();
  // Acesso de propriedade, nunca chamada de função: o linter do React Compiler
  // (`react-hooks/static-components`) trata QUALQUER chamada de função no
  // render como possível criação de componente — a mesma razão pela qual
  // `NoDoFluxo.tsx` também lê os mapas direto.
  const Icone = ICONE_DO_TIPO[tipo] ?? ICONE_DA_CATEGORIA[categoria] ?? Question;
  const visual = VISUAL_DA_CATEGORIA[categoria] ?? VISUAL_PADRAO;
  const Formulario = FORMULARIO_DO_TIPO[tipo];

  return (
    <div className="flex flex-col gap-4" data-testid="ajustes-do-no">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${visual.chip}`}
        >
          <Icone size={15} aria-hidden />
        </span>
        <p className="min-w-0 truncate text-sm font-medium" data-testid="tipo-do-no">
          {t(tipo)}
        </p>
      </div>

      {Formulario === undefined ? (
        <Aviso texto={t("Este bloco não tem ajustes.")} />
      ) : (
        <Formulario {...props} />
      )}
    </div>
  );
}
