---
impacto: nada_mudou
secao: corrigido
titulo: O efeito de vidro do cabeçalho e dos cartões voltou a funcionar
---

O desfoque das superfícies de vidro do produto — o cabeçalho, os cartões
agrupados das Conexões e o fundo do menu lateral no celular — não estava
acontecendo na versão publicada. As superfícies continuavam translúcidas, mas o
que passava por trás aparecia nítido em vez de desfocado.

A causa era uma ordem de declaração no arquivo de estilos combinada com uma
mudança recente dos navegadores: o Chrome deixou de aceitar a forma antiga da
propriedade de desfoque, e a forma moderna estava sendo descartada na hora de
compactar o CSS. Corrigido invertendo a ordem das duas.

Não havia sintoma de erro em lugar nenhum: nada nos logs, nada no console, e a
tela continuava utilizável — só sem o efeito. Passou a ser verificado
automaticamente a cada rodada de testes das telas de acesso, então não volta em
silêncio.

**Nada muda para quem opera o servidor.**
