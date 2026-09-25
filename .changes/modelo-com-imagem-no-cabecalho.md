---
impacto: nada_mudou
secao: corrigido
titulo: Modelo com imagem no cabeçalho era recusado em toda mensagem pela instância oficial importada por chave de conta
---

O envio por modelo aprovado nessa conexão mandava o cabeçalho sempre como texto,
e a Meta recusava todo modelo com imagem no cabeçalho (`Format mismatch, expected
IMAGE`). Agora o envio monta a mensagem pela definição do modelo — lida do espelho
ou, se ele estiver vazio, da própria plataforma — e manda a imagem como imagem.

No **Novo disparo**, a lacuna de imagem do cabeçalho virou um botão
**Subir imagem**, em vez de um campo de texto. O link gerado vale 30 dias, para
durar a campanha inteira.
