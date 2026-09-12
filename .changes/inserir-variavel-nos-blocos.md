---
impacto: capacidade_nova
secao: adicionado
titulo: Botão de inserir variável em todo campo de fluxo que aceita variável
---

Os campos dos blocos de fluxo sempre aceitaram `{{lead.title}}`,
`{{contact.name}}` e afins — mas a única pista disso era uma frase de ajuda em
cada formulário, e as frases divergiam: a do aviso ao vendedor citava três
campos, a do envio ao cliente citava outros três, e nenhuma mencionava o que os
blocos anteriores gravaram.

Pior: errar o nome não dá erro. `{{lead.nome}}` não existe (o campo se chama
`title`), e a mensagem sai com um buraco no lugar — para o cliente, sem nada
acusando no sistema.

Agora todo campo que aceita variável tem um botão **Inserir variável** do lado.
A lista vem agrupada — Contato, Lead, Quem atende, Do fluxo, Da empresa, Do
gatilho — com busca, e insere na posição do cursor. Os **campos personalizados do seu funil** entram na lista com o nome que você deu a eles: "número do
pedido", "data da consulta", "metragem do imóvel".

Onde a variável é um caminho e não um marcador — o campo da regra do bloco
"Decidir" — o botão insere o caminho cru, que é o que aquele campo espera.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
