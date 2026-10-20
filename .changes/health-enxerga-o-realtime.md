---
impacto: capacidade_nova
secao: adicionado
titulo: O health e o vigia da VPS passam a enxergar o Realtime fora
---

`/api/v1/health` ganhou o check `realtime`, que sonda o Realtime do Supabase
pelo mesmo caminho do navegador (`/realtime/v1/api/ping`, via Kong). Antes, com o
Realtime fora, a rota respondia "healthy": o único check do Supabase passava por
outro serviço. Em 2026-10-20 isso deixou as telas sem atualização ao vivo por
horas, sem ninguém saber.

Quando o Realtime falha, o check e o status geral ficam `degraded`, e a rota
**segue respondendo 200**: o atendimento continua, as telas só deixam de
atualizar sozinhas. Monitor externo que trata `degraded` como alerta passa a
avisar nesse caso; quem olha só o código HTTP não percebe diferença.

O vigia da VPS (`scripts/vps/lidiacrm-watchdog.sh`) lê esse check pelo nome e
manda "Tempo real fora — telas não atualizam sozinhas" depois de 3 falhas
seguidas, e "Tempo real recuperado" na volta. Quem instalou o vigia reinstala o
arquivo (`install -m 755 scripts/vps/lidiacrm-watchdog.sh
/usr/local/sbin/lidiacrm-watchdog`) para ganhar o aviso; sem isso, nada quebra.
A causa conhecida e o conserto estão em `docs/runbooks/deploy.md`, seção
"Realtime fora".
