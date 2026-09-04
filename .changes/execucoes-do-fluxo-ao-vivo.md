---
impacto: capacidade_nova
secao: adicionado
titulo: Cada fluxo passou a ter a sua tela de execuções, ao vivo
---

Havia uma tela que listava execuções, mas ela era de todos os fluxos juntos e
não dizia a única coisa que se quer saber ao olhar um fluxo específico:
**quem disparou**. O contato já estava gravado no banco desde sempre e nenhuma tela o
mostrava. O passo a passo de cada execução — um registro por bloco visitado —
também já era gravado, e nenhuma tela o lia.

Agora, na tela de um fluxo, há o botão **"Ver execuções"**. Ele abre a lista das
execuções daquele fluxo, cada linha com o nome e o telefone de quem a disparou,
o estado, quando começou e quantos passos deu. Clicando numa execução, abre o
passo a passo: cada bloco por onde ela passou, a que horas, e
**quanto tempo levou desde o passo anterior**.

A tela é ao vivo. As linhas aparecem e mudam de estado sozinhas enquanto o fluxo
caminha, sem recarregar a página — e o passo a passo de uma execução aberta
cresce na sua frente. Se a conexão ao vivo cair, a tela continua se
atualizando sozinha por outro caminho, mais devagar, em vez de congelar num
passado que parece presente.

Quando o fluxo foi disparado por um lead que ainda não tinha contato próprio, o
contato do lead é usado no lugar — em vez de a linha aparecer sem nome.

Disponível para administradores e gerentes, o mesmo nível da tela de execuções
que já existia.
