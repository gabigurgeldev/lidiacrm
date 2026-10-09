"use client";
import Link from "next/link";

import { Campo, Grupo } from "@/components/ajustes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { rotuloDoEstadoDoCanal } from "@/lib/channels/estado";
import type { SelectableChannel } from "@/lib/channels/selectable";
import { Info } from "@/lib/ui/icons";

import type { PropsDaSecao } from "./estado";
import { ErroDoCampo } from "./pecas";

export function SecaoNumero({
  form,
  patch,
  disabled,
  erros,
  numeros,
  roteador,
}: PropsDaSecao & {
  numeros: SelectableChannel[];
  roteador: { routerId: string; routerName: string } | null;
}) {
  const t = useT();
  return (
    <Grupo
      titulo={t("Por qual número ele atende")}
      rodape={t("Mais de um agente pode atender o mesmo número: a lista de agentes mostra quem atende primeiro.")}
    >
      {roteador ? (
        <div className="flex items-start gap-2 px-4 py-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 shrink-0" aria-hidden />
          <p>
            {t("Este agente é acionado pelo roteador")}{" "}
            <Link href={`/app/ai/routers/${roteador.routerId}`} className="font-medium underline underline-offset-2">
              «{roteador.routerName}»
            </Link>{" "}
            {t("— o campo de número abaixo não se aplica.")}
          </p>
        </div>
      ) : null}
      <Campo rotulo={t("Número conectado")} htmlFor="channel_session_id">
        <Select
          value={form.channel_session_id || undefined}
          onValueChange={(v) => patch({ channel_session_id: v })}
          disabled={disabled}
        >
          <SelectTrigger id="channel_session_id">
            <SelectValue placeholder={t("Selecione um número")} />
          </SelectTrigger>
          <SelectContent>
            {numeros.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {/* O nome nunca é o identificador interno da sessão (ver
                    `nomeDoCanal`), e o estado passa pela mesma tradução que a
                    tela de Conexões usa. */}
                {s.display_name}
                {s.phone_number ? ` · ${s.phone_number}` : ""} · {rotuloDoEstadoDoCanal(s.status, t)}
              </SelectItem>
            ))}
            {numeros.length === 0 ? (
              <SelectItem value="__none__" disabled>
                {t("Nenhum número conectado")}
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        <ErroDoCampo texto={erros.channel_session_id} />
      </Campo>
    </Grupo>
  );
}
