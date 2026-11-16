---
impacto: nada_mudou
secao: corrigido
titulo: O aviso "conversa ficou sem ninguém conduzindo" não se perde mais atrás de conversas já avisadas
---

Com o coordenador ligado, o sistema confere a cada poucos minutos se alguma
conversa ficou sem resposta e abre um aviso na Central. Essa conferência olhava
50 conversas por vez, sem ordem, e incluía conversas que já tinham aviso aberto
e conversas de números com o coordenador só em observação. Numa operação com
muitas conversas, a conversa realmente parada podia nunca entrar na conta, e o
aviso nunca aparecia.

Agora só entram as conversas que ainda precisam de aviso, de números com o
coordenador ativo, e as mais antigas primeiro.
