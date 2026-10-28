---
impacto: nada_mudou
secao: corrigido
titulo: Usuários logados não são mais "deslogados", e Kanban grande volta a abrir
---

**Deslogamento ao longo do dia.** Quando o token de acesso vencia (a cada
hora), o servidor renovava a sessão, mas o cookie novo só seguia para o
navegador — a rota da API que vinha logo depois recebia o cookie vencido,
renovava de novo com dois clientes ao mesmo tempo, e a biblioteca de
autenticação descartava uma das renovações. O resultado era 401 para quem
estava logado: telas que não carregavam e "sessão expirada" sem motivo. Agora
a rota recebe o token que acabou de ser emitido, e uma renovação descartada
por corrida é lida de novo em vez de virar "sem sessão".

**"Não consegui carregar este Kanban: URI too long".** Quadros com algumas
centenas de negócios não abriam: os ids iam todos numa URL só e o gateway do
Supabase recusava. As consultas agora vão em lotes de 100. O mesmo defeito
atingia o radar de risco (que saía sem nome de contato e sem "follow-up em
voo") e a poda do arquivo de webhooks, que falhava a cada rodada sem esvaziar
nada — e por isso deixava o banco crescer.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco.
