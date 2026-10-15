# 02 — Criar e configurar um agente

> Tela: **IA › Agentes** (`/app/ai/agents`). Criar exige papel **admin**; abrir o editor exige **manager** (manager vê tudo em modo somente leitura).

---

## 1. Antes de começar — o que precisa existir

Um agente só consegue ser **publicado** (e só publicado atende) se estas peças existirem. Faça nesta ordem:

| # | O que | Onde | Por quê |
|---|---|---|---|
| 1 | **Número de WhatsApp conectado** (status "conectado"/`WORKING`) | Conexões (`/app/connections`) | O agente atende por um número. Publicar com o número desconectado é recusado. |
| 2 | **Chave de um provedor de IA cadastrada e validada** | IA › Credenciais (`/app/ai/credentials`) | O agente usa essa chave para pensar. Ver o aviso logo abaixo sobre a "chave desta instalação". |
| 3 | (Recomendado) **Material no acervo** — FAQ, política, tabela de preços | IA › Conhecimento (`/app/ai/knowledge/sources`) | Sem material marcado, o agente responde só com o que o modelo já sabe. Precisa de uma chave OpenAI ou OpenRouter para indexar. |
| 4 | (Recomendado) **Funis com etapas e a tradução "para onde o card vai em cada passo"** | Etapas do funil (`/app/settings/tenant/pipelines`) | Sem isso o agente atende mas não move os cards. |
| 5 | (Opcional) **Fluxos de follow-up publicados** | IA › Follow-ups | Para o agente poder armá-los. |
| 6 | (Opcional) **Equipe com disponibilidade configurada** | Equipe / Distribuição de atendimento | Para a passagem para humano cair em alguém. |

> ### ⚠️ Atenção — "A chave desta instalação" salva, mas não publica
>
> O seletor **Chave de acesso** oferece "A chave desta instalação" quando o `.env` do servidor tem a chave daquele provedor. Com ela você consegue **salvar o rascunho**, mas o botão **Publicar** fica desabilitado ("Escolha a chave de acesso da empresa de inteligência artificial") e, se a publicação chegar por API, o banco recusa com `credential_missing` (`fn_publish_ai_agent_version`).
>
> **Na prática:** para publicar, cadastre a chave em **IA › Credenciais**, espere ficar **validada** e escolha essa credencial no agente. (O runtime saberia usar a chave do servidor; quem trava é a regra de publicação.)

---

## 2. Passo a passo — do zero ao agente atendendo

1. **IA › Agentes › Novo agente.**
2. Na aba **Conversa com o cliente**, preencha no mínimo: **Nome**, **Empresa de IA**, **Modelo**, **Chave de acesso**, **Número conectado** e **As instruções dele** (pelo menos uma frase).
3. Clique **Criar agente**. Ele nasce com a **v1 em rascunho** e a tela abre o editor.
4. Configure o resto (capacidades, materiais, gatilhos, passagem para humano, follow-up). Use as abas **Organiza o sistema** e **Confere antes de enviar** se for o caso.
5. **Salvar rascunho.** Cada salvamento atualiza o rascunho vigente (não cria versão nova a cada clique).
6. Aba **Teste:** mande uma mensagem de exemplo e veja a resposta, as ferramentas usadas, o custo e se alguma palavra interna vazou. **Nada é enviado no WhatsApp**, mas o teste **consome créditos** do provedor.
7. **Publicar vN.** Confirme no diálogo. A partir da próxima mensagem que chegar naquele número, o agente responde.
8. Mande uma mensagem real de outro celular e acompanhe em **Execuções** e na Caixa de entrada.

### O que impede o botão Publicar (a dica aparece ao passar o mouse)

| Mensagem | O que fazer |
|---|---|
| Salve o agent antes de publicar. | Agente ainda não criado. |
| Sem rascunho para publicar. | Altere algo e salve — publicar sempre parte de um rascunho. |
| Resolva os erros do formulário. | Há campo em vermelho. |
| Salve o rascunho antes de publicar. | Há alterações não salvas. |
| Escolha a chave de acesso… | Nenhuma credencial cadastrada escolhida (inclui o caso da "chave desta instalação"). |
| Credencial X inválida / ainda não validada. | Vá em Credenciais e revalide. |
| Escolha por qual número de WhatsApp ele atende. | Falta número. |
| Número WhatsApp não está conectado (status: …). | Reconecte o número (QR ou canal oficial). |

Erros que o servidor ainda pode devolver na publicação: `agent_archived`, `version_invalid_state`, `credential_not_found`, `credential_inactive`, `credential_not_validated`, `credential_provider_mismatch` (a chave é de outro provedor), `channel_session_not_found`, `channel_session_offline`, `model_not_found`, `tool_id_invalid`.

---

## 3. Aba "Conversa com o cliente" — campo por campo

### 3.1. Quem é este agente

| Campo | Limite / padrão | O que faz de verdade |
|---|---|---|
| **Nome** | obrigatório, até 120 caracteres | Identifica o agente nas listas, no roteador, na autoria das mensagens e na linha do tempo ("qual agente prometeu voltar"). |
| **Descrição** | até 2.000 caracteres, opcional | Só para a equipe. Não vai para o modelo. |
| **Ordem de preferência** | 0 a 1000, padrão 0 | Quando **mais de um agente publicado** está no **mesmo número** (sem roteador), atende o de número **maior**; empate → o criado primeiro. Com um agente só, deixe 0. |

> ### ⚠️ Atenção — Nome, Descrição e Ordem só valem na criação
> No modo de edição, **Salvar rascunho** grava apenas os campos da **versão**. Mudar Nome, Descrição ou Ordem de preferência ali marca o formulário como alterado, mas **não persiste** esses três campos.
> - Para **renomear**: menu "⋯" do agente na lista › **Renomear**.
> - Para mudar **descrição/ordem** depois de criado: só por API (`PATCH /api/v1/ai/agents/:id` com `name`, `description`, `priority`).

### 3.2. A inteligência que ele usa

| Campo | Limite / padrão | O que faz |
|---|---|---|
| **Empresa de inteligência artificial** | Anthropic (Claude), OpenAI (GPT), Google (Gemini), OpenRouter | Provedor do modelo. Trocar o provedor **limpa** Modelo e Chave (eles dependem dele). |
| **Modelo** | obrigatório, até 120 caracteres | O modelo que conversa. A lista mostra o que a credencial habilita. Na OpenRouter dá para **buscar** pelo nome ("sonnet", "gemini") ou **colar o código** (`anthropic/claude-sonnet-4.5`) e **sincronizar o catálogo**. Modelos marcados "Não usa ferramentas" conversam mas **não mexem no funil nem registram nada** — evite para agente de atendimento. |
| **Chave de acesso** | obrigatória | Qual credencial paga as chamadas. Precisa estar **validada** para publicar. Ver o aviso da §1 sobre a chave da instalação. |

### 3.3. Por qual número ele atende

| Campo | O que faz |
|---|---|
| **Número conectado** | O número de WhatsApp (ou canal oficial) em que este agente responde. Precisa estar conectado para publicar. |

Se o agente é **membro de um roteador**, aparece o aviso "Este agente é acionado pelo roteador «X» — o campo de número abaixo não se aplica". Mesmo assim o campo continua obrigatório para salvar (escolha o número do roteador). Ver [04](04-roteadores.md).

### 3.4. Freios de segurança

| Campo | Limite / padrão | O que faz de verdade |
|---|---|---|
| **Ações por atendimento** (`max_steps`) | 1 a 25, padrão 10 | Quantas ações (ferramentas) o modelo pode encadear num único turno. Vence o padrão do servidor (`AGENT_MAX_STEPS`). Baixo demais → ele para antes de terminar; alto demais → mais custo em turnos confusos. 8–12 é um bom intervalo. |
| **Volume de texto por atendimento** (`token_budget`) | 1.000 a 500.000, padrão 50.000 | ⚠️ Lido **só** pelo runtime antigo (usado no botão **Teste**). O motor que atende em produção **não** aplica este limite por turno. |
| **Custo máximo por atendimento (centavos)** (`cost_budget_cents`) | 1 a 10.000, padrão 50 | ⚠️ Mesmo caso acima: vale no **Teste**, não no atendimento real. O que limita gasto em produção é o **orçamento mensal da organização** (IA › Uso e orçamento). |
| **Mensagens anteriores que ele lê** (`history_message_window`) | 0 a 200, padrão 20 | Quantas mensagens da conversa entram no contexto a cada turno. |
| **Tamanho máximo desse histórico** (`history_token_window`) | 0 a 50.000, passo 500, padrão 8.000 | Teto em tokens desse histórico. Importa em mensagens longas e áudios transcritos. |

### 3.5. As instruções dele (o "prompt")

| Limite | 10 a 20.000 caracteres (contados sem espaços nas pontas) |
|---|---|

- É a **camada do agente** no playbook. Antes dela sempre vem a camada da **plataforma** (transparência: se apresentar como assistente, nunca fingir ser humano, acolher pedido de humano, não inventar preço/prazo, mensagens curtas). Você não precisa repetir isso.
- O contador mostra caracteres e uma estimativa de tokens contra a janela do modelo.
- **Não há corte silencioso:** colar mais de 20.000 caracteres entra inteiro e a tela diz quanto cortar.

**O que escrever (receita que funciona):**

```
## Quem você é
Você é a Ana, assistente da Clínica Sorriso (odontologia, Campinas).

## Seu objetivo
Tirar dúvidas, qualificar o paciente e marcar avaliação gratuita.

## Como conduzir
1. Pergunte o nome e o que o paciente busca (uma pergunta por vez).
2. Consulte o material antes de falar de preço, convênio ou horário.
3. Ofereça dois horários livres. Confirme dia, hora e endereço.

## Regras da casa
- Não dê diagnóstico. Não prometa resultado.
- Desconto só com aprovação: abra um pedido para a recepção.
- Fora do escopo (reclamação, financeiro): passe para uma pessoa.
```

**O que NÃO colocar:** regras que o sistema já garante (STOP, ritmo de envio, janela) — elas são conferências fixas; política longa e tabela de preços — ponha no **acervo**; nomes de ferramentas — o agente já recebe a lista.

### 3.6. Estilo de resposta

| Campo | Limite / padrão | O que faz |
|---|---|---|
| **Responder em várias mensagens curtas** (`split_messages`) | desligado | A resposta sai em "bolhas" separadas, no ritmo anti-banimento, e o modelo é instruído a escrever em parágrafos curtos. |
| **Tamanho máximo por bolha** | 80 a 4.000, padrão 600 | Só aparece com o item acima ligado. |
| **Responder em áudio (nota de voz)** (`reply_as_audio`) | desligado | Cada resposta sai como áudio. **Vence** o modo de bolhas (a resposta vai inteira numa nota). Mensagens com link/e-mail ou muito longas continuam em texto. Se a síntese falhar, o cliente recebe texto e a Central avisa ("O agente parou de responder em áudio…"). |
| **Só quando o cliente mandar áudio** (`reply_as_audio_mirror`) | desligado | Aparece com o áudio ligado. **Ligado:** quem escreve recebe texto, quem manda áudio recebe áudio (espelho). **Desligado:** toda resposta sai em áudio. |
| **Voz** | conforme o serviço | Com a chave **OpenRouter** cadastrada: Eve (animada), Ara (calorosa), Rex (profissional), Sal (equilibrada), Leo (firme). Com serviço Kokoro instalado: Dora, Alex, Santa. Sem nenhum serviço, o interruptor fica desabilitado (só dá para desligar). |

### 3.7. O que o agente pode fazer (capacidades)

Liga **pacotes por jornada** (Atender, Vender, Não perder o cliente, Passar para humano, Organizar, Aprender) ou, no modo avançado, capacidade por capacidade. Teto: **25 capacidades** por agente. Capacidades de risco **crítico** (ex.: enviar WhatsApp por ferramenta, desmarcar compromisso, encerrar negócio) **nunca** entram pelo pacote — precisam ser marcadas uma a uma.

Tudo sobre isso: [03 — Capacidades](03-capacidades-ferramentas.md).

> Lembre: responder ao cliente **não** depende de capacidade nenhuma — a ferramenta nativa `send_message` está sempre presente. As capacidades são o que ele faz **além** de conversar.

### 3.8. O que ele consulta antes de responder (acervo)

Marque os materiais do acervo que este agente pode ler.

- **Nenhum marcado** = a ferramenta de busca **nem entra** no turno; ele responde só com o que o modelo sabe.
- Material marcado mas **"ainda não preparado"** (0 trechos) = o agente não acha nada nele. Confira a indexação no acervo.
- Aviso "Você tem N materiais no acervo e este assistente não lê nenhum" = provável esquecimento.

O agente **cita a fonte** das respostas (as citações aparecem na mensagem enviada, na Caixa de entrada). Detalhes em [09](09-conhecimento-memoria-skills.md).

### 3.8.1. Sistemas que ele consulta (Integrações via API)

Marque os **endpoints** das integrações cadastradas em **IA › Integrações** que este agente pode usar. Teto: **40 endpoints** por agente (separado do teto de 25 capacidades — o agente recebe 4 ferramentas fixas que listam os endpoints).

Cada endpoint aparece com o tipo: **consulta** ou **correção, pede SIM**, e a marca **exige conta verificada** quando for o caso.

| Aviso na seção | O que fazer |
|---|---|
| "Nenhuma integração cadastrada." | Clique em **Conectar um sistema**. |
| "«X» está falhando — enquanto não voltar, o agente transfere quem precisar dela para a equipe." | **Testar conexão** na integração. |
| "tem consulta que exige conta verificada, mas a integração não faz verificação por e-mail" | Ligue a verificação por e-mail na integração (e cadastre o endpoint de busca de conta). |
| Verificação por e-mail sem e-mail configurado na instalação | Configure o envio de e-mail do servidor (ex.: `RESEND_API_KEY`). |

Endpoint desligado ou de integração arquivada é recusado ao salvar ("Um dos endpoints de integração marcados não existe mais…"). Tudo sobre o recurso: [10 §4](10-integracoes.md).

### 3.9. Quando ele entra em ação (gatilhos)

| Campo | Padrão | Efeito no atendimento real |
|---|---|---|
| **O que faz ele responder** | "Uma mensagem nova do cliente" | Único evento existente. |
| **Não responder em grupos** | ligado | ⚠️ O motor atual **sempre** ignora grupos, independente do interruptor. |
| **Não responder às mensagens que saem do seu próprio número** | ligado | ⚠️ O motor atual só reage a mensagens **recebidas**; o interruptor não muda nada. |
| **Só responder quando a mensagem falar de algo específico** (regex, ex.: `pedido\|status\|orçamento`) | vazio | ⚠️ **Não é aplicado pelo motor atual** — só pelo despachante antigo (deprecated). Para separar assuntos entre agentes, use um **Roteador** ([04](04-roteadores.md)). |
| **Quantos atendimentos ao mesmo tempo** (um por conversa / um por cliente) | um por conversa | ⚠️ Lido só pelo despachante antigo. No motor atual a fila já serializa por cliente (rajadas viram um job). |
| **Só atender em horário de funcionamento** | desligado | **Aplicado.** Fora do horário, a resposta é **adiada** para a abertura (quem escreveu às 22h é respondido às 8h). Campos: fuso (IANA, ex.: `America/Sao_Paulo`), início, fim, dias da semana (Dom–Sáb). Ao ligar, o padrão é 08:00–20:00, seg–sex. |

> **Horário do agente × janela anti-ban:** são coisas diferentes. A **janela anti-ban** (padrão 7h–22h, por número) vale para tudo que fala com o cliente, inclusive follow-ups. O **horário do agente** vale só para a resposta a mensagens recebidas.

### 3.10. Passar para uma pessoa

| Campo | Limite / padrão | O que faz |
|---|---|---|
| **Deixar o agente chamar uma pessoa quando perceber que não é caso dele** (`handoff_tool_enabled`) | ligado | Dá ao modelo a ferramenta `request_human_handoff`. Desligado, o **modelo** não consegue passar a conversa — mas a detecção fixa de "quero falar com atendente" continua ativa (guardrail nunca sai). |
| **Palavras que chamam uma pessoa na hora** (`handoff_keywords`) | até 20 expressões de até 60 caracteres; padrão: "falar com humano", "atendente", "pessoa real" | Se a última mensagem do cliente **contém** qualquer uma (sem diferenciar maiúscula), a conversa passa para humano **sem chamar a IA**, com aviso ao cliente. Soma-se à detecção fixa em português. Cuidado com palavras genéricas demais ("ajuda") — passam tudo para humano. |

| **Quando o cliente mandar uma foto, passar para uma pessoa** (`handoff_on_customer_image`) | desligado | A foto que o cliente manda passa a conversa para a equipe **sem chamar a IA**, com aviso de que a foto chegou, e o automático fica parado até alguém devolver. Para loja cujo catálogo não está todo no acervo — sem isto, o agente vê a foto e pode chutar disponibilidade ou preço. Não depende do interruptor acima. |

Fluxo completo da passagem: [07](07-handoff-chamados-e-roteamento-humano.md).

### 3.11. Pedir ajuda sem sair da conversa (casos)

| Campo | Padrão | O que faz |
|---|---|---|
| **Deixar o agente pedir uma tarefa a alguém e seguir conversando** (`cases_enabled`) | desligado | Dá ao modelo `open_human_case` e `provide_case_update`. Quando ele esbarra em algo que só uma pessoa resolve (aprovar desconto, liberar acesso), abre um **caso** em IA › Casos, **continua** conversando, e retoma quando a pessoa responde. Com isso ligado, a conferência "Não prometer atendimento humano que não existe" passa a exigir caso aberto antes de qualquer "vou pedir para alguém verificar". |

### 3.12. Follow-up

| Campo | Limite / padrão | O que faz |
|---|---|---|
| **Habilitar gatilhos automáticos de follow-up** (`followup.enabled`) | desligado | Liga a armação automática dos fluxos marcados abaixo. |
| **Fluxos publicados** (`followup.flow_pointer_ids`) | até 20 | Só aparecem fluxos **publicados**. Um fluxo com gatilho automático (Silêncio, Etapa do funil, Agente pediu ajuda) **só dispara** se algum agente **publicado** tiver follow-up habilitado **e** esse fluxo marcado. Se dois agentes armam o mesmo fluxo, o inscrito é atribuído ao de menor id (estável). |

O retorno que o próprio agente promete ("te chamo amanhã") **não depende** deste interruptor — é a ferramenta nativa `schedule_followup`. Tudo em [05](05-follow-ups.md).

---

## 4. Aba "Organiza o sistema" (papel Operador)

| Campo | Padrão | O que faz |
|---|---|---|
| **Deixar o agente organizar o sistema depois de cada conversa** (`operator_enabled`) | desligado | Liga o turno do Operador ao fim de cada turno do Conversador. **Custa uma chamada de modelo por turno** (exceto quando o Conversador declarou "nada a declarar"). |
| **A inteligência que ele usa para organizar** (`operator_model`) | vazio = "A mesma que conversa" | Pode ser um modelo mais barato (organizar é mais mecânico). Usa o **mesmo provedor e chave** do Conversador. "Usar a mesma que conversa" volta a herdar. |
| **O que ele pode mexer no sistema** (`operator_tool_ids`) | nenhuma; teto próprio de 25 | Lista **só deste papel**. Quando o Operador assume capacidades de escrita, elas **saem** do Conversador (é o que cura o vazamento de vocabulário). Vazio: ele ainda avisa quando o agente prometeu algo e ninguém cumpriu, mas não resolve sozinho. |

Com o papel ligado, aparece **"Como está indo (últimos N dias)"**: em quantas conversas ele organizou algo, quantas promessas ficaram com responsável e quantas vezes "quis agir e não pôde" (sinal para marcar mais capacidades).

### Em que negócios ele pode mexer (escopo de funis)

Fica nesta aba porque é permissão de **operar**, não de conversar.

| Comportamento | Detalhe |
|---|---|
| **Nenhum funil marcado** (padrão) | Ele conversa normalmente mas **não move, não edita, não encerra** negócio nenhum. Falha fechada de propósito. |
| Funil marcado | Pode mover/editar negócios **desse** funil. Tentativa fora do escopo vira aviso próprio na Central (não é falha — é a regra funcionando). |
| Aviso "**As conversas novas viram negócio em X, que não está marcado**" | X é o funil de entrada (onde cada conversa nova vira card). Se ele ficar de fora, os cards se acumulam sem que o agente possa organizá-los. |
| Aviso "**ele não sabe organizar este funil ainda**" | Ninguém disse ao agente o que cada etapa significa. Configure em Etapas do funil › **Para onde o card vai em cada passo**. |

### A tradução de etapas (Etapas do funil)

O agente pensa num funil próprio de 7 passos. Para o card andar no **seu** funil, você diz para qual etapa ele vai em cada passo:

| Passo do agente | Significa | Exemplo de etapa sua |
|---|---|---|
| Novo lead | acabou de chamar e ninguém respondeu ainda | Entrada |
| Primeiro contato | já foi respondido | Em atendimento |
| Em qualificação | ele está entendendo o que a pessoa precisa | Diagnóstico |
| Qualificado | já dá para saber o que oferecer | Proposta |
| Em negociação | está fechando preço, horário ou condições | Negociação |
| Ganho | fechou negócio | Fechado (marcada como "aqui o cliente fecha") |
| Perdido | não fechou | Perdido (marcada como "aqui o cliente desiste") |

"**Não mover o card**" é escolha válida (ex.: etapas "Em separação", "Pós-venda" não têm equivalente). Ganho/Perdido só aceitam etapas marcadas como fechamento/perda. O espelho no CRM **nunca desfaz** o estado do agente: se falhar (ex.: alguém moveu o card antes), vira aviso.

---

## 5. Aba "Confere antes de enviar" (papel Segurança)

Mostra as **10 conferências de saída** (na ordem) e a **1 de entrada**. Oito não se desligam, e a tela diz por quê. Duas custam uma chamada de modelo e têm interruptor **por organização** (vale para todos os agentes):

| Conferência | Custo | Estados |
|---|---|---|
| Conferir promessas em texto livre | +1 consulta ao modelo por mensagem enviada | "vem da configuração do servidor" (sem escolha) / "Ligada por você" / "Desligada por você" |
| Detectar tentativa de manipular o assistente (entrada) | +1 consulta ao modelo por mensagem recebida | idem |

O modelo usado por elas se escolhe em **IA › Provedores**. Lista completa em [08](08-seguranca-guardrails-anti-ban.md).

---

## 6. As outras abas do editor

| Aba | Para que serve |
|---|---|
| **Teste** | Ensaia uma versão (rascunho ou publicada) com uma mensagem de exemplo, nome e telefone opcionais. Mostra status, latência, tokens, custo, as ferramentas chamadas e uma checagem de **vocabulário interno** ("A resposta não usa palavras internas do sistema" ou o que foi encontrado). Não envia nada no WhatsApp; consome créditos. Usa o modelo **da versão** testada. ⚠️ O ensaio roda no runtime antigo: os freios "Volume de texto" e "Custo máximo" valem aqui; algumas conferências não são avaliadas (a tela diz quantas ficaram de fora). |
| **Capacidades** | Quais capacidades foram realmente usadas, quantas vezes, com que resultado. Bom para desligar o que nunca é usado. |
| **Execuções** | Cada turno: status (`completed`, `failed`, `handoff`…), duração, custo, e o rastro detalhado (drawer com cada passo e ferramenta). |
| **Histórico** | Todas as versões. **Diff** entre versões (modelo, provedor, prompt, ferramentas adicionadas/removidas). **Reverter para vN**: cria uma versão nova idêntica à vN e **publica imediatamente** (a atual vira "superseded"). |
| **Propostas** | Melhorias sugeridas pelo sistema a partir dos atendimentos (ver [11](11-monitoramento-e-diagnostico.md)). Aplicar uma proposta cria rascunho/versão nova — você revisa e publica. |

---

## 7. Ciclo de vida: rascunho, publicada, pausada, arquivada

| Estado (selo na tela) | Significado | Atende? |
|---|---|---|
| **Rascunho vN** | Nunca publicado | Não |
| **Publicado vN** | Versão N no ar | Sim |
| **Publicado vN + Rascunho vM** | No ar a N; você está editando a M | Sim (a N) |
| **Publicado vN (rascunho vK superado)** | Existia um rascunho mais antigo que a publicada; ele fica no Histórico, não abre | Sim |
| **Pausado · editando a vN** | Pausado; o formulário abriu da última versão que existiu | Não |
| **Arquivado** | Some das listas ativas | Não |

Ações no menu "⋯" da lista:

| Ação | Efeito |
|---|---|
| **Editar** | Abre o editor. |
| **Renomear** | Troca só o nome. |
| **Duplicar** | Cria outro agente com a mesma configuração (útil para variações por número/nicho). |
| **Pausar** | **Despublica**: o agente para de atender; a versão que estava no ar vira "superseded". Para voltar: abra o editor, **Salvar rascunho** e **Publicar** — ou Histórico › **Reverter para vN**. ("Despausar" pelo menu é só para agentes do tipo antigo.) |
| **Arquivar** | Para de atender e some das listas ativas. Versões preservadas para auditoria. **Não dá para desarquivar pela tela.** |

Regras que o banco garante: versão **publicada é imutável** (mudança = versão nova); só existe **uma** publicada por agente; publicar é uma troca atômica.

---

## 8. Receitas prontas

**Atendente simples de uma loja (um número, um agente)**
- Pacotes: Atender e responder + Vender e mover o funil.
- Acervo: FAQ + política de troca + catálogo (se Nuvemshop).
- Passar para humano ligado; palavras padrão.
- Funis: marque o funil de entrada e traduza as etapas.

**Clínica com agenda**
- Pacote Vender (inclui "Ver horários livres", "Marcar consulta", "Remarcar"); "Desmarcar" é crítico → marcar à mão se quiser.
- Horário de funcionamento: ligado se não quiser resposta à noite (as mensagens noturnas são respondidas na abertura).
- Pedir ajuda sem sair da conversa: ligado (convênio, desconto, encaixe).

**SDR + Suporte no mesmo número**
- Dois agentes com prompts focados + um **Roteador** com intenções "quer comprar" e "precisa de suporte", e fallback no SDR. Ver [04](04-roteadores.md).

**Operação enxuta (organizar sem pagar o dobro)**
- Organiza o sistema: ligado, com modelo mais barato; capacidades de escrita (Vender, Organizar) no Operador; Conversador só com leitura.

---

## Notas técnicas

| Peça | Arquivo |
|---|---|
| Formulário | `app/app/ai/agents/[id]/_components/AgentForm.tsx` |
| Validação (fonte dos limites) | `lib/ai/agents/validation.ts` |
| Salvar / publicar / criar | `app/app/ai/agents/[id]/_actions.ts`, `app/app/ai/agents/_actions.ts` |
| Publicação atômica | `fn_publish_ai_agent_version` (`supabase/baseline.sql`) |
| Leitura em runtime | `lib/agent-engine/agent/agent-config.ts` |
| Horário de funcionamento | `lib/agent-engine/agent/janela-de-atendimento.ts` |
| Escopo de funis | `lib/ai/agents/escopo.ts`, `lib/leads/escopo-de-funil.ts` |
| Tradução de etapas | `lib/leads/agent-mapping.ts`, `crm_stages.agent_stage_hint` |

Tabelas: `ai_agents` (identidade, `priority`, `published_version_id`, `archived_at`) e `ai_agent_versions` (todo o resto). API REST: `/api/v1/ai/agents` (lista/cria), `/:id` (lê/edita identidade), `/:id/versions` (rascunhos), `/:id/publish`, `/:id/pause`, `/:id/duplicate`, `/:id/runs`, `/:id/tool-usage`, `/:id/proposals`, `/:id/versions/:vid/test`.
