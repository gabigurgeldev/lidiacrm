/**
 * Guarda de "só no servidor" para os módulos da assistente que tocam banco,
 * chave da OpenRouter ou o laço de ferramentas.
 *
 * O pacote `server-only` não é dependência deste repositório (e nenhum outro
 * módulo o usa); acrescentá-lo mexeria no lockfile de todo clone por uma
 * linha. Esta guarda faz o mesmo papel em tempo de execução: se um componente
 * cliente importar um desses módulos por engano, o bundle do navegador quebra
 * no carregamento em vez de embarcar código de servidor em silêncio.
 *
 * "Navegador" = tem `window` e NÃO é Node. O jsdom dos testes tem `window`, mas
 * roda em Node (`process.versions.node`); o `process` que o Next injeta no
 * bundle do cliente não tem `versions.node`.
 */
const emNode = typeof process !== "undefined" && typeof process.versions?.node === "string";

if (typeof window !== "undefined" && !emNode) {
  throw new Error("agente/: módulo de servidor importado no navegador");
}

export {};
