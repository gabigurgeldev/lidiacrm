---
impacto: nada_mudou
secao: corrigido
titulo: A Proteção de envio não salvava nada enquanto a data de uso do número ficasse em branco
---

Em Conexões, o painel Proteção de envio respondia "Falha ao salvar knobs" em
qualquer número que ainda não tinha configuração própria — que é o estado de todo
número recém-conectado. A data em branco era gravada como vazia numa coluna que
não aceita vazio, e o erro derrubava o salvamento de todos os outros campos.

Agora data em branco quer dizer "não informei": o número é tratado como
recém-criado, como a tela já dizia, e os demais campos salvam normalmente.
