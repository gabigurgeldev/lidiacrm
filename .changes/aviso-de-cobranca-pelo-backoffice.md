---
impacto: exige_acao
secao: alterado
titulo: Com o Back Office de afiliados ligado, o aviso de cobrança ao cliente sai pelo WhatsApp do Back Office, e o Asaas deixa de avisar
---

Com `BACKOFFICE_URL` e `BACKOFFICE_API_KEY` preenchidos, o CRM passa a mandar ao
Back Office de afiliados os dados que ele precisa para avisar o cliente pelo
WhatsApp: cada fatura do Asaas (pendente, vencida, paga ou cancelada, com
vencimento, valor e link de pagamento), o status da assinatura com a data de
fim do teste grátis, e o WhatsApp do dono da organização. É o Back Office quem
manda o aviso de fatura e o de "seu teste grátis está terminando".

Para o cliente não receber o mesmo aviso duas vezes, o cliente criado ou
atualizado no Asaas pelo checkout passa a nascer com as notificações do Asaas
desligadas. Os testes grátis em andamento e as faturas em aberto chegam ao Back
Office pela conciliação horária, sem passo manual. Estender o teste pelo painel
da plataforma também atualiza a data no Back Office.

Sem o Back Office configurado nada muda: o Asaas continua avisando o cliente,
como antes.

## Requer atenção

Só para quem usa o Back Office de afiliados. Antes de atualizar, confirme que
os modelos de aviso de cobrança estão aprovados na Meta e que a chave "Avisos
de cobrança pelo Back Office" está ligada no produto, no Back Office. Depois de
atualizar, cale o Asaas nos clientes que já existiam, uma vez — primeiro a
simulação, depois de verdade:

```bash
pnpm tsx --env-file=<.env da instalação> scripts/asaas-desligar-notificacoes.ts
pnpm tsx --env-file=<.env da instalação> scripts/asaas-desligar-notificacoes.ts --aplicar
```

Nenhuma variável nova e nenhuma mudança de banco.
