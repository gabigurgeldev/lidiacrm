---
impacto: capacidade_nova
secao: corrigido
titulo: Modelo (template) no Stevo oficial sai pelo número certo
---

Enviar um modelo aprovado (para reabrir uma conversa fora das 24h) numa conexão
**Stevo oficial** não tinha caminho próprio: o envio caía no atalho da API da
Meta configurada no ambiente — ou seja, o modelo sairia pelo **número da Meta**,
não pela instância Stevo do cliente. Para um canal intermediado isso não é
"falha de envio", é a mensagem saindo pelo número errado.

Agora o Stevo tem envio de modelo próprio: o template sai pela instância certa,
com os parâmetros `{{1}}`, `{{2}}`… na ordem correta, e uma falha aparece com
motivo legível em vez de sumir.

**A validar na instância viva:** o formato exato do corpo de envio de template do
provedor não está nos specs públicos (docs são SPA); o corpo segue o vocabulário
da Cloud API (que é o que a instância oficial usa por baixo) e é um ponto único
de ajuste se o provedor exigir outro nome de campo. O seletor de modelo no chat
para o Stevo (listar os aprovados) ainda depende de medir a API de templates do
provedor — segue como tarefa separada.
