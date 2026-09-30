---
impacto: nada_mudou
secao: corrigido
titulo: Mensagem do cliente pelo WhatsApp aparece ao vivo com a conversa aberta
---

A mensagem que o cliente mandava para um número conectado por QR podia demorar
a aparecer, ou só aparecer depois de recarregar a página, mesmo com a conversa
aberta. Duas causas, as duas corrigidas: a conferência de segurança que relê a
conversa nunca chegava a rodar enquanto a tela estava aberta (agora roda a cada
15 segundos com a conversa aberta), e o CRM demorava para confirmar ao WhatsApp
que recebeu a mensagem, porque fazia antes todo o trabalho de automações e IA —
agora confirma na hora e faz esse trabalho logo em seguida.
