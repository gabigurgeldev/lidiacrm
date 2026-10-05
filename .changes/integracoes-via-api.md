---
impacto: capacidade_nova
secao: adicionado
titulo: O agente de IA passa a consultar os sistemas do seu negócio — e corrige com o SIM do cliente
---

Nova tela na Central de IA: **Integrações via API**. Você cadastra o endereço da
API de um sistema seu (loja, ERP, plataforma), a chave de acesso e os pontos que
o agente pode chamar. Na tela do agente, em "Sistemas que ele consulta", marca o
que ele pode usar.

A partir daí, no WhatsApp, o agente busca o dado de verdade antes de responder —
o status de um pedido, a situação de uma conta — em vez de dizer "vou verificar".

Duas travas que valem sempre:

- **Consulta a uma conta exige prova de dono.** O agente pede o e-mail da conta,
  o sistema manda um código de 6 dígitos para esse e-mail, e só depois que o
  cliente digita o código certo na conversa o agente enxerga aquela conta — e
  só ela. Código errado cinco vezes bloqueia e avisa na Central.
- **Correção só com SIM.** Quando o agente encontra algo que pode corrigir, ele
  manda ao cliente o texto que você escreveu e pede SIM. A correção roda uma
  vez, depois do SIM, e o resultado aparece na conversa e na linha do tempo do
  lead. Se falhar, a equipe é avisada e o agente transfere a conversa.

Sistemas que seguem o **Contrato de Suporte v1** (`docs/integracoes/contrato-de-suporte-v1.md`)
são ligados com um clique: o CRM importa o catálogo do que dá para ler e corrigir.

Para quem opera o servidor: sem variável nova obrigatória, e o banco é
atualizado pelo `update.sh` de sempre. A verificação por código usa o envio de
e-mail já configurado na instalação (SMTP ou Resend); sem ele, a tela avisa que
consultas a uma conta não vão funcionar.
