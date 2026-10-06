---
impacto: nada_mudou
secao: corrigido
titulo: Áudio, foto e vídeo que chegam pelo número oficial (Stevo) deixaram de sumir
---

No número oficial conectado pela Stevo, toda mídia **sem legenda** que o cliente
mandava — áudio, foto, vídeo — era descartada na entrada. A mensagem nem aparecia
no inbox, e o agente não respondia: para ele, o cliente não tinha dito nada.

A causa era o lugar do link. A Stevo resolve a mídia e manda o endereço pronto
num bloco `stevo.media` na raiz do evento; o leitor procurava esse bloco dentro
da mensagem, não achava, e concluía "sem conteúdo". Medido em produção com um
áudio e um vídeo reais.

Mesmo com o link lido, faltavam dois passos que os outros canais já tinham: o
pedido para baixar o arquivo e o baixador da Stevo. Agora a mídia é baixada,
guardada no armazenamento da instalação, e o áudio é transcrito antes de o
agente responder — como já acontecia no WhatsApp por QR.

O download não leva nenhuma credencial (o link da Stevo é público) e passa pelas
mesmas guardas de destino dos outros canais.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
