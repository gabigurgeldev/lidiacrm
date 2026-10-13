/**
 * Patch do WAHA (engine NOWEB) para botões nativos em conta conectada por QR Code.
 *
 * O WhatsApp só desenha botões interativos (quick_reply, cta_url, cta_call,
 * cta_copy) quando a mensagem chega marcada como fluxo de empresa. O WAHA monta
 * o `interactiveMessage.nativeFlowMessage`, mas não anexa os nós de stanza
 * (`biz` + `bot`) que o cliente oficial emite — e, sem eles, o app do
 * destinatário recebe a mensagem em silêncio (nada é desenhado).
 *
 * Este script injeta, no `relayMessage` de
 * `/app/dist/core/engines/noweb/noweb.buttons.js`:
 *
 *   - nó `biz` com `interactive` type=native_flow v=1 envolvendo `native_flow`
 *     v=9 name=mixed (caso genérico, vale para quick_reply/cta_*);
 *   - nó `bot` com `biz_bot=1` em chats privados (grupos não levam `bot`).
 *
 * Idempotente: se já aplicado (marca no fonte) ou se o padrão não for
 * encontrado (WAHA atualizado e dist diferente), sai sem alterar nada e SEM
 * derrubar o contêiner — a execução do WAHA continua normalmente pelo
 * `/entrypoint.sh` (ver compose). Backup do original em `<alvo>.orig-<data>`.
 */
const fs = require("fs");

const TARGET =
  process.env.WAHA_PATCH_TARGET ||
  "/app/dist/core/engines/noweb/noweb.buttons.js";
const MARK = "/* [waha-native-buttons] */";

const ORIGINAL = [
  "await sock.relayMessage(chatId, fullMessage.message, {",
  "        messageId: fullMessage.key.id,",
  "    });",
].join("\n");

const REPLACEMENT = [
  MARK,
  "    // [waha-native-buttons] Marca a mensagem como fluxo interativo",
  "    // (biz > interactive type=native_flow v=1 > native_flow v=9 name=mixed)",
  "    // e, em conversa privada, como bot (bot biz_bot=1) — é o que o cliente",
  "    // oficial emite e o que faz o app do destinatário desenhar os botões",
  "    // em contas conectadas por QR Code (não-business).",
  "    const _wahaNodes = [{",
  "        tag: 'biz',",
  "        attrs: {},",
  "        content: [{",
  "            tag: 'interactive',",
  "            attrs: { type: 'native_flow', v: '1' },",
  "            content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],",
  "        }],",
  "    }];",
  "    if (!chatId.endsWith('@g.us')) {",
  "        _wahaNodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });",
  "    }",
  "    await sock.relayMessage(chatId, fullMessage.message, {",
  "        messageId: fullMessage.key.id,",
  "        additionalNodes: _wahaNodes,",
  "    });",
].join("\n");

try {
  if (!fs.existsSync(TARGET)) {
    console.log(
      "[waha-native-buttons] alvo inexistente (dist mudou de estrutura?):",
      TARGET,
      "— seguindo sem patch",
    );
    process.exit(0);
  }
  const src = fs.readFileSync(TARGET, "utf8");
  if (src.includes(MARK)) {
    console.log("[waha-native-buttons] já aplicado — nada a fazer");
    process.exit(0);
  }
  if (!src.includes(ORIGINAL)) {
    console.log(
      "[waha-native-buttons] padrão do relayMessage não encontrado — WAHA atualizado? Seguindo sem patch",
    );
    process.exit(0);
  }
  fs.copyFileSync(TARGET, `${TARGET}.orig`);
  fs.writeFileSync(TARGET, src.replace(ORIGINAL, REPLACEMENT));
  console.log("[waha-native-buttons] patch aplicado em", TARGET);
} catch (e) {
  console.log(
    "[waha-native-buttons] ERRO ao aplicar (seguindo sem patch):",
    e && e.message,
  );
}
process.exit(0);
