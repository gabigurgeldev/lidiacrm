# Runbook — ligar o agente de suporte (Astronauta AI) aos sistemas da Gestalt

O agente de suporte roda no tenant **GESTALT SUPORTE** desta instalação e usa
**Integrações via API** para consultar e corrigir a conta de quem chama no
WhatsApp. Cada sistema da Gestalt fala o **Contrato de Suporte v1**
(`docs/integracoes/contrato-de-suporte-v1.md`).

| Sistema | Onde mora o lado servidor | Estado |
|---|---|---|
| Gestalt CRM (esta instalação) | `app/suporte/v1/*` neste repo | implementado |
| Back Office | repo `PROJETOS GESTALT/BACKOFFICE` | a fazer |
| Votaris Hub | repo `PROJETOS GESTALT/VOTARIS/votarishub` | a fazer |
| SOT | repo `PROJETOS DE PARCERIA/SOT/SOT` | a fazer |
| FIMEI | repo `PROJETOS GESTALT/FIMEI/controle-financeiro` | a fazer |
| ZapTrace | repo `PROJETOS DE PARCERIA/ZAPTRACE/zaptrace` | a fazer |

## 1. Pré-requisitos na VPS

- **E-mail configurado** (`EMAIL_SMTP_*` ou `RESEND_API_KEY` + remetente). Sem
  ele não sai o código de verificação, e o agente não consegue provar o dono de
  conta nenhuma. A tela de Integrações avisa.
- **`AI_CRED_AES_KEY` válida** — guarda o segredo de cada integração.

## 2. Gestalt CRM como sistema consultado

1. Gere o segredo: `openssl rand -hex 32`.
2. No `.env` da VPS: `SUPORTE_V1_SECRET=<segredo>`. Reinicie **app** (com os
   dois arquivos de compose, ver `docs/runbooks/deploy.md`).
3. Prove de dentro do container **worker** que ele alcança o domínio público
   (o agente chama a própria instalação pelo endereço público; endereço interno
   é recusado pela guarda anti-SSRF):

   ```bash
   docker compose -f docker-compose.prod.yml exec worker node -e "fetch('https://gestaltcrm.com.br/suporte/v1/saude').then(r=>console.log(r.status))"
   ```

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
