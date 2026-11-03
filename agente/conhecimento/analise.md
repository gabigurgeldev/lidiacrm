# Análise: Desempenho, Evolução da IA e Audit Log

Rotas: /app/metrics, /app/ai/evolution, /app/audit

## O que é
O grupo **Análise** serve para olhar o sistema funcionando. **Desempenho** mostra o Kanban e a performance de cada atendente nos últimos 30 dias, além do índice de atrito. **Evolução da IA** mostra se o agente de IA está melhorando, onde erra e o que falta ensinar. **Audit Log** é o histórico de quem fez o quê e quando — um registro que não se apaga.

## Onde fica
- **Análise › Desempenho** — todos veem. Quem é atendente vê a própria performance ("Sua performance"); gerente e administrador veem a de todos ("Performance por atendente") e podem comparar.
- **Análise › Evolução da IA** — gerente ou administrador.
- **Análise › Audit Log** — gerente ou administrador.

## Passo a passo
### Ver o desempenho da equipe
1. Abra **Análise › Desempenho**.
2. Veja o resumo do Kanban (negócios por etapa, ganhos e perdidos) e a tabela de performance: conversas, ganhos, perdidos e tempo médio da primeira resposta.
3. Gerente e administrador podem escolher um atendente específico ou **Todos os atendentes**.

### Entender o índice de atrito
1. Ainda em **Desempenho**, veja o painel **Atrito** ("O que isso custou").
2. Ele mostra o que o resultado custou para os dois lados, com base nas demandas encerradas no período — inclusive as conversas que morreram sem resposta.
3. Para mudar quando uma conversa conta como perdida no silêncio, ajuste **Contar como perdida no silêncio após** (em horas, de 1 a 2160) e clique em **Salvar**.

### Acompanhar a evolução do agente de IA
1. Abra **Análise › Evolução da IA**.
2. Em **Período analisado**, escolha as datas. Todos os números da página valem só para esse intervalo — mude as datas para comparar um mês com o outro.
3. Veja o que o agente aprendeu no período, os negócios que ele marcou como fechados e como perdidos, quantas vezes a conversa andou de etapa e quantas vezes passou para uma pessoa.
4. Use o que aparece como travado para decidir o que ensinar (em **Central de IA › Conhecimento** ou **Memória**).

### Consultar o Audit Log
1. Abra **Análise › Audit Log**.
2. Filtre pelo período, por **Ação contém** (ex.: lead.created) e por **Tipo de recurso** (ex.: contact).
3. Cada linha mostra quando, quem fez (ator), a ação e o recurso afetado.
4. Clique em **Carregar mais** para ver registros mais antigos, ou em **Exportar CSV** para baixar.

## Dúvidas comuns
- **Por que só vejo a minha performance?** Quem tem o papel de Atendente vê apenas os próprios números. A visão da equipe inteira é de gerente e administrador.
- **Os números de Desempenho são de que período?** Dos últimos 30 dias.
- **Evolução da IA mostra zero em tudo.** Se não houve atendimento da IA no período escolhido, os números ficam zerados. Amplie as datas.
- **Fechei um negócio à mão e ele não aparece em Evolução da IA.** Está certo: lá só contam os negócios que o agente marcou como fechados ou perdidos. Os da equipe aparecem em **Desempenho**.
- **Dá para apagar ou editar o Audit Log?** Não. Ele é um histórico permanente, justamente para servir de prova de quem fez o quê.
- **Não vejo Audit Log nem Evolução da IA no menu.** Essas telas são para gerente ou administrador.
