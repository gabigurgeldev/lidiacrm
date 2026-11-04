---
impacto: capacidade_nova
secao: adicionado
titulo: O Back Office de afiliados consegue puxar o histórico de cobrança do CRM
---

Até aqui o Back Office só via as faturas que mudaram de estado DEPOIS de a
integração ser ligada: o CRM manda cada fatura no momento em que ela muda, mas
não tinha como reenviar as antigas.

Agora o botão de sincronizar em "Cobranças", no Back Office, pede ao CRM o
histórico inteiro: todas as faturas já gravadas (em aberto, vencidas, pagas e
canceladas, com a data do pagamento quando paga) e o estado atual de cada
assinatura. Repetir a sincronização não duplica nada, e ela **não** gera
comissão de pagamento antigo — só atualiza as faturas e as assinaturas.

A fatura paga também passou a levar a data do pagamento no aviso de sempre.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco. Sem o Back Office configurado
(`BACKOFFICE_URL` e `BACKOFFICE_API_KEY`), a rota responde que não está
configurada e nada sai do CRM.
