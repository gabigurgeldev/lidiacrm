---
impacto: capacidade_nova
secao: adicionado
titulo: O quadro do fluxo diz o que cada bloco faz, e aceita arrastar e duplicar
---

O editor de fluxos mostrava, embaixo do nome de cada bloco, o identificador
interno dele: `logic.wait`, `whatsapp.send_to_lead`, `routing.round_robin`. Num
fluxo com cinco mensagens seguidas isso eram cinco cartões idênticos — para
saber qual era qual, abria-se um por um. E as linhas entre os blocos também não
diziam nada: um bloco "Decidir" com quatro regras produzia quatro fios iguais
saindo do mesmo cartão, sem indicar qual fio era de qual regra.

Agora **o cartão resume os próprios ajustes**. O bloco de espera diz "Espera 2
dias"; o de mensagem mostra o começo do texto que vai sair; o menu lista as
opções; o "Decidir" lista as regras. Quando o bloco depende de um recurso que
ainda não foi escolhido — o fluxo do "Chamar outro fluxo", o número do disparo
em massa, a fila do atendimento em ordem fixa — o cartão diz **"Falta escolher"**
ali mesmo, em vez de deixar a pessoa descobrir no botão Publicar.

**A linha diz de qual saída saiu**, com o nome da regra escrito sobre ela e uma
seta na ponta. As saídas de erro ("não saiu", "sem telefone") aparecem
tracejadas e apagadas: elas podem ficar soltas de propósito, e o desenho agora
mostra isso em vez de parecer ligação faltando.

**Dá para arrastar o bloco da barra lateral direto para o ponto do quadro** onde
ele deve ficar. O clique continua funcionando igual, para quem prefere — e
porque arrastar não é alcançável por teclado.

**Dá para duplicar um bloco com os ajustes que ele já tem**, pelo botão
"Duplicar com estes ajustes" no painel da direita. A cópia nasce ao lado, sem
ligações (uma cópia herdando as linhas do original faria duas saírem da mesma
saída, e o motor escolheria uma por acaso de ordem). O gatilho não duplica: um
fluxo tem um só, e a cópia produziria um fluxo que não publica.

Voltaram também o **minimapa** — que estava desligado porque aparecia como um
retângulo branco sobre o quadro escuro, um defeito de tema que foi corrigido —,
o **alinhamento em grade** ao soltar um bloco, e um botão **"Arrumar"** que
reorganiza o quadro inteiro de cima para baixo a partir do gatilho, com a mesma
regra que a criação por IA já usava.

Nada disso muda o que os fluxos existentes fazem: o resumo, o rótulo da linha e
a seta são desenho, e o que fica salvo continua sendo exatamente o mesmo grafo
de antes.

Na mesma leva, 76 textos do editor de fluxos que ainda saíam em português para
quem escolheu espanhol passaram a ser traduzidos.
