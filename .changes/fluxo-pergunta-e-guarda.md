---
impacto: capacidade_nova
secao: adicionado
titulo: Blocos de fluxo para perguntar e guardar a resposta, e menu que já manda a pergunta numerada
---

Três peças para montar um pré-atendimento por fluxo:

- **Perguntar e guardar a resposta** (bloco novo): manda uma pergunta, espera
  o cliente responder e guarda o texto **inteiro** numa variável que você
  nomeia — `{{vars.problema}}`, por exemplo. Antes, a espera guardava só os
  primeiros 280 caracteres da mensagem. Áudio entra pela transcrição.
- **Atualizar o nome do cliente** (bloco novo): grava no cadastro o nome que o
  cliente informou. É o nome que aparece no Inbox e que o agente de IA usa —
  no lugar do apelido do perfil do WhatsApp.
- **Esperar uma escolha** (menu) agora pode mandar a própria pergunta, com as
  opções numeradas embaixo (1️⃣ 2️⃣ 3️⃣) e aceitando o número, o emoji ou o
  nome da opção. E pode guardar a escolha com um nome (`{{vars.sistema}}`) —
  dois menus seguidos não sobrescrevem mais a escolha um do outro.

Menus já publicados não mudam: sem pergunta, o bloco continua só esperando.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
