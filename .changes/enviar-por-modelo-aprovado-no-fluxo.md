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

**Cinco consertos entraram junto, e os cinco eram invisíveis:**

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

- **Escolher o número ESVAZIAVA a lista.** O recorte por conexão filtrava por
  uma coluna que o espelho do canal oficial nunca preenche — ele é chaveado pela
  CONTA, não pelo número. Resultado: "nenhum modelo aprovado nesta conta" com o
  espelho cheio, culpando a sua conta pelo nosso filtro.
- **Escrever o nome do modelo à mão não enviava.** O envio exigia que a
  definição estivesse espelhada aqui e recusava ANTES de chamar a plataforma,
  com "não está no espelho" — culpando o template. Agora quem responde é a
  plataforma, com o código dela: nome que não existe é 132001, parâmetro a menos
  é 132000, template não aprovado é 133010. Definição que o espelho SABE que
  está reprovada continua barrada antes de gastar.

**A lista de modelos agora é da conta da conexão que você escolheu** — e não da
conta mais antiga da organização, que é o que quem tem duas contas oficiais via.

**A conexão intermediada passou a listar os modelos dela.** Ela sabia mandar e
não sabia listar, então o seletor vinha vazio numa conta cheia de modelos
aprovados. E quando o espelho local ainda não foi sincronizado, a lista é
perguntada à plataforma na hora, em vez de a tela dizer que não há nenhum.

Se mesmo assim não der para listar, o bloco oferece escrever o nome e o idioma
do modelo já aprovado — e agora esse caminho de fato envia.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
