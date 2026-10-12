# 10 — Integrações

Tudo que liga o agente a algo fora dele.

| # | Integração | Para quê | Onde configura |
|---|---|---|---|
| 1 | Canais de WhatsApp | Por onde o agente fala | Conexões |
| 2 | Provedores de IA e "pontos de IA" | Quem pensa, e qual modelo em cada tarefa | IA › Credenciais, IA › Provedores |
| 3 | Voz | Responder em áudio | IA › Credenciais (OpenRouter) |
| 4 | **Integrações via API** | O agente consulta e corrige dados em sistemas externos | IA › Integrações |
| 5 | Nuvemshop | Pedidos, produtos, clientes | Integrações › Nuvemshop |
| 6 | Google Agenda | Horários livres e compromissos | Agenda / Tipos de agendamento |
| 7 | Captação e webhooks | Contatos entrando sozinhos; avisar outros sistemas | Webhooks, Fluxos |
| 8 | MCP e API REST | Outros sistemas e IAs operando o CRM | Configurações › Tokens de API |
| 9 | E-mail | Códigos de verificação, convites | `.env` do servidor |
| 10 | Asaas (assinatura) | Cobrança da organização | Painel/`.env` |

---

## 1. Canais de WhatsApp

| Canal | Transporte | Observações para o agente |
|---|---|---|
| **WAHA** (QR code) | Não oficial | Fala livre a qualquer hora (dentro da janela anti-ban). Exige aquecimento e ritmo para não ser banido. Se cair, a Central avisa "Conexão do WhatsApp caiu — precisa escanear o QR de novo". |
| **Meta Cloud API** (canal oficial) | Oficial | Fora da **janela de 24 h** desde a última mensagem do cliente, só sai **modelo aprovado** — o agente ganha `send_template` e a conferência "Respeitar a janela do WhatsApp" barra texto livre. |
| **Zernio** (parceiro) | Oficial (BSP) | Mesmas regras da Meta (janela de 24 h, modelos). |
| **Stevo** (parceiro) | Oficial **ou** QR, conforme o modo gravado da instância | Regras conforme o modo. |

O agente é ligado a **um número** (campo "Número conectado"). Para publicar, o número precisa estar conectado. Grupos (`@g.us`) nunca são atendidos pelo agente.

Mídia recebida: áudio é **transcrito**, imagem é **descrita** (ou enviada nativa ao modelo, se ele suportar). Se não der para ler, a Central avisa "O agente não conseguiu ler uma foto ou áudio que o cliente enviou".

---

## 2. Provedores de IA

### 2.1. Credenciais (IA › Credenciais)

| Provedor | Uso típico |
|---|---|
| **Anthropic (Claude)** | Agente principal. |
| **OpenAI (GPT)** | Agente; **transcrição de áudio** (padrão de mercado — também funciona com OpenRouter); embeddings. |
| **Google (Gemini)** | Agente. |
| **OpenRouter** | Uma chave, centenas de modelos (inclusive gratuitos). Também serve para **indexar o acervo** e para a **voz**. |

**Adicionar credencial:** provedor, rótulo (ex.: "Produção"), chave, **Endereço próprio (opcional)** (para endpoint compatível). A chave é **cifrada (AES-GCM)** e nunca volta em texto claro. Ao salvar, é **validada** em segundo plano e a lista de modelos disponíveis é carregada. Pode **revalidar** depois.

**Chave da instalação:** se o `.env` do servidor tem `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` ou `OPENROUTER_API_KEY`, ela aparece como "da instalação". ⚠️ Agente com "A chave desta instalação" **não publica** ([02 §1](02-criar-e-configurar-agente.md)) — cadastre a credencial na tela.

### 2.2. Pontos de IA (IA › Provedores)

O sistema chama IA em vários lugares. A tela mostra **qual modelo** atende cada um, agrupado por papel, com "Se falhar:" (o sintoma que você veria). Pontos marcados como **fixos** não se escolhem ali, e a tela diz por quê.

| Papel | Ponto | O que faz |
|---|---|---|
| **Atender o cliente** | Responder o cliente (`agent_turn`) | Usa o modelo da **versão publicada do agente** ("Configurar no agente"). |
| | Trabalhar o funil (`operator_turn`) | Papel Operador. |
| | Abordar quem preencheu o formulário (`automation_ai_message`) | Ação "Mensagem escrita pela IA" das regras automáticas. |
| | Sugerir resposta ao atendente (`draft_suggestion`) | Rascunho para o humano revisar. |
| | Responder (motor antigo) (`bot_respond`) | Caminho legado. |
| **Entender a conversa** | Escolher qual agente atende (`intent_router`) | Roteador. |
| | Identificar a etapa do lead (`stage_classifier`) | Dica de etapa. |
| | Medir o clima da conversa (`sentiment_classify`) | Sentimento → passagem para humano. |
| | Ler a resposta ao follow-up (`followup_classify`) | Nó "Classificar (IA)". |
| | Escolher a hora do follow-up (`followup_decide_timing`) | Plano de tempo. |
| **Proteger a operação** | Barrar tentativa de manipulação (`jailbreak_detect`) | Conferência de entrada. |
| | Impedir promessa que não se cumpre (`promise_semantic`) | Conferência de promessa semântica. |
| **Lembrar e buscar** | Resumir a conversa longa (`compaction`) | Compactação. |
| | Guardar o combinado (`flush`) | Notas antes de compactar. |
| | Fechar o atendimento (`checkpoint`) | Checkpoint do turno. |
| | Indexar o seu material (`embedding_indexar`) — **fixo** | Mesmo modelo da busca. |
| | Buscar no seu material (`embedding_consultar`) — **fixo** | Mesmo modelo da indexação. |
| **Ver e ouvir** | Ouvir o áudio do cliente (`transcricao_de_audio`) — **fixo** | Padrão OpenAI (chave OpenAI ou OpenRouter). |
| | Ver a imagem do cliente (`visao_de_imagem`) | Descreve foto/comprovante. |
| **Melhorar e testar** | Avaliar o próprio atendimento (`flywheel_judge`) | Alimenta Propostas. |
| | Extrair a lição (`flywheel_distiller`) | Transforma bons atendimentos em orientação. |
| | Testar a conexão com o provedor (`connection_test`) | Botão de teste. |
| | Ensaiar o agente antes de publicar (`teste_de_agente`) — **fixo** | Usa o modelo da versão ensaiada. |
| | Medir o tamanho do contexto (`contagem_de_tokens`) — **fixo** | Do mesmo provedor do modelo. |
| | Entender o pedido de fluxo (`flow_ai_interpretar`) | "Criar com IA". |
| | Montar o fluxo (`flow_ai_gerar`) | "Criar com IA". |

Para conferir a lista vigente: `lib/ai/pontos/registro.ts` (`PONTOS_DE_IA`).

Catálogo de modelos da OpenRouter é sincronizado por cron (`sync-model-catalog`) e pelo botão "Sincronizar catálogo agora" no seletor de modelo.

---

## 3. Voz

"Responder em áudio" usa a **chave da OpenRouter** da organização (vozes Eve, Ara, Rex, Sal, Leo) — nada roda no servidor. Instalações com o serviço Kokoro têm as vozes Dora, Alex e Santa. Sem serviço de voz, o interruptor fica desabilitado. Se a síntese falhar, o cliente recebe texto e a Central avisa.

---

## 4. Integrações via API

Tela: **IA › Integrações** (`/app/ai/integracoes`), papel **manager**+.

Permite ao agente **consultar** dados do cliente em sistemas externos (status de pedido, assinatura, acesso a curso…) e **propor correções** (reenviar acesso, trocar e-mail…), com duas garantias que não dependem do modelo:

- **Ninguém vê dados de uma conta sem provar que é o dono** (código por e-mail);
- **Nenhuma correção roda sem o SIM do cliente**, conferido pelo sistema.

### 4.1. Pré-requisitos (avisos no topo da tela)

1. **Chave de cifra** da instalação ativa (para guardar o segredo da API). Resolvida pelo `update.sh`.
2. **Envio de e-mail** configurado, se for usar verificação por código.

### 4.2. Cadastrar uma integração

| Campo | Detalhe |
|---|---|
| **Nome do sistema** | 1–80. |
| Descrição | até 500. |
| Tipo | **Genérica** ou **Contrato de Suporte v1** (padrão próprio com assinatura e catálogo importável — ver `docs/integracoes/contrato-de-suporte-v1.md`). |
| **Endereço base da API** | `https://…` (sem barra no fim). |
| Autenticação | nenhuma, **Bearer**, **cabeçalho** próprio (nome do cabeçalho; alguns são reservados), **HMAC-SHA256**, ou **Suporte v1**. |
| **Chave de acesso** | Guardada cifrada. "Deixe em branco para manter a chave atual." |
| **Verificar o dono da conta por e-mail** | "O agente pede o e-mail da conta, manda um código e só consulta a conta depois que o cliente digita o código certo." Exige um endpoint do tipo **Busca de conta por e-mail**. |
| **Por quantas horas a verificação vale** | 1–24, padrão 4. |
| Ligada | Liga/desliga a integração. |

Botões: **Testar conexão**, **Salvar**, **Arquivar** (agentes param de consultá-la).

### 4.3. Endpoints

Cada endpoint é uma operação que o agente pode usar.

| Campo | Detalhe |
|---|---|
| **Tipo** | **Consulta** (leitura), **Correção (pede SIM)** (ação) ou **Busca de conta por e-mail** (identidade). |
| Slug | identificador (`a-z0-9_`, 3–41). |
| Título | 1–80. |
| **Descrição para a IA** | até 600 — quando usar este endpoint. |
| Método e caminho | GET/POST/PUT/PATCH/DELETE + `/caminho` (pode usar `{{params.x}}`, e `{{conta.id}}`/`{{contato.telefone}}`, que o **servidor** preenche). |
| **Parâmetros** | até 12: nome, tipo (texto, inteiro, número, sim/não, lista de opções), obrigatório, descrição, opções, tamanho máximo, onde vai (caminho, query, corpo). Nomes `conta`, `contato`, `params`, `sessao` são reservados — o modelo nunca escolhe a conta. |
| Corpo fixo | JSON opcional. |
| **Exige conta verificada** | Obrigatório se o caminho usa `{{conta...}}`. |
| **Texto de confirmação** | Obrigatório em **Correção**: o que o cliente lê antes de responder SIM. |
| **Campos da resposta** | até 40 (`campo.subcampo`, `itens.*`) — só eles chegam ao modelo. |
| Tempo-limite | 1–15 s, padrão 8 s. |

**Importar catálogo** (integrações Suporte v1) cria/atualiza os endpoints a partir do catálogo do sistema. Cada endpoint pode ser **Testado**, editado ou apagado.

### 4.4. Ligar no agente

Agente › aba Conversa › **Sistemas que ele consulta** › marque os endpoints (até 40) › salve e publique. O agente recebe até **4 ferramentas fixas**:

| Ferramenta | O que faz |
|---|---|
| `consultar_sistema` | Chama um endpoint de consulta e devolve só os campos permitidos. |
| `propor_acao` | Propõe uma correção: o sistema manda ao cliente o resumo e pede **SIM**. O modelo encerra o turno e recebe o resultado no próximo. |
| `verificar_identidade` | Manda um código de **6 dígitos** ao e-mail informado pelo cliente. |
| `escolher_conta` | Quando o e-mail tem mais de uma conta, registra a escolha do cliente. |

### 4.5. As regras de segurança (executadas pelo runtime, antes do modelo)

**Verificação de identidade**
- Código válido por **10 minutos**, **5 tentativas**; limites por e-mail e por conversa contados no banco.
- O código nunca é guardado em claro (só HMAC), nunca aparece em log, prompt ou resultado de ferramenta. O modelo **não vê** o código e não deve pedir que o cliente o repita.
- **Anti-enumeração:** a resposta ao cliente é a mesma exista a conta ou não.
- Sessão verificada vale pelas horas configuradas, só para aquela conta.
- Muitas tentativas erradas → aviso "Alguém errou o código de verificação de uma conta várias vezes".

**Confirmação de correção (SIM)**
- Vale só a **primeira** mensagem do cliente depois da oferta, dentro do prazo.
- A mensagem **inteira** precisa ser uma afirmativa clara, sem negação nem "espera"; áudio/imagem **nunca** confirmam; negativa clara cancela.
- Confirmada, a correção roda com os parâmetros **congelados** no momento da proposta e com `Idempotency-Key` (não executa duas vezes).
- Falhou depois do SIM → aviso "O cliente confirmou uma correção e ela não foi aplicada".

**Rede**
- Mesmas guardas dos webhooks: https em produção, bloqueio de rede interna/metadados de nuvem (também no IP resolvido), redirecionamento **não** é seguido, resposta limitada a **256 KB**.
- Integração que falha **5 vezes seguidas** abre o circuito por um tempo: o agente para de consultá-la e **transfere** quem precisar dela para a equipe; aviso "Uma integração via API está falhando e o agente parou de consultá-la".

### 4.6. Atividade

Aba **Atividade** da integração: chamadas e falhas das últimas 24 h, **correções propostas** com estado (esperando o SIM, executando, aplicada, falhou, não autorizada, venceu sem resposta) e a lista de chamadas.

---

## 5. Nuvemshop

Tela: **Integrações › Nuvemshop**. Sincroniza **pedidos, produtos e clientes** via OAuth + webhooks.

1. O servidor precisa de `NUVEMSHOP_APP_ID`, `NUVEMSHOP_CLIENT_ID`, `NUVEMSHOP_CLIENT_SECRET` (senão a tela mostra "Integração não configurada").
2. Admin clica **Conectar Nuvemshop** e autoriza o app na loja.
3. A tela mostra última sincronização e webhooks registrados.

Para o agente: capacidades **Ver as compras do cliente** e **Procurar produto na loja**; material **Catálogo de produtos** no acervo.

---

## 6. Google Agenda e agenda interna

- **Tipos de agendamento** (Tipos de agendamento): nome, **duração**, **onde acontece**, **quem atende** ("sem isto, não há horário para oferecer").
- **Conexão com Google** por pessoa (OAuth com `calendar.readonly` para ler ocupados e `calendar.events` para escrever os compromissos marcados aqui). Sincronização ida e volta por cron (`agenda-google-sync`, `-push`, `-refresh`).
- Para o agente: pacote **Vender** traz "Ver horários livres" (desconta folgas, compromissos e agenda Google), "Ver compromissos", "Marcar", "Remarcar"; "Desmarcar" é crítico.

---

## 7. Captação e webhooks

| Direção | Recurso | Detalhe |
|---|---|---|
| Entrada | **Entradas de contatos** (Webhooks › Origens) | Endereço para o site mandar contatos a um funil, com mapa de campos e segredo opcional ([06 §B.6](06-fluxos-e-automacoes.md)). |
| Entrada | **Gatilho "Quando outro sistema chamar"** (Fluxos) | Endereço público criado ao publicar, estável entre publicações. |
| Saída | **Avisar outro sistema (webhook)** (Regras automáticas) | POST com assinatura opcional (segredo cifrado), anti-SSRF. |

---

## 8. MCP e API REST

- **API REST** `/api/v1/*`: JSON snake_case, `Authorization: Bearer tok_...` (nunca em query string). Tokens em **Configurações › Tokens de API**: escopos, expiração opcional; o valor aparece **uma vez** ("Copie e guarde agora").
- **Servidor MCP** (`/api/mcp`): expõe o mesmo catálogo de capacidades do agente para IAs externas (Claude Desktop, etc.), com checagem de papel + escopo e auditoria de cada chamada.
- Todas as mutações vão para o log de auditoria (`api_audit_log`) com `X-Request-Id`.

---

## 9. E-mail

Configurado no servidor (ex.: `RESEND_API_KEY`). Necessário para: código de verificação das Integrações via API, convites de equipe, recuperação de senha. Sem ele, a verificação por e-mail fica indisponível e o agente transfere para a equipe quem precisar dela.

---

## 10. Assinatura (Asaas)

Se a instalação cobra mensalidade por organização (`docs/integracoes/asaas.md`): organização **bloqueada** (teste vencido, mensalidade vencida além da tolerância) tem as **automações paradas** — agente, follow-ups, fluxos, disparos e regras automáticas. Mensagens recebidas continuam sendo gravadas; ao pagar, tudo volta.

---

## Notas técnicas

| Peça | Arquivo |
|---|---|
| Tipos de conexão | `lib/channels/tipo-de-conexao.ts`, `lib/channels/capabilities.ts`, `lib/channels/adapters/*` |
| Provedores | `lib/ai/pontos/provedores.ts`, `registro.ts`, `resolver.ts` |
| Integrações via API | `lib/ai/integracoes/*`, `lib/agent-engine/edge/integracoes/*`, `docs/architecture/integracoes-via-api.architecture.json` |
| Nuvemshop | `lib/nuvemshop/*` |
| Agenda | `lib/agenda/*`, `lib/agenda/google/*` |
| MCP | `lib/mcp/server.ts`, `app/api/mcp/route.ts` |
| Webhooks de saída | `lib/automation/actions/call-webhook.ts`, `outbound-url.ts`, `outbound-ip.ts` |

Tabelas das Integrações via API: `ai_api_integrations`, `ai_api_endpoints`, `ai_api_verificacoes`, `ai_api_chamadas` (+ ações pendentes); `ai_agent_versions.api_endpoint_ids`.
