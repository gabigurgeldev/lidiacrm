/**
 * Anexo marcado "guardar como material" vira documento na prévia do
 * construtor. Puro: a tela chama a cada mudança nos anexos e a cada prévia
 * nova (gerada ou refinada), e o resultado é sempre o mesmo para a mesma
 * entrada — anexo desmarcado sai, anexo marcado entra uma vez só.
 */
import { TETO_DE_MATERIAIS, type MaterialDaPrevia, type PreviaGerada } from "./esquemas";

/** O documento de um anexo leva este prefixo — é por ele que a prévia sabe qual material veio de anexo. */
export const PREFIXO_DO_ANEXO = "Anexo — ";
const TETO_DO_NOME = 120;
const TETO_DO_TEXTO = 60_000;

export interface AnexoParaGuardar {
  nome: string;
  texto: string;
  guardar: boolean;
}

const nomeDoMaterial = (a: AnexoParaGuardar) => `${PREFIXO_DO_ANEXO}${a.nome}`.slice(0, TETO_DO_NOME);

export function sincronizarAnexosGuardados(previa: PreviaGerada, anexos: readonly AnexoParaGuardar[]): PreviaGerada {
  const guardados = anexos.filter((a) => a.guardar && a.texto.trim().length > 0);
  const nomes = new Set(guardados.map(nomeDoMaterial));
  const outros = previa.materiais.filter((m) => !m.nome.startsWith(PREFIXO_DO_ANEXO) || nomes.has(m.nome));
  const jaTem = new Set(outros.map((m) => m.nome));
  const novos: MaterialDaPrevia[] = guardados
    .map((a) => ({ tipo: "documento" as const, nome: nomeDoMaterial(a), texto: a.texto.slice(0, TETO_DO_TEXTO) }))
    .filter((m) => !jaTem.has(m.nome));
  return { ...previa, materiais: [...outros, ...novos].slice(0, TETO_DE_MATERIAIS) };
}
