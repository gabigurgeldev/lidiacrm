---
impacto: nada_mudou
secao: corrigido
titulo: O editor do agente salva o que mostra, e diz por que não publica
---

O editor do agente tinha campos que pareciam salvar e não salvavam, e um
caminho que salvava e nunca deixava publicar.

- **Nome, descrição e ordem de preferência agora são salvos** quando você edita
  um agente. Antes a tela dizia "Rascunho salvo", e o nome voltava ao antigo ao
  recarregar — e o botão Publicar ficava travado pedindo para salvar de novo.
  Renomear não cria mais um rascunho novo.
- **"A chave desta instalação" publica.** Escolher a chave que veio na
  instalação (no lugar de uma cadastrada em IA › Credenciais) salvava o agente
  mas nunca deixava publicar. Afetava o agente criado no primeiro acesso: depois
  da primeira edição, ele não podia mais ser publicado. Agora publica, desde que
  a instalação tenha mesmo a chave daquela empresa de IA.
- **O follow-up não se perde mais.** Criar um agente já com follow-up marcado, ou
  reverter para uma versão antiga, desligava os follow-ups em silêncio.
- **Aplicar uma proposta de melhoria não apaga mais a configuração do agente.**
  A versão "melhorada" ia ao ar sem os materiais de consulta, sem permissão nos
  funis, sem o papel que organiza o sistema, sem follow-up e sem resposta em
  áudio. Agora ela muda só as instruções, como prometido.
- **O motivo de o Publicar estar travado aparece escrito** embaixo dos botões —
  antes só aparecia passando o mouse, o que não existe no celular.
- **Erros dizem o que fazer**, em vez de códigos como `credential_missing`.
- **A tela de criação mostra seus funis e materiais.** Ela dizia "você ainda não
  tem nenhum funil" para quem tinha.
- **Saíram da tela controles que não mudavam nada**: "não responder em grupos",
  "não responder às mensagens do próprio número", "quantos atendimentos ao mesmo
  tempo" e "só responder quando falar de algo específico". Os três primeiros já
  eram sempre assim; o último não funcionava e volta quando funcionar.

Nada muda para quem opera o servidor: a atualização aplica sozinha a mudança de
banco (a função que publica o agente), sem passo manual.
