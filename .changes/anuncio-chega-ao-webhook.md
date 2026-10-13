---
impacto: capacidade_nova
secao: corrigido
titulo: O clique em anúncio passou a ser reconhecido — e a automação manda o anúncio ao webhook
---

Quem clica num anúncio "Clique para o WhatsApp" manda junto, na primeira
mensagem, os dados do anúncio: título, texto, link, id do anúncio e o id do
clique (`ctwa_clid`), que é o que os sistemas de rastreio usam para casar a
conversão.

No WhatsApp por QR o CRM procurava esses dados com o nome errado e **nunca**
os encontrava. Medido em produção: 70 mensagens vindas de anúncio, nenhum
contato marcado como "veio de anúncio".

Agora:

- o contato é marcado na primeira vez que chega por anúncio, como já era a
  intenção;
- a própria **mensagem** do clique guarda o anúncio — inclusive para quem já
  era contato e clicou num anúncio novo;
- em **Automações**, o gatilho "Quando chegar mensagem no WhatsApp" ganhou a
  condição **"Veio de anúncio (valor: ad)"**, que roda uma vez por clique;
- a ação **"Avisar outro sistema (webhook)"** passa a mandar um bloco
  `anuncio` com `source_type`, `source_id`, `source_url`, `source_app`,
  `title`, `description`, `media_type`, `media_url`, `thumbnail_url`,
  `ctwa_clid` e `conversion_source`. O resto dos dados de origem do contato
  continua fora do webhook.

Cliques anteriores a esta versão não são marcados retroativamente.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
