---
impacto: nada_mudou
secao: corrigido
titulo: Áudio e imagem do cliente deixaram de sumir quando o modelo padrão da organização não tem chave
---

Quando o modelo padrão da organização apontava para um provedor sem chave
cadastrada (por exemplo, padrão `claude-sonnet-5` da Anthropic com só a chave
da OpenRouter), nenhum áudio nem imagem de cliente era lido. O sistema tentava
cinco vezes e desistia, sem abrir aviso nenhum na Central. O agente respondia
como se o cliente não tivesse mandado nada.

O áudio nem usa esse modelo. Agora a falta de chave do modelo padrão não
impede a leitura da mídia:

- o áudio é transcrito pela chave da OpenAI ou da OpenRouter;
- a imagem usa o modelo escolhido em "Ver a imagem do cliente". Se não houver
  nenhum modelo com chave, o agente avisa o cliente que não conseguiu abrir a
  foto, e um aviso abre na Central dizendo o que configurar.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
