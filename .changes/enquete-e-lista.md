---
impacto: capacidade_nova
secao: adicionado
titulo: Enquete e lista — o cliente toca na opção em vez de digitar
---

Perguntas com escolhas fechadas agora podem sair como **enquete** ou **lista de
opções** do WhatsApp, em três lugares:

- **Fluxos** — o bloco "Esperar uma escolha" ganhou "Como mostrar as opções"
  (Para tocar, Enquete, Lista ou Texto numerado). Blocos novos já nascem "Para
  tocar"; fluxos publicados continuam em texto numerado até alguém mudar.
- **Agentes de IA** — a ferramenta nova `send_options` deixa o agente oferecer de
  2 a 10 opções. Liga e desliga por agente em Estilo de resposta ("Oferecer
  opções para o cliente tocar"); vem ligada.
- **Inbox** — o "+" do campo de escrever tem "Enquete ou lista".

Quem decide o formato é a conexão: enquete aparece no número conectado por QR;
lista, no QR (só em conversa individual) e no número oficial. Onde o formato não
existir, a mesma pergunta sai numerada e o cliente responde o número — o fluxo e
o agente entendem os dois. A escolha volta como resposta na conversa, com um selo
"Tocou na enquete", e a bolha da enquete mostra o que foi escolhido.

Também corrigido: no número oficial, a resposta a uma lista ou a um botão de
modelo era **descartada sem aviso**. Agora entra na conversa como texto.

Se o WhatsApp entregar um voto sem dizer qual opção foi (acontece), a Central de
avisos abre "Um cliente escolheu uma opção que não conseguimos ler".

Para quem opera o servidor: nada a fazer à mão. A atualização aplica a migration
0236 (dois tipos de mensagem novos, um interruptor por agente, um tipo de aviso)
e o WAHA passa a avisar os votos de enquete (`poll.vote`, `poll.vote.failed`) —
o contêiner do WAHA é recriado pelo `update.sh` com a lista nova de eventos, sem
pedir QR de novo.
