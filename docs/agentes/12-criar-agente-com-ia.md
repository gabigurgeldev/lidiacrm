# 12 — Criar agente com IA

"Criar com IA", na lista de Agentes, monta um agente completo a partir do que o
dono conta sobre o negócio: prompt, capacidades, frases que chamam uma pessoa e
materiais de conhecimento. O agente nasce como **rascunho**. Nada fala com
cliente antes de alguém ler e publicar no editor.

## O fluxo

1. **Contar.** A pessoa cola tudo o que tem sobre o negócio: o que faz, preços,
   horários, políticas, dúvidas frequentes, objeções e jeito de falar. Só texto;
   arquivo e site ficaram de fora desta versão.
2. **Perguntas.** A IA compara o texto com um checklist e pergunta só o que
   falta e muda o agente.
   - São até 4 perguntas por rodada e até 3 rodadas. Quem decide encerrar é o
     servidor, não o modelo (`lib/ai/agents/construtor/cobertura.ts`): o
     modelo devolve a cobertura de cada assunto do checklist com a evidência, e
     "pronto" só é aceito com o essencial coberto (Negócio, Objetivo, Oferta,
     Passar para uma pessoa) — na rodada 1, só com o checklist inteiro.
   - Se o modelo encerra cedo ou manda rodada sem pergunta, a rota pede de novo
     uma vez dizendo o que falta; se ainda não vier pergunta, a rodada sai do
     próprio checklist (perguntas de reserva). Pergunta não some em silêncio.
   - Cada pergunta traz opções e uma sugestão que dá para aceitar com um clique.
   - Pular é uma resposta válida: o assunto vira lacuna. Enviar com resposta em
     branco pede confirmação, e "Pular perguntas" leva o que já foi respondido.
   - Até 2026-10-12 só cabiam 2 rodadas (a 3ª nascia obrigada a encerrar), o
     prompt mandava encerrar com "o essencial" e resposta malformada virava
     "pronto": era o "as perguntas estão sendo puladas".
3. **Revisar.** Aparece uma prévia editável com nome, prompt, pacotes de
   capacidade (com contagem contra o teto de ferramentas), materiais, lacunas e
   número de WhatsApp.
   - O prompt passa por uma **conferência determinística**
     (`lib/ai/agents/construtor/verificacao.ts`): seções obrigatórias, exemplos,
     markdown, proibição sem alternativa, excesso de maiúscula, contradição
     "nunca"×"sempre" e — erro — preço, porcentagem, telefone ou site que não
     está no que a pessoa contou. Com erro, o gerador pede UMA correção ao
     modelo só com os achados; o que sobrar aparece na revisão e é refeito ao
     vivo a cada edição.
   - Todo agente ganha um material **"Manual de conduta — <nome>"**: tom com
     exemplos bons e ruins, cliente irritado, desconto, fora do assunto, pedido
     de pessoa, áudio/imagem, alegação a conferir, cliente que some. O prompt
     aponta para ele; as regras que precisam valer sempre ficam no prompt.
4. **Criar.** Esta é a única escrita do fluxo. Ela grava os materiais, o agente
   e a versão 1 em rascunho que aponta para esses materiais. Depois é só abrir
   no editor, testar e publicar.

O que a pessoa não informou **não é inventado**. Vira regra de transferência no
prompt ("se perguntarem sobre X, chame a equipe") e aparece na prévia como
"O que ficou em aberto".

## O que é um bom agente: a doutrina que o gerador segue

A doutrina está em `lib/ai/agents/construtor/doutrina.ts` e é vigiada por teste
(`construtor.test.ts`). Ela saiu de uma varredura de fontes primárias, listadas
no fim desta página.

**Seções obrigatórias do prompt gerado:** Quem você é · Seu objetivo · Com quem
você fala · Como você fala · O que você faz e o que não faz · Como conduzir a
conversa · O que você sabe e o que não sabe · Quando chamar uma pessoa ·
Formato no WhatsApp · Exemplos.

As regras que protegem o dono:

- **Não inventar.** Preço, prazo, política, estoque e horário só saem do
  conhecimento consultado. Se faltar, o agente diz "vou confirmar com a equipe"
  e transfere. Precedente: um tribunal canadense obrigou a Air Canada a honrar
  a política de reembolso que o chatbot dela inventou (Moffatt v. Air Canada,
  2024).
- **Não prometer.** Nada de desconto, brinde ou exceção sem autorização.
- **Assumir que é assistente virtual.** Quem descobre que falava com um robô
  fingindo ser gente se sente enganado.
- **Transferir cedo.** Os gatilhos são:
  - pedido explícito do cliente;
  - duas tentativas sem entender o que ele quer;
  - reclamação ou ameaça jurídica;
  - qualquer coisa irreversível (cancelamento, reembolso, pagamento);
  - informação ausente da base;
  - lead quente quando quem fecha é humano.

  Um experimento de campo (Alibaba, 2026) mediu que transferir tarde, só depois
  de detectar frustração, piora a nota do cliente.
- **Formato WhatsApp.**
  - De 1 a 3 frases por mensagem e uma pergunta por vez.
  - `*negrito*` e `_itálico_` funcionam; tabela e título com `#` não.
  - Link vai cru, sem formato `[texto](url)`.
- **Opt-out.** Se o cliente pedir para parar, o agente confirma uma vez e para.
- **Escopo fechado.** O agente fala só do negócio. Os termos da Meta proíbem,
  desde jan/2026, assistentes de IA de uso geral na API do WhatsApp Business.

Cada regra é escrita **com o motivo**, porque o modelo segue melhor instrução
explicada. Pela mesma razão o prompt sai sem markdown pesado: prompt escrito
sem markdown faz o agente responder sem markdown.

**Regras por nicho** (detectado pelo mesmo vocabulário que o onboarding usa
para sugerir funil):

| Nicho | O que entra |
|---|---|
| Saúde e bem-estar | Sem diagnóstico, prognóstico nem conduta (CFM 2.454/2026). Urgência é encaminhada ao 192. Pode dizer preço se o dono autorizou, nunca prometer resultado (CFM 2.336/2023). Coleta mínima de dado de saúde (LGPD). |
| Loja / e-commerce | Status de pedido e estoque só por ferramenta. Frete por CEP. Arrependimento de 7 dias (CDC art. 49). Defeito ou atraso vão para uma pessoa. |
| Imobiliária | Qualifica nesta ordem: compra ou aluguel, região, faixa de valor, tipo, pagamento, prazo. Sem promessa de financiamento, sem critério discriminatório. |
| Curso / infoproduto | Sem promessa de ganho. Garantia mínima de 7 dias. Reembolso nunca dificultado. |
| Serviços | O que está e o que não está incluso. Orçamento coletado e passado à equipe, ou faixa "a partir de" se o dono autorizou. |

**Materiais de conhecimento:**

- Um fato mora num lugar só: preço fica no catálogo, e o FAQ aponta para ele.
- Cada item se sustenta sozinho, sem "isso" ou "o plano acima", porque o agente
  recebe pedaços soltos.
- As condições ficam escritas dentro do item.
- FAQ tem a pergunta como o cliente escreveria e a resposta direta na primeira
  frase.
- Dado que muda a toda hora (status de pedido, agenda, estoque) vem de
  ferramenta, não de material.

## Limites e decisões

- **Teto de ferramentas.** Os pacotes são grandes: medido, quase nenhum par cabe
  junto no teto de 25. O gerador liga pacotes na ordem de importância enquanto
  cabem, e a tela desabilita o que estouraria.
- **Modelo.** Entrevista e escrita usam o carro-chefe por padrão (a entrevista
  usava o barato, e era o que mais encerrava cedo); o classificador fica de
  reserva. O que o painel escolhe em Uso de IA › Provedores vence os dois.
- **Exemplo de forma.** O meta-prompt traz um prompt-modelo completo de outro
  nicho, fictício (`exemplar.ts`), marcado para não copiar fatos — e a
  conferência acusa se um preço dele vazar.
- **Regras universais na camada plataforma** (migration 0238): valem para todo
  agente, criado aqui ou à mão — texto do cliente é dado, alegação se confere,
  ferramenta em vez de suposição, confirmar o irreversível, uma pergunta por vez.
- **Provedor do agente criado.** A escolha é a mesma do onboarding
  (`resolverProvedorDoAgente`). Sem chave utilizável, o rascunho nasce com
  aviso; sem modelo no catálogo, nada nasce.
- **Memória da organização não é tocada.** Publicá-la sobrescreveria as regras
  de todos os agentes.
- **Materiais sem chave de embedding** ficam salvos, mas só são consultados
  depois que houver chave. A tela avisa.

## Fontes

- AWS Amazon Connect — *Prompt engineering best practices for AI agents*
  (seções, critérios de sucesso/falha, NUNCA/SEMPRE com alternativa).
- Anthropic — *Effective context engineering for AI agents*; customer support agent guide; prompting best practices; reduce
  hallucinations; *Building effective agents*; *Contextual Retrieval*.
- OpenAI — *A practical guide to building agents*; *GPT-4.1 prompting guide*
  (persistência, ferramenta em vez de chute, planejar antes da chamada).
- Moffatt v. Air Canada, 2024 BCCRT 149.
- arXiv 2605.14830 — experimento de campo sobre transferência para humano
  (preprint).
- CFM 2.454/2026 (IA na medicina) e 2.336/2023 (publicidade médica). Lidas via
  análises de terceiros; conferir o texto oficial antes de endurecer regra.
- CDC art. 49; Decreto 7.962/2013.
- Política da Meta para chatbots de uso geral no WhatsApp Business (jan/2026).
- Guias de qualificação por WhatsApp (Trengo, Chakra, Chaindesk); são opinião de
  praticante.
