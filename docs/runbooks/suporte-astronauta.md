# Runbook — ligar o agente de suporte (Astronauta AI) aos sistemas da Gestalt

O agente de suporte roda no tenant **GESTALT SUPORTE** desta instalação e usa
**Integrações via API** para consultar e corrigir a conta de quem chama no
WhatsApp. Cada sistema da Gestalt fala o **Contrato de Suporte v1**
(`docs/integracoes/contrato-de-suporte-v1.md`).

| Sistema | Endereço base da integração | O que o agente faz | Onde o segredo vai |
|---|---|---|---|
| Gestalt CRM | `https://gestaltcrm.com.br/suporte/v1` | diagnóstico + `reconectar_canal`, `reindexar_material` | `.env` do `crm` na VPS (ver §2) |
| Back Office | `https://<domínio do Back Office>/suporte/v1` | só diagnóstico (afiliado/fornecedor: cadastro, Pix, saldos, saques, produtos) | `.env` do Back Office |
| Votaris Hub | `https://<PUBLIC_APP_URL>/suporte/v1` | só diagnóstico (módulos, domínio, WhatsApp, fila) | variáveis do Worker/Easypanel |
| SOT | `https://<PUBLIC_APP_URL>/suporte/v1` | só diagnóstico (assinatura, plano, módulo, membros, quadros) | variáveis do Worker/Easypanel |
| FinMEI | `https://<domínio do FinMEI>/suporte/v1` | só diagnóstico (assinatura, bloqueio, WhatsApp verificado) | variáveis da Vercel |
| Radar de Vendas (ZapTrace) | `https://<APP_URL>/api/suporte/v1` | só diagnóstico (números, última mensagem, última análise) | `.env` do Radar |

Todos implementados e na `main` de cada repositório (2026-10-05). Só o CRM tem correção: nos
outros, tudo que daria para "consertar" é dinheiro, acesso ou ler QR Code — decisão de pessoa.
Um segredo **diferente por sistema** (`openssl rand -hex 32`): o mesmo valor vai no sistema
(`SUPORTE_V1_SECRET`) e na integração do tenant GESTALT SUPORTE. Sem o segredo, o sistema
responde 503 e nada fica exposto.

## 1. Pré-requisitos na VPS

- **E-mail configurado** (`EMAIL_SMTP_*` ou `RESEND_API_KEY` + remetente). Sem
  ele não sai o código de verificação, e o agente não consegue provar o dono de
  conta nenhuma. A tela de Integrações avisa.
- **`AI_CRED_AES_KEY` válida** — guarda o segredo de cada integração.

## 2. Gestalt CRM como sistema consultado

1. Gere o segredo: `openssl rand -hex 32`.
2. No `.env` do `crm` **no disco da VPS**: `SUPORTE_V1_SECRET=<segredo>`. Na instalação
   EasyPanel da Gestalt o arquivo é `/etc/easypanel/projects/lidiacrm/crm/code/deploy/easypanel/.env`
   — "Implantar" no painel **não** regrava esse arquivo, então variável salva só no painel
   pode nunca chegar ao contêiner. Recrie app e worker a partir desse diretório:

   ```bash
   docker compose -p lidiacrm_crm --project-directory . -f docker-compose.yml -f docker-compose.override.yml up -d --no-deps app worker
   ```

   Confira: `curl -s -o /dev/null -w '%{http_code}' https://gestaltcrm.com.br/suporte/v1/saude`
   responde `401` (segredo configurado, assinatura ausente). `503` = o segredo não chegou.
3. Prove de dentro do container **worker** que ele alcança o domínio público
   (o agente chama a própria instalação pelo endereço público; endereço interno
   é recusado pela guarda anti-SSRF):

   Do MESMO diretório do passo 2 e com o MESMO projeto e arquivos de compose — na
   instalação EasyPanel o projeto é `lidiacrm_crm` e o compose é o `docker-compose.yml`
   dali, não o `docker-compose.prod.yml` do repositório (com ele o `exec` não acha o
   serviço):

   ```bash
   docker compose -p lidiacrm_crm --project-directory . -f docker-compose.yml -f docker-compose.override.yml exec worker node -e "fetch('https://gestaltcrm.com.br/suporte/v1/saude').then(r=>console.log(r.status))"
   ```

   Numa instalação pelo kit (sem painel), o equivalente é
   `docker compose -f docker-compose.prod.yml --env-file .env exec worker node -e "…"`.

   Esperado: `401` (chegou e recusou a assinatura). `fetch failed` = hairpin
   NAT bloqueado — resolver antes de seguir.

## 3. Ligar no tenant GESTALT SUPORTE

1. Central de IA › Integrações via API › **Nova integração**:
   - Nome: `Gestalt CRM`
   - Tipo: **Contrato de Suporte v1**
   - Endereço: `https://gestaltcrm.com.br/suporte/v1`
   - Chave: o mesmo `SUPORTE_V1_SECRET`
2. **Testar conexão** → "Conectado a Gestalt CRM (contrato v1)".
3. **Importar catálogo** → cria `buscar_conta`, `diagnostico`,
   `reconectar_canal`, `reindexar_material`.
4. Central de IA › Agentes › **Astronauta AI** › "Sistemas que ele consulta":
   marque Diagnóstico e as correções. Publique a versão.
5. No prompt do Astronauta, acrescente (texto sugerido):

   > Quando o cliente relatar problema na conta dele em algum sistema da
   > Gestalt: pergunte o e-mail da conta e use verificar_identidade. Depois que
   > a conta estiver verificada, use consultar_sistema com o diagnóstico antes
   > de responder. Se o diagnóstico sugerir uma correção, explique e use
   > propor_acao — nunca diga que corrigiu antes de receber o resultado. Se não
   > resolver, ou se o cliente não conseguir verificar, transfira para a equipe.

## 3b. Os outros cinco sistemas

Para cada linha da tabela do topo: gere um segredo, ponha `SUPORTE_V1_SECRET` no
sistema, publique/reinicie, confira que `<endereço base>/saude` sem assinatura responde
`401`, e repita o §3 com o nome e o endereço base daquele sistema. Os cinco não têm
correção, então o "Importar catálogo" cria só `buscar_conta` e `diagnostico` — marque o
diagnóstico de cada um no Astronauta.

O mesmo e-mail pode ter conta em mais de um sistema: a verificação é UMA por conversa e
busca em todos; se um sistema achar mais de uma conta, o agente pergunta qual.

## 4. Prova de ponta a ponta (obrigatória a cada sistema ligado)

Com uma conta de teste do dono, pelo WhatsApp do suporte:

1. "Deu erro na minha conta" → o agente pede o e-mail.
2. O código chega no e-mail, citando o final do número do WhatsApp.
3. Digitar o código → o agente confirma e lê o diagnóstico.
4. Parar o canal de teste → o diagnóstico sugere `reconectar_canal` → o agente
   pede SIM → responder SIM → o canal reinicia, o resultado aparece na conversa,
   na linha do tempo do lead (`api_acao_executada`) e na auditoria
   (`suporte.acao_executada` no tenant consultado).
5. Errar o código 5 vezes → bloqueia, e aparece "Alguém errou o código de
   verificação…" na Central.
6. Informar o e-mail de outra pessoa → resposta igual, mas nada é consultado.
7. Responder SIM depois de 15 minutos → nada é executado.

## 5. Quando falhar

- **"A integração está falhando"** na Central: 5 chamadas seguidas falharam e o
  agente pausou a integração por 10 min (ele transfere quem precisar). Abra a
  integração › Testar conexão.
- **"O cliente confirmou uma correção e ela não foi aplicada"**: a equipe
  termina à mão; a aba Atividade da integração mostra o erro.
- **401 `signature_invalid`** no teste: segredo diferente entre os dois lados, ou
  relógio da VPS fora (tolerância de 5 minutos).
