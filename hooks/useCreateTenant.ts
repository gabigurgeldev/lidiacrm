"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateTenantPayload {
  display_name: string;
  slug: string;
  legal_name?: string;
  cnpj?: string;
  plan?: "standard" | "pro" | "enterprise";
  owner_email: string;
  /**
   * Com a senha, o dono nasce junto e já consegue entrar. Opcional no tipo
   * porque a rota a aceita ausente — antes dela, o tenant nascia sem ninguém
   * dentro e o `owner_email` virava só um hash no audit.
   */
  owner_password?: string;
}

export interface CreateTenantResponse {
  data: {
    id: string;
    slug: string;
    display_name: string;
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCreateTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateTenantPayload) =>
      apiClient.post<CreateTenantResponse>("/api/v1/admin/tenants", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
    },
  });
}
