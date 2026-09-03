---
impacto: exige_acao
secao: corrigido
titulo: Número da API Oficial recebia mensagem e não conseguia responder
---

Quem conectou um número pela API Oficial através do intermediário de conta
tinha um canal pela metade: as mensagens dos clientes chegavam normalmente ao
Inbox, e toda tentativa de responder falhava. Na tela aparecia
`stevo_send_failed: 409` — e, até o conserto anterior, nem isso: aparecia
`[object Object]`.

A causa não estava na conta de ninguém. O CRM mandava **todo** envio pelo mesmo
endereço, o serviço de gestão da conta, que de fato entrega para números ligados
por QR. Para um número da API Oficial ele não entrega: esse número fala com a
Meta por outro serviço, com outra credencial. Medido na conta de um cliente: o
serviço de gestão devolve credencial de envio vazia para **todo** número da API
Oficial e preenchida para **todo** número por QR, enquanto o serviço correto
respondia que aquele mesmo número estava no ar, aprovado e com 16 mensagens
entregues nos últimos 7 dias. O número sempre esteve certo; o destino é que
estava errado.

Agora o CRM manda cada modalidade para o serviço que a atende. Números ligados
por QR seguem exatamente como estavam.


Dois ganhos que vêm junto:

O sinal de saúde desses números passa a vir da Meta, e não da conta do
intermediário. Antes um número podia aparecer como "conectado" e ainda assim não
entregar nada, porque estava em modo de teste ou reprovado na revisão da Meta —
e isso só se descobria pela mensagem que não chegava. Agora aparece na tela de
Canais.

E, quando a Meta recusa um envio, o motivo dela chega inteiro à tela, com o
código. O caso mais comum é a janela de 24 horas: passado esse prazo desde a
última mensagem do cliente, a Meta só aceita modelo aprovado, e agora a tela diz
isso em vez de um erro genérico.

## Requer atenção

Uma vez por número da API Oficial: em Canais, no cartão do número, cole o
**token de envio** no campo novo. Esse valor é o único que a chave da conta não
descobre sozinha — ele só aparece no painel do seu provedor, dentro da
instância. O CRM valida o token contra o provedor antes de gravar: se estiver
errado, ele diz na hora, em vez de deixar o canal mudo até a próxima mensagem
falhar.

Enquanto o token não for colado, o número continua recebendo e continua sem
enviar — que é exatamente o estado de hoje. Nada regride por não fazer nada;
o envio é que não passa a funcionar sozinho.

Números ligados por QR não têm esse campo e não precisam de nenhuma ação.
