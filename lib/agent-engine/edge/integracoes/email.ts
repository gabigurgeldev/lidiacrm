/**
 * O envio real do código de verificação — o seam que os testes trocam.
 *
 * Marca da organização que ATENDE (a que roda o agente), pelo mesmo transporte
 * dos outros e-mails do produto (SMTP ou Resend, `lib/email/resend.ts`).
 */
import { assuntoDoCodigo, emailDoCodigo } from '@/lib/ai/integracoes/email-do-codigo';
import { marcaDaSaida } from '@/lib/branding/saida';
import { isEmailConfigured, sendEmail } from '@/lib/email/resend';

import type { EnviarEmail } from './turno';

export const enviarEmailDoCodigo: EnviarEmail = async ({ organizationId, to, telefoneDoContato, codigo }) => {
  const marca = await marcaDaSaida(organizationId);
  const { html, text } = emailDoCodigo({ marca, codigo, telefoneDoContato });
  const r = await sendEmail({ to, subject: assuntoDoCodigo(marca), html, text, fromName: marca.nome });
  return r.ok ? { ok: true } : { ok: false, erro: r.error ?? 'send_failed' };
};

export const emailEstaConfigurado = (): boolean => isEmailConfigured();
