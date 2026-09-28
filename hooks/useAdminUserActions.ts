"use client";
/**
 * Mutações de gestão de usuários do painel da plataforma, e o relatório.
 *
 * Toda mutação invalida `["admin", "users"]` (listas) e `["admin", "user", id]`
 * (detalhe) — a tela nunca fica mostrando o estado de antes do clique.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { RelatorioDeUsuarios } from "@/lib/admin/relatorio-usuarios";
import type { Role } from "@/lib/schemas/team";

function useInvalidar() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ["admin", "users"] });
    void qc.invalidateQueries({ queryKey: ["admin", "users-report"] });
    if (id) void qc.invalidateQueries({ queryKey: ["admin", "user", id] });
  };
}

export function useCriarUsuarioAdmin() {
  const t = useT();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (v: { organizationId: string; email: string; senha: string; role: Role; nome?: string }) =>
      apiClient.post<{ data: { user_id: string; conta_criada: boolean } }>(
        `/api/v1/admin/tenants/${v.organizationId}/users`,
        { email: v.email, senha: v.senha, role: v.role, ...(v.nome ? { nome: v.nome } : {}) },
      ),
    onError: showApiError,
    onSuccess: (r) => {
      toast.success(
        r.data.conta_criada
          ? t("Usuário criado. Passe o e-mail e a senha para a pessoa.")
          : t("Esta pessoa já tinha conta e agora faz parte da organização. A senha digitada não foi aplicada."),
      );
      invalidar(r.data.user_id);
    },
  });
}

export function useEditarUsuarioAdmin(id: string) {
  const t = useT();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (v: { full_name?: string | null; email?: string }) =>
      apiClient.patch(`/api/v1/admin/users/${id}`, v),
    onError: showApiError,
    onSuccess: () => {
      toast.success(t("Alterações salvas."));
      invalidar(id);
    },
  });
}

export function useSuspenderUsuarioAdmin(id: string) {
  const t = useT();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (reason: string) => apiClient.post(`/api/v1/admin/users/${id}/suspend`, { reason }),
    onError: showApiError,
    onSuccess: () => {
      toast.success(t("Conta suspensa. A pessoa não consegue mais entrar."));
      invalidar(id);
    },
  });
}

export function useReativarUsuarioAdmin(id: string) {
  const t = useT();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: () => apiClient.post(`/api/v1/admin/users/${id}/reactivate`, {}),
    onError: showApiError,
    onSuccess: () => {
      toast.success(t("Conta reativada."));
      invalidar(id);
    },
  });
}

export function useExcluirUsuarioAdmin(id: string) {
  const t = useT();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (confirmEmail: string) =>
      apiClient.delete(`/api/v1/admin/users/${id}`, { confirm_email: confirmEmail }),
    onError: showApiError,
    onSuccess: () => {
      toast.success(t("Conta excluída."));
      invalidar(id);
    },
  });
}

export function useMudarPapelAdmin(id: string) {
  const t = useT();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (v: { organizationId: string; role: Role }) =>
      apiClient.patch(`/api/v1/admin/users/${id}/memberships/${v.organizationId}`, { role: v.role }),
    onError: showApiError,
    onSuccess: () => {
      toast.success(t("Papel atualizado."));
      invalidar(id);
    },
  });
}

export function useRemoverDaOrgAdmin(id: string) {
  const t = useT();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (organizationId: string) =>
      apiClient.delete(`/api/v1/admin/users/${id}/memberships/${organizationId}`),
    onError: showApiError,
    onSuccess: () => {
      toast.success(t("Pessoa removida da organização."));
      invalidar(id);
    },
  });
}

export function useRelatorioDeUsuarios(dias: 7 | 30 | 90) {
  return useQuery({
    queryKey: ["admin", "users-report", dias] as const,
    queryFn: () =>
      apiClient.get<{ data: RelatorioDeUsuarios }>(`/api/v1/admin/users/report?dias=${dias}`),
    staleTime: 60_000,
  });
}
