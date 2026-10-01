/**
 * O teto do `proxy.ts` cobre todo upload que alguma rota aceita.
 *
 * O Next corta em 10 MB, SEM erro, o corpo que passa pelo proxy. Em produção
 * (2026-10-01) o disparo com vídeo de 12 MB chegava truncado à rota, que aceita
 * até 16 MB: `req.formData()` falhava e a tela dizia "Campo 'file' (multipart)
 * obrigatório". Nada nos testes da rota pegaria isso — o corte acontece antes
 * dela. Este arquivo amarra os dois lados: o limite que cada rota DECLARA e o
 * teto que o `next.config.ts` CONFIGURA.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LIMITE_DO_CORPO_DA_REQUISICAO } from "@/lib/http/limite-do-corpo";
import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";

const MB = 1024 * 1024;

function rotas(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return rotas(caminho);
    return nome === "route.ts" ? [caminho] : [];
  });
}

/** Rotas que leem multipart, com os limites em bytes escritos no arquivo. */
function limitesDeclarados(): Array<{ rota: string; bytes: number }> {
  return rotas("app/api")
    .map((rota) => ({ rota, texto: readFileSync(rota, "utf8") }))
    .filter(({ texto }) => /\.formData\(\)/.test(texto))
    .flatMap(({ rota, texto }) => {
      const literais = [...texto.matchAll(/(\d+(?:\.\d+)?)\s*\*\s*(?:MB\b|1_?024\s*\*\s*1_?024)/g)].map(
        (m) => Number(m[1]) * MB,
      );
      const constantes = /\bMAX_MEDIA_BYTES\b/.test(texto) ? [MAX_MEDIA_BYTES] : [];
      return [...literais, ...constantes].map((bytes) => ({ rota, bytes }));
    });
}

describe("o teto do corpo cobre os uploads", () => {
  it("a varredura enxerga os limites (controle positivo)", () => {
    const achados = limitesDeclarados();
    // O vídeo do disparo (16 MB) e a mídia da conversa (50 MB) são os dois que
    // já foram cortados; se a varredura não os vê, ela está cega.
    expect(achados).toContainEqual({ rota: join("app/api/v1/bulk-sends/media/route.ts"), bytes: 16 * MB });
    expect(achados.some((a) => a.bytes === MAX_MEDIA_BYTES)).toBe(true);
  });

  it("nenhuma rota aceita mais do que o proxy deixa chegar", () => {
    const acima = limitesDeclarados().filter((a) => a.bytes >= LIMITE_DO_CORPO_DA_REQUISICAO);
    expect(acima).toEqual([]);
  });

  it("o teto fica acima do padrão de 10 MB do Next", () => {
    expect(LIMITE_DO_CORPO_DA_REQUISICAO).toBeGreaterThan(10 * MB);
  });

  it("o next.config.ts aplica o teto ao proxy", () => {
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toMatch(/proxyClientMaxBodySize:\s*LIMITE_DO_CORPO_DA_REQUISICAO/);
  });
});
