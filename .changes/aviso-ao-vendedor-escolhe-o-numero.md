---
impacto: capacidade_nova
secao: corrigido
titulo: O bloco que avisa o vendedor escolhe o número, avisa uma pessoa e não some mais em silêncio
---

Três defeitos do bloco "Avisar o vendedor no WhatsApp", todos mudos.

**Não dava para escolher por qual número o aviso sai.** Ele usava sempre a
conexão mais antiga da organização — e, quando nenhuma estava conectada,
qualquer uma, inclusive desconectada. Quem tem mais de um número via o aviso
sair pelo errado, ou não sair. Agora o bloco tem "Por onde enviar", igual aos
outros blocos de envio; deixar em "a primeira disponível" mantém o
comportamento de antes, para quem tem um número só.

**Avisar uma pessoa específica matava a execução.** O bloco aceitava esse
destinatário e não fazia nada com ele: o fluxo morria ali, sem mensagem, sem
registro e sem nada na tela. Agora funciona de verdade, com a pessoa escolhida
numa lista — e o painel marca quem ainda não tem telefone de aviso cadastrado,
antes de você publicar.

**Aviso que não saía não deixava rastro.** As saídas "Sem telefone cadastrado" e
"Não saiu agora" podem ficar sem ligação nenhuma no quadro, e nesse caso o
caminho terminava ali: o vendedor não era avisado e o fluxo terminava dizendo
que deu certo. Agora, sempre que o aviso não sai, abre um item na Central de
avisos dizendo qual bloco tentou, sobre qual lead e por quê. Quem trata o caso
pelo desenho continua podendo — o registro é além, não no lugar.

Fluxos já publicados seguem funcionando sem mexer em nada.
