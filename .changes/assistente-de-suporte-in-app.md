---
impacto: capacidade_nova
secao: adicionado
titulo: Assistente de suporte dentro do sistema — a bolinha no canto
---

Toda tela do sistema ganhou uma bolinha no canto inferior direito. Ela abre a
**Lia**, assistente de suporte: "Olá, eu sou a Lia, assistente do <sua marca>".

A Lia:

- tira dúvidas de uso — o que cada tela faz, onde fica no menu, passo a passo;
- consulta dados **da conta de quem pergunta**, só para ler: resumo da conta,
  leads por etapa, conversas abertas, a própria agenda, contato pelo nome
  (telefone mascarado), uso de IA do mês e situação das conexões de WhatsApp;
- **nunca altera nada** — se pedirem uma mudança, ela explica o passo a passo;
- nunca fala de outra conta, e respeita o papel de quem pergunta (atendente vê
  só o que já vê nas telas).

Cada pessoa tem até 50 perguntas por dia. O histórico fica salvo e só a própria
pessoa o vê.

Para ligar, quem opera o servidor preenche no `.env` a chave própria da
assistente na OpenRouter — `AGENTE_OPENROUTER_API_KEY` — e reinicia o app. Sem
ela a bolinha aparece e avisa que a assistente está indisponível. Opcionais:
`AGENTE_MODEL` (padrão `anthropic/claude-haiku-5.5`), `AGENTE_LIMITE_DIARIO`
(padrão 50) e `AGENTE_NOME` (padrão Lia). O banco ganha duas tabelas de
histórico (migration 0250), aplicadas pelo próprio update.
