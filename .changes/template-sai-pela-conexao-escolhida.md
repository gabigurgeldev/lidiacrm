---
impacto: nada_mudou
secao: corrigido
titulo: Modelo aprovado não saía pela conexão oficial conectada na tela — só pela do arquivo de ambiente
---

Quem conecta a API Oficial **pela tela de Conexões** guarda o número e o token
no banco, cifrados. O envio de **texto** por esse canal sempre usou essa
credencial. O envio de **modelo aprovado**, não: ele lia duas variáveis de
ambiente que uma instalação conectada pela tela não tem.

O efeito era um pedido para um endereço sem número, com autorização vazia — a
plataforma recusava, e a mensagem de erro falava do template. O problema estava
na credencial.

E o sintoma enganava mais que o normal: **pelo mesmo número, texto ia e modelo não**.
Nada na tela ligava uma coisa à outra, porque os dois pareciam o mesmo canal.

Agora o modelo sai pela credencial **da conexão escolhida**, com o ambiente
apenas como reserva — exatamente a regra que o envio de texto já seguia. E
quando não há credencial nenhuma, o erro diz isso, com o caminho de volta
("reconecte o canal em Conexões"), em vez de deixar a plataforma responder algo
sobre o template.

Nada muda para quem opera o servidor: sem variável nova, sem passo de
atualização, sem mudança de banco. Quem já usava as variáveis de ambiente
continua funcionando igual.
