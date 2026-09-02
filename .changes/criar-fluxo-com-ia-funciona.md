---
impacto: capacidade_nova
secao: corrigido
titulo: Criar fluxo com IA passou a funcionar
---

Descrever o fluxo em português e deixar a inteligência artificial montá-lo nunca
tinha funcionado de ponta a ponta. Dependendo do provedor e do tamanho do
pedido, a tela travava em "Montando N blocos…" e não saía dali, ou terminava com
"A IA não conseguiu terminar o fluxo. Tente descrever de outro jeito" — e
descrever de outro jeito não adiantava, porque a causa nunca esteve no texto.

Agora funciona, e o caminho mudou de forma:

- **O fluxo é montado em duas etapas, não numa tacada.** Primeiro a inteligência
  artificial escolhe quais blocos e em que ordem; depois preenche um bloco de
  cada vez. Antes era um pedido único e enorme — o formato que os provedores
  aceitam pior —, e um único bloco com um campo fora do lugar apagava o fluxo
  inteiro: cinquenta e nove blocos prontos e um defeituoso davam zero blocos.
- **O fluxo inteiro aparece no quadro em segundos**, já posicionado, e cada bloco
  se completa em seguida.
- **Quando um bloco fica com valores padrão, a tela diz quantos** e pede revisão
  antes de publicar. Um bloco com valores padrão parece pronto e não está.
- **O erro que aparece é o motivo real.** "Nenhum provedor de IA está configurado
  nesta organização" tem conserto de um clique e chegava como a mesma frase
  genérica de todos os outros casos.
- **Quem usa OpenRouter deixou de falhar sempre**, e chaves cadastradas em
  instalações inteiras deixaram de recusar com "Erro interno".
- O passo de perguntas foi refeito: conversa em balões, opções em cartões
  clicáveis, indicação de onde você está e barra de progresso.

Para quem administra a instalação: o registro do servidor passou a guardar o
motivo pelo qual o serviço parou — se faltou espaço na resposta ou se o formato
foi recusado, que são problemas opostos e chegavam ao registro como a mesma
coisa. Há também `pnpm ia:diagnostico`, que dispara a chamada real e imprime a
resposta crua do serviço.

Nada a fazer: nenhuma configuração nova, nenhuma variável de ambiente nova,
nenhuma mudança no banco.
