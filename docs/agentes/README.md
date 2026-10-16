# Guia completo dos agentes de IA — DeskcommCRM

> **Para quem é:** quem configura e opera o CRM (dono do negócio, admin, gestor de atendimento) e quem dá suporte a uma instalação. Cada documento começa pelo uso e termina com notas técnicas para quem precisa ir ao código.
>
> **De onde saiu:** tudo aqui foi levantado no código-fonte (telas em `app/app/ai/**`, motor em `lib/agent-engine/**`, follow-up em `lib/followup/**`, fluxos em `lib/flow-engine/**`, regras em `lib/automation/**`). Onde a tela promete algo que o motor atual não executa, isso está escrito explicitamente — procure pelos blocos **⚠️ Atenção**.
>
> **Data do levantamento:** 2026-10-07, contra a `main` em `4c80d9ca` (inclui Integrações via API e o áudio espelhado). Números que mudam com o tempo (quantidade de capacidades, de blocos etc.) vêm acompanhados do comando que os confere.

---

## Os documentos

| # | Documento | O que responde |
|---|---|---|
| 01 | [Como o agente funciona](01-como-o-agente-funciona.md) | O caminho de uma mensagem do WhatsApp até a resposta, passo a passo. Os três papéis (Conversador, Operador, Segurança). Tipos de turno. Memória. |
| 02 | [Criar e configurar um agente](02-criar-e-configurar-agente.md) | Pré-requisitos, passo a passo de criação, **cada campo da tela explicado** (limite, padrão, efeito real), publicar, testar, pausar, versões. |
| 03 | [Capacidades (ferramentas)](03-capacidades-ferramentas.md) | Pacotes, níveis de risco, teto por agente, o catálogo completo de capacidades e as ferramentas nativas do motor. |
| 04 | [Roteadores de intenção](04-roteadores.md) | Vários agentes no mesmo número: como o roteador escolhe, cada campo, regras de decisão, aderência (sticky), teste. |
| 05 | [Follow-ups](05-follow-ups.md) | Retorno agendado pelo agente, fluxos de follow-up (construtor visual), gatilhos, blocos, publicação, fila e intervenções. |
| 06 | [Fluxos de automação e regras automáticas](06-fluxos-e-automacoes.md) | O construtor de Fluxos (blocos, variáveis, IA que monta fluxo) e as Regras automáticas da tela Webhooks. Qual motor usar quando. |
| 07 | [Passagem para humano, chamados e roteamento de atendentes](07-handoff-chamados-e-roteamento-humano.md) | Quando o agente sai de campo, o aviso ao cliente, como devolver, "pedir ajuda sem sair da conversa", distribuição para atendentes. |
| 08 | [Segurança, guardrails e anti-banimento](08-seguranca-guardrails-anti-ban.md) | As conferências antes de cada envio, ritmo de envio, janela, aquecimento de número, opt-out, LGPD, orçamento. |
| 09 | [Conhecimento, memória e skills](09-conhecimento-memoria-skills.md) | Acervo (RAG), memória da empresa, memória do cliente, skills situacionais, camadas do playbook. |
| 10 | [Integrações](10-integracoes.md) | Canais de WhatsApp, provedores de IA e "pontos de IA", voz, Nuvemshop, Google Agenda, Asaas, captação por webhook, MCP, API. |
| 11 | [Monitoramento e diagnóstico](11-monitoramento-e-diagnostico.md) | Central de avisos, Execuções, uso e orçamento, propostas de melhoria, e um guia de "o agente não respondeu — e agora?". |

---

## Mapa mental em uma página

```
                         ┌───────────────────────────────┐
  Cliente no WhatsApp ──▶│  Canal (WAHA / Meta / parceiro)│
                         └───────────────┬───────────────┘
                                         │ mensagem gravada + evento
                                         ▼
                         ┌───────────────────────────────┐
                         │ Fila do agente (job inbound)   │  junta rajada de mensagens
                         └───────────────┬───────────────┘  do mesmo cliente (8 s)
                                         ▼
   ┌───────────────────── TURNO DO AGENTE (Conversador) ─────────────────────┐
   │ 1. Está com humano? → não faz nada                                       │
   │ 2. Fora da janela de envio / do horário do agente? → adia para a abertura│
   │ 3. Roteador (se houver) escolhe QUAL agente atende                       │
   │ 4. Monta o contexto: playbook + memória da empresa + skills + checkpoint │
   │    + memória do cliente + histórico                                      │
   │ 5. Pediu humano / pediu para parar? → avisa e silencia (sem IA)          │
   │ 6. Modelo conversa usando ferramentas (responder, buscar no acervo,      │
   │    mover etapa, agendar retorno, chamar humano, abrir chamado…)          │
   │ 7. Cada mensagem passa pela cadeia de conferências (Segurança)           │
   │ 8. Fecha o turno com um checkpoint (resumo, compromissos, objeções)      │
   └─────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
                 ┌────────────────────────────────────┐
                 │ TURNO DO OPERADOR (opcional)        │  organiza o CRM, nunca fala
                 └────────────────────────────────────┘  com o cliente

  Em paralelo, sem depender da conversa:
   • Retornos agendados (o agente prometeu voltar)  → turno de follow-up no horário
   • Fluxos de follow-up (silêncio, etapa, chamado…) → passos com espera/IA/mensagem
   • Fluxos de automação (lead criado, palavra, webhook…) → blocos de CRM/WhatsApp
   • Regras automáticas (Webhooks) → ações em série quando um evento acontece
```

---

## Glossário rápido

| Termo na tela | O que é | Nome técnico |
|---|---|---|
| Agente | Um "funcionário" de IA com instruções, modelo, número de WhatsApp e permissões | `ai_agents` (kind `mcp_agent`) |
| Versão / Rascunho / Publicada | Cada salvamento cria ou altera um rascunho; só a versão **publicada** atende | `ai_agent_versions` (`draft` → `published` → `superseded`) |
| Capacidade | Algo que o agente pode fazer no CRM (ler ficha, mover etapa…) | tool do catálogo MCP (`lib/mcp/tools`) |
| Pacote | Grupo de capacidades por jornada ("Vender e mover o funil") | `ToolBundle` |
| Roteador | Escolhe qual agente atende cada mensagem num mesmo número | `ai_routers` + `ai_router_members` |
| Intenção | Uma "porta" do roteador ligada a um agente | `ai_router_members.intent_name` |
| Retorno | Promessa do agente de voltar a falar num horário | `cron_jobs` (`followup_turn`) |
| Fluxo de follow-up | Sequência visual de esperas, classificações e mensagens | `followup_flow_pointers` / versões / `followup_enrollments` |
| Fluxo (automação) | Construtor de blocos de CRM e WhatsApp disparado por evento | `flows` / `flow_versions` / `flow_executions` |
| Regra automática | "Quando X acontecer, faça Y" (tela Webhooks) | `automation_rules` |
| Passar para humano (handoff) | O agente para de responder e a conversa vai para a equipe | `contacts.force_human`, `conversations.bot_silenced_until` |
| Caso / chamado | O agente pede uma tarefa a uma pessoa **sem** sair da conversa | `agent_cases` |
| Central de avisos | Onde o sistema avisa o que precisa de decisão humana | `agent_inbox_items` |
| Checkpoint | Resumo que o agente grava ao fim de cada turno | `lead_checkpoints` |
| Acervo | Material do negócio que o agente consulta (FAQ, documentos…) | `ai_knowledge_sources` |
| Ponto de IA | Cada lugar do sistema que chama um modelo (responder, classificar…) | `lib/ai/pontos/registro.ts` |

---

## Os três jeitos de "automatizar" — e qual escolher

| Preciso de… | Use | Documento |
|---|---|---|
| Alguém que **converse** com o cliente, entenda e responda | **Agente** | 02 |
| Vários agentes especialistas no **mesmo número** | **Roteador** | 04 |
| Retomar quem **parou de responder**, com esperas e mensagens | **Fluxo de follow-up** | 05 |
| Distribuir lead, marcar, avisar vendedor, menu de opções, disparo em massa | **Fluxo (automação)** | 06 |
| Reação simples a um evento ("lead criado → mover e mandar mensagem") | **Regra automática** | 06 |
| Uma pessoa resolver algo e a IA continuar a conversa | **Casos (pedir ajuda)** | 07 |

---

## Telas envolvidas (onde fica cada coisa)

Nos documentos, **"IA › X"** quer dizer o item X dentro de **Central de IA** no menu.

| Menu | Caminho | Tela |
|---|---|---|
| Central de IA › Montar o agente › **Agentes** | `/app/ai/agents` | Lista de agentes, criar, editar, testar |
| Central de IA › Montar o agente › **Follow-ups** | `/app/ai/followups` | Fluxos de follow-up, fila, retornos |
| Central de IA › Montar o agente › **Roteadores** | `/app/ai/routers` | Roteadores de intenção |
| Central de IA › Montar o agente › **Credenciais** | `/app/ai/credentials` | Chaves dos provedores de IA |
| Central de IA › Montar o agente › **Provedores** | `/app/ai/providers` | Qual modelo cada "ponto de IA" usa |
| Central de IA › Montar o agente › **Integrações via API** | `/app/ai/integracoes` | Sistemas externos que o agente consulta ou corrige |
| Central de IA › Ensinar o agente › **Conhecimento** | `/app/ai/knowledge/sources` | Acervo |
| Central de IA › Ensinar o agente › **Memória** | `/app/ai/memory` | Memória da empresa |
| Central de IA › Ensinar o agente › **Skills** | `/app/ai/skills` | Skills situacionais |
| Central de IA › Acompanhar o agente › **Casos** | `/app/ai/cases` | Pedidos de ajuda do agente |
| Central de IA › Acompanhar o agente › **Alertas** | `/app/ai/inbox` | Central de avisos |
| Central de IA › Acompanhar o agente › **Propostas** | `/app/ai/proposals` | Melhorias sugeridas |
| Central de IA › Acompanhar o agente › **Execuções** | `/app/ai/runs` | Execuções de IA |
| Central de IA › Acompanhar o agente › **Uso e orçamento** | `/app/ai/usage` | Custo e teto mensal |
| **Evolução da IA** | `/app/ai/evolution` | O que o agente aprendeu |
| **Fluxos** | `/app/flows` (+ `/app/flows/execucoes`) | Fluxos de automação |
| **Webhooks** | `/app/webhooks` | Regras automáticas, entradas de contatos, atividade |
| **Conexões** | `/app/connections` | Números de WhatsApp e proteção de envio |
| **Nuvemshop** | `/app/integrations/nuvemshop` | Integração da loja |
| **Agenda** / **Tipos de agendamento** | `/app/agenda`, `/app/settings/tenant/agenda` | Agenda e tipos |
| **Etapas do funil** | `/app/settings/tenant/pipelines` | Funis, etapas e "para onde o card vai em cada passo do agente" |
| **Distribuição de atendimento** | `/app/settings/atendimento` | Modo de distribuição e visibilidade |
| **Radar** | `/app/radar` | Negócios em risco |

> **Permissões:** criar agente exige papel **admin**. Abrir o editor exige **manager** (manager vê em modo somente leitura; só admin salva e publica). Regras automáticas exigem **manager**. Roteadores: listar com **agent**, criar/editar com **admin**.
