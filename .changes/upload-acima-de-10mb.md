---
impacto: nada_mudou
secao: corrigido
titulo: Vídeo acima de 10 MB no disparo (e mídia grande na conversa) deixou de dar erro de "multipart"
---

O disparo aceita vídeo até 16 MB, que é o limite do WhatsApp, mas qualquer
vídeo acima de 10 MB falhava com "Campo 'file' (multipart) obrigatório". Quem
via a mensagem achava que tinha escolhido o arquivo errado.

O sistema cortava em 10 MB, sem avisar, todo envio de arquivo. A tela de
disparo recebia o vídeo pela metade e não conseguia ler. O mesmo corte pegava
o anexo na conversa (que aceita até 50 MB) e o material do acervo do agente
(até 20 MB).

Agora o teto acompanha o maior arquivo que o sistema aceita. Cada tela continua
recusando o que passa do seu próprio limite, com a mensagem certa ("O vídeo
precisa ter até 16 MB.").

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
