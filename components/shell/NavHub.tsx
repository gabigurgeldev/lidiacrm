import { Grupo, Linha, PaginaAjustes } from "@/components/ajustes";
import type { Role } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO, type Idioma } from "@/lib/i18n/idiomas";
import { hubSections, type NavGroupId } from "@/lib/navigation/registry";

interface NavHubProps {
  group: NavGroupId;
  isPlatformAdmin: boolean;
  role: Role | null;
  title: string;
  subtitle: string;
  /**
   * Idioma da interface. `traduzir` é pura — roda em Server Component sem
   * provider. O default mantém os demais hubs (ex.: /app/ai) como estão até
   * que a página deles passe o locale; o que não tem entrada no dicionário
   * degrada para pt-BR, que é o comportamento de antes.
   */
  locale?: Idioma;
}

/**
 * Vitrine de um grupo do registro de navegação.
 *
 * O sidebar carrega o uso diário; o hub carrega o inventário — todas as telas
 * do grupo, cada uma com a frase que explica para que serve. Era isso que
 * faltava: telas como Conhecimento e Credenciais existiam só como aba dentro de
 * `/app/ai`, invisíveis para quem ainda não estava lá.
 *
 * As seções vêm do campo `section` do registro e são a JORNADA de quem usa o
 * grupo (montar → ensinar → acompanhar), não uma taxonomia técnica. Reordenar a
 * jornada é reordenar o array do registro.
 */
/**
 * `aria-labelledby` separa múltiplos ids por ESPAÇO — então um id com espaço
 * ("hub-ia-Ensinar o agente") vira três referências quebradas e a seção fica sem
 * rótulo acessível. O slug é o que mantém a região anunciável.
 */
function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function NavHub({ group, isPlatformAdmin, role, title, subtitle, locale = IDIOMA_PADRAO }: NavHubProps) {
  const secoes = hubSections(group, isPlatformAdmin, role);

  // No kit de Ajustes: uma lista agrupada por etapa da jornada, cada linha com
  // a frase que diz para que a tela serve. Era uma grade de cartões soltos —
  // o único hub do produto que não falava a linguagem das telas a que leva.
  return (
    <PaginaAjustes titulo={traduzir(title, locale)} descricao={subtitle ? traduzir(subtitle, locale) : undefined}>
      {secoes.map(({ section, items }) => (
        <Grupo
          key={section}
          titulo={traduzir(section, locale)}
          idDoTitulo={`hub-${group}-${slug(section)}`}
          recuo="icone"
          className="max-w-3xl"
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Linha
                key={item.href}
                href={item.href}
                icone={<Icon size={18} weight="regular" />}
                disco
                titulo={traduzir(item.label, locale)}
                descricao={traduzir(item.description, locale)}
              />
            );
          })}
        </Grupo>
      ))}
    </PaginaAjustes>
  );
}
