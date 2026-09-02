---
impacto: capacidade_nova
secao: adicionado
titulo: Vários números por conexão, e um jeito novo de conectar
---

A tela de **Conexões** foi refeita e deixou de tratar cada forma de conectar
como um caso isolado. Três coisas mudaram para quem opera.

**Vários números oficiais da Meta.** Antes cabia um só — e o pior é que a tela
não dizia isso: quem colasse a credencial de um segundo número via o primeiro
ser substituído em silêncio, sem aviso. Mesma linha, credencial nova, número
novo. O número antigo continuava recebendo mensagem e passava a responder pelo
novo. Agora cada número é uma conexão própria, com nome que você escolhe
("Vendas", "Suporte"), estado próprio e a **sua** URL de webhook para colar no
painel da Meta — que é por número, não por empresa. Repetir um número já
conectado continua trocando a credencial daquele, como antes.

**Conectar pelo provedor parceiro com uma chave só.** Há provedores que emitem
uma chave de conta em vez de uma credencial por número. Cole a chave e o CRM
pergunta ao provedor quais números você tem, mostra a lista — com o nome, o
telefone e o estado de cada um — e você marca os que quer atender aqui. O
webhook de cada número é configurado automaticamente; você não copia nem cola
endereço nenhum. Se algum não puder ser configurado, a tela avisa **quais**, na
hora: um número que envia e não recebe é o problema mais confuso possível para
descobrir depois.

**Cada número diz por qual regra ele fala.** O selo que existia só no seletor do
Inbox agora aparece em toda parte: nos cartões de Conexões, na lista de
conversas, no topo da conversa e em cada mensagem. Ele diz três coisas — que é
WhatsApp, se o número foi ligado **por QR code** ou é **oficial**, e se ele passa
por um **provedor parceiro** (com o nome dele). A diferença é prática e cara: no
oficial existe a janela de 24 horas, e fora dela só sai modelo aprovado; no
número por QR não existe janela, mas existe risco de banimento por volume.

*Um mesmo provedor pode hospedar os dois tipos na mesma conta — instância
oficial e número por QR convivem —, e por isso o CRM passou a guardar a regra de
cada número em vez de deduzi-la do provedor. Números importados antes desta
versão continuam funcionando como antes.*

**O que você precisa fazer ao atualizar:** nada. Nenhuma variável nova é
obrigatória, nenhum passo manual, e as conexões existentes continuam como
estavam. A atualização do banco vai junto e é aplicada sozinha.

*Se você usa um provedor parceiro que emite chave de conta, pode apontar o CRM
para um servidor diferente do padrão com `STEVO_API_BASE_URL` — só necessário em
instalação dedicada.*
