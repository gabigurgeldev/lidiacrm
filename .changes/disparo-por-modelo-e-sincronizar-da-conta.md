---
impacto: capacidade_nova
secao: adicionado
titulo: O disparo em massa escolhe o modelo aprovado, e o Sincronizar dos modelos funciona na instância importada por chave de conta
---

Em **Disparos › Novo disparo**, escolher um número oficial agora mostra a lista de
modelos aprovados daquela conexão, a prévia do texto e um campo para cada valor
(`{{1}}`, `{{2}}`…). Antes a tela só avisava para "escolher o modelo em Conexões e
voltar", e não havia como disparar por modelo.

Em **Conexões › Provedor parceiro › Modelos do parceiro**, o botão Sincronizar
falhava sempre quando o número oficial tinha sido importado pela chave de conta —
a tela procurava a conexão de outro provedor e respondia "nenhuma conexão de
parceiro ativa", mesmo com o token gravado. Agora a tela diz de qual conexão são os
modelos (com seletor, quando há mais de uma) e sincroniza a conexão certa.

Nada a fazer na atualização.
