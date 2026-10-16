---
impacto: capacidade_nova
secao: adicionado
titulo: O agente não inventa mais o que não está no material da empresa
---

Quando o cliente perguntava algo que o material do agente não respondia, o
agente recebia a orientação de "responder com o que já sabe" ou de "dizer que
ia confirmar" — e acabava afirmando preço, cor, estoque ou prazo que não
existiam, ou prometendo um retorno que ninguém dava.

Agora:

- **O agente só afirma o que tem fonte**: o material da empresa, o resultado de
  uma ferramenta ou as instruções dele. Isso vale para qualquer fato da empresa
  — produto, característica, estoque, cor, preço, prazo, política, horário,
  endereço —, não só para preço e prazo.
- **Você escolhe o que acontece quando falta a informação**, no editor do
  agente, em *Passar para uma pessoa › Quando o agente não souber responder*:
  - **Chamar alguém da equipe** — o agente avisa o cliente e passa a conversa;
  - **Dizer que não sabe e seguir** — para quem não tem ninguém atendendo pela
    Caixa de entrada: o agente diz com clareza que não tem a informação, sem
    prometer retorno.

  A escolha vale para todos os agentes e é salva na hora. Sem escolha, o
  sistema decide: chama a equipe se alguém tem disponibilidade cadastrada para
  atender; senão, diz que não sabe.
- **Trecho só parecido com a pergunta não vira resposta**: quando o material
  traz algo próximo (outro modelo, outro serviço), o agente é avisado de que
  parecido não serve.
- **Conferência antes de enviar**: nova conferência "Só afirmar o que tem
  fonte" em *Segurança*. A mensagem que afirma preço, prazo, estoque,
  característica ou endereço sem fonte neste atendimento não sai; o agente é
  orientado a buscar no material ou a seguir a sua escolha acima.
- **Se o agente insistir, o sistema assume**: no modo *Chamar alguém da
  equipe*, a conversa é passada com o motivo "Faltou informação no material do
  agente" (visível no aviso da Central); no modo *Dizer que não sabe*, o
  cliente recebe uma mensagem curta dizendo que essa informação não está
  disponível, sem promessa de retorno. Quem pediu para parar continua sem
  receber nada.
- **Agentes criados pelo assistente de criação** deixam de receber a regra
  "diga que vai confirmar com a equipe".

Para quem opera o servidor: nada a fazer. A atualização aplica sozinha a nova
versão das regras de todo agente — exceto onde alguém já tinha editado essas
regras à mão, que fica como está.
