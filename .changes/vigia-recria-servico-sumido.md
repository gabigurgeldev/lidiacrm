---
impacto: nada_mudou
secao: corrigido
titulo: O vigia da VPS recria contêiner que sumiu depois de um reinício
---

Depois de um reinício do servidor, o gateway do banco podia falhar ao subir e acabar
removido. O vigia só sabia religar contêiner parado, então não tinha o que fazer: o sistema
ficava sem login e o vigia só mandava e-mail. Agora ele também recria o serviço que sumiu,
desde que o resto do sistema esteja de pé. Quem já instalou o vigia precisa recopiar o
script, como mostra o runbook de deploy.
