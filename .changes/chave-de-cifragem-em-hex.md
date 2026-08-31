---
impacto: nada_mudou
secao: corrigido
titulo: Cadastrar a chave da IA falhava com "Erro interno" em instalações inteiras
---

Em algumas instalações, salvar a chave de um provedor de IA — OpenRouter,
Anthropic, OpenAI — respondia apenas "Erro interno. Tente de novo em instantes".
Tentar de novo nunca resolvia, porque nada ali dependia do momento.

A causa era o formato de uma variável do servidor, a `AI_CRED_AES_KEY`, que é a
chave com que o CRM cifra as credenciais antes de guardá-las. Ela era lida
somente como base64. Uma chave gerada em hexadecimal — que é o formato dos
outros segredos do produto, e o que boa parte dos geradores de ambiente produz —
passava pela leitura sem qualquer reclamação e virava um valor do tamanho
errado, silenciosamente. A cifragem então recusava, e a recusa acontecia antes
de qualquer gravação: nada aparecia no registro do aplicativo, nada no banco de
dados. Uma instalação podia ficar sem conseguir cadastrar IA para sempre, sem
uma única linha em lugar nenhum dizendo por quê.

Agora a chave é aceita nos dois formatos, hexadecimal e base64, exigindo 32
bytes em ambos. Nenhuma instalação que já funcionava muda de comportamento — o
caso que passou a ser aceito é exatamente o que já estava quebrado.

O erro mudo também foi consertado, porque ele foi o mais caro dos dois. Quando a
chave estiver mesmo inválida, a tela passa a dizer qual variável está errada e
o que ela precisa ser, em vez de mandar tentar de novo; e `/api/v1/health` ganhou
um item, `ai_encryption_key`, que denuncia o problema antes de alguém esbarrar
nele. Esse item nunca derruba a instalação: ele avisa, e o atendimento — que não
depende de cifrar chave de IA para nada — segue de pé.
