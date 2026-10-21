---
impacto: nada_mudou
secao: corrigido
titulo: O inbox pesa menos no servidor e o envio não duplica mensagem em lentidão
---

Uma mensagem recebida relia a lista de conversas 3 a 5 vezes em cada aba
aberta; agora os eventos de uma mesma rajada viram uma releitura só. A
conferência de segurança deixa de rodar a cada 15 s/45 s com o tempo real
funcionando (passa a 5 min) e não roda em aba de fundo. Imagens, áudios e
vídeos da conversa ficam no cache do navegador em vez de refazer a rota a cada
redesenho.

Com o servidor lento, o envio repetia o pedido depois de 10 s e a mensagem
chegava em dobro no WhatsApp do cliente. Agora é uma tentativa só.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
