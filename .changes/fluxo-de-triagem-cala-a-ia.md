---
impacto: capacidade_nova
secao: adicionado
titulo: O fluxo pode fazer a pré-triagem do cliente sem a IA responder por cima
---

O gatilho **"Quando o cliente manda mensagem"** ganhou opções para montar um
pré-atendimento (perguntar nome, sistema, problema) antes do agente de IA:

- **Quando começar:** em toda mensagem (como sempre) ou **só no começo da
  conversa** — a primeira mensagem do cliente, ou a que chega depois de um
  número de horas sem conversa (24 por padrão). Antes, a própria resposta do
  cliente ao menu fazia o fluxo começar de novo.
- **Uma vez por cliente de cada vez:** enquanto o fluxo está em andamento para
  alguém, as mensagens dessa pessoa não começam outro.
- **A IA fica calada enquanto o fluxo conversa:** o agente não responde por
  cima das perguntas do fluxo — antes os dois respondiam a mesma mensagem.
- **Não começar se uma pessoa da equipe está com a conversa.**

Corrigido junto: num fluxo com duas perguntas seguidas, se o cliente
respondia a primeira e sumia na segunda, o fluxo seguia pelo caminho "não
entendi a resposta" (lendo a resposta da primeira pergunta) em vez de "não
respondeu a tempo".

Fluxos já publicados não mudam: todas as opções nascem desligadas.

Para quem opera o servidor: a atualização aplica sozinha a mudança de banco
(duas colunas e dois índices novos). Nenhum passo manual.
