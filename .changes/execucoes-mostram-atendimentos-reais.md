---
impacto: capacidade_nova
secao: corrigido
titulo: A aba Execuções do agente mostra os atendimentos de verdade
---

A aba **Execuções** de cada agente ficava vazia mesmo com o agente
respondendo clientes todos os dias: ela lia um registro que só o atendimento
antigo preenchia.

Agora cada atendimento em que o agente fala com o cliente aparece ali, com:

- o desfecho em português: respondeu, passou para uma pessoa, adiado por estar
  fora do horário, ficou sem resposta, ou cortado pelo limite por atendimento;
- quanto a IA custou e quantos tokens usou, somando todas as chamadas daquele
  atendimento (não só a resposta);
- quanto tempo levou, e as ferramentas que o agente usou, passo a passo;
- o link para a conversa.

Atendimentos sem agente publicado (o agente padrão do sistema) e testes feitos
pelo botão **Testar** não entram na lista.

Não há mudança de banco nem passo manual. Cada atendimento registrado também
gera uma linha no registro de auditoria, como toda gravação nesta tabela.
