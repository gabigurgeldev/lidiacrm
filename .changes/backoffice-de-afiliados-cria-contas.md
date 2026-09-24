---
impacto: capacidade_nova
secao: adicionado
titulo: O Back Office de afiliados da Gestalt pode criar, suspender e reativar contas por API
---

Rotas novas em `/backoffice/*` para o Back Office de afiliados da Gestalt: criar
organização com convite do dono, suspender, reativar, alterar o plano cobrado e
conciliar. Elas só respondem com `BACKOFFICE_OUTBOUND_SECRET` preenchido no `.env`
— vazio (o padrão) mantém tudo desligado e as rotas respondem 503, então quem não
usa o Back Office não precisa fazer nada.

O Back Office só enxerga organizações que ele mesmo criou (tabela nova
`backoffice_tenants`, migration 0216). Contrato e passo a passo em
`docs/integracoes/backoffice.md`.
