---
impacto: capacidade_nova
secao: adicionado
titulo: A base de conhecimento do agente funciona com a chave da OpenRouter
---

Quem cadastrou só a chave da OpenRouter em **IA › Credenciais** agora consegue
subir material para o agente: ele é preparado com o mesmo modelo de antes
(`openai/text-embedding-3-small`), servido pela OpenRouter. Antes, o material
ficava esperando uma chave da OpenAI para sempre.

Quem tem a chave da OpenAI continua usando a OpenAI, e nada precisa ser
reindexado. Uma instalação com `OPENROUTER_API_KEY` no `.env` também passa a
servir de último recurso.
