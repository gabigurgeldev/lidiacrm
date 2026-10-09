---
impacto: nada_mudou
secao: corrigido
titulo: A IA parou de ficar em silêncio no meio do atendimento
---

Quatro defeitos faziam a IA parar de responder ao cliente — e nenhum avisava ninguém.

- **O worker da IA morria a cada PDF recebido no WhatsApp.** Ler o texto de um PDF
  de 9 KB consumia 255 MB de memória dentro do worker, que caía e voltava a cair
  sempre que pegava o mesmo PDF. Cada queda derrubava os atendimentos em andamento
  de todas as organizações; numa instalação real foram 255 reinícios num dia. A
  leitura do PDF agora roda num processo separado e custa ~14 MB.
- **O aquecimento do número calava respostas.** Número conectado há poucos dias tem
  teto de envios por dia, e a IA parava no meio do pedido quando ele acabava. Responder
  a quem escreveu nas últimas 24 horas não conta mais para esse teto. O limite
  diário do número e o ritmo de envio continuam valendo, e disparo em massa não muda.
- **Quando um teto barra a IA, a Central avisa.** Antes o envio era recusado em
  silêncio; agora abre um aviso crítico, um por número, apontando Conexões ›
  Proteção de envio.
- **Resumo malformado não repete mais o turno.** Quando o modelo devolvia o resumo
  do atendimento num formato inválido, o turno — que já tinha respondido — voltava
  para a fila de 10 em 10 minutos, segurando a próxima mensagem do cliente.

De quebra: a transcrição de áudio passou a informar o idioma da organização. Sem ele,
um áudio curto em português chegou a ser transcrito em tailandês.
