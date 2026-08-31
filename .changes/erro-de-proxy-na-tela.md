---
impacto: nada_mudou
secao: corrigido
titulo: Página de erro do servidor aparecia crua dentro da tela
---

Quando o servidor estava trocando de versão, qualquer ação em andamento podia
falhar de um jeito assustador: em vez de uma frase, a tela mostrava o código de
uma página de erro inteira — com marcação, desenhos e links —, despejado dentro
do próprio balão de mensagem. Foi visto no construtor de fluxo com IA, mas podia
acontecer em qualquer tela.

A causa era o cliente que faz os pedidos ao servidor. Quando a resposta não vinha
da nossa API — porque quem respondeu foi o servidor de entrada, e não o sistema —
ele usava o conteúdo bruto daquela resposta como se fosse a mensagem escrita para
uma pessoa ler.

Agora esse conteúdo é recusado quando é claramente uma página, ou quando é longo
demais para ser uma frase, e no lugar aparece uma explicação com o que fazer:
"O servidor está indisponível no momento (pode ser uma atualização em andamento).
Tente de novo em alguns segundos." O conteúdo original continua acessível para
quem for investigar o problema — ele só deixou de ser tratado como texto de tela.

Junto veio o motivo pelo qual quase ninguém deveria ver essa mensagem daqui em
diante: pedidos que falham exatamente nessa janela passaram a ser tentados de
novo sozinhos, poucos instantes depois. A indisponibilidade de uma troca de
versão costuma durar menos que essa espera, então na maioria das vezes a ação
simplesmente conclui.
