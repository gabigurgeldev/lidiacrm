# 04 — Roteadores de intenção

> Tela: **IA › Roteadores** (`/app/ai/routers`). Listar: papel **agent**. Criar, editar e excluir: **admin**.

## 1. Para que serve

Um número de WhatsApp, vários agentes especialistas. O roteador lê cada mensagem que chega, decide **qual intenção** ela representa ("quer comprar", "precisa de suporte", "quer remarcar") e entrega o turno ao agente ligado àquela intenção.

Sem roteador, o número é atendido pelo agente publicado daquele número com maior **Ordem de preferência** — um só.

```
mensagem ──▶ classificador (modelo barato) ──▶ intenção + confiança
                                                │
              confiança ≥ mínimo e intenção casou? ──sim──▶ agente da intenção
                                                │
                                               não
                                                ▼
                         agente de fallback do roteador (se houver)
                                                │ (sem fallback)
                                                ▼
                         agente publicado do número (como se não houvesse roteador)
                                                │ (nenhum)
                                                ▼
                                      agente genérico
```

---

## 2. Criar um roteador — passo a passo

1. Crie e **publique** os agentes especialistas antes (cada um com prompt focado no seu assunto). Eles **não precisam** estar no mesmo número — quem tem o vínculo com o número é o roteador. Na prática, escolha o mesmo número no campo deles.
2. **IA › Roteadores › Novo roteador.** Preencha:
   - **Nome** (até 120 caracteres; ex.: "Roteador de vendas").
   - **Número de WhatsApp.** Só pode existir **um roteador ativo por número** (tentar ativar um segundo dá erro 409).
3. **Criar roteador.** Você cai na tela de edição.
4. Configure o **modelo do classificador**, o **agente de fallback** e as **intenções** (abaixo).
5. Ligue **Ativo**. **Salvar.**
6. Use o painel **Testar classificação** com frases reais.

---

## 3. Campos do roteador

### Identificação

| Campo | Detalhe |
|---|---|
| **Nome** | Até 120 caracteres. |
| **Número de WhatsApp** | Definido na criação. "Número removido" aparece se a conexão foi apagada. |
| **Ativo** | "Ativo — está roteando as conversas deste número" / "Inativo — não roteia nada". Inativo = o número volta a funcionar como se o roteador não existisse. |

### Modelo que identifica a intenção

| Opção | Efeito |
|---|---|
| **Automático — usa o provedor da organização** | Usa a configuração de IA da organização com o modelo padrão do classificador (`claude-haiku-4-5` se nada for definido). |
| Um modelo específico (lista por provedor; "chave desta instalação" quando vem do `.env`) | Grava modelo **e** provedor. Útil quando a organização usa um provedor e o crédito barato está em outro. |

O classificador roda **a cada mensagem recebida** (é barato e é o que detecta troca de assunto). Custo e chamadas aparecem como ponto de IA **"Escolher qual agente atende"** (`intent_router`).

### Se nenhuma intenção casar

| Campo | Efeito |
|---|---|
| **Agente de fallback** | Quem atende quando a confiança fica abaixo do mínimo, a intenção é "nenhuma", ou o classificador falha. |
| **Nenhum — responde com o atendimento padrão** | Cai no agente publicado **do número** (o que atenderia sem roteador); se não houver, no agente genérico. |

### Intenções (membros)

Cada intenção é uma linha:

| Campo | Limite | Dica |
|---|---|---|
| **Nome da intenção** | 1–120 caracteres, único no roteador | Curto e claro: "quer comprar", "suporte técnico", "financeiro". É o que o classificador devolve. |
| **Agente que atende** | um agente | O agente precisa ter **versão publicada**; se não tiver, o turno cai no fallback (e isso fica registrado). |
| **Quando escolher esta intenção** | 1–2.000 caracteres | "Escreva como explicaria para um atendente novo: em que situação o cliente cai aqui." Diga também o que **não** é. |
| **Frases de exemplo** (opcional) | lista | Frases reais de clientes ("quanto custa?", "meu pedido não chegou"). Ajudam muito o classificador. |

A ordem das intenções é a ordem em que aparecem para o classificador.

### Parâmetros que só a API altera

| Parâmetro (`ai_routers.config`) | Padrão | Efeito |
|---|---|---|
| `sticky` | `true` | Aderência: depois que um agente assume a conversa, ele continua nela até o cliente **mudar de assunto com confiança**. |
| `min_confidence` | `0.6` | Confiança mínima (0 a 1) para aceitar uma intenção. |

A tela preserva esses dois ao salvar (o PATCH mescla `config`). Para mudar: `PATCH /api/v1/ai/routers/:id` com `{"config": {"min_confidence": 0.7}}`.

---

## 4. As regras de decisão (exatamente como o motor faz)

Arquivo: `lib/agent-engine/agent/resolve-turn-agent.ts`.

1. **Sem roteador ativo no número** → fluxo normal (agente publicado do número).
2. **Com aderência (sticky)** e o agente da conversa ainda é membro do roteador: classifica mesmo assim; **só troca** se vier uma intenção **diferente** da atual **e** com confiança ≥ mínimo. Senão, mantém o mesmo agente.
3. **Sem aderência:** intenção casada com confiança ≥ mínimo → agente daquela intenção.
4. **Classificador falhou** (erro, resposta inválida): com aderência, mantém o agente atual; sem aderência, vai para o fallback.
5. **Nada casou / confiança baixa** → fallback; sem fallback → agente publicado do número; sem esse → genérico.
6. **Follow-up** (não há mensagem nova para ler) → **nunca classifica**: usa o agente aderido, ou o fallback, ou o genérico.
7. Agente escolhido **sem versão publicada** → tenta o fallback e registra o motivo real (não finge sucesso).

Robustez: qualquer erro inesperado no roteador faz o turno seguir **como se não houvesse roteador**. O roteador é estritamente aditivo — nunca deixa o cliente sem resposta.

O classificador só pode devolver intenções que existem na lista; se o modelo "inventar" uma, a resposta é descartada.

A decisão de cada turno fica gravada (`ai_router_decisions`: intenção, confiança, agente, resultado) e a conversa guarda o agente/intenção atuais (`conversations.active_ai_agent_id`, `active_intent`).

Resultados possíveis: `no_router`, `classified`, `sticky`, `reclassified`, `fallback`, `no_match`, `classifier_failed`.

---

## 5. Testar classificação

Painel no fim da tela (o roteador precisa estar **ativo**):

- Digite uma mensagem ("oi, quero saber o preço do plano premium") › **Testar classificação**.
- Resultado: **Intenção** (ou "nenhuma casou"), **confiança** em %, e **Agente que atenderia**.
- Se a confiança ficar abaixo do mínimo, a tela avisa: "abaixo do mínimo de 60%, cairia no atendimento padrão em produção".

O teste chama o modelo de verdade (consome crédito), mas não grava decisão de produção.

---

## 6. Boas práticas e armadilhas

- **Poucas intenções, bem separadas.** 2 a 5 costuma bastar. Intenções que se sobrepõem derrubam a confiança.
- **Sempre defina um fallback** — de preferência o agente mais generalista.
- **Descrição + exemplos** valem mais que o nome.
- Um roteador **ativo com zero intenções e sem fallback** é inofensivo: não casa nada e o número continua atendido pelo agente publicado dele.
- Ao **remover** um agente das intenções, conversas que estavam aderidas a ele deixam de estar (o motor trata como sem aderência).
- O roteador escolhe **quem conversa**. Cada agente continua com os próprios freios, capacidades, acervo, follow-ups e Operador.
- O agente-membro mostra no editor: "Este agente é acionado pelo roteador «X»".

---

## Notas técnicas

| Peça | Arquivo / tabela |
|---|---|
| Carregar roteador | `lib/agent-engine/agent/router-config.ts` |
| Classificador | `lib/agent-engine/agent/intent-classifier.ts` (prompt pede JSON `{"intent","confidence"}`) |
| Decisão | `lib/agent-engine/agent/resolve-turn-agent.ts` |
| Tela | `app/app/ai/routers/_client.tsx`, `app/app/ai/routers/[id]/_client.tsx` |
| API | `/api/v1/ai/routers` (GET/POST), `/:id` (GET/PATCH/DELETE), `/:id/members` (PUT — substitui a lista), `/:id/test` |
| Tabelas | `ai_routers` (um ativo por `channel_session_id`, índice parcial), `ai_router_members`, `ai_router_decisions` |

Mudanças em roteadores são auditadas por trigger (`ai.router_created` etc.).
