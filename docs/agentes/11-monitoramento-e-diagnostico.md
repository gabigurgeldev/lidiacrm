# 11 — Monitoramento e diagnóstico

Onde olhar para saber se os agentes estão trabalhando, quanto custam, o que aprenderam — e o que fazer quando algo não acontece.

---

## 1. As telas de acompanhamento

| Tela | Caminho | Para que |
|---|---|---|
| **Central de avisos** | IA › **Alertas** (`/app/ai/inbox`) | Tudo que precisa de decisão humana. Cada aviso diz "O que aconteceu" e "O que fazer". **Marcar resolvido** move para "Resolvidos". |
| **Execuções de IA** | IA › Execuções (`/app/ai/runs`) | Cada chamada de IA, taxa de falha ("N a cada 100 execuções falharam"), filtro **Ver só as falhas**, mensagem técnica do provedor. |
| **Execuções do agente** | Editor do agente › aba Execuções | Turno a turno, com o rastro detalhado (cada passo e ferramenta). |
| **Capacidades do agente** | Editor › aba Capacidades | Quantas vezes cada capacidade foi usada. |
| **Uso e orçamento** | IA › Uso e orçamento (`/app/ai/usage`) | Custo por período/filtro e o **Orçamento mensal de IA** ([08 §5](08-seguranca-guardrails-anti-ban.md)). |
| **Evolução** | IA › Evolução (`/app/ai/evolution`) | "O que seu agente aprendeu": linha do tempo do aprendizado, regras que você ensinou, melhorias aprovadas, habilidades mais usadas, assuntos mais procurados, conversas encaminhadas, casos que precisaram de uma pessoa, negócios fechados/perdidos pelo agente, custo no período. |
| **Propostas** | IA › Propostas (`/app/ai/proposals`) e aba do agente | Melhorias sugeridas a partir de bons atendimentos (avaliador + destilador). "Aguardando decisão" / "Já decididas". Aprovar vira versão nova do agente ou regra na memória — você revisa e publica. |
| **Casos** | IA › Casos | Pedidos de ajuda do agente ([07](07-handoff-chamados-e-roteamento-humano.md)). |
| **Fila de follow-up** | IA › Follow-ups › Fila | Inscrições e retornos agendados ([05](05-follow-ups.md)). |
| **Execuções de fluxos** | Fluxos › Execuções | Passo a passo e erros dos fluxos ([06](06-fluxos-e-automacoes.md)). |
| **Atividade das regras** | Webhooks › Atividade | Resultado de cada ação, reenviar. |
| **Linha do tempo do cliente** | Ficha do contato / negócio | Mudanças de checkpoint, atividades do agente (com autoria), vetos de conferência, passagens para humano. |

---

## 2. Catálogo de avisos da Central

| Aviso (como aparece) | Normalmente significa | O que fazer |
|---|---|---|
| Conexão do WhatsApp caiu — precisa escanear o QR de novo | Sessão WAHA desconectada | Conexões › reconectar |
| Seu número de WhatsApp precisa de atenção | Saúde do número (qualidade, limite) | Ver o número em Conexões |
| Um modelo de mensagem mudou de situação na revisão | Template aprovado/rejeitado pela Meta | Ajustar o modelo |
| Uma tarefa do assistente falhou e parou de tentar | Job esgotou tentativas (ex.: sem modelo configurado, credencial inválida) | Ver Execuções; corrigir credencial/modelo |
| Um evento recebido não pôde ser processado | Evento morto no barramento | Ver detalhes; geralmente dado inconsistente |
| Uma resposta ficou presa e não chegou ao cliente | Mensagem em "enviando" há mais de 5 min | Conferir conexão; reenviar manualmente se preciso |
| Um atendimento saiu sem as ferramentas que você ligou | Falha ao montar as capacidades no turno | Ver o motivo no corpo; revalidar credencial/token |
| O agente não conseguiu ler uma foto ou áudio que o cliente enviou | Transcrição/visão falhou | Chave OpenAI/OpenRouter; ponto "Ver e ouvir" |
| O agente parou de responder em áudio e está mandando texto | Voz indisponível | Chave OpenRouter / serviço de voz |
| O assistente passou um atendimento para um humano | Handoff | Assumir a conversa; devolver depois |
| O orçamento de IA foi atingido / O gasto de IA passou do aviso que você definiu | Orçamento | IA › Uso e orçamento |
| O assistente prometeu algo a um cliente e ninguém ficou responsável | Promessa sem dono (Operador) | Assumir a promessa; ligar capacidades no Operador |
| Próxima ação sem negócio definido — precisa da sua escolha | O agente combinou algo e há mais de um negócio possível | Escolher o negócio |
| Negócios que já estavam parados — precisam de uma decisão | Radar de risco | Decidir: retomar, encerrar |
| A sugestão de retomar contato venceu — decida | Proposta de reativação não decidida | Aprovar/descartar |
| O lead não respondeu no prazo que você definiu | Soneca vencida | Retomar |
| Um fluxo de follow-up parou de tentar | Inscrição morta | Ver dossiê; corrigir o fluxo |
| Um disparo em massa travou e está esperando para continuar | Campanha parada | Ver Disparos |
| Um material que você enviou não entrou na base de conhecimento | Indexação falhou (ex.: sem chave) | Chave de indexação; reindexar |
| Proposta de melhoria do assistente aguardando sua revisão | Flywheel | IA › Propostas |
| O avaliador de qualidade precisa de recalibragem | Avaliador desalinhado | Revisar propostas recentes |
| Uma integração via API está falhando e o agente parou de consultá-la | Circuito aberto | IA › Integrações › Testar conexão |
| O cliente confirmou uma correção e ela não foi aplicada | Ação externa falhou após o SIM | Resolver manualmente com o cliente |
| Alguém errou o código de verificação de uma conta várias vezes | Possível tentativa de acesso indevido | Avaliar a conversa |
| Avisos do Operador (não agiu / não rodou / sem ferramentas) | Papel Operador sem capacidade ou com falha | Aba Organiza o sistema |

Para a lista vigente: `lib/ai/agent-inbox-copy.ts`.

---

## 3. Diagnóstico: "o agente não respondeu"

Siga na ordem — cada passo elimina uma causa:

| # | Pergunta | Como checar | Correção |
|---|---|---|---|
| 1 | O agente está **publicado**? | Lista de agentes: selo "Publicado vN" | Publicar. |
| 2 | Está no **número certo** e o número está **conectado**? | Campo "Número conectado"; Conexões | Reconectar; corrigir o número. |
| 3 | Há **roteador** no número mandando para outro agente? | IA › Roteadores; "Testar classificação" | Ajustar intenções/fallback. |
| 4 | A conversa está **com humano**? | Cabeçalho da conversa ("Devolver ao automático" visível) | Devolver ao automático. |
| 5 | O cliente pediu para **parar** / está bloqueado? | Ficha do contato | Só a pessoa pode reverter, com consentimento. |
| 6 | Está **fora da janela** anti-ban (7h–22h) ou do **horário do agente**? | Proteção de envio do número; gatilhos do agente | Normal: a resposta sai na abertura. |
| 7 | É **grupo**? | Conversa `@g.us` | Agente não atende grupos. |
| 8 | **Orçamento** esgotado? | IA › Uso e orçamento | Aumentar teto; devolver conversas. |
| 9 | **Credencial** inválida / modelo removido? | IA › Credenciais (revalidar); Execuções (mensagem do provedor) | Revalidar; trocar modelo e republicar. |
| 10 | Organização **bloqueada** por assinatura? | Tela de assinatura | Regularizar. |
| 11 | Canal oficial com **janela de 24h fechada**? | Execuções/rastro: veto `messaging_window` | Usar modelo aprovado (o agente tenta `send_template`). |
| 12 | O worker está de pé? | Saúde do serviço `worker`; avisos "tarefa falhou" | Ver logs do contêiner `worker`. |

### "Respondeu, mas…"

| Sintoma | Causa provável | Correção |
|---|---|---|
| Inventa preço/política | Material não marcado ou não indexado | Marcar material; conferir trechos; FAQ com a resposta exata |
| "Não sei" para algo que está no material | Busca não achou (paráfrase muito distante, PDF imagem) | Reescrever o FAQ como o cliente pergunta |
| Não move o card | Funil não marcado em "Em que negócios ele pode mexer", ou etapas sem tradução | Marcar funil; Etapas do funil › "Para onde o card vai" |
| Card vai para a etapa errada | Tradução de etapa errada | Ajustar a tradução |
| Manda mensagens demais | Prompt pedindo várias perguntas | "Uma pergunta por vez" nas instruções (o teto é 3 por turno) |
| Passa para humano à toa | Palavra de handoff genérica; sentimento lendo "não" como irritação (já corrigido) | Revisar "Palavras que chamam uma pessoa" |
| Usa palavras internas | Capacidades de escrita no Conversador | Ligar o Operador e mover a escrita para ele |
| Promete retorno e não volta | Ferramenta recusou (fora da janela, já existe retorno) | Ver rastro do turno; aba Fila |
| Follow-up automático não dispara | Fluxo não marcado num agente publicado com follow-up habilitado; etapa do funil errada (homônima); contato já em outro fluxo | Ver [05 §B.2](05-follow-ups.md) |
| Resposta demora | Debounce de 8 s junta rajadas; turno + checkpoint; provedor lento | Normal até ~20–40 s; ver latência em Execuções |

---

## 4. Comandos úteis (para quem administra o servidor)

```bash
# Capacidades vigentes (catálogo)
ls lib/mcp/tools/catalogo/

# Blocos de fluxo registrados
grep -n "registrarNo(" lib/flow-engine/register-all.ts

# Variáveis do worker do agente e seus padrões
grep -nE "^\s+[A-Z_]{4,}: z" lib/agent-engine/env.ts

# Pontos de IA
grep -n "id: \"" lib/ai/pontos/registro.ts

# Vocabulário de opt-out em vigor
grep -n 'PALAVRAS_DE_OPT_OUT' -A40 lib/opt-out/deteccao.ts
```

No banco (somente leitura):

```sql
-- Agente publicado por número
select a.name, v.version_number, v.channel_session_id, v.model
from ai_agents a join ai_agent_versions v on v.id = a.published_version_id
where a.organization_id = '<org>' and a.archived_at is null;

-- Últimas decisões do roteador
select created_at, intent_name, confidence, outcome
from ai_router_decisions where organization_id = '<org>'
order by created_at desc limit 20;

-- Jobs do agente que morreram
select kind, attempts, last_error, created_at from job_queue
where organization_id = '<org>' and status = 'dead'
order by created_at desc limit 20;
```

> Nomes de colunas podem evoluir — confira em `lib/database.types.ts` antes de rodar.
