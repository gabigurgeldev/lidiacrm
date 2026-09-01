---
impacto: capacidade_nova
secao: corrigido
titulo: Criar fluxo com IA passou a montar o fluxo de verdade
---

Depois de descrever o fluxo e responder às perguntas, o último passo — montar —
demorava muito e terminava sem fluxo nenhum, com a frase "A IA não conseguiu
terminar o fluxo. Tente descrever de outro jeito." Trocar a descrição não
adiantava, e o quadro ficava vazio o tempo inteiro.

O pedido ao serviço de inteligência artificial era um só, e enorme: o fluxo
inteiro numa resposta, com todas as onze formas de bloco possíveis descritas
juntas e os campos de cada uma embutidos. Duas consequências. A primeira é que
esse formato é justamente o que serviços de resposta estruturada aceitam pior. A
segunda é pior ainda: a resposta era conferida de uma vez só, então um único
bloco com um campo fora do lugar apagava o fluxo inteiro — cinquenta e nove
blocos perfeitos e um defeituoso davam zero blocos, e ninguém ficava sabendo que
cinquenta e nove estavam prontos.

Agora são dois passos. Primeiro a inteligência artificial escolhe **quais**
blocos e em que ordem — um pedido pequeno, que qualquer serviço aceita. Depois
ela preenche **um bloco de cada vez**, quatro em paralelo. O bloco que falhar
recebe valores padrão e o fluxo continua; os outros não são afetados.

O que muda na tela:

- O fluxo inteiro aparece no quadro em segundos, já posicionado, e cada bloco se
  completa em seguida. Antes os blocos pingavam um a um durante todo o tempo da
  espera e sumiam todos juntos se algo falhasse no fim.
- **O erro que aparece agora é o motivo real.** "Nenhum provedor de IA está
  configurado nesta organização" tem conserto de um clique e chegava como a
  mesma frase genérica de todos os outros casos.
- Quando algum bloco fica com valores padrão, a tela **diz quantos** e pede para
  revisar antes de publicar. Um bloco com valores padrão parece pronto e não
  está.
- O passo de perguntas foi refeito: conversa em balões, opções em cartões
  clicáveis (com teclado), indicação de em que ponto da conversa você está, e
  barra de progresso durante a montagem.

Para quem administra uma instalação: o registro do servidor passou a guardar o
motivo pelo qual o serviço de inteligência artificial parou — se faltou espaço
na resposta ou se o formato foi recusado, que são problemas opostos e chegavam
ao registro como a mesma coisa. Há também um comando de diagnóstico,
`pnpm ia:diagnostico`, que dispara a chamada real e imprime a resposta crua do
serviço, sem nada no meio.

Nada a fazer: nenhuma configuração nova, nenhuma variável de ambiente nova,
nenhuma mudança no banco.
