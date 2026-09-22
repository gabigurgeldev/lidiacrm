import { CascaDaCena } from "@/components/auth/CascaDaCena";
import { marcaDaSaida } from "@/lib/branding/saida";
import { createClient } from "@/lib/supabase/server";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

/**
 * A casca das telas de acesso — login, cadastro, recuperação, MFA.
 *
 * ── A composição ──────────────────────────────────────────────────────────────
 *
 * Uma cena 3D em vidro ocupa a tela inteira, e o formulário flutua sobre ela num
 * cartão de vidro fosco. Não há mais painel dividido: o vidro precisa de algo
 * atrás para refratar, e sobre o branco chapado do desenho anterior ele
 * simplesmente não aparecia.
 *
 * ⚠️ Isto já mudou DUAS vezes, e as duas foram decisão de quem é dono do
 * produto. Era preto com um modelo 3D; virou faixa verde com nuvens SVG (e o
 * three.js foi apagado); agora é cena de vidro em three.js de novo. Quem for
 * mexer aqui está desfazendo uma decisão, não consertando um deslize — vale a
 * pena perguntar antes.
 *
 * ── O vidro é de CHASSI, e isso é o que o torna legítimo ──────────────────────
 *
 * O anti-pattern 5 (glassmorphism) foi revogado em 2026-09-01, mas com uma
 * ressalva que sobreviveu: vidro só em superfície que existe UMA vez por tela.
 * Um cartão de login é exatamente isso. Os campos dentro dele NÃO são vidro —
 * vidro sobre vidro empasta, e destruiria a garantia de contraste abaixo.
 *
 * ── Por que o texto é legível sobre uma cena que se mexe ──────────────────────
 *
 * Não é por sorte nem por medição da cena. O cartão é `--color-surface` a 86%
 * de alfa (`--vidro-opacidade`), então o fundo composto fica SEMPRE entre
 * `rgb(219,219,219)` — cena preta atrás — e branco puro. Nos dois extremos
 * `--color-text` e `--color-text-muted` passam o piso de 4,5:1, o que os torna
 * seguros sobre QUALQUER cena, inclusive uma em movimento.
 *
 * Quem mede é `tests/unit/acesso-vidro-contraste.test.ts`, e ele reprova se
 * alguém baixar a opacidade. Baixá-la é a mudança que parece cosmética e
 * derruba a legibilidade da única tela por onde se entra.
 *
 * ── O logo voltou a ser UM só ─────────────────────────────────────────────────
 *
 * No desenho anterior eram dois elementos — a faixa sumia no celular e o logo
 * precisava reaparecer sobre o branco. Aqui o cartão é a mesma peça em toda
 * largura, e o logo mora nele. Como o cartão é claro, a arte é a NORMAL: a
 * troca para a versão branca de `SidebarBrand` não se aplica e seria um erro
 * (logo branco sobre cartão branco).
 *
 * ── Por que `marcaDaSaida(null)` ──────────────────────────────────────────────
 *
 * Aqui não existe organização resolvida: `null` é a declaração disso, e a pilha
 * resultante é a mesma do layout raiz (banco acima, `.env` embaixo). E
 * `marcaDaSaida` NUNCA lança (ver o cabeçalho dela): uma cor ou um logo mal
 * gravados não podem derrubar a única tela por onde se entra para corrigi-los.
 *
 * ── O NOME não é escrito em lugar nenhum, e isso é vigiado ────────────────────
 *
 * Removido a pedido de quem é dono do produto: o logo já o diz. Vale também
 * para `sr-only` — aquilo entra no `textContent`, e a sonda afirma que o valor
 * de `data-marca-do-ambiente` NÃO aparece escrito na página.
 *
 * ⚠️ Isso NÃO dispensou o cruzamento de `tests/e2e/icone-da-marca.spec.ts`, que
 * compara o título da aba (que lê `platform_branding` no banco) contra a marca
 * resolvida do `.env`. O transporte dessa segunda é `data-marca-do-ambiente`,
 * escrito em `login/page.tsx`. Ler o `alt` do logo no lugar PARECE equivalente e
 * não é: o `alt` sai de `marcaDaSaida`, a mesma pilha do título, e a spec
 * passaria a comparar o banco consigo mesma.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const marca = await marcaDaSaida(null);
  // A maioria destas telas roda ANTES do login (não há usuário nenhum), mas
  // duas — `/login/mfa` e, em parte, `/login/recovery` — rodam com uma sessão
  // parcial já criada. Onde há sessão, o idioma salvo no perfil vale; sem ela,
  // `IdiomaProvider` já cai no padrão pt-BR sozinho — nunca lança.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const locale = (user?.user_metadata?.locale as string | undefined) ?? null;

  return (
    <IdiomaProvider locale={locale}>
      <div className="relative flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6">
        <CascaDaCena />

        <main className="acesso-cartao ios-vidro acesso-entra w-full max-w-[27rem] px-6 py-9 sm:px-9 sm:py-10">
          <div className="space-y-7">
            {marca.logoUrl && (
              <div className="flex justify-center">
                {/*
                  <img> em vez de next/image pelo mesmo motivo do resto do
                  produto: a URL é de quem hospeda e o `next/image` exige
                  allowlist de domínios fechada em BUILD — a imagem pré-buildada
                  do self-host recusaria o domínio do operador.

                  O `alt` é o nome DESTA resolução (`marca.nome`), não o de
                  `branding()`: é a legenda da imagem que está ali.

                  O `data-testid` é lido por `tests/e2e/marca-logo.spec.ts`, que
                  prova que o logo da EMPRESA não vaza para a fachada. Sem ele a
                  spec caía na "primeira <img> da página", e uma asserção de
                  negação com seletor largo passa sozinha assim que outra imagem
                  entra na tela.
                */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  data-testid="logo-da-fachada"
                  src={marca.logoUrl}
                  alt={marca.nome}
                  className="h-10 w-auto max-w-[14rem] object-contain"
                />
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
    </IdiomaProvider>
  );
}
