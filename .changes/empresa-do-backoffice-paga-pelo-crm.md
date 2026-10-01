---
impacto: nada_mudou
secao: corrigido
titulo: Empresa criada pelo Back Office de afiliados não nasce mais com acesso permanente
---

A empresa criada pelo Back Office (`POST /backoffice/tenants`) nascia isenta da
assinatura, e o cliente usava o CRM de graça para sempre. Agora ela nasce em
teste, com o valor do plano mandado pelo Back Office (já com o desconto do
afiliado), e é cobrada pelo Asaas como quem se cadastra pela tela. Mudar o plano
pelo Back Office atualiza o valor enquanto a assinatura ainda não foi criada no
Asaas.

Empresas que já nasceram isentas continuam isentas: mudar isso é decisão de
quem opera, em **Admin › Organizações › Assinatura**.
