---
impacto: capacidade_nova
secao: adicionado
titulo: Agentes de IA podem usar qualquer modelo da OpenRouter, inclusive o lançado hoje
---

A lista de modelos da OpenRouter no agente só mudava uma vez por dia, de
madrugada. Um modelo lançado de manhã não dava para escolher até o dia
seguinte — e não havia onde digitar o código dele, porque o agente só publica
com um modelo que esteja na lista.

Agora, embaixo do campo "Modelo", há uma busca que consulta a própria
OpenRouter na hora: digite parte do nome ("sonnet", "kimi") ou cole o código
exato (`anthropic/claude-sonnet-4.5`). Cada resultado mostra o preço de entrada
e saída e avisa quando o modelo não usa ferramentas — o que faria o agente
conversar sem mexer no funil. Ao escolher, o código é conferido na OpenRouter,
o modelo entra na lista com o preço de verdade (o teto de orçamento continua
valendo) e já fica selecionado. Código com erro de digitação é recusado na hora,
com o motivo. O botão "Atualizar lista da OpenRouter" também fica sempre à mão,
não só quando a lista está vazia.

Gerentes e administradores podem adicionar modelos; a ação fica registrada na
auditoria. Nada muda para quem usa Anthropic, OpenAI ou Google direto.
