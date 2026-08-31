---
impacto: nada_mudou
secao: corrigido
titulo: O passo de montar o fluxo com IA falhava sem deixar rastro
---

Depois de descrever o fluxo e responder as perguntas, o último passo — montar o
fluxo — terminava com "A IA não conseguiu terminar o fluxo. Tente descrever de
outro jeito." Trocar a descrição não adiantava: a falha não tinha relação com o
que era pedido.

O formato que descreve os blocos de um fluxo é o mais complexo do produto, e duas
características dele não são aceitas por serviços de inteligência artificial que
respondem em formato estruturado. Uma é a possibilidade de encaixar condições
dentro de condições, sem limite de camadas, que se descreve referenciando a si
mesma. A outra é um campo que aceitava qualquer tipo de valor, e por isso não
descrevia tipo nenhum.

Agora existe uma versão simplificada desse formato, usada apenas para a geração
por inteligência artificial: condições de um nível só, e valores de tipo
declarado. Tudo que a inteligência artificial produz continua sendo válido para o
sistema, porque a versão simplificada é um subconjunto da original — condições em
várias camadas seguem funcionando normalmente quando montadas na tela.

A parte mais séria não era essa. Esse passo **não registrava nada**: nem no
histórico do servidor, nem no registro de auditoria, que tinha uma entrada
prevista para falhas e nunca gravou uma linha. Enquanto isso, a única informação
disponível era a frase genérica na tela. Agora o passo registra início, fim com a
contagem de blocos gerados, e o erro com a causa — inclusive erros que acontecem
depois de a resposta já ter começado a ser enviada, que antes desapareciam por
completo.

Também foi corrigido o modelo usado por padrão nesse passo: era o modelo de
classificação, o mais simples, escolhido por engano; passou a ser o modelo
principal. Isso afeta apenas instalações que não escolheram um modelo próprio na
tela de provedores.
