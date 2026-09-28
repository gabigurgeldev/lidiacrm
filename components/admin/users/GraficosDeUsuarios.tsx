"use client";
/**
 * Gráficos do relatório de usuários (`/admin/users/relatorios`).
 *
 * ⚠️ TODOS DE UMA SÉRIE SÓ, na cor da marca — e isso é decisão, não economia.
 * A accent é da MARCA DA INSTALAÇÃO (white-label, `platform_branding`), então
 * não há como validar de antemão um par categórico com ela: qualquer segunda
 * cor fixa pode colidir com o verde de um cliente e o vermelho de outro. O
 * cinza neutro como segunda série reprova no piso de croma (lê como
 * "desabilitado"). Cadastros e acessos viram dois gráficos lado a lado — small
 * multiples — com a MESMA escala de tempo e nenhuma legenda para decodificar.
 *
 * Cada gráfico tem tooltip por barra e uma tabela equivalente em `<details>`:
 * cor nunca é o único canal, e quem usa leitor de tela lê a tabela.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";

const COR = "var(--color-accent)";
const EIXO = { fontSize: 11, fill: "var(--color-text-subtle)" };

function CaixaDoTooltip({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground">{titulo}</p>
      <p className="mt-0.5 font-semibold tabular-nums text-foreground">{valor}</p>
    </div>
  );
}

export function CartaoDeGrafico({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">{titulo}</h2>
      {subtitulo && <p className="mt-0.5 text-xs text-muted-foreground">{subtitulo}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SerieDiaria({
  dados,
  rotulo,
}: {
  dados: Array<{ dia: string; valor: number }>;
  /** Nome da medida, no singular/plural já resolvido pelo chamador. */
  rotulo: string;
}) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const dataCurta = (dia: string) =>
    new Date(`${dia}T00:00:00Z`).toLocaleDateString(idioma, {
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    });
  const total = dados.reduce((s, d) => s + d.valor, 0);

  return (
    <>
      {total === 0 ? (
        <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
          {t("Nada no período")}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={176}>
          <BarChart data={dados} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="0" />
            <XAxis
              dataKey="dia"
              tickFormatter={dataCurta}
              tick={EIXO}
              tickLine={false}
              axisLine={{ stroke: "var(--color-border-strong)" }}
              minTickGap={24}
            />
            <YAxis allowDecimals={false} tick={EIXO} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ fill: "var(--color-surface-elevated)" }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as { dia: string; valor: number } | undefined;
                if (!active || !p) return null;
                return <CaixaDoTooltip titulo={dataCurta(p.dia)} valor={`${p.valor} ${rotulo}`} />;
              }}
            />
            <Bar dataKey="valor" fill={COR} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          {t("Ver como tabela")}
        </summary>
        <div className="mt-2 max-h-48 overflow-auto rounded-md border">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">{t("Dia")}</th>
                <th className="px-3 py-1.5 text-right font-medium">{rotulo}</th>
              </tr>
            </thead>
            <tbody>
              {dados.map((d) => (
                <tr key={d.dia} className="border-t">
                  <td className="px-3 py-1">{dataCurta(d.dia)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{d.valor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

/**
 * Barras horizontais com o valor escrito na ponta — para poucas categorias
 * (papéis, top organizações) o número direto é mais rápido que o eixo.
 * Feito em HTML e não em recharts: é uma lista, e lista acessível de graça.
 */
export function BarrasHorizontais({
  itens,
  vazio,
}: {
  itens: Array<{ chave: string; rotulo: string; valor: number; href?: string }>;
  vazio: string;
}) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  if (itens.every((i) => i.valor === 0)) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{vazio}</p>;
  }
  return (
    <ul className="space-y-3">
      {itens.map((i) => (
        <li key={i.chave} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            {i.href ? (
              <a href={i.href} className="truncate hover:underline">
                {i.rotulo}
              </a>
            ) : (
              <span className="truncate">{i.rotulo}</span>
            )}
            <span className="shrink-0 font-semibold tabular-nums">{i.valor}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted" aria-hidden>
            <div
              className="h-2 rounded-full transition-[width]"
              style={{ width: `${(i.valor / max) * 100}%`, background: COR, minWidth: i.valor > 0 ? 4 : 0 }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
