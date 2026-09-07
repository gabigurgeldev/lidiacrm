---
impacto: capacidade_nova
secao: adicionado
titulo: Renomear e excluir um fluxo, direto na lista
---

A lista de fluxos sabia ligar, pausar e abrir. Não sabia renomear nem excluir —
quem errava o nome na criação recriava o fluxo do zero, e quem queria apagar um
fluxo não tinha caminho nenhum pela tela. As duas operações existiam no servidor
desde o primeiro dia do motor de fluxos; o que faltava era a porta.

Agora cada linha da lista tem um menu com **Renomear** e **Excluir**.

Renomear troca só o nome: as versões publicadas, o histórico de execuções e as
ligações do quadro continuam exatamente como estão. Nome já usado por outro
fluxo da mesma organização é recusado com a razão escrita, em vez de um erro
genérico — e a janela não fecha, para você corrigir ali mesmo.

Excluir pede confirmação e leva junto as versões publicadas e o histórico de
execuções daquele fluxo. **Fluxo com execução em andamento não é apagado** — o
sistema recusa e diz para pausar e esperar terminar, porque uma automação
sumindo no meio do caminho é o desfecho que o motor inteiro existe para evitar.

Quem pode fazer as duas coisas passou a ser quem **gerencia** — o mesmo papel
que já monta, publica e liga fluxo. Antes, excluir exigia o dono da conta,
sozinho entre todas as operações do módulo, e sem argumento que sustentasse a
diferença: publicar um fluxo põe uma automação para falar com cliente por conta
própria, o que pesa mais do que apagar o rascunho dela.
