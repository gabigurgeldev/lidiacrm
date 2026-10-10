---
impacto: nada_mudou
secao: corrigido
titulo: O coordenador passou a decidir com o modelo escolhido para ele
---

Em organizações que só têm chave da OpenRouter (ou de outro provedor que não o
padrão), o coordenador nunca conseguia perguntar ao modelo quem deveria
conduzir a conversa. Toda decisão dizia "o modelo de decisão falhou" e caía no
destino padrão, mesmo com o modelo escolhido em IA › Provedores. O sistema
procurava a chave do provedor padrão antes de olhar a escolha feita para o
coordenador, e parava ali. Vale para qualquer ponto de IA configurado nessa
tela, não só o coordenador.

Também na tela do coordenador:

- O modelo que decide agora aparece e se troca ali mesmo, em Configurar, abaixo
  de "Usar o modelo quando as regras não bastarem".
- Ao simular sem "Consultar o modelo de verdade", a tela não diz mais que o
  modelo falhou: diz que a simulação seguiu o destino padrão sem consultá-lo.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
