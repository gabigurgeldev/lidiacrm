---
impacto: capacidade_nova
secao: adicionado
titulo: O fluxo agora fala com o cliente, e dispara campanha
---

O construtor de fluxos sabia avisar o vendedor e não sabia falar com o cliente.
Quem montava um fluxo via o bloco "Avisar o vendedor no WhatsApp" e supunha,
com razão, que houvesse o outro lado. Não havia — e a única forma de o fluxo
falar com o cliente era não falar.

Dois blocos novos fecham isso.

"Mandar mensagem para o cliente" envia na conversa do próprio cliente, aquela
que aparece no Inbox, e não só texto: imagem, áudio, vídeo e arquivo também.
Dá para escolher por qual número sair — o conectado por QR code, o da API
oficial ou o do parceiro —, ou deixar que o sistema use o primeiro disponível,
que é o certo para quem tem um número só. O texto aceita os dados do lead, como
nos outros blocos.

"Disparo em massa" cria uma campanha para muita gente de uma vez. Escolhe o
número, e daí em diante a tela se ajusta ao que aquele número permite: um que
só entrega modelo aprovado passa a pedir o modelo, e a lista sai dos modelos
que já estão aprovados na conta, com um campo por variável. Os destinatários
vêm de um marcador (a lista é recortada de novo a cada execução, então quem
entrar depois também recebe) ou de uma lista fixa de contatos.

Por padrão a campanha nasce em RASCUNHO e abre um aviso na Central. É de
propósito: um fluxo não tem ninguém olhando, e o recorte da lista — quantos vão
receber, quantos ficaram de fora e por quê — é justamente a informação que faz
alguém mudar de ideia antes de mandar. Quem já confia no fluxo pode marcar para
disparar sozinho, e aí é escolha declarada.

O disparo criado por um fluxo agora aparece na tela de Disparos identificado
como tal. Antes ele apareceria sem dono e sem origem, e não haveria como saber
qual fluxo desligar se ele começasse a mandar o que não devia.
