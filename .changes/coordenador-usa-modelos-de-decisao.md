---
impacto: capacidade_nova
secao: adicionado
titulo: O coordenador usa os modelos de decisão da OpenRouter (GPT-6 Luna Decisions, Decider, d1…)
---

A OpenRouter tem uma categoria de modelos que não escrevem texto: eles leem o
contexto e devolvem a probabilidade de cada opção. O coordenador agora sabe
usá-los.

Em IA › Coordenador › Configurar, nos campos **1º — modelo de decisão** e
**2º — segundo ajudante**, escolha a OpenRouter: os modelos de decisão aparecem
num grupo próprio no topo da lista ("Modelos de decisão"), lidos ao vivo da
OpenRouter. Com um deles escolhido, cada decisão vai com a mensagem do cliente,
o contexto da conversa e os destinos como opções, e volta com a probabilidade
de cada um. Medido: ~0,4 s e US$ 0,00002 por decisão, contra ~2 s de um modelo
de chat. O custo entra no uso de IA da organização.

Modelos de chat continuam funcionando nesses campos como antes.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
