---
impacto: capacidade_nova
secao: corrigido
titulo: O link para o cliente conectar o WhatsApp agora abre de verdade
---

O link gerado no botão "QR code" de uma conexão saía como
`https://placeholder.invalid/pair/...` — um endereço que não existe. A tela
mostrava o link com ar de pronto e o botão Copiar copiava, mas quem recebesse
abriria o nada. Com isso, o método de conectar o WhatsApp pelo celular do
cliente não funcionava.

A causa: o endereço da instalação é fixado quando a imagem é construída, e a
imagem que todo mundo baixa é construída sem saber qual será o seu domínio. O
link agora usa o endereço por onde você está acessando o CRM, que é sempre o
certo. Se você definiu `NEXT_PUBLIC_APP_URL` no `.env`, ele continua sendo
respeitado — a única exceção é quando ele está no valor de fábrica, que também
não serve para um link que vai para o celular de outra pessoa.

Nada a fazer: gere um link novo e ele já sai abrível.
