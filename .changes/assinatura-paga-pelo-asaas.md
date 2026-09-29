---
impacto: exige_acao
secao: adicionado
titulo: Assinatura paga pelo Asaas, com 7 dias grátis no cadastro e bloqueio de quem não paga
---

O sistema passa a cobrar uma mensalidade por organização (padrão R$ 1.200,00),
paga dentro do CRM por PIX ou cartão de crédito, processada pelo Asaas. Quem se
cadastra ganha 7 dias grátis. Quando o teste termina sem assinatura, ou a
mensalidade fica 3 dias em atraso, o CRM mostra só a tela de pagamento e as
automações param; ao pagar, o acesso volta na hora. Mensagens recebidas
continuam sendo gravadas.

Organizações que já existiam ficam isentas. O painel da plataforma ganhou a
chave "Isenta de cobrança" por organização.

## Requer atenção

Para ligar a cobrança: preencher `ASAAS_API_KEY`, `ASAAS_AMBIENTE` e
`ASAAS_WEBHOOK_TOKEN` no `.env` e cadastrar o webhook no painel do Asaas —
passo a passo em `docs/integracoes/asaas.md`. Sem a chave, a cobrança fica
desligada e nada muda para ninguém.
