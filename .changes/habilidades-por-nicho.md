---
impacto: capacidade_nova
secao: adicionado
titulo: Agentes ganham habilidades de atendimento por ramo, ligadas sozinhas na criação
---

O catálogo de habilidades (skills) passou de 2 para 23 roteiros de atendimento,
e cada agente agora escolhe as suas.

**Sempre ligadas, em todo agente:** objeção de preço, agendamento, cliente
insatisfeito, "já paguei" / comprovante, pedido sobre dados pessoais (LGPD),
cliente que volta depois de sumir, e risco à vida (indica CVV 188 / SAMU 192 e
chama uma pessoa na hora).

**Por ramo:**

- Clínica — sinais de urgência, convênio e particular, preparo e resultado de exame.
- Imobiliária — entender o que o cliente procura, financiamento e FGTS, garantias do aluguel.
- Serviços — pedido de orçamento, serviço que deu problema.
- Curso / infoproduto — "serve pra mim?", promessa de resultado, acesso à plataforma, garantia e reembolso.
- Loja — rastreio de pedido, produto com problema, estoque e tamanho, frete e entrega.

Quem cria um agente a partir do modelo de um ramo (ou pelo "Criar com IA") já
recebe as habilidades daquele ramo ligadas. Na tela do agente, a nova seção
**Habilidades** mostra as que estão ligadas e deixa ligar ou desligar as de
qualquer ramo. O agente só lê o roteiro quando a situação aparece na conversa.

**Para quem já tem agentes:** nenhum agente existente recebe habilidades de
ramo sozinho. Eles passam a ter, além de objeção de preço e agendamento, as
cinco novas que valem para todos (cliente insatisfeito, comprovante, LGPD,
retomada e risco à vida). Para ligar as do seu ramo, abra o agente ›
Habilidades.

Nada a fazer para atualizar: as mudanças de banco (migrations 0241 e 0242)
vêm no `update.sh`, sem variável nova e sem arquivo para editar.
