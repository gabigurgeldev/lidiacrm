---
impacto: nada_mudou
secao: corrigido
titulo: Gatilho por palavra e menu de escolha nunca funcionaram
---

Um fluxo que começava com "Quando o cliente escrever uma palavra" nunca
começava. Nenhuma vez, em nenhuma instalação. A execução até nascia a cada
mensagem recebida, mas morria no primeiro passo com o motivo "mensagem sem a
palavra" — inclusive quando a mensagem era exatamente a palavra configurada.

O mesmo valia para o bloco "Esperar uma escolha": ele mandava a pergunta, o
cliente respondia, e a resposta nunca era reconhecida. O fluxo saía sempre pela
saída "Não entendi a resposta", ou ficava esperando até o prazo acabar.

A causa era o texto da mensagem. O aviso interno que acorda os fluxos guarda o
texto num campo chamado `body_preview`, e os dois blocos procuravam por outros
quatro nomes — nenhum deles existia ali. Os dois liam sempre um texto vazio, e
texto vazio não casa com palavra nenhuma. Como a comparação em si estava certa,
os testes que existiam passavam: eles montavam o aviso à mão, com o nome que o
código esperava, em vez de usar o que o sistema realmente escreve.

Agora os dois leem o campo certo, e há um teste com uma cópia literal de um
aviso real de produção — inclusive o que morreu — para que a diferença entre "o
que o código espera" e "o que o sistema escreve" não volte a passar despercebida.

Um limite que vale saber: esse campo guarda os primeiros 280 caracteres da
mensagem. Uma palavra-chave que só apareça depois disso não dispara o fluxo. Em
conversas de WhatsApp isso cobre praticamente tudo, e ler a mensagem inteira
exigiria que o bloco fosse buscá-la no banco, coisa que a arquitetura do
produto não permite a esse tipo de bloco.

Fluxos que já existem voltam a funcionar sozinhos, sem republicar nem
reconfigurar nada.
