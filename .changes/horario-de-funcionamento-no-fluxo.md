---
impacto: capacidade_nova
secao: adicionado
titulo: O fluxo passa a saber que horas são — bloco de horário de funcionamento
---

Até aqui um fluxo respondia 3h de domingo exatamente como responderia 10h de
terça. O único bloco de tempo era "Esperar", que é duração fixa: para segurar
uma cobrança até segunda-feira era preciso escrever "espere 10 horas" à mão, e
esse número acerta uma vez e erra em todas as outras.

O bloco novo, **Horário de funcionamento**, fica na paleta em "Lógica". Você
marca os dias da semana (nasce seg a sex), o horário (08:00–18:00) e o fuso, e
ele separa o que acontece dentro e fora do expediente.

Fora do horário, duas respostas — e a escolha é sua, porque são situações
diferentes:

- **Seguir pela saída "Fora do horário"** — a execução continua AGORA, por outro
  caminho. É por onde se responde "atendemos das 8h às 18h, já já alguém te
  responde" sem deixar a pessoa no vácuo.
- **Segurar e retomar quando abrir** — a execução dorme e continua sozinha na
  abertura. É para o que não pode sair fora de hora: cobrança, oferta, lembrete.

O horário é conferido no fuso que você escolher, e não no do servidor — é o que
faz 08:00 significar 08:00 para quem atende. Expediente que atravessa a
meia-noite ainda não é suportado: o fim precisa ser depois do começo, e a tela
recusa antes de publicar em vez de o fluxo se comportar de forma estranha depois.

A conta é a mesma que o agente de IA já usa no "Só atender em horário de
funcionamento" — ela mudou de casa para os dois lerem a mesma regra, em vez de
divergirem na primeira correção.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
