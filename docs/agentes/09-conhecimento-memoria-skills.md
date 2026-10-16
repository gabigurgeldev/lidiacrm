# 09 — Conhecimento, memória e skills

O que o agente "sabe" vem de seis lugares. Saber qual usar para cada coisa é metade da qualidade do atendimento.

| Onde | Para que | Entra no prompt | Escopo |
|---|---|---|---|
| **Instruções do agente** | Quem ele é, objetivo, roteiro, regras de conduta | Sempre | O agente |
| **Memória da empresa** | Regras e combinados que valem para todos os atendimentos | Sempre | Organização |
| **Skills** | Roteiros para situações específicas (objeção de preço, rastreio de pedido, urgência clínica…) | Índice sempre; corpo **só quando a situação aparece** | **Agente** (universais em todos; as de ramo, por agente) |
| **Acervo (conhecimento)** | FAQ, políticas, tabelas, manuais, catálogo | **Sob demanda**, via busca | Os materiais marcados no agente |
| **Memória do cliente** | O que o agente aprendeu sobre aquela pessoa | Índice sempre; corpo sob demanda | Um cliente |
| **Checkpoint** | Resumo, compromissos e objeções do último turno | Sempre | Um cliente |

Regra prática: **conduta** vai nas instruções; **regra da casa que vale para todos** vai na memória da empresa; **conteúdo consultável** (texto longo, preço, política) vai no acervo; **roteiro situacional** vira skill.

---

## 1. Acervo de conhecimento (RAG)

Tela: **IA › Conhecimento** (`/app/ai/knowledge/sources`) — "O que o agente sabe".

### 1.1. Pré-requisito: a chave de indexação

Preparar o material exige uma chave **OpenAI** ou **OpenRouter** (modelo de embeddings padrão `text-embedding-3-small`). A tela mostra o aviso **antes** do cadastro e permite colar a chave ali mesmo; quando já existe chave, diz qual está valendo. Sem chave, o material sobe e **nunca fica pronto** — e agora isso aparece como aviso ("Um material que você enviou não entrou na base de conhecimento").

> O modelo que indexa e o que busca **precisam ser o mesmo** (pontos fixos em IA › Provedores). Trocar exige reindexar tudo.

### 1.2. Tipos de material

| Tipo | Como entra | Quando usar |
|---|---|---|
| **Perguntas e respostas** (`faq`) | Você cola pares pergunta/resposta | As dúvidas que se repetem. É o formato que o agente cita melhor, porque cada resposta chega inteira. |
| **Documento** (`documento`) | Envia arquivo (PDF, Markdown, texto) **ou** cola o texto | Política de troca, tabela de preços, manual, contrato. |
| **Conversas anteriores** (`conversas`) | Automático | Atendimentos resolvidos que alguém marcou como aproveitáveis, **anonimizados** e indexados em lote (cron `kb-conversations-batch`). |
| **Catálogo de produtos** (`catalogo`) | Automático | Produtos sincronizados da loja (Nuvemshop): preço, descrição, disponibilidade. |

### 1.3. Passo a passo

1. **Adicionar material** → escolha o tipo → preencha / envie.
2. Aguarde o estado ficar pronto (o cartão mostra quantos **trechos** foram gerados). Dá para **ver os trechos**, **reindexar** e **editar** FAQ.
3. No **agente** › "O que ele consulta antes de responder" → marque o material → salve e publique.

### 1.4. Como a busca funciona no atendimento

- A ferramenta `search_knowledge` só existe no turno se o agente tem material marcado (ou se a empresa já tem **Respostas ensinadas pela equipe** — ver 1.6).
- O agente é instruído a buscar **antes** de responder qualquer fato da empresa (produto, característica, estoque, preço, prazo, política, horário, endereço) e **só afirma o que tem fonte**. Quando o material não responde, segue *Quando o agente não souber responder* (chamar a equipe ou dizer que não sabe) — nunca chuta e nunca promete "vou confirmar".
- Parâmetros (por agente em `ai_agents.config`, ou do servidor): **top-K** = 5 trechos, **similaridade mínima** = 0,40 (calibrada: pergunta literal ≈ 0,85, paráfrase 0,49–0,65, irrelevante ≈ 0,27), teto de **2.000 tokens** de trechos (`RAG_MAX_TOKENS`).
- As **fontes** de cada resposta ficam gravadas na mensagem e aparecem **só para quem atende**, na Caixa de entrada (botão ⓘ ao lado da hora): *"Fonte: Tabela de preços 2026, trecho 3"*, com o tipo do material e a semelhança. Toda mensagem do turno leva as fontes de todas as buscas feitas até ela.
- Mensagem do agente que afirma algo da empresa **sem nenhum trecho do material** aparece com o selo **"sem trecho do material"**. Não quer dizer que inventou — pode ter vindo das instruções do agente ou de uma ferramenta —, mas é a mensagem que vale conferir.

### 1.5. Dicas de conteúdo

- Um assunto por pergunta no FAQ; resposta completa e autossuficiente.
- Escreva como o cliente pergunta (inclua sinônimos).
- Tabelas de preço: uma linha por item, com nome e preço na mesma linha.
- Evite PDFs escaneados (imagem não vira texto).

### 1.6. Perguntas que o material não responde (Central de lacunas)

Toda vez que o agente busca e não acha nada — ou tenta afirmar algo sem fonte e é barrado —, a pergunta do cliente vira um aviso na **Central de avisos**: *"Clientes perguntaram X e o material do agente não tem a resposta (N vezes)"*.

- A pergunta é guardada **sem dados pessoais** (nome, telefone, e-mail, CPF são trocados por marcadores; se sobrar algum, a pergunta não é guardada).
- Perguntas iguais escritas de jeitos diferentes (acento, maiúsculas, "bom dia", "por favor") somam no mesmo aviso — o número entre parênteses diz quantas vezes ela apareceu.
- **Responder e ensinar o agente** (gerente ou administrador): escreva a resposta — e, se quiser, reescreva a pergunta. O par entra no material **Respostas ensinadas pela equipe**, que **todos os agentes** consultam, sem precisar republicar nenhum. Vale assim que a indexação termina (segundos).
- **Não é para o material**: a pergunta para de gerar aviso.
- Se uma pergunta já respondida voltar, o aviso reabre: o par ensinado não cobriu aquela forma de perguntar.
- Nada entra na base sem alguém da equipe escrever ou aprovar.

---

## 2. Memória da empresa

Tela: **IA › Memória** (`/app/ai/memory`).

Duas partes:

| Parte | O que é | Como edita |
|---|---|---|
| **Documento da organização** | Texto-mãe versionado | Editar → **Publicar versão** (só admin). Histórico de versões; **Restaurar como nova versão**. Publicado vale no **próximo turno** de todos os agentes. |
| **Aprendizados** | Entradas curtas ("Não oferecer frete grátis no primeiro contato") | **Novo aprendizado** (título + "O que o agente deve saber"). **Arquivar** / **Reativar**. Origem: *manual* ou *aprendido automaticamente* (o agente com `crm_save_org_memory`, ou proposta aprovada do flywheel). |

Entra no prefixo fixo do prompt (barato, em cache) de **todos** os agentes da organização. Mantenha curto e factual.

---

## 3. Skills situacionais

Tela: **IA › Skills** (`/app/ai/skills`).

Uma skill é um **roteiro para uma situação**. Só o nome e a descrição ficam sempre no prompt; o **corpo** entra apenas quando a última mensagem do cliente casa com as palavras da skill. Situação neutra = zero custo.

### 3.1. De onde vêm

| Origem | Como |
|---|---|
| **Catálogo** | "Skills prontas, mantidas pela plataforma" → **Instalar** (vale para os agentes que usam o padrão; nos outros, ligue em Agente › Habilidades). |
| **Upload** | **Enviar skill (.zip)** com um `SKILL.md` e, opcionalmente, arquivos de apoio (*references*). |

Ações: **Desinstalar**, ver **Histórico de versões**, **Publicar versão**, **Restaurar como nova versão**. Trocar/voltar versão é mover um ponteiro — sem reiniciar nada.

### 3.2. Quais skills cada agente usa (migration 0241)

Cada versão do agente guarda a sua lista em `ai_agent_versions.skill_names`. A tela é **Agente › Habilidades**.

| Tipo | Quando vale |
|---|---|
| **Universal** (skill de plataforma com `nichos` vazio) | **Sempre**, em todo agente — não entra na lista. Hoje: `objecao-preco`, `agendamento`, `cliente-insatisfeito`, `comprovante-de-pagamento`, `dados-pessoais-lgpd`, `retomada-de-conversa`, `risco-a-vida`. |
| **De ramo** (plataforma, `nichos` = `clinica`, `imobiliaria`, `servicos`, `curso`, `loja`) | Só se a lista do agente a tiver. |
| **Da organização** (instalada ou importada) | Com a lista no **padrão** (`NULL`), sempre; com lista explícita, só se estiver nela. |

**Instalação automática:** quem cria o agente a partir do modelo de um ramo (Novo agente › modelo) ou pelo **Criar com IA** recebe as skills daquele ramo já ligadas — a lista padrão mora em `lib/ai/skills/skills-por-nicho.ts`. Agente em branco, genérico ou criado antes da 0241 fica no padrão: universais + as da organização.

Para ver o catálogo em vigor sem confiar nesta lista: `grep -n "^-- ---- skill" supabase/migrations/20261014130000_0242_habilidades_por_nicho.sql`.

### 3.3. Formato do `SKILL.md`

```markdown
---
name: objecao-preco
description: Quando o cliente acha caro ou pede desconto
matcher:
  any_keywords: [caro, desconto, mais barato, abaixa o preço]
  probe_keywords: [preço, valor]
---

1. Reconheça a preocupação sem discutir.
2. Reforce o valor (garantia, entrega, suporte) com dados do acervo.
3. Se pedir desconto, não prometa: abra um caso para aprovação.
```

| Chave | Significado |
|---|---|
| `name` | Identificador da skill. |
| `description` | O que aparece no índice (sempre no prompt). |
| `matcher.any_keywords` | **Casa** a skill: se a mensagem contém alguma, o corpo entra no turno. |
| `matcher.probe_keywords` | Sinal **fraco**: dispara sem `any_keywords` = "quase usou" → vira candidato para curadoria (golden set), não injeta o corpo. |

O corpo tem teto de linhas (skill é roteiro, não manual). O casamento é **determinístico** (por palavra normalizada), não por IA: mesma mensagem → mesmas skills.

Se a skill tem *references*, o agente ganha `read_skill_reference` para ler o arquivo de apoio quando o corpo mencionar.

---

## 4. Memória do cliente

| Peça | O que é |
|---|---|
| **Notas duráveis** (`lead_notes`) | O agente grava com `save_lead_note` (título curto + corpo). Os **títulos** entram sempre num índice com orçamento fixo (`LEAD_NOTES_INDEX_MAX_TOKENS`, padrão 500); o **corpo** é lido sob demanda (`get_lead_note`). Notas antigas podem ser **consolidadas** (`supersedes`). Estourar o índice faz o agente ser instruído a consolidar. |
| **Recuperação híbrida** | Busca por palavra exata (bom para "PED-12345"), por significado (embedding), com decaimento temporal (meia-vida 30 dias) e diversidade (MMR). Parâmetros `LEAD_RECALL_*`. |
| **Checkpoint** | Compromissos, objeções, próxima ação, resumo acumulado e a declaração do turno. |
| **Compactação** | Acima de 40 mensagens, notas são gravadas e o histórico vira resumo + cauda recente. |

Nada disso precisa de configuração — é o motor.

---

## 5. Playbook em camadas

O "prompt de sistema" é montado por camadas, em ordem fixa:

1. **Plataforma** — transparência (apresentar-se como assistente, nunca fingir ser humano), respeito a opt-out, honestidade comercial (sem preço/prazo sem fonte), tom de WhatsApp (mensagens curtas, sem jargão, emoji só se o cliente usar).
2. **Organização / agente** — as **instruções do agente** (com agente publicado) ou o playbook da organização.
3. **Campanha** — quando houver.

Cada camada é versionada e carregada por ponteiro a cada turno. **Regra dura nunca mora no playbook** — mora nas conferências ([08](08-seguranca-guardrails-anti-ban.md)); o texto só orienta o tom.

---

## Notas técnicas

| Peça | Arquivo / tabela |
|---|---|
| Tipos de material | `lib/ai/rag/tipos-de-fonte.ts` |
| Indexação | `workers/rag-indexer.ts`, `lib/ai/rag/*` (`ai_knowledge_sources`, `ai_chunks` com pgvector) |
| Busca no turno | `lib/agent-engine/agent/search-knowledge.ts` |
| Chave de embeddings | `components/ai/ChaveDeConhecimento.tsx`, `lib/ai/embeddings/chave.ts` |
| Memória da empresa | `lib/agent-engine/agent/org-memory.ts`, `lib/ai/memoria-da-org.ts` |
| Skills | `lib/agent-engine/agent/skills.ts`, `skill-references.ts`, `lib/ai/skills/{db,install,package}.ts` (`skill_versions`, `skill_pointers`) |
| Notas do cliente | `lib/agent-engine/agent/lead-notes.ts`, `lead-notes-recall.ts` |
| Compactação | `lib/agent-engine/agent/compaction.ts` |
| Playbook | `lib/agent-engine/agent/playbook.ts`, `lib/agent-engine/playbooks/platform.md` (`playbook_versions`, `playbook_pointers`) |
