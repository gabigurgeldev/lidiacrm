---
impacto: nada_mudou
secao: corrigido
titulo: Fluxo com bloco de mensagem não publicava
---

Publicar um fluxo que tivesse blocos de mensagem era recusado com uma lista de
erros do tipo:

    A saída "Sem telefone do cliente" de "Mandar mensagem para o cliente"
    não leva a lugar nenhum.

Todo bloco que fala com alguém traz de fábrica saídas para quando ele não
consegue: "Sem telefone do cliente", "Não saiu agora", "Ninguém disponível",
"Não deu para criar". Elas existem para quem QUER desenhar o que fazer nesses
casos — mandar um aviso ao gerente, tentar de novo mais tarde. A validação, no
entanto, tratava todas como se fossem regras escritas por quem monta o fluxo, e
exigia que cada uma levasse a algum bloco.

Na prática isso quer dizer que um fluxo com cinco blocos de mensagem precisava
de dez ligações para casos de erro que ninguém quis tratar — e, sem elas, não
publicava de jeito nenhum.

Agora essas saídas podem ficar soltas. Quando ficam, aquele caminho
simplesmente termina ali, que é exatamente o que o motor sempre fez com uma
saída sem ligação; o registro da execução continua mostrando por onde ela saiu.
No quadro elas aparecem em cinza, como o "Senão" já aparecia, para se
distinguirem das saídas que você criou.

O que NÃO mudou: as saídas que você escreveu continuam obrigatórias. Uma regra
do "Decidir", uma opção do "Esperar uma escolha", uma frente do "Fazer ao mesmo
tempo" — deixar qualquer uma delas sem destino segue sendo recusado na
publicação, porque ali o vazio é esquecimento, não escolha.

Nenhum fluxo já publicado muda de comportamento.
