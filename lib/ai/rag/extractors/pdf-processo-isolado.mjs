// Processo filho da extração de PDF. Lê os bytes do PDF no stdin e escreve UMA
// linha JSON no stdout com o desfecho de `extrairTextoDoPdf`.
//
// Roda em `node` puro — nunca sob `tsx`. Por que ele existe está no cabeçalho de
// `pdf-texto.mjs`: sob o loader do `tsx`, um PDF de 9 KB leva o heap a 255 MB e
// derrubava o worker de produção. Aqui o custo é ~14 MB e morre com o processo.

import { extrairTextoDoPdf } from "./pdf-texto.mjs";

const pedacos = [];
process.stdin.on("data", (pedaco) => pedacos.push(pedaco));
process.stdin.on("end", async () => {
  const desfecho = await extrairTextoDoPdf(new Uint8Array(Buffer.concat(pedacos)));
  process.stdout.write(JSON.stringify(desfecho) + "\n", () => process.exit(0));
});
