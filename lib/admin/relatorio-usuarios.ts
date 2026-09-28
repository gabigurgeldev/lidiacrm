/**
 * Relatório e export de usuários do painel da plataforma — puro, sem I/O.
 *
 * As rotas `GET /api/v1/admin/users/report` e `/export` leem o diretório do
 * Auth (`./diretorio-auth.ts`) e os vínculos (`user_organizations`), e passam
 * as duas listas para cá. Tudo o que é conta e formatação mora aqui para ser
 * testado sem Supabase.
 */
import type { UsuarioDoDiretorio } from "./diretorio-auth";
import { estadoDaConta, type EstadoDaConta } from "./gestao-usuarios";
import { ROLES, type Role } from "@/lib/schemas/team";

export interface VinculoParaRelatorio {
  user_id: string;
  organization_id: string;
  organization_name: string | null;
  role: string;
  revoked_at: string | null;
}

const DIA_MS = 24 * 60 * 60 * 1000;
/** Sem login há mais que isto = inativo. Também é a janela de "ativo". */
export const DIAS_PARA_INATIVO = 30;

export interface RelatorioDeUsuarios {
  gerado_em: string;
  dias: number;
  totais: {
    usuarios: number;
    ativos: number;
    suspensos: number;
    pendentes: number;
    inativos: number;
    sem_mfa: number;
    email_nao_confirmado: number;
    sem_organizacao: number;
  };
  /** Vínculos ATIVOS por papel. Uma pessoa em duas organizações conta duas vezes. */
  por_papel: Record<Role, number>;
  por_organizacao: Array<{ organization_id: string; nome: string | null; usuarios: number }>;
  /**
   * Uma linha por dia do período, do mais antigo ao mais novo — dia sem
   * evento é ZERO explícito, nunca buraco, para o gráfico não ligar pontos
   * por cima de um dia vazio.
   *
   * `acessos` conta o ÚLTIMO login de cada pessoa, que é o único que o Auth
   * guarda: quem entrou ontem e hoje aparece só hoje. É "quantas pessoas
   * tiveram o último acesso naquele dia", e o rótulo da tela diz isso.
   */
  serie: Array<{ dia: string; cadastros: number; acessos: number }>;
  /** Os que estão há mais tempo sem entrar, primeiro os que nunca entraram. */
  inativos: Array<{
    id: string;
    email: string | null;
    full_name: string | null;
    last_sign_in_at: string | null;
    created_at: string;
  }>;
}

function diaUtc(iso: string): string {
  return iso.slice(0, 10);
}

export function montarRelatorio(
  usuarios: UsuarioDoDiretorio[],
  vinculos: VinculoParaRelatorio[],
  dias: number,
  agora: Date = new Date(),
): RelatorioDeUsuarios {
  const corteInativo = agora.getTime() - DIAS_PARA_INATIVO * DIA_MS;
  const ativosVinculos = vinculos.filter((v) => !v.revoked_at);
  const comVinculo = new Set(ativosVinculos.map((v) => v.user_id));

  const totais = {
    usuarios: usuarios.length,
    ativos: 0,
    suspensos: 0,
    pendentes: 0,
    inativos: 0,
    sem_mfa: 0,
    email_nao_confirmado: 0,
    sem_organizacao: 0,
  };
  const inativos: RelatorioDeUsuarios["inativos"] = [];

  for (const u of usuarios) {
    const estado = estadoDaConta(u, agora);
    if (estado === "suspenso") totais.suspensos++;
    if (estado === "pendente") totais.pendentes++;
    const ultimo = u.last_sign_in_at ? new Date(u.last_sign_in_at).getTime() : null;
    if (estado !== "suspenso") {
      if (ultimo !== null && ultimo >= corteInativo) totais.ativos++;
      else {
        totais.inativos++;
        inativos.push({
          id: u.id,
          email: u.email,
          full_name: u.full_name,
          last_sign_in_at: u.last_sign_in_at,
          created_at: u.created_at,
        });
      }
    }
    if (!u.tem_mfa) totais.sem_mfa++;
    if (!u.email_confirmed_at) totais.email_nao_confirmado++;
    if (!comVinculo.has(u.id)) totais.sem_organizacao++;
  }

  inativos.sort((a, b) => {
    if (!a.last_sign_in_at && b.last_sign_in_at) return -1;
    if (a.last_sign_in_at && !b.last_sign_in_at) return 1;
    const ta = a.last_sign_in_at ?? a.created_at;
    const tb = b.last_sign_in_at ?? b.created_at;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  const por_papel = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  const porOrg = new Map<string, { nome: string | null; usuarios: Set<string> }>();
  for (const v of ativosVinculos) {
    if ((ROLES as readonly string[]).includes(v.role)) por_papel[v.role as Role]++;
    const o = porOrg.get(v.organization_id) ?? { nome: v.organization_name, usuarios: new Set() };
    o.usuarios.add(v.user_id);
    porOrg.set(v.organization_id, o);
  }
  const por_organizacao = [...porOrg.entries()]
    .map(([organization_id, o]) => ({ organization_id, nome: o.nome, usuarios: o.usuarios.size }))
    .sort((a, b) => b.usuarios - a.usuarios || (a.nome ?? "").localeCompare(b.nome ?? ""))
    .slice(0, 10);

  // Série diária em UTC, `dias` dias terminando hoje.
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
  const serie: RelatorioDeUsuarios["serie"] = [];
  const indice = new Map<string, number>();
  for (let i = dias - 1; i >= 0; i--) {
    const dia = new Date(hoje - i * DIA_MS).toISOString().slice(0, 10);
    indice.set(dia, serie.length);
    serie.push({ dia, cadastros: 0, acessos: 0 });
  }
  for (const u of usuarios) {
    const c = indice.get(diaUtc(u.created_at));
    if (c !== undefined) serie[c]!.cadastros++;
    if (u.last_sign_in_at) {
      const a = indice.get(diaUtc(u.last_sign_in_at));
      if (a !== undefined) serie[a]!.acessos++;
    }
  }

  return {
    gerado_em: agora.toISOString(),
    dias,
    totais,
    por_papel,
    por_organizacao,
    serie,
    inativos: inativos.slice(0, 20),
  };
}

// ---------------------------------------------------------------------------
// Export CSV
// ---------------------------------------------------------------------------

export interface FiltrosDeExport {
  tenant_id?: string;
  role?: Role;
  status?: EstadoDaConta;
  q?: string;
}

export interface LinhaDeExport {
  id: string;
  email: string | null;
  nome: string | null;
  status: EstadoDaConta;
  organizacoes: string;
  criado_em: string;
  ultimo_acesso: string | null;
  email_confirmado: boolean;
  mfa: boolean;
}

/** Uma linha por PESSOA (não por vínculo), com as organizações juntas. */
export function linhasDeExport(
  usuarios: UsuarioDoDiretorio[],
  vinculos: VinculoParaRelatorio[],
  filtros: FiltrosDeExport,
  agora: Date = new Date(),
): LinhaDeExport[] {
  const porUsuario = new Map<string, VinculoParaRelatorio[]>();
  for (const v of vinculos) {
    if (v.revoked_at) continue;
    const l = porUsuario.get(v.user_id) ?? [];
    l.push(v);
    porUsuario.set(v.user_id, l);
  }
  const q = filtros.q?.trim().toLowerCase();

  return usuarios
    .flatMap((u) => {
      const vs = porUsuario.get(u.id) ?? [];
      if (filtros.tenant_id && !vs.some((v) => v.organization_id === filtros.tenant_id)) return [];
      if (filtros.role && !vs.some((v) => v.role === filtros.role && (!filtros.tenant_id || v.organization_id === filtros.tenant_id))) return [];
      const status = estadoDaConta(u, agora);
      if (filtros.status && status !== filtros.status) return [];
      if (q && !(u.email?.toLowerCase().includes(q) || u.full_name?.toLowerCase().includes(q))) return [];
      return [
        {
          id: u.id,
          email: u.email,
          nome: u.full_name,
          status,
          organizacoes: vs.map((v) => `${v.organization_name ?? v.organization_id} (${v.role})`).join("; "),
          criado_em: u.created_at,
          ultimo_acesso: u.last_sign_in_at,
          email_confirmado: !!u.email_confirmed_at,
          mfa: u.tem_mfa,
        },
      ];
    })
    .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
}

const COLUNAS: Array<[keyof LinhaDeExport, string]> = [
  ["id", "id"],
  ["email", "email"],
  ["nome", "nome"],
  ["status", "status"],
  ["organizacoes", "organizacoes"],
  ["criado_em", "criado_em"],
  ["ultimo_acesso", "ultimo_acesso"],
  ["email_confirmado", "email_confirmado"],
  ["mfa", "mfa"],
];

/**
 * Célula de CSV segura.
 *
 * ⚠️ INJEÇÃO DE FÓRMULA: nome e e-mail são digitados por gente de fora da
 * administração (o próprio usuário, em Perfil). Uma célula que começa com
 * `=`, `+`, `-`, `@`, TAB ou CR vira fórmula ao abrir no Excel/Sheets — e
 * `=HYPERLINK(...)` ou `=cmd|...` num arquivo aberto por quem administra a
 * instalação é o ataque clássico. Prefixo `'` neutraliza (recomendação OWASP).
 */
export function celulaCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  let s = typeof valor === "boolean" ? (valor ? "sim" : "nao") : String(valor);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function paraCsv(linhas: LinhaDeExport[]): string {
  const cabecalho = COLUNAS.map(([, rotulo]) => rotulo).join(",");
  const corpo = linhas.map((l) => COLUNAS.map(([k]) => celulaCsv(l[k])).join(","));
  // BOM: sem ele o Excel em pt-BR abre UTF-8 como Latin-1 e "João" vira "JoÃ£o".
  return "﻿" + [cabecalho, ...corpo].join("\r\n") + "\r\n";
}
