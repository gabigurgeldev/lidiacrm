---
impacto: capacidade_nova
secao: adicionado
titulo: O painel da plataforma cria, edita, suspende e remove usuários, e mostra relatórios
---

Quem administra a instalação agora gerencia as contas pelo painel `/admin`:
criar usuário numa organização, editar nome e e-mail, trocar o papel, remover
de uma organização, suspender e reativar a conta, e excluí-la (com o e-mail
digitado como confirmação). O painel recusa suspender ou excluir a própria
conta, a última conta de administração da plataforma e o último administrador
de uma organização.

Nova tela **Relatórios de usuários** (`/admin/users/relatorios`): totais,
ativos, inativos, suspensos, quem nunca entrou, contas sem verificação em duas
etapas, distribuição por papel, organizações com mais pessoas, novas contas e
últimos acessos por dia, e exportação em CSV.

O app ganhou a porta para o painel — **Admin da plataforma** no rodapé da barra,
no menu da conta e na busca (⌘K) —, visível só para quem administra a
instalação. O painel passou a usar a mesma moldura visual do app.

Nada a fazer para atualizar: não há migration, variável de ambiente nem
arquivo a editar.
