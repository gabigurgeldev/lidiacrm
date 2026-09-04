---
impacto: capacidade_nova
secao: alterado
titulo: Os fluxos deixaram de esperar o relógio para continuar
---

Um fluxo avançava por saltos de um minuto. Não porque os blocos fossem lentos —
eles rodam em frações de segundo — mas porque, toda vez que o fluxo precisava
ser retomado (depois de uma espera, depois de aguardar a resposta do cliente), o
motor esperava a próxima batida de um relógio que só batia uma vez por minuto.

Medido numa execução real: dois blocos seguidos levaram 0,9 e 0,1 segundos, e a
retomada seguinte levou **59,1 segundos**. Um fluxo com três esperas gastava
três minutos que não eram de ninguém.

Agora o motor roda continuamente dentro do processo de trabalho, verificando a
cada poucos segundos. A retomada caiu de até um minuto para cerca de dois
segundos. O relógio antigo continua ligado como rede de segurança: se o processo
de trabalho cair, os fluxos seguem andando de minuto em minuto em vez de parar.

**O tempo que você configura continua valendo exatamente.** Uma espera de cinco
minutos continua sendo cinco minutos — ela apenas recomeça dois segundos depois
de vencer, em vez de até um minuto depois.

E como o relógio deixou de ser o limite, o bloco "Esperar" passou a aceitar
**segundos**: o mínimo caiu de cinco minutos para dez segundos. O campo também
ganhou a unidade ao lado — segundos, minutos, horas ou dias — em vez de exigir
que tudo fosse convertido para minutos na cabeça (esperar três dias significava
digitar 4320, e um zero a mais fazia o fluxo dormir um mês).
