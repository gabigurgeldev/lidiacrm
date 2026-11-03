# Canais: Conexões (WhatsApp), Nuvemshop e Webhooks

Rotas: /app/connections, /app/integrations/nuvemshop, /app/webhooks

## O que é
O grupo **Canais** é por onde as mensagens e os dados entram e saem. Em **Conexões** você liga seus números de WhatsApp — por QR Code ou pelo canal oficial da Meta — e acompanha a saúde de cada um. **Nuvemshop** conecta a sua loja para trazer pedidos e clientes. **Webhooks** recebe contatos de fora (landing pages, formulários) e cria automações que agem sozinhas.

## Onde fica
- **Canais › Conexões** — só administrador. Um ponto colorido ao lado mostra se alguma conexão caiu.
- **Canais › Nuvemshop** — só administrador.
- **Canais › Webhooks** — gerente ou administrador.

Conexões tem as abas **Números por QR**, **API Oficial (Meta)** e **Provedor parceiro** (com os modelos de mensagem de cada um). Webhooks tem as abas **Receber dados**, **Leads recebidos**, **Automações** e **Atividade**.

## Passo a passo
### Conectar o WhatsApp pelo QR Code
1. Abra **Canais › Conexões**, aba **Números por QR**.
2. Clique em **Conectar novo WhatsApp**. Aguarde "Preparando o código…".
3. No celular: abra o WhatsApp → **Aparelhos conectados** → **Conectar um aparelho** → aponte a câmera para o QR Code da tela.
4. Quando aparecer **Conectado!**, o número já está atendendo. As conversas passam a chegar no **Inbox**.
5. Se o código expirar, clique em **Gerar novo QR**.
6. Se o número não estiver com você, use **Enviar link para o cliente**: o link vale por 30 minutos e permite parear à distância.

### Reconectar um número que caiu
1. Quando uma conexão cai, aparece um aviso no topo do sistema com **Escanear o QR** ou **Ver conexões**.
2. Em **Conexões**, clique em **Reconectar** no número e escaneie o novo QR Code no celular.
3. Use **Atualizar saúde** para conferir o estado de todos os números.

### Conectar o canal oficial da Meta
1. Em **Conexões**, abra a aba **API Oficial (Meta)** e clique em **Conectar canal oficial**.
2. Preencha **ID do número de telefone**, **ID da conta do WhatsApp Business** e **Token de acesso**, que vêm do seu app na Meta.
3. Clique em **Validar e conectar**. Copie a **URL de callback** e o **Token de verificação** mostrados e cole no painel da Meta.
4. Na sub-aba **Templates da Meta**, use **Sincronizar com a Meta** para trazer os modelos aprovados.

### Ajustar a proteção de envio (anti-bloqueio)
1. Em **Conexões**, clique em **Proteção de envio** no número.
2. Ajuste a **Janela de envio** (horário em que pode enviar), **Enviar aos domingos**, o **Ritmo entre envios**, o **Teto diário de envios** e o **Aquecimento automático de número novo**.
3. Campo vazio usa o padrão seguro do sistema. Só marque "Este número já está aquecido" se ele já envia há semanas.

### Conectar a Nuvemshop
1. Abra **Canais › Nuvemshop** e clique em **Conectar Nuvemshop**.
2. Você é levado à Nuvemshop para autorizar o app na sua loja. Autorize.
3. Ao voltar, aparece "Nuvemshop conectada com sucesso." Pedidos, produtos e clientes passam a ser sincronizados.

### Receber leads de um formulário ou landing page
1. Abra **Canais › Webhooks**, aba **Receber dados**, e clique em **Nova fonte**.
2. Dê um nome (ex.: Landing page de Black Friday), escolha o **Kanban de entrada** e o **Estágio de entrada**. Se quiser, informe a **URL de obrigado**.
3. Clique em **Criar fonte**. Copie o **Endereço da fonte** ou use **Copiar formulário** para colar um formulário pronto no seu site. Há instruções para WordPress/Elementor e Zapier/n8n.
4. Clique em **Enviar lead de teste** para conferir. Cada envio vira um lead no Kanban; veja tudo em **Leads recebidos**.

### Criar uma automação
1. Na aba **Automações**, clique em **Nova automação**.
2. Monte em três passos:
   - **QUANDO** — o gatilho: "Quando entrar um contato novo (webhook)", "Quando um lead mudar de etapa", "Quando chegar mensagem no WhatsApp", "Quando um lead ganhar uma tag" ou "Quando um contato ganhar uma tag".
   - **SE (opcional)** — uma condição para filtrar.
   - **ENTÃO** — uma ou mais ações: "Criar/mover lead no Kanban", "Enviar mensagem no WhatsApp", "Mensagem escrita pela IA", "Adicionar tag", "Atribuir a um atendente", "Avisar outro sistema (webhook)" ou "Iniciar fluxo de mensagem".
3. Clique em **Criar automação** e depois em **Ligar**.
4. Acompanhe o resultado na aba **Atividade**.

## Dúvidas comuns
- **Como conecto meu WhatsApp?** Em **Canais › Conexões › Números por QR**, clique em **Conectar novo WhatsApp** e escaneie o QR Code pelo celular em **Aparelhos conectados › Conectar um aparelho**.
- **Não vejo o menu Conexões.** Só o administrador conecta e gerencia números.
- **Meu WhatsApp desconectou sozinho.** Pode acontecer se o celular ficar muito tempo sem internet ou se a sessão for encerrada no aparelho. Use **Reconectar** e escaneie de novo.
- **Qual a diferença entre QR e API Oficial?** Pelo QR, você envia texto livre, mas há risco de bloqueio por volume — por isso existe a proteção de envio. Na API oficial, depois de 24 horas sem resposta do cliente, só sai modelo aprovado pela Meta, e a Meta cobra por mensagem.
- **Por que minha mensagem ficou esperando?** Ela pode estar fora da janela de envio do número, ou acima do teto diário. Sai sozinha quando a janela reabrir.
- **Excluir um número apaga as conversas?** Não. As conversas continuam no Inbox; o número para de atender. Se ele tiver registros, é arquivado em vez de apagado.
- **A automação não rodou.** Veja a aba **Atividade**: ela explica o motivo (contato sem telefone, pediu para não receber mensagens, fora da janela de envio, agente sem versão publicada etc.).
- **A tela da Nuvemshop diz "Integração não configurada".** A instalação ainda não tem as credenciais da Nuvemshop. Fale com quem administra o sistema.
