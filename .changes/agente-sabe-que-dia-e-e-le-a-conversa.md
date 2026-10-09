---
impacto: capacidade_nova
secao: alterado
titulo: O agente sabe que dia e que horas são, lê a conversa como conversa e segue regras mais coerentes
---

Três mudanças no que o agente recebe a cada mensagem:

- **Data e hora.** O agente não sabia que dia era: "posso passar amanhã?" ou
  "vocês abrem agora?" viravam chute. Agora ele recebe dia da semana, data e
  hora no fuso do horário de funcionamento do agente (ou do número, se o agente
  não tiver horário).
- **A conversa como conversa.** As últimas mensagens chegavam ao agente como
  dados técnicos. Agora chegam como uma conversa, com quem falou e a que horas.
- **Regras da plataforma reescritas.** O texto-base que vale para todo agente
  dizia que ele era sempre "assistente virtual de vendas" e mandava passar para
  uma pessoa sempre que faltasse informação. Agora quem o agente é vem das
  instruções que você escreveu. Antes de dizer que não sabe, ele procura no
  acervo de conhecimento. Ele registra um caso antes de passar a conversa
  inteira para a equipe e responde em no máximo três mensagens por vez.

Agentes com histórico longo (40 mensagens ou mais) também gastam menos: o
resumo da conversa só é refeito quando ela andou, e não a cada mensagem.

**Ao atualizar:** o texto-base novo só substitui o antigo se ninguém o editou
nesta instalação. Se você personalizou a camada de plataforma, ela continua
como está.

Não há passo manual.
