---
impacto: capacidade_nova
secao: adicionado
titulo: O bloco de aviso do fluxo agora manda para um número escolhido
---

O bloco "Avisar o vendedor no WhatsApp", no editor de fluxos, só sabia mandar
mensagem para uma pessoa: quem estivesse com o lead naquele momento. O número
vinha do telefone de aviso cadastrado para aquele atendente, e não havia campo
nenhum na tela do bloco para escrever outro. Quem quisesse avisar o gerente, o
plantão ou um número de grupo interno não tinha caminho — o bloco parecia
configurável e, na prática, tinha um destinatário só.

Agora o bloco pergunta **para quem**: "Quem está com o lead" (o comportamento de
antes, inalterado) ou "Um número fixo", que abre um campo de telefone. O campo
aceita o número como uma pessoa digita — `+55 (11) 99999-8888`, `55 11 99999
8888` — e aceita também `{{contact.phone_number}}` ou uma variável do fluxo,
porque passa pela mesma substituição de variáveis da mensagem.

Número fora do formato não derruba o fluxo nem some: sai pela saída "Sem
telefone cadastrado", que já existia, e que continua sendo por onde passa o
caso de o atendente não ter telefone cadastrado. Fluxos já publicados seguem
exatamente como estão — a escolha nasce em "Quem está com o lead".

O envio continua passando pelo mesmo caminho do CRM e do agente, com bloqueio do
contato, janela do número e ritmo anti-banimento respeitados.
