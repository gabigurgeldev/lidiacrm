---
impacto: nada_mudou
secao: corrigido
titulo: Contas sem agente de IA deixaram de ter os clientes avisados pela IA
---

Uma conta que nunca criou agente de inteligência artificial estava tendo os
próprios clientes abordados por ela. Quem mandava mensagem para o número
conectado recebia de volta algo como "Vou pedir ajuda de alguém da equipe para
cuidar disso com você. Não há atendente disponível neste instante — sua
conversa entrou na fila." — e, a partir dali, o atendimento automático daquela
conversa ficava desligado para sempre.

Medido numa instalação real: dos casos em que o sistema tirou a conversa do
atendimento automático por achar o cliente insatisfeito,
**23 de 24 aconteceram em empresas que não têm nenhum agente cadastrado**.

**A causa era uma peça que media sem ter porta.** O medidor de humor das
mensagens lia o agente só para descobrir um ajuste de sensibilidade; não
encontrando nenhum, ele usava o valor padrão e continuava medindo. Parecia
inofensivo — medir não fala com ninguém —, mas a nota baixa é o que aciona a
passagem para atendimento humano, e é a passagem que escreve ao cliente.

Agora o medidor só funciona onde existe um agente **no ar**. Sem IA ligada não
há classificação, não há gasto com ela, não há conversa silenciada e não há
mensagem ao cliente. Vale também para o meio do caminho: agente criado mas
nunca publicado não conta como ligado.

Para quem usa IA nada muda — a medição de humor e a passagem para humano seguem
exatamente como estavam.

**Nada muda para quem opera o servidor.** Sem variável nova, sem passo de
atualização, sem mudança de banco.
