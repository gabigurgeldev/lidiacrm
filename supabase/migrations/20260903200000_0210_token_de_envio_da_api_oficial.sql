-- 0210 — o token de ENVIO da API Oficial do intermediário de conta.
--
-- Por que uma coluna a mais, e não a que já existe:
--
-- `stevo_token_encrypted` guarda a chave da CONTA (`stevo_sk_…`), que fala com
-- `openapi.stevo.chat` — lista instâncias, aponta webhook, e envia POR PROXY.
-- Para uma instância por QR o proxy envia; para uma instância da API Oficial ele
-- responde `409 not_ready` ("sem token — conecte primeiro"), porque a Oficial
-- não tem servidor de instância: ela fala com a Meta por um GATEWAY separado
-- (`apimeta.shurima.cloud`), com Bearer de OUTRO token, exibido na instância.
--
-- Medido em produção: `GET /v1/instances/{id}` devolve `token: null` e
-- `server_url: null` para TODA instância `is_official_api: true`, enquanto as
-- SM v2 devolvem os dois preenchidos. O token da Oficial não é descobrível pela
-- API de conta — só o operador o vê no painel. Por isso ele é COLADO, e por isso
-- precisa de lugar próprio: sobrescrever a chave da conta com ele quebraria a
-- listagem, o reaponte de webhook e o envio por QR de uma vez.
--
-- Cifrada em repouso pelas mesmas RPCs do resto do repo (`fn_encrypt_oauth` /
-- `fn_decrypt_oauth`), como as demais credenciais desta tabela.

alter table public.channel_sessions
  add column if not exists stevo_official_token_encrypted bytea;

comment on column public.channel_sessions.stevo_official_token_encrypted is
  'Token de envio da API Oficial (Bearer do gateway apimeta), cifrado. Distinto de stevo_token_encrypted, que é a chave da conta usada no proxy/gestão. Null = esta instância não envia pelo gateway.';
