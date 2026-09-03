---
impacto: nada_mudou
secao: corrigido
titulo: Criar fluxo com IA falhava em pedido de tamanho normal — e custava caro demais
---

Descrever um fluxo com mais de uns dez blocos e mandar a IA montar terminava em
erro. Trocar de modelo não mudava nada — e não mudava porque o problema nunca
foi o modelo.

**O que estava acontecendo.** O sistema autorizava a resposta do plano a ocupar
1.200 tokens. Medido contra o provedor real, um pedido pequeno (8 blocos) já
gastava até 1.166 — raspando o limite — e um pedido de tamanho normal (15
blocos) precisava de 6.006. A resposta era cortada no meio, e um JSON cortado
não pode ser lido.

O que tornou isso caro é o que aparecia no lugar: o erro dizia *"não foi
possível interpretar a resposta"*, uma frase sobre leitura, não sobre espaço.
Ela mandou cinco correções seguidas procurarem no formato dos dados, no
provedor e no jeito de transmitir a resposta. Não estava em nenhum dos três.

E era intermitente, o que espalhou ainda mais a busca: quando o modelo
principal era cortado, o sistema tentava um segundo modelo, mais econômico —
que às vezes cabia.

**O limite de blocos acabou.** O espaço da resposta agora comporta o maior
fluxo que o sistema permite descrever, e passou a viver ao lado desse limite —
longe dele foi como o número envelheceu sem ninguém ver. Autorizar mais espaço
**não custa nada**: cobra-se pelo que o modelo escreve, não pelo que se
autoriza. Foi confundir as duas coisas que produziu um limite apertado "para
economizar" e, junto com ele, uma funcionalidade que não funcionava.

**A geração ficou 3x mais barata e muito mais rápida.** Quem decide o custo é o
modelo, e o sistema estava escolhendo o mais caro do catálogo para um trabalho
que não pede: montar um fluxo é escolher blocos de uma lista fechada e escrever
rótulos curtos. Medido, no mesmo plano de 15 blocos:

| | tokens escritos | tempo | custo da geração |
|---|---|---|---|
| antes (modelo carro-chefe) | 6.006 | 55 a 77 s | ~US$ 0,116 |
| agora (modelo econômico) | ~1.400 | ~8 s | ~US$ 0,035 |

O carro-chefe escrevia quatro vezes mais do que o fluxo ocupa — o excedente é
ele "pensando", e pensar é cobrado. Ele continua no desenho, no lugar certo:
entra **quando o econômico falha**, não antes. E quem preferir o carro-chefe
sempre continua podendo escolhê-lo em Uso de IA › Provedores; a escolha do
painel ganha de tudo isto.

**Quando ainda assim não couber**, o sistema tenta de novo com o dobro do
espaço, no mesmo modelo — trocar de modelo não devolve espaço a ninguém. E se
nem assim couber, a tela passa a dizer o que fazer: *o fluxo é grande demais
para montar de uma vez, descreva uma parte por vez*. Antes dizia "tente de
novo", e tentar de novo dava o mesmo erro.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança no banco. Quem já instalou recebe o conserto na
próxima atualização.
