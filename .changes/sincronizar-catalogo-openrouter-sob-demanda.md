---
impacto: capacidade_nova
secao: adicionado
titulo: O catálogo de modelos da OpenRouter passa a poder ser sincronizado na hora
---

Quem escolhia OpenRouter num agente e via "Nenhum modelo disponível" — mesmo
com a chave validada — esbarrava num detalhe invisível: a lista de modelos da
OpenRouter não vem pronta na instalação, como as de Anthropic, OpenAI e
Google. Ela é sincronizada uma vez por dia, de madrugada, por um relógio
interno. Se esse relógio ainda não tiver rodado desde que a instalação
existe — ou se, por qualquer motivo, tiver parado de rodar —, o seletor fica
mudo, e nada na tela avisava por quê.

Agora o seletor de modelo distingue os três motivos de estar vazio: não
carregou (mostra o erro), o catálogo desta conta ainda não foi sincronizado
(mostra um botão para sincronizar na hora), ou o provedor realmente não tem
modelo. Administradores e gerentes conseguem clicar em "Sincronizar catálogo
agora" e ver a lista se preencher em segundos, sem esperar o próximo dia.
