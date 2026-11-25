"use client";
import { useEffect } from "react";

import { useUserOpcional } from "@/hooks/auth/AuthProvider";
import { definirSomDeAviso } from "@/lib/notifications/som";
import { resumeAudio } from "@/lib/notifications/sounds";

/**
 * Liga o som de aviso à casca:
 *
 *  1. sincroniza a preferência da pessoa (`AuthUser.som_de_aviso`, ausente =
 *     ligado) com `lib/notifications/som.ts`, que é quem decide se toca;
 *  2. destrava o áudio no PRIMEIRO gesto. O navegador não deixa página tocar
 *     som antes de a pessoa interagir com ela. Sem isto, o primeiro aviso da
 *     sessão sairia mudo, e o motivo não apareceria em lugar nenhum.
 */
export function useSomDeAviso(): void {
  const user = useUserOpcional();
  const ligado = user?.som_de_aviso !== false;

  useEffect(() => {
    definirSomDeAviso(ligado);
  }, [ligado]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const destravar = () => {
      void resumeAudio().catch(() => {});
      window.removeEventListener("pointerdown", destravar);
      window.removeEventListener("keydown", destravar);
    };
    window.addEventListener("pointerdown", destravar);
    window.addEventListener("keydown", destravar);
    return () => {
      window.removeEventListener("pointerdown", destravar);
      window.removeEventListener("keydown", destravar);
    };
  }, []);
}
