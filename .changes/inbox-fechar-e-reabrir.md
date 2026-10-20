---
impacto: capacidade_nova
secao: adicionado
titulo: Conversa fechada pode ser reaberta, escolhendo a aba para onde ela volta
---

No inbox, o botão **Fechar** saiu do menu ⋮ e ficou à vista no cabeçalho da
conversa.

Uma conversa em **Fechadas** agora mostra **Reabrir**, que pergunta para onde
ela volta:

- **Na Fila** — sem dono, esperando alguém pegar;
- **Em Minhas** — quem clicou assume o atendimento;
- **Com o automático** — o atendimento automático retoma (só aparece se a
  organização tem automático configurado).

Antes, fechar era porta só de ida: a conversa fechada só voltava por efeito
colateral ("Assumir", quando não tinha dono, ou "Liberar", só para o dono), e
quem não era nenhum dos dois não tinha como trazê-la de volta. A reabertura
fica no audit como `conversation.reopened`, com o destino escolhido.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
