---
impacto: exige_acao
secao: alterado
titulo: Com o Back Office de afiliados ligado, o aviso de cobrança ao cliente sai pelo WhatsApp do Back Office, e o Asaas deixa de avisar
---

Com `BACKOFFICE_URL` e `BACKOFFICE_API_KEY` preenchidos, o CRM manda ao Back
Office as faturas do Asaas (status, vencimento, valor e link), o status da
assinatura com o fim do teste grátis e o WhatsApp do dono. O Back Office avisa
o cliente; o cliente do Asaas criado pelo checkout nasce com as notificações do
Asaas desligadas. Testes e faturas em aberto chegam pela conciliação horária.

Sem o Back Office configurado nada muda.

## Requer atenção

Só para quem usa o Back Office. Antes de atualizar, confirme os modelos de aviso
aprovados na Meta e a chave "Avisos de cobrança pelo Back Office" ligada no
produto. Depois, cale o Asaas nos clientes antigos (simulação, depois de verdade):

```bash
pnpm tsx --env-file=<.env da instalação> scripts/asaas-desligar-notificacoes.ts
pnpm tsx --env-file=<.env da instalação> scripts/asaas-desligar-notificacoes.ts --aplicar
```

Nenhuma variável nova e nenhuma mudança de banco.
