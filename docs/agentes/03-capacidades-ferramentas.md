# 03 — Capacidades (ferramentas) do agente

> Na tela: **"O que o agente pode fazer"** (aba Conversa) e **"O que ele pode mexer no sistema"** (aba Organiza o sistema).

Um agente tem dois conjuntos de ferramentas:

1. **Ferramentas nativas do motor** — sempre presentes (ou ligadas por um interruptor específico). Responder ao cliente é uma delas.
2. **Capacidades do catálogo** — o que você liga na tela, por pacote ou uma a uma. São as mesmas ferramentas que o CRM expõe por **MCP** para sistemas externos.

---

## 1. Ferramentas nativas do motor

| Ferramenta | Quando está presente | O que faz |
|---|---|---|
| `send_message` | Sempre | **Único** jeito de falar com o cliente. Texto fora dela nunca é enviado. Cada envio passa pela cadeia de conferências. Máximo de 3 mensagens físicas por turno. |
| `get_lead_context` | Sempre | Relê dados do contato e as últimas mensagens. |
| `update_lead_state` | Sempre | Marca avanço no funil do agente (só o **próximo** estágio; regressão recusada), qualificação (orçamento/autoridade/necessidade/prazo), próxima ação e motivo. Espelha no card conforme a tradução de etapas e o escopo de funis. |
| `save_lead_note` / `get_lead_note` | Sempre | Memória durável do cliente: grava fatos (preferências, restrições, o que já foi oferecido), consolida notas antigas, relê o corpo sob demanda. |
| `schedule_followup` | Quando o servidor tem a janela de retorno configurada (padrão: sim) | Agenda o retorno do próprio agente ("te chamo amanhã às 10h"). Ver [05](05-follow-ups.md). |
| `search_knowledge` | Só se o agente tem **material marcado** no acervo | Busca no acervo e devolve trechos; o agente deve responder com base neles e citar. Sem resultado → "vou confirmar", nunca chutar. |
| `request_human_handoff` | Se **"Deixar o agente chamar uma pessoa"** estiver ligado | Passa a conversa para humano. O modelo deve avisar o cliente antes; se não avisar, o sistema manda um aviso padrão. |
| `open_human_case` / `provide_case_update` | Se **"Pedir ajuda sem sair da conversa"** estiver ligado | Abre caso para uma pessoa e segue conversando; repassa a informação que a pessoa pediu ao cliente. |
| `read_skill_reference` | Só quando uma skill que casou neste turno tem arquivos de apoio | Lê um arquivo de apoio da skill ativa. |
| `send_template` | Só em canal que exige modelo aprovado fora da janela de 24h (Meta oficial / parceiros oficiais) | Envia modelo aprovado quando `send_message` foi recusado porque a janela de 24h fechou. |
| `consultar_sistema` | Se o agente tem endpoints de **consulta** marcados (Integrações via API) | Consulta um sistema externo e devolve os campos permitidos. Usar antes de afirmar qualquer coisa sobre a conta do cliente nesse sistema. |
| `propor_acao` | Se há endpoints de **correção** marcados | Propõe uma correção; o sistema manda ao cliente o resumo e pede **SIM**. A correção só roda depois do SIM, conferido pelo runtime — nunca pelo modelo. |
| `verificar_identidade` | Se alguma integração faz **verificação por e-mail** | Manda um código de 6 dígitos ao e-mail da conta. O cliente digita na conversa e a conferência é automática; o modelo nunca vê o código. |
| `escolher_conta` | Idem | Quando o e-mail verificado tem mais de uma conta, registra qual o cliente escolheu. |

Ferramentas nativas têm **precedência de nome**: se uma capacidade do catálogo tiver o mesmo nome, vale a nativa.

---

## 2. Pacotes (o caminho padrão na tela)

| Pacote | O agente passa a conseguir… |
|---|---|
| **Atender e responder** | ler a conversa, entender o histórico e responder sem pedir que o cliente repita. |
| **Vender e mover o funil** | registrar a oportunidade, atualizar o negócio, mover de etapa, ver e marcar agenda. |
| **Não perder o cliente** | agendar retornos e acompanhar quem esfriou. |
| **Passar para um humano** | reconhecer quando não é com ele, chamar uma pessoa e entregar o resumo. |
| **Organizar a operação** | marcadores, etapas do funil, avisos automáticos e distribuição de trabalho. |
| **Aprender e evoluir** | consultar o que a empresa já sabe, aprender com atendimentos e sugerir melhorias. |

Estados do pacote: **ligado** (todas as automáticas dentro), **parcial** (algumas), **desligado**.

### Níveis de risco

| Selo | Significado | Entra pelo pacote? |
|---|---|---|
| **Só consulta** (seguro) | Só lê. Nada muda. | Sim |
| **Altera dados** (atenção) | Muda algo no sistema; dá para ver e desfazer pela tela. | Sim |
| **Efeito que não dá para desfazer** (crítico) | Sai do sistema ou não volta atrás (ex.: mandar WhatsApp de verdade). | **Nunca** — precisa marcar uma a uma, no quadro vermelho do pacote |

### O teto

- **25 capacidades por agente** no Conversador e **mais 25** independentes no Operador.
- Ligar um pacote que faria passar do teto é **recusado** com a contagem ("faltam N vagas") — e a conta inclui as críticas do pacote, para que você ainda consiga marcá-las depois.
- Por que existe: muitas ferramentas no prompt pioram a escolha do modelo (erra a ferramenta, gasta contexto). O motor já soma as nativas a essas 25.

### Capacidades "órfãs"

Se uma capacidade salva deixou de existir numa atualização do sistema, a tela mostra o aviso "Uma capacidade ligada não existe mais…" com o botão **Desligar essa capacidade**. Ela continua salva, mas o agente não consegue usá-la.

---

## 3. Catálogo completo

> Para conferir a lista vigente na sua versão: `GET /api/v1/mcp/tools` (logado) ou, no código, `lib/mcp/tools/catalogo/*.ts`. No levantamento havia **57** capacidades.
>
> **"Só pessoa"** = capacidade operada por gente: ela exige um papel acima do papel do agente, então **ligá-la no agente não faz efeito** — ela aparece no catálogo porque também é exposta via MCP/API para uso humano.

### Atendimento (cliente, conversa, mensagem)

| Capacidade (nome técnico) | Rótulo na tela | Risco | Pacotes | O que faz |
|---|---|---|---|---|
| `crm_search_contacts` | Procurar cliente | consulta | atender, vender | Encontra cliente por nome, telefone ou e-mail. |
| `crm_get_contact` | Ver ficha do cliente | consulta | atender, vender | Abre a ficha completa: contato, histórico, origem. |
| `crm_propose_contact_field` | Anotar dado que o cliente informou | altera | vender | Guarda nome/e-mail/telefone dito na conversa **para uma pessoa conferir** antes de entrar na ficha. |
| `crm_list_conversations` | Listar conversas | consulta | atender, escalar | Conversas em andamento, quem cuida, posição na fila. |
| `crm_get_conversation` | Ver uma conversa | consulta | atender, escalar | Detalhes: quem atende, marcadores, tempo de espera. |
| `crm_get_conversation_history` | Ler o histórico da conversa | consulta | atender | Mensagens já trocadas. |
| `crm_send_whatsapp_message` | Enviar mensagem no WhatsApp | **crítico** | atender | Envia WhatsApp ao cliente. ⚠️ O motor **bloqueia** envio pelo catálogo durante o atendimento — o agente fala pela `send_message` nativa. Útil via MCP externo. |
| `crm_get_queue_status` | Ver a fila de atendimento | consulta | atender, escalar | Quantos esperam e há quanto tempo. |
| `crm_assign_conversation` | Direcionar conversa para alguém | altera | escalar, atender | Atribui, transfere ou devolve à fila. |
| `crm_manage_tags` | Aplicar marcadores | altera | organizar, atender | Põe/tira marcador em conversa, cliente ou oportunidade. |
| `crm_list_tags` | Ver os marcadores em uso | consulta | organizar, atender | Para reaproveitar em vez de inventar parecido. |
| `crm_list_message_templates` | Ver as respostas prontas | consulta | atender, organizar | Lista textos prontos e atalhos. |
| `crm_render_message_template` | Preencher uma resposta pronta | consulta | atender, organizar | Preenche lacunas com dados do cliente. Não envia. |
| `crm_list_privacy_requests` | Ver pedidos de privacidade | consulta | organizar, atender | Quem pediu exportar/apagar dados — para parar de insistir. |

### Escalação (pessoas e chamados)

| Capacidade | Rótulo | Risco | Pacotes | O que faz |
|---|---|---|---|---|
| `crm_list_available_attendants` | Ver quem pode assumir agora | consulta | escalar, atender | Quem está em atendimento, carga e espaço. |
| `crm_request_human_handoff` | Chamar um atendente humano | altera | escalar | Interrompe o automático e chama uma pessoa com resumo. ⚠️ Durante o atendimento o motor bloqueia esta versão do catálogo — a passagem é feita pela nativa `request_human_handoff`. |
| `crm_list_human_cases` | Ver os chamados em aberto | consulta | escalar | Para não pedir duas vezes a mesma coisa. |
| `crm_get_human_case` | Ler um chamado e o que a pessoa decidiu | consulta | escalar | Decisão e texto da pessoa. |
| `crm_add_case_note` | Registrar o que aconteceu num chamado | altera | escalar | Atualiza o chamado. |
| `crm_close_human_case` | Encerrar um chamado com o desfecho | **crítico** | escalar | Fecha o chamado (não reabre por aqui). |
| `crm_resume_ai_attendance` | Retomar o atendimento automático | **crítico** | escalar | **Só pessoa.** Devolve a conversa ao agente. O agente nunca se auto-libera. |
| `crm_list_team_members` | Ver quem trabalha na empresa | consulta | organizar, escalar | Pessoas do time e permissões. |

### Funil de vendas

| Capacidade | Rótulo | Risco | Pacotes | O que faz |
|---|---|---|---|---|
| `crm_list_leads` | Listar oportunidades do funil | consulta | vender | Oportunidades, etapa, responsável. |
| `crm_get_lead` | Ver uma oportunidade | consulta | vender | Etapa, responsável, marcadores, valor. |
| `crm_list_pipelines` | Listar funis | consulta | vender, organizar | Funis e etapas. |
| `crm_list_stages` | Ver as etapas de um funil | consulta | organizar, vender | Colunas na ordem do quadro. |
| `crm_create_lead` | Criar oportunidade no funil | altera | vender | Registra nova oportunidade. Respeita o escopo de funis. |
| `crm_update_lead` | Atualizar uma oportunidade | altera | vender | Valor, responsável, informações. |
| `crm_move_lead_stage` | Mover oportunidade de etapa | altera | vender | Avança ou registra perda. |
| `crm_create_stage` | Criar etapa no funil | altera | organizar | **Só pessoa.** |
| `crm_update_stage` | Renomear ou reordenar uma etapa | altera | organizar | **Só pessoa.** |
| `crm_archive_stage` | Arquivar uma etapa do funil | **crítico** | organizar | **Só pessoa.** |

### Agenda

| Capacidade | Rótulo | Risco | Pacotes | O que faz |
|---|---|---|---|---|
| `crm_find_free_slots` | Ver horários livres na agenda | consulta | vender | Horários livres do atendente (descontando folgas, compromissos e agenda pessoal/Google). |
| `crm_list_appointments` | Ver os compromissos marcados | consulta | vender | Compromissos de um cliente ou de um dia. |
| `crm_book_appointment` | Marcar consulta ou sessão | altera | vender | Reserva horário. |
| `crm_reschedule_appointment` | Remarcar um compromisso | altera | vender | Move para outro horário. |
| `crm_cancel_appointment` | Desmarcar um compromisso | **crítico** | vender | Desmarca e libera o horário. |

### Retenção (retornos e risco)

| Capacidade | Rótulo | Risco | Pacotes | O que faz |
|---|---|---|---|---|
| `crm_schedule_followup` | Agendar um retorno para o cliente | altera | reter | Marca retorno (mesma regra de janela da nativa). |
| `crm_cancel_followup` | Cancelar um retorno agendado | altera | reter | Desmarca retorno futuro. |
| `crm_list_followups` | Ver os retornos de um cliente | consulta | reter | Marcados, feitos, desmarcados. |
| `crm_list_at_risk_leads` | Ver quem esfriou e quem ficou sem próximo passo | consulta | reter | Oportunidades paradas além do prazo + pessoas esperando sem nada marcado. |
| `crm_close_demand` | Encerrar o negócio como ganho ou perdido | **crítico** | reter | Fecha a oportunidade com motivo. |
| `crm_propose_reactivation` | Sugerir retomar contato com quem sumiu | altera | reter | Cria sugestão para uma pessoa **aprovar** antes de qualquer envio. |

### Comércio (Nuvemshop)

| Capacidade | Rótulo | Risco | Pacotes | O que faz |
|---|---|---|---|---|
| `crm_list_contact_orders` | Ver as compras do cliente | consulta | vender, atender | Compras, valor, situação da entrega. |
| `crm_search_products` | Procurar produto na loja | consulta | vender, atender | Preço e estoque reais. |

### Operação (entradas, regras automáticas)

| Capacidade | Rótulo | Risco | Pacotes | O que faz |
|---|---|---|---|---|
| `crm_list_webhook_sources` | Ver as entradas automáticas de contatos | consulta | organizar | Origens de captação, se estão ligadas. |
| `crm_list_webhook_source_events` | Ver o que chegou por uma entrada | consulta | organizar | Últimos contatos e campos recebidos. |
| `crm_create_webhook_source` | Criar uma entrada automática de contatos | **crítico** | organizar | **Só pessoa.** |
| `crm_set_webhook_source_active` | Ligar ou desligar uma entrada de contatos | **crítico** | organizar | **Só pessoa.** |
| `crm_list_automation_rules` | Ver as regras automáticas | consulta | organizar | O que dispara cada regra e se está ligada. |
| `crm_list_automation_runs` | Ver o que as regras dispararam | consulta | organizar | Execuções recentes e falhas. |
| `crm_set_automation_rule_active` | Ligar ou desligar uma regra automática | **crítico** | organizar | **Só pessoa.** |

### Conhecimento, memória e evolução

| Capacidade | Rótulo | Risco | Pacotes | O que faz |
|---|---|---|---|---|
| `crm_search_knowledge` | Consultar o que a empresa já sabe | consulta | evoluir, atender | Busca no acervo (versão do catálogo; no atendimento a nativa `search_knowledge` é quem roda). |
| `crm_list_knowledge_sources` | Ver os materiais cadastrados | consulta | evoluir | Materiais e se foram processados. |
| `crm_list_improvement_proposals` | Ver sugestões de melhoria | consulta | evoluir | Propostas do sistema e motivos. |
| `crm_get_org_memory` | Consultar as regras da empresa | consulta | evoluir, atender | Lê a memória da empresa. |
| `crm_save_org_memory` | Anotar uma regra aprendida | altera | evoluir | Grava aprendizado marcado como "aprendido automaticamente". |

---

## 4. Como o motor monta as ferramentas de um turno

1. Começa pelas **nativas** (conforme os interruptores da §1).
2. Acrescenta as **capacidades marcadas** no agente. Se o papel **Operador** estiver ligado e tiver assumido capacidades de escrita, essas **saem** do Conversador.
3. Bloqueia, no catálogo, o envio de WhatsApp e a passagem para humano (o motor tem caminhos próprios, com as conferências).
4. Embrulha tudo num **disjuntor** (mesma chamada repetida, mesma ferramenta muitas vezes, nenhuma progressão → aviso, depois bloqueio).
5. Se falhar ao montar as capacidades extras, o turno **segue sem elas** e a Central recebe "Um atendimento saiu sem as ferramentas que você ligou".

Toda capacidade executada pelo agente é auditada (`api_audit_log`) com o agente como autor, usando um token efêmero que respeita papel e escopo.

---

## 5. Recomendações

- Comece por **Atender** + o pacote do seu objetivo (Vender **ou** Não perder o cliente). Ligue o resto conforme a aba **Capacidades** mostrar necessidade.
- Ligue capacidades **críticas** só quando o processo exigir e o prompt disser exatamente quando usá-las.
- Agenda: o pacote Vender traz ver/marcar/remarcar; "Desmarcar" é crítico.
- Se o Operador estiver ligado, deixe **leitura** no Conversador e **escrita** no Operador.
- Use a aba **Capacidades** do agente para ver o que nunca é usado e liberar vagas.

---

## Notas técnicas

| Peça | Arquivo |
|---|---|
| Catálogo (texto para humanos) | `lib/mcp/tools/catalogo/*.ts` |
| Handlers (o que o modelo recebe na descrição) | `lib/mcp/tools/<dominio>.ts` |
| Pacotes e riscos | `lib/mcp/tools/pacotes.ts` |
| Regra de seleção e teto | `lib/mcp/tools/selecao-por-pacote.ts` (`TETO_TOOLS_POR_AGENTE`) |
| Ponte catálogo → turno | `lib/agent-engine/edge/crm/mcp-tools.ts` |
| Divisão Conversador/Operador | `lib/agent-engine/agent/entrega-de-capacidade.ts` |
| Disjuntor | `lib/agent-engine/agent/tool-breaker.ts` |
| Ferramentas nativas | `AGENT_TOOL_DEFS` em `lib/agent-engine/agent/inbound-turn.ts` |
