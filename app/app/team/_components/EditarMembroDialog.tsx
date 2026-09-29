"use client";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEditarMembro } from "@/hooks/team/useEditarMembro";
import { useT } from "@/hooks/i18n/useT";
import type { TeamMember } from "@/hooks/team/useTeamMembers";
import type { EditarMembroInput } from "@/lib/schemas/team";

const SENHA_MINIMA = 8;

interface Props {
  membro: TeamMember | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Nome, e-mail e senha de uma pessoa da equipe. Manda só o que mudou: trocar o
 * nome não pode reenviar o e-mail, e senha em branco quer dizer "manter".
 */
export function EditarMembroDialog({ membro, onOpenChange }: Props) {
  return (
    <Dialog open={!!membro} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* `key`: cada pessoa abre o formulário com os PRÓPRIOS dados, nunca com
            a senha digitada para a anterior. */}
        {membro ? (
          <Formulario key={membro.user_id} membro={membro} onOpenChange={onOpenChange} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  membro,
  onOpenChange,
}: {
  membro: TeamMember;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const editar = useEditarMembro();
  const [nome, setNome] = React.useState(membro.full_name ?? "");
  const [email, setEmail] = React.useState(membro.email ?? "");
  const [senha, setSenha] = React.useState("");

  const dados: EditarMembroInput = {};
  if (nome.trim() !== (membro.full_name ?? "")) dados.nome = nome.trim() || null;
  if (email.trim().toLowerCase() !== (membro.email ?? "").toLowerCase()) {
    dados.email = email.trim().toLowerCase();
  }
  if (senha !== "") dados.senha = senha;

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const senhaValida = senha === "" || senha.length >= SENHA_MINIMA;
  const mudouAlgo = Object.keys(dados).length > 0;
  const podeSalvar = emailValido && senhaValida && mudouAlgo && !editar.isPending;

  async function salvar() {
    if (!podeSalvar) return;
    try {
      await editar.mutateAsync({ userId: membro.user_id, dados });
      toast.success(
        dados.senha !== undefined
          ? t("Dados salvos. Passe a nova senha para a pessoa.")
          : t("Dados salvos."),
      );
      onOpenChange(false);
    } catch {
      // showApiError no hook já mostrou o motivo.
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("Editar usuário")}</DialogTitle>
        <DialogDescription>
          {t(
            "Mude o nome, o e-mail de acesso ou defina uma senha nova. Não é enviado nenhum e-mail.",
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label htmlFor="editar-membro-nome">{t("Nome")}</Label>
          <Input
            id="editar-membro-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            data-testid="editar-membro-nome"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="editar-membro-email">{t("E-mail")}</Label>
          <Input
            id="editar-membro-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="editar-membro-email"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="editar-membro-senha">{t("Nova senha")}</Label>
          <Input
            id="editar-membro-senha"
            type="text"
            autoComplete="off"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder={t("deixe em branco para manter")}
            data-testid="editar-membro-senha"
          />
          <p className="text-xs text-muted-foreground">
            {t("Mínimo de 8 caracteres. Fica visível para você poder repassá-la.")}
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          {t("Cancelar")}
        </Button>
        <Button onClick={salvar} disabled={!podeSalvar} data-testid="editar-membro-salvar">
          {editar.isPending ? t("Salvando…") : t("Salvar")}
        </Button>
      </DialogFooter>
    </>
  );
}
