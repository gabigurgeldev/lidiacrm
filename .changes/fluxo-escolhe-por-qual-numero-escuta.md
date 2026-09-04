---
impacto: capacidade_nova
secao: adicionado
titulo: Escolher por quais números o fluxo começa
---

Quem tem mais de um número de WhatsApp conectado não tinha como dizer a qual
deles um fluxo respondia. Os blocos de início — "Quando o cliente manda
mensagem" e "Quando o cliente escrever uma palavra" — não perguntavam nada, e o
fluxo valia para todos os números da conta. Um fluxo de atendimento montado para
a loja disparava também no número da clínica.

Agora os dois blocos de início têm o campo "Por quais números o fluxo escuta",
com a mesma lista de conexões que os blocos de envio já usam. O padrão é
**todos os números conectados**, que é exatamente como tudo funcionava antes:
fluxos já publicados seguem valendo para todos, sem precisar abrir, escolher
nem publicar de novo.

Quando você escolhe um número, mensagem que chegar por qualquer outro é
simplesmente ignorada por esse fluxo — não vira uma execução que nasce e morre.
Isso importa na tela de Execuções: numa conta com seis números, o outro caminho
encheria a lista de linhas mortas e esconderia as execuções que você precisa
olhar.

O campo aparece nos dois blocos de propósito. Tê-lo em um só seria pegadinha: o
outro continuaria disparando para a conta inteira sem dizer.
