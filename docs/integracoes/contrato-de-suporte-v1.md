# Contrato de Suporte v1

Como um sistema se deixa consultar — e corrigir — pelo agente de suporte do CRM
(Central de IA › Integrações via API, tipo **Contrato de Suporte v1**).

O agente fala com o cliente no WhatsApp. Quando o cliente diz "deu erro na minha
conta", o agente:

1. pede o e-mail da conta e chama `POST /identidade/buscar` em cada sistema;
2. **o CRM** (não o sistema) gera um código de 6 dígitos e manda para esse e-mail;
3. o cliente digita o código na conversa — o CRM confere antes do modelo rodar;
4. o agente lê `GET /contas/{id}/diagnostico` daquela conta, e só daquela;
5. se houver correção no catálogo, ele propõe; o cliente lê o texto de
   confirmação e responde SIM; só então o CRM chama
   `POST /contas/{id}/acoes/{acao}`, uma vez;
6. se nada resolver, transfere para um atendente.

O `{id}` da conta **nunca** é escolhido pelo modelo: é o `subject_id` que o
próprio sistema devolveu no passo 1 para o e-mail que o cliente provou ter.

Fonte única no código: `lib/suporte/contrato.ts` (assinatura, conferência e as
formas das respostas, em Zod). A implementação deste CRM como sistema consultado
mora em `app/suporte/v1/*`.

## Autenticação

Toda requisição leva:

| Cabeçalho | Valor |
|---|---|
| `X-Suporte-Timestamp` | segundos Unix; fora de ±300 s é recusado |
| `X-Suporte-Signature` | `sha256=` + HMAC-SHA256 hex do texto abaixo, com o segredo compartilhado |
| `X-Suporte-Request-Id` | uuid, para correlacionar com a auditoria |
| `X-Suporte-Email-Verificado` | o e-mail que o cliente provou — obrigatório em `/contas/*` |
| `Idempotency-Key` | id da ação no CRM — obrigatório em `/acoes/*` (24 h) |

Texto assinado:

```
{timestamp}.{MÉTODO}.{caminho com query}.{corpo cru}
```

**Método e caminho entram na assinatura de propósito.** Assinar só
`{timestamp}.{corpo}` (como o Back Office) faria uma assinatura de GET — corpo
vazio — valer para qualquer outro GET na janela de 5 minutos: o diagnóstico da
conta A viraria o da conta B.

Compare em tempo constante (`crypto.timingSafeEqual`).

### Vetor de teste

Copie este caso para o teste do seu sistema. Se a sua assinatura não bater,
você não fala o contrato.

```
segredo:          segredo-de-teste
timestamp:        1760000000
método:           POST
caminho+query:    /suporte/v1/contas/org-123/acoes/reconectar_canal
corpo:            {"canal":"1"}
texto assinado:   1760000000.POST./suporte/v1/contas/org-123/acoes/reconectar_canal.{"canal":"1"}
X-Suporte-Signature: sha256=08571e48e073516b414bf0f198fb206c4c217ba433ecdea5b1b6720e1b75f32a
```

O mesmo vetor está em `lib/suporte/contrato.test.ts`.

## Endpoints

Base: `{origem}/suporte/v1`. JSON, sem envelope `{data}`.

### `GET /saude`

```json
{ "ok": true, "sistema": "Nome do Sistema", "versao_contrato": "1" }
```

### `GET /catalogo`

O que o agente pode ler e corrigir. O CRM importa isto e cria os endpoints
sozinho.

```json
{
  "sistema": "Nome do Sistema",
  "leituras": [
    {
      "slug": "assinatura",
      "titulo": "Assinatura da conta",
      "descricao": "Plano, vencimento e situação do pagamento.",
      "metodo": "GET",
      "caminho": "/contas/{{conta.id}}/assinatura",
      "parametros": [],
      "campos_da_resposta": ["plano", "vence_em", "situacao"]
    }
  ],
  "acoes": [
    {
      "slug": "reconectar_canal",
      "titulo": "Reconectar o WhatsApp",
      "descricao": "Reinicia a sessão do número sem desconectar o celular.",
      "parametros": [
        { "nome": "canal", "tipo": "string", "obrigatorio": true, "descricao": "número do canal no diagnóstico", "onde": "body" }
      ],
      "confirmacao": "Posso reconectar o canal {{params.canal}}? Ele fica fora por uns segundos."
    }
  ]
}
```

`diagnostico` e `buscar_conta` são fixos do contrato e não precisam estar no
catálogo. Ações são sempre `POST /contas/{{conta.id}}/acoes/{slug}`.

Parâmetro: `nome` (minúsculas, `_`), `tipo` (`string` · `integer` · `number` ·
`boolean` · `enum` com `valores`), `obrigatorio`, `descricao` (o agente lê),
`onde` (`path` · `query` · `body`). Os nomes `conta`, `contato`, `params` e
`sessao` são reservados.

### `POST /identidade/buscar`

```json
{ "email": "dono@loja.com" }
```

```json
{ "contas": [ { "subject_id": "abc-123", "nome": "Loja do Dono", "papel": "admin" } ] }
```

Lista vazia quando não há conta — **nunca 404**, nunca uma mensagem diferente.
Devolva só contas em que o e-mail tem poder de administrar (dono, admin).

### `GET /contas/{id}/diagnostico`

```json
{
  "conta": { "nome": "Loja do Dono", "status": "ativa", "plano": "pro" },
  "verificacoes": [
    {
      "id": "whatsapp_1",
      "area": "whatsapp",
      "status": "problema",
      "titulo": "O WhatsApp do número final 7777 está desconectado",
      "detalhe": "Desde ontem às 18h. Mensagens recebidas nesse período não entraram.",
      "acao_sugerida": { "acao": "reconectar_canal", "params": { "canal": "1" } }
    }
  ],
  "gerado_em": "2026-10-05T12:00:00Z"
}
```

`status`: `ok` · `atencao` · `problema`. Escreva `titulo` e `detalhe` em
português, prontos para o agente repetir ao cliente.

### `GET /contas/{id}/<leitura>`

Leituras específicas declaradas no catálogo.

### `POST /contas/{id}/acoes/{acao}`

```json
{ "canal": "1" }
```

```json
{ "ok": true, "resultado": "Canal reconectado. Já está recebendo mensagens." }
```

ou

```json
{ "ok": false, "erro": { "codigo": "acao_nao_aplicavel", "mensagem": "O canal já está conectado." } }
```

## Regras do lado do sistema

- **Confira de novo a posse.** Em todo `/contas/{id}`, o e-mail de
  `X-Suporte-Email-Verificado` tem de pertencer àquela conta. É a segunda
  barreira: um defeito no CRM não alcança a conta de outra pessoa.
- **Idempotência.** A mesma `Idempotency-Key` em 24 h devolve o primeiro
  resultado, sem executar de novo.
- **Respostas** até 64 KB, sem segredo, sem stack trace; telefone e e-mail
  mascarados.
- **Audite** toda chamada com o `X-Suporte-Request-Id`.
- **Ações** só as reversíveis ou inofensivas. Nada de reenviar mensagem, mexer
  em cobrança ou em credencial pelo agente.

| Situação | Status | `codigo` |
|---|---|---|
| assinatura ausente, inválida ou expirada | 401 | `signature_invalid` |
| e-mail não pertence à conta | 403 | `email_nao_pertence_a_conta` |
| conta não existe | 404 | `conta_nao_encontrada` |
| parâmetros inválidos | 422 | `params_invalidos` |
| ação não se aplica agora | 409 | `acao_nao_aplicavel` |
| segredo não configurado no sistema | 503 | `not_configured` |

## Como ligar um sistema ao agente

1. Gere um segredo forte (`openssl rand -hex 32`) e configure-o no sistema.
2. No CRM: Central de IA › Integrações via API › Nova integração, tipo
   **Contrato de Suporte v1**, endereço `https://seu-sistema/suporte/v1`, cole o
   segredo.
3. "Testar conexão" deve dizer o nome do sistema. Depois, "Importar catálogo".
4. Na tela do agente, em "Sistemas que ele consulta", marque o diagnóstico e as
   correções. Publique a versão.
