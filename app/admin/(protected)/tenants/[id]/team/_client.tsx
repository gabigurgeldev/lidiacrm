"use client";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ROTULO_DO_PAPEL } from "@/lib/auth/types";
import { ROLES, type Role } from "@/lib/schemas/team";

interface Props {
  organizationId: string;
}

interface CriarResult {
  data: { user_id: string; role: string; conta_criada: boolean };
}

/**
 * Criar uma pessoa dentro de um tenant, pelo painel da plataforma.
 *
 * A aba existia marcada como "em breve". Enquanto isso, criar uma organização
 * por aqui produzia um lugar sem ninguém dentro: `POST /admin/tenants` coletava
 * `owner_email` e só o transformava em hash no audit — nenhuma conta, nenhum
 * vínculo. Esta tela é a saída para os tenants que já nasceram assim.
 */
export function TenantTeamClient({ organizationId }: Props) {
  const t = useT();
  const [email, setEmail] = React.useState("");
  const [senha, setSenha] = React.useState("");
  const [nome, setNome] = React.useState("");
  const [role, setRole] = React.useState<Role>("admin");

  const criar = useMutation({
    mutationFn: async () =>
      apiClient.post<CriarResult>(`/api/v1/admin/tenants/${organizationId}/users`, {
        email: email.trim(),
        senha,
        role,
        ...(nome.trim() ? { nome: nome.trim() } : {}),
      }),
    onError: showApiError,
    onSuccess: (r) => {
      toast.success(
        r.data.conta_criada
          ? t("Acesso criado. Passe o e-mail e a senha para a pessoa.")
          : t(
              "Esta pessoa já tinha conta nesta instalação e agora faz parte desta organização. Ela entra com a senha que já usava — a senha digitada aqui não foi aplicada.",
            ),
      );
      setEmail("");
      setSenha("");
      setNome("");
    },
  });

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const podeSalvar = emailValido && senha.length >= 8 && !criar.isPending;

  return (
    <div className="max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>{t("Criar usuário")}</CardTitle>
          <CardDescription>
            {t(
              "A pessoa passa a fazer parte desta organização e entra com o e-mail e a senha definidos aqui. Nenhum e-mail é enviado.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="admin-membro-email">{t("E-mail")}</Label>
            <Input
              id="admin-membro-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pessoa@empresa.com.br"
              data-testid="admin-membro-email"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="admin-membro-nome">{t("Nome")}</Label>
            <Input
              id="admin-membro-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={t("opcional")}
              data-testid="admin-membro-nome"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="admin-membro-senha">{t("Senha")}</Label>
            {/*
              Texto claro de propósito: quem cria precisa ler a senha para
              repassá-la. Mascarar só produziria erro de digitação numa senha que
              a própria pessoa acabou de inventar.
            */}
            <Input
              id="admin-membro-senha"
              type="text"
              autoComplete="off"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              data-testid="admin-membro-senha"
            />
            <p className="text-xs text-muted-foreground">
              {t("Mínimo de 8 caracteres. Fica visível para você poder repassá-la.")}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="admin-membro-papel">{t("Papel")}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger id="admin-membro-papel" data-testid="admin-membro-papel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROTULO_DO_PAPEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(
                "Para o dono da organização, escolha Administrador — é quem consegue criar o restante do time.",
              )}
            </p>
          </div>

          <div>
            <Button
              onClick={() => criar.mutate()}
              disabled={!podeSalvar}
              data-testid="admin-membro-salvar"
            >
              {criar.isPending ? t("Criando...") : t("Criar usuário")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
