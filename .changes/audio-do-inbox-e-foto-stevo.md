---
impacto: capacidade_nova
secao: corrigido
titulo: Áudio do inbox falha com motivo claro, e foto de contato no número por QR
---

**Nota de voz que não saía.** Quando a conversão da gravação para ogg/opus não
acontecia no servidor (tipicamente o ffmpeg ausente), o áudio seguia em webm e o
canal recusava a entrega com um erro que culpava a URL — o operador via "falhou"
numa nota de voz gravada normalmente, sem motivo. Agora o envio para por um erro
que DIZ o que aconteceu ("este canal exige a nota de voz em ogg/opus — verifique
o ffmpeg no servidor") em vez do erro críptico, e o servidor registra a causa no
log. Com o ffmpeg presente, a nota de voz vira ogg/opus e sai normalmente.

**Foto de contato.** No número conectado por QR o CRM passa a buscar a foto de
perfil do contato (quando o provedor a expõe). No número **oficial** (API da
Meta) não há foto a mostrar — a Meta não a disponibiliza por privacidade, então
o contato fica com a silhueta, como antes; não é falha.
