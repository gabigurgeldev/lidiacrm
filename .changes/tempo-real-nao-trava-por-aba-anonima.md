---
impacto: nada_mudou
secao: corrigido
titulo: Uma aba sem sessão no tempo real não trava mais o CRM de todos
---

Quando a busca do token do tempo real falhava (por exemplo, com o servidor
lento), a aba seguia conectada como **anônima**. Isso tinha dois efeitos:

- o tempo real parava para **todas as organizações** da instalação enquanto
  essa aba estivesse aberta, porque o banco recusava a leitura anônima com erro
  em vez de devolver vazio;
- a própria aba entrava em laço de reconectar e reler o inbox inteiro cerca de
  uma vez por segundo, o que bastava para saturar uma VPS de 2 vCPU e deixar
  todas as telas lentas.

Agora a leitura anônima das tabelas do tempo real devolve vazio sem erro, a aba
mantém o token que já tinha quando a renovação falha e não assina sem token. A
reconexão de um canal que oscila espera cada vez mais (até 30 s) em vez de
voltar a 1 s a cada tentativa.

Nada muda para quem opera o servidor: a atualização aplica a mudança de banco
sozinha, sem variável nova e sem passo manual.
