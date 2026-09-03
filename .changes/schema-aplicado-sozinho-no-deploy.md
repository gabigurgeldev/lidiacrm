---
impacto: exige_acao
secao: adicionado
titulo: O deploy passa a aplicar o schema do banco sozinho
---

Até aqui, a cadeia merge → publicar imagem → implantar entregava código novo e
deixava o banco para trás: nenhum passo dela tocava no schema. Quem aplicava
`supabase/baseline.sql` era o `update.sh` do kit, por SSH — e uma instalação
que implanta por painel (EasyPanel, Coolify, Dokploy) nunca executa esse
script. O sintoma não apontava para a causa: o deploy passava verde, o app
subia, e alguma tela começava a devolver menos dado, quase sempre em silêncio.

Agora o próprio deploy aplica o schema. Um serviço novo, `migrate`, sobe antes
do app, compara um carimbo do `baseline.sql` contra o que já está no banco e
só aplica quando muda. Se falhar — banco fora do ar, por exemplo —, o erro vai
para o log em voz alta e o app sobe do mesmo jeito, com o banco como estava:
uma instalação com schema atrasado continua de pé, em vez de cair inteira por
causa disso.

## Requer atenção

Quem já tem uma instalação rodando por EasyPanel (ou outro painel que leu o
`docker-compose.prod.yml` uma vez e guardou sua própria cópia) precisa
acrescentar o serviço `migrate` na definição do painel manualmente — o painel
não re-lê o compose do repositório sozinho. Sem esse passo, o deploy segue
subindo a versão nova sem aplicar o schema dela, exatamente como hoje.
