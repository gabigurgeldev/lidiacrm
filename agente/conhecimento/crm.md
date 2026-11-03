# CRM: Kanbans, Contatos, Tags e Fluxos

Rotas: /app/kanban, /app/contacts, /app/tags, /app/flows, /app/flows/execucoes

## O que é
O grupo **CRM** é onde você acompanha o funil de vendas. Os **Kanbans** são os quadros com colunas (etapas) por onde cada negócio avança. **Contatos** guarda as pessoas e o histórico delas. **Tags** organiza os contatos com etiquetas coloridas, que podem até mover o negócio de coluna. **Fluxos** são automações montadas num quadro visual — distribuir o lead, avisar quem atende, esperar e cobrar — e **Execuções dos fluxos** mostra o que cada fluxo fez.

## Onde fica
- **CRM › Kanbans** — todos veem; criar, renomear e configurar Kanbans é de gerente ou administrador.
- **CRM › Contatos** — todos veem.
- **CRM › Tags** — todos veem; criar e editar tags é de gerente ou administrador.
- **CRM › Fluxos** — só gerente ou administrador.
- **Execuções dos fluxos** (todas as execuções de todos os fluxos) — só gerente ou administrador. Não fica no menu lateral: abra pela busca do topo (Ctrl+K ou ⌘K) digitando "Execuções dos fluxos". Para ver só um fluxo, abra o fluxo e clique em **Ver execuções**.

## Passo a passo
### Criar um Kanban
1. Abra **CRM › Kanbans** e clique em **Novo Kanban** (ou **Criar meu primeiro Kanban**).
2. Dê o nome (ex.: Consultas, Obras, Matrículas) e, se quiser, **Para que serve**.
3. Em **Começar com as colunas de**, escolha um modelo pronto ou **Em branco**. Confira a **Prévia das colunas**.
4. Clique em **Criar Kanban**. Depois, clique nele para abrir o quadro.

### Criar um negócio (lead) à mão
1. Abra o Kanban e clique em **Novo negócio**.
2. Preencha o título, escolha a coluna, e se quiser o **Valor (R$)** e o **Fechamento previsto**.
3. Clique em **Criar negócio**.

### Mudar um lead de etapa
1. No quadro, arraste o card até a coluna desejada.
2. Ou, pela conversa no **Inbox**, abra **Dados do contato** e escolha a coluna em **Contato no Kanban**.
3. Para mover vários de uma vez, selecione os cards e use **Mover para…** na barra de ações.
4. Para fechar: no menu do card (**Ações do lead**), use **Marcar como ganho** ou **Marcar como perdido** (o sistema pede o motivo da perda).

### Configurar colunas e campos do Kanban
1. Com o quadro aberto, clique em **Configurar**.
2. Na aba **Colunas e agente**, renomeie, crie (**Acrescentar etapa ao fim**), reordene ou arquive colunas. Marque qual coluna é "Aqui o cliente fecha" e qual é "Aqui o cliente desiste".
3. Em **Para onde o card vai em cada passo**, diga para qual etapa o agente de IA deve levar o card em cada momento do atendimento, ou deixe **Não mover o card**. Clique em **Salvar estas escolhas**.
4. Na aba **Campos e nomes**, troque como chamar o cliente e o negócio, e crie campos extras (**Adicionar campo**). Clique em **Salvar vocabulário e campos**.

### Cadastrar ou importar contatos
1. Abra **CRM › Contatos** e clique em **Novo contato**. Preencha ao menos e-mail ou telefone (com código do país, ex.: +5511999998888) e clique em **Criar contato**.
2. Para importar, clique em **Importar CSV** e envie a planilha. Colunas reconhecidas: nome, telefone, email, cpf, nascimento, tags. Até 500 linhas por arquivo. No Excel, use "Salvar como" → "CSV UTF-8".
3. Na lista, use a busca e o filtro de origem (Manual, WhatsApp, Nuvemshop, Importado). Clique no contato para ver a **Visão geral** e o histórico, ou use **Iniciar conversa no Inbox**.

### Criar e usar tags
1. Abra **CRM › Tags** e clique em **Nova tag**. Dê nome, cor e, se quiser, uma **Coluna do Kanban (opcional)**.
2. Com a coluna ligada, aplicar a tag num contato leva o negócio dele para essa coluna — e mover o card para a coluna também dá a tag ao contato.
3. Para aplicar uma tag, use **Adicionar tag** no painel do contato (no Inbox) ou, no Kanban, **Aplicar tag nos contatos** com os cards selecionados.
4. Tag que não serve mais pode ser arquivada (**Arquivar tag**) e reativada depois.

### Criar um fluxo
1. Abra **CRM › Fluxos** e clique em **Criar fluxo**. Dê um nome (ex.: Novo lead do Meta Ads).
2. No quadro, clique nos blocos da paleta para acrescentar (ou arraste). Comece por um bloco de início, como "lead novo entrou no Kanban", "mensagem recebida", "palavra-chave" ou "Ativação manual pelo botão".
3. Ligue os blocos e clique em cada um para ajustar (esperar, perguntar, enviar mensagem, distribuir, avisar a equipe, passar para a IA etc.).
4. Se preferir, use **Criar com IA**: descreva o que quer e clique em **Montar o fluxo**.
5. Clique em **Salvar rascunho** e depois em **Publicar**.
6. Volte à lista de fluxos e clique em **Ligar**. Só fluxo publicado e ligado roda. Para parar, use **Pausar**.

### Ver o que um fluxo fez
1. Na tela do fluxo, clique em **Ver execuções** (só daquele fluxo), ou abra **Execuções dos fluxos** pela busca do topo para ver todas.
2. Cada execução mostra quando começou, os passos e o desfecho — e, se parou no meio, em qual bloco e por quê.
3. Uma execução em andamento pode ser interrompida com **Cancelar execução**.

## Dúvidas comuns
- **Como mudo um lead de etapa?** Arraste o card para outra coluna no Kanban, ou escolha a coluna no painel **Dados do contato** da conversa.
- **Por que não vejo o botão "Novo Kanban" ou "Nova tag"?** Criar e editar Kanbans e tags é só para gerente ou administrador.
- **Arquivar um Kanban apaga os negócios?** Não. Ele sai da lista e para de receber negócio novo, mas o histórico fica guardado. Para apagar de vez existe **Excluir de vez**.
- **O que é o Kanban "Padrão"?** É o Kanban principal da empresa, marcado com o selo **Padrão** na lista. Para trocar, use **Tornar padrão** no Kanban desejado.
- **Publiquei o fluxo e ele não roda.** Depois de publicar, é preciso **Ligar** o fluxo na lista. Confira também o gatilho de início e as **Execuções** para ver se ele parou em algum bloco.
- **Como disparo um fluxo para um cliente específico?** Crie o fluxo com o bloco de início "Ativação manual pelo botão", publique e ligue. Depois, na conversa do Inbox, use **Mais ações › Ativar fluxo**.
- **Posso excluir um contato?** Sim, pela lista de contatos (**Excluir contato**). Para pedidos de exclusão por LGPD, o administrador usa a anonimização (veja a página de Organização).
- **O que são os campos do Kanban?** Campos extras (ex.: endereço) que aparecem nos dados do negócio. São criados em **Configurar › Campos e nomes**.
