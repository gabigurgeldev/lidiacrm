---
impacto: nada_mudou
secao: alterado
titulo: O botão Testar do agente roda o atendimento de verdade, com o que está na tela, sem enviar nada
---

O teste antigo do agente rodava um motor diferente do que atende no WhatsApp.
Ele aprovava respostas que no atendimento real nunca sairiam, pulava as
conferências feitas antes de enviar, e as ações do agente (mover card, marcar
consulta) aconteciam de verdade no CRM. Ele também só testava a última versão
**salva**: quem ajustava as instruções via o efeito do texto anterior.

Agora, na aba **Teste** do agente:

- **Testa o que está na tela, mesmo sem salvar.** Mude as instruções, abra
  Teste e escreva como se fosse o cliente. Voltar para Configuração não perde
  mais o que estava sem salvar.
- **É o mesmo atendimento do WhatsApp.** Mesmas instruções, mesma divisão em
  bolhas, mesmas conferências antes de enviar. As respostas aparecem marcadas
  como "não enviada".
- **Mostra o que aconteceu:**
  - o que o agente tentou fazer no CRM, marcado como **simulado**;
  - cada conferência, com o resultado de cada uma e, quando barra, **qual** barrou;
  - o que ele anotou sobre o cliente;
  - os avisos que iriam para a Central;
  - o custo e o tempo do teste.
- **A conversa continua.** A próxima mensagem do cliente leva o que já foi dito.
- **Testar como se fosse outro horário**, para ver o horário de atendimento e a
  janela de envio funcionando.
- **Nada é enviado nem gravado no CRM.** O custo de IA é real e entra no consumo
  da organização, marcado como teste.

O passo "Testar" do onboarding também passa a usar o atendimento de verdade.

Nada muda para quem opera o servidor: não há mudança de banco nem passo manual.
