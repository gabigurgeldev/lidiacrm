---
impacto: nada_mudou
secao: corrigido
titulo: O painel da plataforma volta a listar as organizações, a Inbox e os alertas do dashboard
---

Depois da atualização que trouxe o coordenador de atendimento, a tela
**Organizações** do painel da plataforma passou a mostrar "0 tenants —
Nenhum tenant encontrado", com as organizações todas lá. A consulta falhava, e
a tela tratava a falha como se a lista estivesse vazia.

O mesmo defeito atingia a **Inbox** da plataforma e dois alertas do
**Dashboard** (organizações com conversas acumuladas e números com suspeita de
banimento).

Agora:

- As três telas voltam a carregar.
- Se a lista de organizações não carregar por qualquer motivo, a tela diz que
  não carregou, mostra o motivo e oferece **Tentar de novo** — em vez de dizer
  que não há organização nenhuma.

Nada muda para quem opera o servidor: não há mudança de banco nem passo manual.
