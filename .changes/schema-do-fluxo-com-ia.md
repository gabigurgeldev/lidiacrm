---
impacto: nada_mudou
secao: corrigido
titulo: Criar fluxo com IA nunca funcionou, e a causa era o formato pedido ao modelo
---

A tela de criar fluxo com inteligência artificial não passava do primeiro passo.
Você descrevia o que queria, clicava em continuar, e recebia de volta um erro —
qualquer que fosse a descrição, qualquer que fosse o modelo escolhido.

A causa estava no formato em que a resposta era pedida ao modelo. O sistema
aceitava duas respostas possíveis — uma pergunta de volta, ou o sinal de que já
dava para montar — e descrevia isso como uma escolha entre dois formatos
alternativos no nível mais externo do pedido. Serviços de inteligência artificial
compatíveis com o padrão da OpenAI, que é o caso da OpenRouter, não aceitam
alternativas nesse nível: aceitam apenas um formato único, ainda que com partes
opcionais dentro dele.

O pedido era recusado sempre, e a recusa chegava disfarçada. Dependendo do modelo,
a mensagem falava em resposta ilegível ou em resposta fora do formato — nenhuma
das duas apontando para o formato pedido, que era o problema. Foi por isso que a
investigação passou antes por tempo de espera e por nome de modelo, corrigindo
dois defeitos reais que não eram este.

Agora o formato é único, com os campos que variam marcados como opcionais, e a
combinação válida é conferida depois que a resposta chega: uma pergunta sem
alternativas, por exemplo, é tratada como falha em vez de ser exibida como uma
escolha sem escolhas.

A regra que faltava também passou a ser vigiada automaticamente. Esse tipo de erro
não dá nenhum sinal em quem desenvolve — o programa compila, os testes passam — e
só aparece diante de um serviço real. Agora existe uma verificação que reprova a
volta desse formato em qualquer ponto do sistema que converse com inteligência
artificial, inclusive nos que vierem a ser escritos.
