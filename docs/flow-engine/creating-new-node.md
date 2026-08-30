# Como criar um bloco novo em menos de 15 minutos

É a promessa que justifica o motor: um tipo de nó novo **não toca** o schema do
grafo, o motor, nem a tela. Você declara a definição e a registra.

## Os quatro pedaços

```ts
// lib/flow-engine/nodes/o-seu.ts
import { z } from "zod";
import { ramoPadrao, type FlowNodeDefinition, type NodeExecutionResult } from "../types";

const configSchema = z.strictObject({
  etapa_id: z.string().uuid(),
});
type Config = z.infer<typeof configSchema>;

export const crmMoverEtapa: FlowNodeDefinition<Config> = {
  type: "crm.move_stage",          // categoria.acao — minúsculo, ponto, underscore
  version: 1,
  category: "crm",
  rotulo: "Mover de etapa",        // 1. o que a paleta mostra
  descricao: "Leva o lead para outra etapa do funil.",
  mutaCrm: true,                   // 2. ver abaixo — esquecer isto é defeito MUDO
  configSchema,                    // 3. o passe 2 do grafo valida por aqui
  branches: () => [ramoPadrao("Depois de mover")],   // 4. as saídas
  execute: async (ctx, config): Promise<NodeExecutionResult> => {
    const lead = ctx.fatos.lead;
    if (lead === null) return { kind: "dead", reason: "sem_lead" };
    await ctx.crm.moverEtapa({ leadId: lead.id, etapaId: config.etapa_id });
    return { kind: "advance", branch_id: "else" };
  },
};
```

Depois, uma linha em `lib/flow-engine/register-all.ts`. **Só isso.** A paleta, o
schema do grafo e a validação de publicação já sabem dele.

## As quatro regras que o CI cobra

`lib/flow-engine/registry.test.ts` reprova quem quebrar qualquer uma.

1. **`execute` NUNCA fala com o Supabase.** Nada de `createAdminClient`, nada de
   `process.env`. Precisa de algo que as portas não oferecem? Acrescente o
   método à porta (`PortaDoCrm`, `PortaDeCanal`…) e implemente em
   `supabase-adapter.ts`. É o que mantém todo nó testável sem Postgres — e é o
   que faz o construtor conseguir calcular as saídas no navegador.

2. **`rotulo` e `descricao` em português de operação.** A tela não fala jargão
   de API, e o guarda cobra tamanho mínimo. Acrescente também as duas frases em
   `lib/i18n/dicionario.ts`: elas chegam à tela por `t()` dinâmico, que o guarda
   de i18n não coleta — sem a entrada, quem escolheu espanhol lê português.

3. **`mutaCrm: true` se o bloco muda o lead.** Os fatos são carregados **uma vez
   por tick**. Sem a marca, o bloco muda o CRM e o bloco seguinte lê o mundo
   velho — foi exatamente assim que `routing.round_robin` escolhia o vendedor e
   `whatsapp.notify_user` lia `assigned_user` como `null`: vendedor escolhido,
   nunca avisado, sem erro nenhum.

4. **O pega-tudo `else` é o último ramo, e é único.** Use `ramoPadrao()`. Saídas
   de regra vêm antes, com id estável — renomear o rótulo não pode soltar a
   ligação que alguém já desenhou.

## Se o bloco for um GATILHO

Declare `eventos: ["lead.stage_changed"]`. O matcher **deriva** dali o que
escutar no `event_log` — nunca de uma lista digitada à parte. O formato tem de
casar o CHECK `event_type_format` (`^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`), e o
evento precisa **já ser emitido** por alguém; um gatilho novo que espera evento
inexistente fica desenhável na tela e nunca dispara.

## Se o bloco precisar esperar

Devolva `{ kind: "wait", next_eval_at }`. Na volta, `ctx.esperaEmCurso` vem
preenchido — é assim que o nó sabe que já esperou, sem reler o banco. **Não
reinicie a contagem** quando `agora < esperaEmCurso.ate`: devolva a mesma hora,
senão algo que acorde a execução antes do prazo faz a espera nunca terminar.

## Um formulário para o bloco

`app/app/flows/[id]/_components/PainelDoNo.tsx`, um `case` por tipo. Não é
gerado do schema Zod de propósito: o genérico pediria `duracao_ms` em
milissegundos e uma árvore de JSON para as condições. Quem monta o fluxo conhece
o funil, não o schema.

Dê também uma config inicial em `configInicial()` no `FlowCanvas.tsx` — um bloco
que nasce com config inválida não desenha as saídas, e a pessoa não tem onde
ligar a primeira linha.
