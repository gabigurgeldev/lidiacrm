---
impacto: nada_mudou
secao: corrigido
titulo: Vídeo pelo inbox voltou a sair, e sem chegar em dobro
---

Mandar um vídeo pela conversa no inbox dava erro: tanto um vídeo curto quanto
um longo. E quem tentava de novo podia acabar mandando o mesmo vídeo duas ou
três vezes para o cliente.

Eram três coisas juntas:

- O vídeo do inbox era convertido inteiro pelo serviço de WhatsApp a cada
  envio, o que numa VPS leva de segundos a vários minutos.
- A tela desistia de esperar depois de 10 segundos e mostrava "Erro
  inesperado. Tente novamente.", com o vídeo ainda saindo.
- O vídeo ficava na janela para tentar de novo, e cada tentativa era outro
  envio.

Agora:

- O vídeo é preparado uma vez só, quando você o escolhe, como o disparo já
  fazia. Vídeo de celular comum fica pronto na hora.
- A tela espera o envio de foto, vídeo e documento terminar de verdade.
- Se mesmo assim a tela não conseguir confirmar, ela pede para você conferir
  na conversa se a mensagem saiu, em vez de pedir para tentar de novo.
- Arquivo acima de 50 MB é avisado na hora em que você o escolhe, com o
  tamanho dele, em vez de depois de esperar o envio inteiro.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
