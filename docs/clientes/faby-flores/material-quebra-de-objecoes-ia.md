# Faby AI — Material de apoio para quebrar objeções

> Feito em 04/11/2026 a partir de [`objecoes-dos-clientes.md`](objecoes-dos-clientes.md).
> **Publicado em produção em 04/11/2026, às 13:08 UTC:**
> - material "Quebra de objeções" no acervo, indexado com 19 trechos;
> - Faby AI **v9** = prompt da v8 + bloco A, com acervo da v8 + o material novo.
>
> Rollback: republicar a v8.

O material tem duas partes, porque a IA usa as duas de jeitos diferentes:

| Parte | Onde entra | Quando a IA usa |
|---|---|---|
| **A. Regra curta no prompt** (abaixo) | Prompt do agente, numa versão nova (v9) | Sempre: diz *como* reagir a qualquer objeção |
| **B. Respostas por objeção** | Arquivo [`acervo-quebra-de-objecoes.faq.md`](acervo-quebra-de-objecoes.faq.md), cadastrado como material do tipo **Perguntas frequentes** no acervo | Quando a fala do cliente parece com uma das 19 objeções do arquivo: a busca de conhecimento traz a resposta certa |

Todas as respostas seguem as regras da v8:

- sem desconto ou brinde;
- sem lista de preços e sem valor logo de cara;
- nunca valor de planta ou paisagismo;
- uma mensagem curta por vez, com no máximo uma pergunta;
- passar cedo para a equipe quando o cliente estiver irritado ou quando algo só a equipe pode decidir.

---

## A. Bloco para o prompt (v9)

Entra logo depois da seção "O que você faz e o que não faz" do prompt atual, sem mudar o resto:

```text
Quando o cliente hesitar (objeções):
- Objeção é pedido de ajuda, não um "não". Exemplos: achou caro, quer algo mais simples, pediu foto, a flor que quer não aparece, quer para hoje, a loja está fechada, quer desconto, vai pensar, perguntou se é natural.
- Antes de responder, consulte a busca de conhecimento: o material "Quebra de objeções" diz como agir em cada caso.
- Responda em três tempos, numa mensagem só: reconheça em poucas palavras, ofereça UMA alternativa concreta (outro item, outra quantidade, retirada, agendar) e faça UMA pergunta que leve ao próximo passo.
- Nunca deixe a resposta sem próximo passo: nada de "Sim", "Não", "Não temos" ou um valor solto.
- Nunca diga que a loja não tem um produto só porque ele não está no acervo. Diga que a atendente confirma e já sugira uma alternativa.
- Pediu foto: envie a foto do acervo se houver; se não houver, passe para a atendente na hora com o motivo "PEDIU FOTO". Não mande o cliente escolher na enquete no lugar da foto.
- Desconto, condição especial, montar sob medida, link de pagamento, vale-alimentação e feriado: a decisão é da equipe. Responda com simpatia e passe se o cliente insistir.
- Não repita uma pergunta que o cliente já respondeu. Se ele disse "tanto faz, me mostra opções", recomende você mesma duas opções.
```

**Por que cada linha existe** (achados do levantamento):

- **"Três tempos numa mensagem só".** A equipe vende quando junta alternativa e pergunta. Perde quando manda número solto, tabela colada ou "Sim".
- **"Nunca diga que não tem".** A IA disse que não havia girassol nem rosa avulsa, e a loja vende os dois.
- **"Pediu foto".** É a objeção mais repetida. A IA respondia "não consigo enviar fotos", e o cliente ia embora.
- **"Não repita a pergunta".** A IA perguntou a ocasião 2 a 3 vezes e mandou "escolha a faixa acima" para quem já tinha dito "tanto faz, me mostra opções".

---

## B. Respostas por objeção (acervo)

O arquivo [`acervo-quebra-de-objecoes.faq.md`](acervo-quebra-de-objecoes.faq.md) já está no formato que o acervo lê (`## Pergunta:` / `## Resposta:`). São 19 objeções no arquivo; a 20ª fica no bloco do prompt:

| # | Objeção | O que a IA faz |
|---|---|---|
| 1 | Tem foto? Manda os modelos | Envia a foto do acervo, ou passa para a atendente na hora |
| 2 | Tem algo mais em conta / orçamento baixo | Menor item que sirva; se ficar abaixo da tabela, rosa avulsa ou flor com chocolate pela atendente |
| 3 | Achei caro / salgado | Acolhe e oferece UMA alternativa mais leve, com o valor só dela |
| 4 | Achei simples / é pequeno / fica cheio? | Diz quantas rosas tem e oferece o próximo degrau |
| 5 | Tem desconto? | "Esse valor já é o nosso melhor" e segue para o fechamento |
| 6 | Tem girassol / lírio / cor X? | Não nega: a atendente confirma, e a IA já sugere uma alternativa |
| 7 | Entrega hoje? Que horas? | Pronta entrega / 40 min; pergunta horário e bairro |
| 8 | Está aberto? Domingo? Feriado? | Informa o horário; nunca afirma feriado; oferece anotar o pedido |
| 9 | Inclui entrega? Cobra taxa? | R$ 12 na cidade + pergunta o bairro + opção de retirar |
| 10 | Vou pensar / ver com alguém | Resume o combinado, sem pressão |
| 11 | É natural? É importada? É foto de IA? | Resposta curta e honesta |
| 12 | Crédito, link, Alelo, quando pagar | Formas aceitas; link e vale ficam com a atendente |
| 13 | "?" / "Tem alguém aí?" | Pede desculpas, responde na hora, diz quando a equipe volta |
| 14 | Quero falar com uma pessoa | Passa imediatamente |
| 15 | Murcha até a noite? | Não inventa durabilidade; sugere entrega mais perto do horário |
| 16 | Frase no cartão / chocolate junto | Sim + valores dos cartões |
| 17 | Concorrente fez mais barato | Não baixa preço; reforça o diferencial; passa se insistir |
| 18 | Estou em outra cidade / entrega surpresa | Tudo pelo WhatsApp com Pix; atendente combina o local |
| 19 | Encomenda para data futura | Agenda e segue o roteiro |
| 20 | (coberta no prompt) repetição de pergunta / "tanto faz" | Recomenda duas opções sem perguntar de novo |

---

## C. O que o material NÃO resolve sozinho (depende da loja)

1. **Fotos no acervo.** O CRM já permite que a Faby AI envie fotos do acervo, mas a Faby Flores não tem nenhuma cadastrada. Enquanto não houver fotos, a objeção nº 1 só se resolve passando para a atendente, e ela precisa responder. **É o item de maior impacto.**
2. **Produtos que a loja vende e a IA não conhece:** girassol, lírio, gipsofila, margarida, rosa decorada com saquinho, chocolates avulsos, kits, cestas, grama por metro. Com eles no material "Produtos e serviços", a IA para de mandar "a atendente confirma" para tudo.
3. **Decisões a tomar:**
   - aceita link de pagamento?
   - aceita Alelo ou vale?
   - abre domingo ou feriado?
   - até que horas sai a última entrega?

   A equipe hoje dá respostas diferentes. Com a resposta da loja, as entradas 8 e 12 podem afirmar em vez de passar.
4. **Contradição no acervo atual:** o FAQ "Quanto custa paisagismo" diz "a partir de R$ 150", e o prompt proíbe citar valor de paisagismo. Sugestão: tirar o valor do FAQ.
5. **Equipe respondendo depois do repasse.** Quando a IA passa o cliente e ninguém responde, a venda morre. Isso aconteceu inclusive com cliente pronto para pagar.

---

## D. Como colocar em produção (quando aprovado)

1. **Acervo:** cadastrar `acervo-quebra-de-objecoes.faq.md` como material "Perguntas frequentes" com o nome **"Quebra de objeções"**, pela tela de Conhecimento ou pela rota `POST /api/v1/ai/knowledge/sources` com `source_type: "faq"` e `markdown_blob`.
2. **Agente:** criar a versão v9 a partir da v8: prompt da v8 + o bloco A, e `knowledge_source_ids` da v8 + o id do material novo.
3. **Simular antes de publicar:** v8 × v9 com 10 falas reais do levantamento ("Achei simples", "Tem fts??", "Até R$ 100, é para criança", "Tem girassol?", "Tem desconto no Pix?", "Está aberto hoje?", "Vou ver com meu namorado"…).
4. **Publicar** a v9. Rollback = republicar a v8.
