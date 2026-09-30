---
impacto: nada_mudou
secao: corrigido
titulo: Conectar pela conta do provedor parceiro não fica mais girando até dar erro
---

Em Conexões › Provedor parceiro, colar a chave e clicar em "Ver meus números"
deixava o botão em "Consultando o provedor…" por mais de meio minuto e terminava
em erro, mesmo com a chave certa. O provedor leva de 20 a 30 segundos para
responder, e o CRM desistia antes: o servidor em 15 segundos, a tela em 10 (e
ainda repetia a consulta três vezes). Agora o CRM espera a resposta e mostra os
números — ou o motivo real da recusa, como chave inválida ou sem permissão.

Quando o provedor está instável, a mensagem agora diz isso — "não respondeu a
tempo" ou "está instável agora (503), a chave não foi recusada" — em vez de
pedir para verificar a conexão do servidor, que não tinha nada de errado.
