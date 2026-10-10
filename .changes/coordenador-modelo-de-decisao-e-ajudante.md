---
impacto: capacidade_nova
secao: adicionado
titulo: Coordenador decide toda mensagem com o modelo de decisão, e chama um segundo ajudante quando fica em dúvida
---

Em IA › Coordenador › Configurar, o cartão **Modelo de decisão** ganhou:

- **Quando consultar**: "Toda mensagem (com o contexto da conversa)" ou "Só
  quando as regras não decidem" (o comportamento de antes, que continua sendo o
  padrão de quem já tinha publicado).
- **1º — modelo de decisão** e **2º — segundo ajudante**, lado a lado, cada um
  com a lista de modelos (na OpenRouter, os roteadores aparecem no topo).

O modelo de decisão recebe agora a mensagem **e as últimas falas da conversa**.
Antes ele decidia lendo só a mensagem nova, sem saber o que o agente tinha
perguntado. Ele devolve só a decisão — qual agente ou fluxo conduz —, nunca
texto para o cliente.

Quando o 1º não consegue distinguir (responde que está em dúvida, decide com
confiança abaixo da mínima ou devolve algo fora da lista), a mesma pergunta,
com o mesmo contexto, vai ao segundo ajudante, e vale a decisão dele. Sem
ajudante escolhido, fica a decisão do 1º. A simulação mostra quando o ajudante
entrou, e o diário passou a guardar a escolha, o erro e o ajudante de cada
decisão.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
