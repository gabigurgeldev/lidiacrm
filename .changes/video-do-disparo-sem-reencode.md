---
impacto: nada_mudou
secao: corrigido
titulo: Disparo com vídeo deixou de travar o WhatsApp de todas as organizações
---

Cada envio de um disparo com vídeo pedia ao WhatsApp (WAHA) que convertesse o
vídeo, e ele reencodava o arquivo inteiro de novo para CADA destinatário. Numa
VPS de 2 núcleos, cada conversão levava vários minutos. Num disparo para
centenas de contatos elas se acumulavam, o serviço de WhatsApp ficava sem
memória e parava para todas as organizações. Em produção, dois disparos com
vídeo entregaram 10 mensagens em 2 horas, e os vídeos já estavam no formato
certo desde o início.

Agora o vídeo é preparado uma vez só, quando você sobe o arquivo no disparo:

- Vídeo de celular comum (H.264 com áudio AAC) só é ajustado para tocar
  enquanto baixa, o que é instantâneo.
- Vídeo em outro formato (HEVC de iPhone, por exemplo) é convertido uma vez.

Depois disso, cada envio só manda o arquivo pronto.

Disparos criados antes desta versão continuam funcionando como antes. Para
ganhar o conserto, suba o vídeo de novo.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
