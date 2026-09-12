---
impacto: capacidade_nova
secao: adicionado
titulo: Os blocos de envio passam a mandar modelo aprovado — inclusive pela conexão intermediada
---

Fora da janela de 24 horas, uma conexão oficial do WhatsApp **não entrega texto livre** — é regra da plataforma. Até aqui só o disparo em massa sabia mandar
modelo aprovado; os dois blocos que mandam mensagem 1:1 ("Mandar mensagem para o
cliente" e "Avisar o vendedor no WhatsApp") só sabiam texto. Numa conexão
oficial, um fluxo que reagisse a um lead parado há dois dias simplesmente não
entregava nada — e não há ninguém olhando um fluxo rodar.

Os dois blocos ganharam a escolha **Como enviar**: escrever a mensagem, ou usar
um modelo aprovado. Escolhido o modelo, aparece um campo por lacuna dele — e
cada campo aceita variável, então a definição aprovada leva o nome de quem
recebe e o número do pedido que um bloco anterior calculou.

Quando a conexão escolhida só entrega modelo, a pergunta some e o bloco diz por
quê, em vez de oferecer uma opção que a plataforma vai recusar.

**Três consertos entraram junto, e os três eram invisíveis:**

- **O modo de modelo do disparo por fluxo estava morto.** A tela lia a resposta
  da listagem no formato errado, a busca falhava por dentro, e o resultado era a
  frase "Nenhum modelo aprovado nesta conta. Crie e aprove o modelo na Meta…" —
  mandando você arrumar uma conta que estava certa.
- **Modelo numa conexão intermediada saía pelo número errado.** Sem um caminho
  próprio, o envio caía no da plataforma direta, que usa o número e o token do
  ambiente. A mensagem saía, o cliente recebia — de outro número —, e a resposta
  dele chegava na caixa errada ou em nenhuma.
- **Número por QR numa conta intermediada aparecia como só-modelo**, e o texto
  livre que ele aceita ficava sem caminho no seletor.

**A lista de modelos agora é da conexão que você escolheu** — e não da conta mais antiga da organização — quem tem duas contas oficiais via só a primeira. E
quando não dá para listar os modelos de uma conexão, o bloco oferece escrever o
nome e o idioma do modelo já aprovado, em vez de deixar você sem saída.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
