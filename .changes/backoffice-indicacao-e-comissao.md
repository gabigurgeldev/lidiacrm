---
impacto: capacidade_nova
secao: adicionado
titulo: Cadastro pelo link de um afiliado do Back Office dá desconto ao cliente e comissão ao afiliado
---

Com `BACKOFFICE_URL` e `BACKOFFICE_API_KEY` preenchidos no `.env`, o cadastro
aceita o código de indicação do Back Office de afiliados da Gestalt: pelo link
do afiliado (`/signup?ref=CODIGO`, lembrado por 90 dias) ou digitado na tela. O
desconto do afiliado entra na mensalidade e toda cobrança do Asaas sai com ele.

Cada cobrança paga, estornada ou contestada, o cadastro e o cancelamento viram
eventos para o Back Office, que calcula receita e comissão. Eles passam por uma
fila (migration 0221) e o cron novo `backoffice-saida` reenvia o que o Back
Office não recebeu.

Vazio (o padrão) mantém tudo desligado: quem não usa o Back Office não precisa
fazer nada. Passo a passo em `docs/integracoes/backoffice.md`.
