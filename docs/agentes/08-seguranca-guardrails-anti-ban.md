# 08 — Segurança, guardrails e anti-banimento

> Regra de ouro: **o que protege o cliente e o seu número não depende do prompt.** São conferências no código, com poder de veto, que rodam antes de cada mensagem sair — do agente, dos follow-ups, dos fluxos e das regras automáticas.

---

## 1. A cadeia de conferências de saída (papel "Segurança")

Roda **antes de cada mensagem** e **nesta ordem**. A primeira que barra interrompe as seguintes, e o assistente recebe o motivo para reescrever (é instrução, não erro).

| # | Conferência (tela) | O que protege | Desliga? |
|---|---|---|---|
| 1 | **Respeitar quem pediu para parar** (`stop`) | Contato com STOP/opt-out, ou com a conversa passada para humano (`is_blocked` ou `force_human`), não recebe nada automático. Lido direto do banco a cada envio. | Não — "insistir é infração, não estratégia". |
| 2 | **Respeitar dados apagados e a base legal** (`lgpd`) | Contato **anonimizado** não recebe mensagem; **prospecção** (primeiro toque) sem base legal não sai. Resposta a quem escreveu não é prospecção. | Não — obrigação legal. |
| 3 | **Segurar o ritmo de envio** (`pacing`) | Espaça as mensagens, respeita teto diário e aquecimento do número (§3). | Não — "o número é o seu negócio". |
| 4 | **Respeitar a janela do WhatsApp** (`messaging_window`) | Em canal oficial (Meta e parceiros), fora da janela de 24 h só sai **modelo aprovado**. | Não — quem impõe é o WhatsApp. |
| 5 | **Variar o texto das mensagens iguais** (`spinning`) | Evita a mesma frase idêntica para muita gente (padrão de spam). | Não. |
| 6 | **Não prometer preço ou prazo por conta própria** (`promise`) | Barra desconto, valor ou parcelamento fora da **tabela de promessas** da organização (piso de preço, teto de desconto %, teto de parcelas). Sem tabela publicada, não fiscaliza. | Não — regra fixa, custo zero. |
| 7 | **Conferir promessas em texto livre** (`semantic_promise`) | Uma segunda leitura, por modelo, para promessas que a regra fixa não reconhece. | **Sim**, por organização. Custa +1 consulta ao modelo por mensagem enviada. |
| 8 | **Não prometer atendimento humano que não existe** (`case_promise`) | Barra "vou pedir para o responsável te ligar" sem **caso** aberto. 1ª vez ensina; se insistir, o sistema **abre um caso mínimo** e libera. Ativa quando o agente tem "Pedir ajuda sem sair da conversa" ligado. | Não. |
| 9 | **Não falar a nossa língua com o seu cliente** (`internal_vocabulary`) | Barra nome de ferramenta, tabela, código de erro, UUID na mensagem. 1ª e 2ª vez ensinam; se o modelo não reescrever, o envio sai com registro (silêncio é pior que um termo técnico). | Não — "derrubou o vazamento medido de 30% para zero". |
| 10 | **Dizer que é um assistente quando perguntam** (`disclosure`) | Se o cliente pergunta se fala com robô, a resposta não pode enganar (o sistema pode **injetar** a frase de transparência, conforme `DISCLOSURE_MODE`). | Não. |

### Conferência de entrada

| Conferência | O que faz | Desliga? |
|---|---|---|
| **Detectar tentativa de manipular o assistente** (`jailbreak_detect`) | Lê a mensagem que chega e marca tentativas de fazer o assistente ignorar as instruções. **Não bloqueia** a mensagem sozinha: só marca o turno. Se no mesmo turno houver tentativa de promessa fora da tabela, escala para humano. | **Sim**, por organização. +1 consulta ao modelo por mensagem recebida. |

**Onde ligar/desligar:** editor de qualquer agente › aba **Confere antes de enviar** (vale para a organização inteira). Três estados: "vem da configuração do servidor" (sem escolha registrada), "Ligada por você", "Desligada por você". O modelo usado por elas se escolhe em **IA › Provedores** (pontos "Impedir promessa que não se cumpre" e "Barrar tentativa de manipulação").

Cada veto vira uma linha de rastro (`before_send_traces`) e atividade na linha do tempo do cliente.

---

## 2. Opt-out (pedido para parar)

A mesma regra vale na **ingestão** (que grava o bloqueio) e no **agente** (`lib/opt-out/deteccao.ts`):

- **Bloqueia** (`is_blocked = true`, irrevogável pelo agente) quando a mensagem **inteira** é uma palavra de parada — `stop`, `parar`, `pare`, `sair`, `cancelar`, `descadastrar`, `remover`, `unsubscribe`, e equivalentes em espanhol como `baja` — ou um verbo de cessação **com objeto de comunicação** ("parar de me mandar", "sair da lista").
- **Não bloqueia** frases como "tem como parar a dor?" (medido: 12 falsos positivos em 32 frases de clínica quando a regra era a palavra solta).
- **Suspeita** (ambíguo): o agente confirma ao cliente que para os envios automáticos, silencia, cancela retornos e abre item na Central para uma pessoa confirmar o bloqueio real.

Para ver o vocabulário vigente: `grep -n 'PALAVRAS_DE_OPT_OUT' -A40 lib/opt-out/deteccao.ts`.

---

## 3. Anti-banimento: ritmo, janela, aquecimento

Configurável **por número** em **Conexões › (número) › Proteção de envio**.

| Parâmetro (tela) | Padrão | Faixa |
|---|---|---|
| **Janela de envio (horário local)** — início e fim | 7h – 22h | início 0–23, fim até 24 |
| **Enviar aos domingos** | sim | — |
| **Fuso horário da janela** | `America/Sao_Paulo` | IANA |
| **Ritmo entre envios (segundos)** | 1,2 s | 1 s – 600 s |
| **+ variação de até** (jitter) | 0,8 s | — |
| **Teto diário de envios** | sem teto | — |
| **Aquecimento automático de número novo** | ligado | degraus abaixo |
| **Este número já está aquecido — pular o aquecimento** | — | — |

Aquecimento padrão (envios por dia, conforme a idade do número):

| Idade do número | Teto |
|---|---|
| 0–3 dias | 20 |
| 4–7 dias | 50 |
| 8–14 dias | 100 |
| 15–30 dias | 200 |
| 31+ dias | sem limite de aquecimento |

Enquanto o aquecimento libera menos que o teto diário, **é ele que limita** (a tela avisa).

**Comportamento fora da janela:** o turno do agente e os follow-ups são **adiados** para a abertura — nada é perdido. Teto diário e aquecimento são avaliados no momento do envio.

**Campanhas / disparo em massa:** intervalo próprio (padrão 5 s no bloco de fluxo), além do ritmo do número.

---

## 4. Limites do turno do agente

| Limite | Padrão | Onde |
|---|---|---|
| Ações (ferramentas) por turno | 10 (tela; servidor 8 sem agente) | "Ações por atendimento" / `AGENT_MAX_STEPS` |
| Mensagens físicas por turno | 3 | `MAX_SENDS_PER_TURN` |
| Disjuntor: mesma chamada idêntica | aviso em 2, bloqueio em 5 | `TOOL_BREAKER_EXACT_*` |
| Disjuntor: mesma ferramenta | aviso em 3, parada em 8 | `TOOL_BREAKER_SAME_TOOL_*` |
| Disjuntor: sem progresso | aviso em 3, bloqueio em 5 | `TOOL_BREAKER_NO_PROGRESS_*` |
| Tempo da chamada de modelo | 120 s turno / 20 s classificador / 90 s resumo | `LLM_TIMEOUT_*` |

---

## 5. Orçamento de IA da organização

Tela: **IA › Uso e orçamento** › **Orçamento mensal de IA** (valores em **dólar**, a moeda do provedor).

| Modo | Efeito |
|---|---|
| **Só acompanhar** | A IA nunca para por gasto. |
| **Me avisar ao passar de** (% do limite) | Abre aviso na Central ("O gasto de IA passou do aviso que você definiu"); a IA continua. |
| **Parar a IA ao chegar em** | Ao atingir o limite, as conversas em andamento vão para a **fila humana** com aviso ao cliente ("Teto de gasto com IA atingido — assumir a conversa"). A parada só começa a valer **72 h depois de armada** (dá para antecipar: "Começar a valer agora"). Exige limite mínimo. |

⚠️ Se o servidor estiver com `AI_BUDGET_ENFORCEMENT=avisar`, a parada não acontece mesmo com "Parar a IA" escolhido (a tela avisa).

O gasto do mês é calculado por uma régua única (`fn_gasto_de_ia_do_mes`) — o número que a tela mostra é o mesmo que decide.

---

## 6. Outras proteções do agente

| Proteção | Detalhe |
|---|---|
| Identidade da organização | Sempre da linha do job, nunca de texto do modelo. |
| Escopo de funis | O agente só escreve nos funis marcados (falha fechada). |
| Capacidades críticas | Nunca entram por pacote. |
| "Só pessoa" | Retomar atendimento, criar/arquivar etapa, ligar regra automática etc. exigem papel humano. |
| Projeção de contexto | Quando nenhuma capacidade do catálogo está no turno, ids internos saem do contexto que o modelo lê (menos chance de vazar UUID). |
| Integrações via API | Correção só com SIM conferido pelo runtime; conta só depois de código por e-mail; anti-SSRF; resposta limitada a 256 KB; campos da resposta filtrados ([10 §4](10-integracoes.md)). |
| PII | Fora de logs; o texto do cliente nunca vai para log nem para mensagem de erro. |
| Webhooks de saída | Anti-SSRF (bloqueia rede interna e metadados de nuvem), https em produção, sem seguir redirecionamento. |

---

## Notas técnicas

| Peça | Arquivo |
|---|---|
| Lista mostrada na tela | `lib/ai/guardrails/lista-de-conferencia.ts` |
| Cadeia | `lib/agent-engine/guardrails/before-send.ts` |
| Camadas por organização | `lib/agent-engine/guardrails/camadas-da-org.ts` (`org_guardrail_layers`) |
| Promessa | `lib/agent-engine/guardrails/promise/{engine,table,semantic}.ts` (`promise_table_versions` / `promise_table_pointers`) |
| Vazamento | `lib/agent-engine/guardrails/vazamento-interno.ts` |
| Jailbreak | `lib/agent-engine/guardrails/jailbreak/classifier.ts` |
| Ritmo | `lib/agent-engine/pacing/{defaults,engine,store}.ts` (`channel_knobs`) |
| Variação | `lib/agent-engine/spinning/` |
| Opt-out | `lib/opt-out/deteccao.ts` |
| Orçamento | `lib/ai/budget/check.ts`, `lib/agent-engine/edge/llm/orcamento.ts` |
