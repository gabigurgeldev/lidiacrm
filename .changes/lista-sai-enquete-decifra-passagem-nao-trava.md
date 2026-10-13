---
impacto: nada_mudou
secao: corrigido
titulo: A lista do WhatsApp volta a sair, o voto da enquete passa a ser lido e a passagem não trava por motivo longo
---

**Lista.** Toda lista mandada pelo número por QR voltava recusada pelo
transporte (`message.title should not be empty`): o cliente não via nada e o
agente pedia desculpas por uma lista que nunca chegou. A lista agora leva
título — a própria pergunta, quando é curta, ou "Escolha uma opção" com a
pergunta logo abaixo. Medido num aparelho: a lista aparece, o toque volta como
escolha e o agente entende a opção.

**Enquete.** O voto chegava como "não decifrado", porque a conexão não guardava
a enquete que tinha mandado. A sessão passa a ligar o armazenamento do
transporte (só daqui para frente, sem puxar o histórico antigo). Conexões que
já existem recebem o ajuste na próxima reconexão.

**Passagem para pessoa.** O agente que escrevia o pedido inteiro no motivo da
passagem (mais de 500 caracteres) recebia uma recusa, e o turno acabava sem
passar — o cliente ficava esperando ninguém. Agora o motivo é cortado no
limite, no último campo inteiro, e a passagem acontece.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
