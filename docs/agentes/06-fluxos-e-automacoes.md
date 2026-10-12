# 06 — Fluxos de automação e regras automáticas

O CRM tem **três motores de automação**. Este documento cobre dois deles; o terceiro (follow-up) está em [05](05-follow-ups.md).

| Motor | Tela | Forma | Relógio | Bom para |
|---|---|---|---|---|
| **Regras automáticas** (`lib/automation`) | **Webhooks › Automações** | Linear: gatilho → condições (E) → ações em série | O evento | Reações simples: "lead criado → mover, marcar, mandar boas-vindas" |
| **Fluxos de follow-up** (`lib/followup`) | **IA › Follow-ups** | Grafo com espera, classificação por IA, laço | Data da próxima avaliação | Reengajar quem parou de responder |
| **Fluxos** (`lib/flow-engine`) | **Fluxos** (`/app/flows`) | Grafo com **registro de blocos**: CRM, distribuição, WhatsApp, lógica, paralelo, subfluxo | Data da próxima avaliação | Distribuição de leads, menus de opções, avisos à equipe, disparo em massa, processos com várias etapas |

Os três passam qualquer envio ao cliente pela **mesma cadeia de conferências** do agente (opt-out, LGPD, ritmo anti-ban, janela de 24h).

---

## Parte A — Fluxos (construtor de blocos)

### A.1. Ciclo de vida

| Estado | O que significa |
|---|---|
| **Rascunho** | Editável; não roda. "Rascunho — publique antes de ligar." |
| **Publicado** | Passou na validação. "Publicado e pronto para ligar." Ainda **não** dispara. |
| **Ligado** | Dispara a cada evento do gatilho. |
| **Pausado** | Não arma novas execuções. |

Cada execução fica presa à **versão publicada** em que nasceu (o gatilho também é copiado para a versão). Publicar de novo não altera execuções em andamento.

### A.2. Passo a passo

1. **Fluxos › Criar fluxo** — nome (ex.: "Novo lead do Meta Ads").
2. Monte à mão **ou** use **Criar com IA** (§A.6).
3. Arraste os blocos, ligue as saídas, configure cada bloco no painel lateral. Campos de texto aceitam **variáveis** `{{...}}` (§A.4).
4. **Publicar** → resolve os pontos que a validação apontar (§A.5).
5. **Ligar** no menu do fluxo.
6. Acompanhe em **Execuções** (por fluxo ou geral) — cada passo, o caminho tomado e os erros.

### A.3. Catálogo de blocos

> Para ver a lista vigente: `GET /api/v1/flows/nodes` (logado) ou `lib/flow-engine/register-all.ts`. No levantamento havia **30** blocos. "Mexe no CRM" = bloco que altera dados.

#### Gatilhos (exatamente um por fluxo)

| Bloco | Dispara quando | Configuração |
|---|---|---|
| **Quando um lead é criado** (`trigger.lead_created`) | Um lead novo entra no funil (qualquer origem). | — |
| **Quando o cliente manda mensagem** (`trigger.message_received`) | Toda mensagem recebida de cliente. O texto fica em `{{event...}}`. | **Canal** (opcional — só um número). |
| **Quando o cliente escrever uma palavra** (`trigger.keyword`) | A mensagem traz uma das palavras. | **Palavras** (1–20, até 60 caracteres), **modo** contém / exata, **canal** opcional. |
| **Quando a IA passar para uma pessoa** (`trigger.ai_handoff`) | O agente passa uma conversa para a equipe (`agent.handoff_requested`). | — |
| **Ativação manual pelo botão** (`trigger.manual`) | Um atendente aperta **"Ativar fluxo"** dentro da conversa e escolhe este fluxo para o contato. | — |
| **Quando outro sistema chamar** (`trigger.webhook`) | Um sistema externo chama o **endereço público** do gatilho. O corpo recebido fica em `{{event...}}`. | **Nome** (2–120). O endereço é criado **ao publicar** e **não muda** em republicações (quem já copiou continua funcionando). |

#### Lógica

| Bloco | O que faz | Configuração | Saídas |
|---|---|---|---|
| **Decidir** (`logic.if`) | Segue por um caminho conforme o que for verdade. | **Saídas** (1–8), cada uma com nome e uma **condição**: grupo E/OU, com opção de negar, até 20 itens, aninhável. Cada item: **campo** (`lead.score`, `contact.tags`, `vars.x`…), **operador** — igual, diferente, maior, ≥, menor, ≤, contém, não contém, começa com, termina com, vazio, não vazio, está em, não está em, regex, antes de, depois de, entre — e **valor**. | Uma por saída + senão |
| **Esperar** (`logic.wait`) | Segura o fluxo. | **Duração**: 10 segundos a 90 dias. | Segue |
| **Esperar acontecer** (`logic.await_event`) | Fica parado até um evento ou o prazo. | **Evento**: mensagem recebida, lead mudou de etapa, lead ganho, lead perdido. **Filtro** opcional. **Prazo**: 5 min a 30 dias. | Aconteceu / prazo venceu |
| **Esperar uma escolha** (`logic.choice_menu`) | Espera a resposta do cliente e segue pela opção escolhida (menu "1, 2, 3"). | **Opções** (1–10): rótulo e **respostas aceitas** (1–10 por opção, ex.: "1", "vendas"). **Modo** exata / contém. **Prazo** (padrão 1 h; 5 min a 30 dias). | Uma por opção + "Não respondeu a tempo" |
| **Horário de funcionamento** (`logic.business_hours`) | Separa dentro/fora do expediente. | **Fuso** (padrão `America/Sao_Paulo`), **início** (08:00), **fim** (18:00), **dias** (seg–sex). **Fora do horário:** desviar (sai pela saída "fora") ou **esperar** abrir. | Dentro / fora |
| **Dividir os caminhos** (`logic.split`) | Reparte as execuções. | **Modo**: sorteio, equilibrando, ou em fila (na ordem). **Caminhos** 2–10. | Um por caminho |
| **Fazer ao mesmo tempo** (`logic.fork`) | Segue por vários caminhos de uma vez. | **Ramos** 2–6, **modo** todas (espera todos) / primeira (segue com o primeiro que chegar), **encontro** = o bloco Reencontro. | Um por ramo |
| **Reencontro** (`logic.merge`) | Onde os ramos paralelos voltam a ser um. | — | Segue |
| **Repetir para cada** (`logic.loop`) | Percorre uma lista item a item. | **Lista** (caminho, ex.: `vars.itens`), **máximo** 1–100. Dentro do laço: `{{frame.loop_index}}`, `{{frame.loop_total}}`. | "Para cada item" / acabou |
| **Chamar outro fluxo** (`flow.call`) | Roda outro fluxo como sub-rotina e espera ele terminar. | **Fluxo**, **entrada** (valores passados). | Segue |
| **Fim** (`logic.end`) | Encerra com um desfecho que aparece no relatório. | **Desfecho** (texto, padrão "concluido", até 40), **nota** (até 200). | — |

Variáveis gravadas dentro de um ramo paralelo ficam **naquele ramo** (`frame`), para dois ramos não se sobrescreverem.

#### CRM

| Bloco | O que faz | Configuração |
|---|---|---|
| **Marcar o cliente** (`crm.add_tag`) | Põe marcador no lead — ou no **contato**, quando o fluxo não tem lead (caso comum de quem chega pelo WhatsApp). | **Marcador** (até 40). |
| **Desmarcar o cliente** (`crm.remove_tag`) | Tira o marcador. | **Marcador**. |
| **Definir o dono do lead** (`crm.assign_owner`) | Entrega o lead a uma pessoa. | **Pessoa**. |
| **O vendedor já falou com o lead?** (`crm.owner_responded`) | Verifica se saiu mensagem do dono depois de… | **Contar a partir de**: desde a atribuição / desde o início do fluxo. Saídas "Sim, já falou" / não. |
| **Entregar a conversa para a IA** (`crm.handoff_to_agent`) | Devolve o atendimento ao agente, desfazendo a passagem para humano — pela mesma regra do botão da tela (solta as três travas). | — |

#### Distribuição (roteamento de leads para vendedores)

Todos usam a **mesma** regra de elegibilidade do roteamento de conversas: disponível ∧ dentro do horário da pessoa ∧ abaixo da capacidade ∧ heartbeat vivo ([07](07-handoff-chamados-e-roteamento-humano.md)).

| Bloco | O que faz | Configuração |
|---|---|---|
| **Distribuir para um vendedor** (`routing.round_robin`) | Rodízio real: quem recebeu há mais tempo (ou nunca) primeiro. | **Quando ninguém puder:** tentar depois (a cada 1 min–24 h, padrão 5 min) ou seguir pelo "senão". |
| **Sortear um vendedor** (`routing.random`) | Sorteio entre os disponíveis. | Idem. |
| **Distribuir em fila, na ordem** (`routing.fixed_order`) | Percorre uma ordem fixa de vendedores, um lead por vez; quem não está disponível é pulado. A posição da fila fica guardada entre execuções. | **Ordem** (1–50 pessoas) + idem. |
| **Passar para outro vendedor** (`routing.redistribute`) | Tira de quem não atendeu e entrega ao próximo. Combine com "O vendedor já falou com o lead?" + "Esperar". | Idem. |

#### WhatsApp e avisos

| Bloco | O que faz | Configuração |
|---|---|---|
| **Mandar mensagem para o cliente** (`whatsapp.send_to_lead`) | Texto, imagem, áudio, vídeo ou arquivo na conversa do cliente. | **Tipo**, **texto** (até 4.000, com variáveis), **URL da mídia**, **modo** livre / **modelo aprovado** (nome, idioma, valores dos parâmetros), **canal** (opcional). |
| **Avisar o vendedor no WhatsApp** (`whatsapp.notify_user`) | Mensagem para quem atende, com dados do lead. | **Destinatário**: dono do lead / uma pessoa específica / um telefone. **Mensagem** (até 4.000), modo livre/modelo, canal. A pessoa precisa ter **telefone de aviso** (E.164) na disponibilidade. |
| **Disparo em massa** (`whatsapp.bulk_send`) | Cria uma campanha para muitos contatos. | **Nome**, **canal**, modo livre (texto até 4.096) / modelo, **audiência**: por **tags** (até 20) ou **lista fixa** (até 5.000 contatos), **intervalo** entre envios (1 s–10 min, padrão 5 s), **começar sozinho** (padrão: não — a campanha nasce esperando você iniciar). |
| **Abrir aviso na Central** (`notify.internal`) | Registra um aviso para quem administra. | **Título** (até 120), **corpo** (até 1.000), **severidade** informativo / atenção / crítico. |

### A.4. Variáveis `{{...}}`

| Grupo | Exemplos | Observação |
|---|---|---|
| **Contato** | `{{contact.name}}`, `{{contact.phone_number}}`, `{{contact.email}}`, `{{contact.tags}}`, `{{contact.id}}` | A pessoa da conversa. |
| **Lead** | `{{lead.title}}`, `{{lead.status}}`, `{{lead.value_cents}}`, `{{lead.score}}`, `{{lead.score_band}}`, `{{lead.source}}`, `{{lead.tags}}`, `{{lead.created_at}}`, `{{lead.stage_id}}`, `{{lead.pipeline_id}}`, `{{lead.owner_user_id}}`, `{{lead.id}}`, `{{lead.custom_fields.x}}` | Vazio quando o fluxo não nasceu de um lead. |
| **Quem atende** | `{{assigned_user.name}}`, `{{assigned_user.notification_phone}}`, `{{assigned_user.id}}` | Vazio enquanto ninguém assumiu. |
| **Do fluxo** | `{{vars.qualquer_coisa}}` | O que os blocos anteriores gravaram (raiz aberta). |
| **Da empresa** | `{{global.telefone_suporte}}` | Variáveis da organização, iguais em todos os fluxos (`organizations.settings.flow_globals`). |
| **Do gatilho** | `{{event.body}}`, campos do webhook | O payload que disparou (raiz aberta). |
| **Deste caminho** | `{{frame.loop_index}}`, `{{frame.loop_total}}` | Dentro de laço/ramo. |
| **Da execução** | `{{execution.started_at}}`, `{{execution.steps_taken}}`, `{{execution.id}}` | Depuração. |

⚠️ Variável que não existe vira **vazio** (nunca a chave crua para o cliente) — e não dá erro. Ex.: `{{lead.nome}}` não existe (o campo é `lead.title`). Use o seletor de variáveis do campo.

Não há expressões (`{{ lead.value * 0.1 }}`) nem bloco de código — decisão de segurança.

### A.5. Validação ao publicar

| Código | Significa |
|---|---|
| `sem_gatilho` / `gatilho_repetido` | Precisa de exatamente um gatilho. |
| `inalcancavel` | Bloco que nenhum caminho alcança. |
| `ramo_sem_saida` | Saída de um bloco sem ligação. |
| `ramo_inexistente` / `origem_inexistente` / `destino_inexistente` | Ligação apontando para algo que não existe mais. |
| `encontro_inexistente` / `encontro_nao_e_reencontro` | "Fazer ao mesmo tempo" sem um "Reencontro" válido. |
| `ciclo` / `volta_ao_inicio` | Laço proibido / ligação de volta ao gatilho. |

Salvar aceita rascunho incompleto; publicar não.

### A.6. Criar com IA

Botão **Criar com IA** no construtor:

1. **Montar um fluxo do zero** ou **Ajustar o fluxo que está no quadro**.
2. Descreva o que quer (até 2.000 caracteres). Ex.: *"Quando entrar lead do formulário, distribuir em rodízio, avisar o vendedor no WhatsApp e, se em 30 minutos ele não falar com o cliente, passar para outro."*
3. A IA pode **perguntar** algo antes (com opções ou "Não tenho preferência"). Dá para **corrigir a última resposta**.
4. **Ver o que vai ser montado** → lista dos N blocos → **Montar o fluxo** (substitui o quadro; dá para descartar).
5. Revise: a tela lista **ajustes feitos automaticamente**, blocos que vieram com **valores padrão** e o que **ainda falta resolver** para publicar.

Usa os pontos de IA "Entender o pedido de fluxo" e "Montar o fluxo" (configuráveis em IA › Provedores) e passa pelo orçamento da organização.

### A.7. Execuções

**Fluxos › Execuções** (geral) ou **Execuções** de um fluxo: cada execução com status (pendente, esperando, concluída, falhou, **morta**), passos dados, eventos (append-only) e o motivo de erro. `dead` **é** a fila de erros: não existe tela de dead-letter separada.

Motor: cron `flow-engine-worker` 1×/min (e loop contínuo no worker), reivindicação por organização em rodízio (`FOR UPDATE SKIP LOCKED`), idempotência por passo.

---

## Parte B — Regras automáticas (tela Webhooks › Automações)

### B.1. Estrutura

```
QUANDO <gatilho>   SE <condições, todas verdadeiras>   ENTÃO <ações, em ordem>
```

A regra **nasce pausada** ("A automação nasce pausada. Revise e ligue quando estiver pronta.").

### B.2. Gatilhos

| Gatilho (tela) | Evento |
|---|---|
| Quando entrar um contato novo (webhook) | `lead.created` |
| Quando um lead mudar de etapa | `lead.stage_changed` |
| Quando chegar mensagem no WhatsApp | `message.received` |
| Quando um lead ganhar uma tag | `lead.tag_added` |
| Quando um contato ganhar uma tag | `contact.tag_added` |

### B.3. Condições (opcional, até 10, todas precisam ser verdadeiras)

Cada condição: **campo**, operador **igual / diferente / contém**, **valor** (até 500).
Campos sugeridos pela tela: `lead.title`, `lead.tags`, `lead.source_metadata.utm_source`, `contact.tags`, `event.to_stage_id`, `event.added_tags`, `event.body_preview`. Em "usar campo avançado" dá para escrever qualquer caminho, ex.: `lead.custom_fields.minha_chave`.

O contexto avaliado contém `event` (payload do evento), `lead` e `contact` (carregados do banco).

### B.4. Ações (1 a 10, executadas na ordem; dá para reordenar)

| Ação (tela) | Configuração | Observações |
|---|---|---|
| **Criar/mover lead no funil** | Funil + etapa | — |
| **Enviar mensagem no WhatsApp** | Número + texto (até 2.000) | Aceita `{{contact.name}}` (ou `{{nome}}`), `{{telefone}}`, `{{email}}` e qualquer caminho do contexto. Respeita janela e limite diário do número; fora da janela, espera a próxima. Números desconectados aparecem desabilitados. |
| **Mensagem escrita pela IA** | **Agente publicado** + número + **o que a IA deve fazer com os dados** (até 1.000) | O agente escreve a **primeira** mensagem para quem preencheu um formulário, com o tom e o conhecimento dele, recebendo todos os campos respondidos. Ponto de IA "Abordar quem preencheu o formulário". O modelo **não** recebe ferramenta de envio — quem envia é a regra. |
| **Adicionar tag** | Tags (1–10) | — |
| **Atribuir a um atendente** | Pessoa | — |
| **Avisar outro sistema (webhook)** | URL + segredo opcional | Com segredo, enviamos assinatura para o outro lado conferir. O segredo é guardado cifrado (exige a chave de cifra da instalação ativa). Proteção anti-SSRF no egress. |
| **Iniciar fluxo de mensagem** | Fluxo de **follow-up** publicado e ativo | Inscreve o contato no fluxo (é o gatilho "Automação (Webhooks)" do follow-up). |

### B.5. Comportamento

- **Anti-laço:** eventos causados por uma regra não disparam regras de novo (profundidade 1).
- **Tudo ou nada no adiamento:** se uma ação de WhatsApp precisa esperar (ritmo/limite), o **evento inteiro** é adiado antes de qualquer ação rodar — evita execução parcial no retry.
- **Atividade:** aba de atividade mostra cada execução, o resultado de cada ação (sucesso, falha, pulada, adiada) e permite **reenviar**.

### B.6. A mesma tela tem: Entradas de contatos (captação)

**Webhooks › Origens/Capturas** cria um **endereço** para o site/formulário mandar contatos direto para um funil:

| Campo | Detalhe |
|---|---|
| Nome | até 120 |
| Funil e etapa padrão | onde o lead entra |
| Redirecionar para (opcional) | URL para onde o navegador vai depois de enviar |
| Mapa de campos | quais campos do formulário são nome / telefone / e-mail |
| Segredo (opcional, 16–200) | para validar quem envia |

Combine: **entrada de contatos** → regra "Quando entrar um contato novo" → **Mensagem escrita pela IA** + **Atribuir** + **Iniciar fluxo de follow-up**.

---

## Parte C — Qual usar?

| Cenário | Recomendado |
|---|---|
| Lead de formulário: mover, marcar, mandar boas-vindas escrita pela IA | **Regra automática** |
| Distribuir lead em rodízio, avisar o vendedor, redistribuir se ele não responder em 30 min | **Fluxo** (round_robin → notify_user → esperar → owner_responded → redistribute) |
| Menu "digite 1 para vendas, 2 para suporte" antes da IA | **Fluxo** com "Esperar uma escolha" (ou um **Roteador**, se quiser IA entendendo texto livre) |
| Retomar quem sumiu há 2 dias, perguntar se ainda tem interesse e classificar a resposta | **Fluxo de follow-up** |
| Campanha para todos com a tag "black-friday" | **Fluxo** com "Disparo em massa" (ou tela Disparos) |
| Quando a IA passar para humano, avisar o gestor no WhatsApp | **Fluxo** com gatilho "Quando a IA passar para uma pessoa" + "Avisar o vendedor" |
| Atendente decide, na conversa, iniciar um roteiro | **Fluxo** com "Ativação manual pelo botão" |

---

## Notas técnicas

| Peça | Arquivo |
|---|---|
| Arquitetura do motor de fluxos | `docs/flow-engine/architecture.md` (⚠️ a tabela "o que ainda não existe" cita paralelo/subfluxo como ausentes — hoje existem: `lib/flow-engine/nodes/paralelo.ts`) |
| Como criar um bloco novo | `docs/flow-engine/creating-new-node.md` |
| Registro de blocos | `lib/flow-engine/register-all.ts`, `registry.ts`, `nodes/*.ts` |
| Disparo por evento | `lib/flow-engine/trigger-matcher.ts` |
| Motor | `lib/flow-engine/engine.ts`, `loop.ts` |
| Variáveis | `lib/flow-engine/catalogo-de-variaveis.ts`, `variaveis.ts` |
| Publicação | `lib/flow-engine/validate-publish.ts`, `gatilho-por-webhook.ts` |
| IA que monta fluxo | `lib/flow-engine/ai/*` |
| Regras automáticas | `lib/automation/engine.ts`, `actions/*.ts`, `lib/schemas/webhooks.ts` |

Tabelas: `flows`, `flow_versions`, `flow_executions`, `flow_execution_events`, `flow_routing_cursors`; `automation_rules`, `automation_rule_runs`; `webhook_sources`.
