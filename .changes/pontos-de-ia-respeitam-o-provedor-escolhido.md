---
impacto: capacidade_nova
secao: corrigido
titulo: O painel de Provedores mostra o modelo de verdade e a escolha vale mesmo com a chave da instalação
---

Em **IA › Provedores**:

- **"Buscar no seu material" e "Indexar o seu material" não aparecem mais como Claude.**
  Eles usam embedding (texto → vetor), não o modelo de conversa, e a
  tela agora mostra o modelo e a chave que de fato usam. O mesmo vale para
  "Ensaiar o agente" e "Medir o tamanho do contexto".
- **"Ouvir o áudio do cliente" passou a ser configurável**: escolha OpenAI ou
  OpenRouter (os dois que transcrevem áudio), o modelo (incluindo o mais
  preciso) e a chave. Sem escolha, continua como antes.
- **Escolher um provedor com "chave da instalação" agora usa esse provedor.**
  Antes, em sentimento, respostas automáticas, fluxos com IA e no "Criar com
  IA", escolher a OpenRouter sem selecionar uma chave fazia a chamada cair no
  Claude. Agora vale a chave da organização para aquele provedor ou a da
  instalação; só sem nenhuma delas cai no padrão, com aviso no log.
- O endereço próprio da OpenAI (servidor compatível) passou a ser respeitado.

Não há passo manual nem mudança de banco.
