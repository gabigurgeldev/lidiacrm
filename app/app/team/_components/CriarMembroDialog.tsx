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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCriarMembro } from "@/hooks/team/useCriarMembro";
import { useT } from "@/hooks/i18n/useT";
import { ROLES, type Role } from "@/lib/schemas/team";
import { ROTULO_DO_PAPEL } from "@/lib/auth/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SENHA_MINIMA = 8;

/**
 * Cria a pessoa com e-mail e senha, no lugar do convite por e-mail.
 *
 * O convite dependia de `RESEND_API_KEY` e, sem ela, terminava num link cru na
 * tela para copiar à mão — que é o estado de toda instalação recém-feita, no
 * dia em que justamente se monta o time.
 */
export function CriarMembroDialog({ open, onOpenChange }: Props) {
  const t = useT();
  const [email, setEmail] = React.useState("");
  const [senha, setSenha] = React.useState("");
  const [nome, setNome] = React.useState("");
  const [role, setRole] = React.useState<Role>("agent");

  const criar = useCriarMembro();

  // Reset ao fechar: um diálogo que reabre com a senha anterior no campo é um
  // convite a criar a segunda pessoa com a credencial da primeira.
  React.useEffect(() => {
    if (!open) {
      setEmail("");
      setSenha("");
      setNome("");
      setRole("agent");
    }
  }, [open]);

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const senhaValida = senha.length >= SENHA_MINIMA;
  const podeSalvar = emailValido && senhaValida && !criar.isPending;

  async function salvar() {
    if (!podeSalvar) return;
    try {
      const r = await criar.mutateAsync({
        email: email.trim(),
        senha,
        role,
        ...(nome.trim() ? { nome: nome.trim() } : {}),
      });
      // Duas mensagens diferentes de propósito: quando a conta já existia, a
      // senha digitada NÃO vale, e dizer "criado com sucesso" faria quem opera
      // repassar uma credencial que não funciona.
      toast.success(
        r.data.conta_criada
          ? t("Acesso criado. Passe o e-mail e a senha para a pessoa.")
          : t(
              "Esta pessoa já tinha conta nesta instalação e agora faz parte da equipe. Ela entra com a senha que já usava — a senha digitada aqui não foi aplicada.",
            ),
      );
      onOpenChange(false);
    } catch {
      // showApiError no hook já mostrou o motivo (inclusive 409 "já faz parte").
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Criar usuário")}</DialogTitle>
          <DialogDescription>
            {t(
              "A pessoa entra imediatamente com o e-mail e a senha que você definir aqui. Não é enviado nenhum e-mail.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="membro-email">{t("E-mail")}</Label>
            <Input
              id="membro-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pessoa@empresa.com.br"
              data-testid="membro-email"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="membro-nome">{t("Nome")}</Label>
            <Input
              id="membro-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={t("opcional")}
              data-testid="membro-nome"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="membro-senha">{t("Senha")}</Label>
            <Input
              id="membro-senha"
              type="text"
              autoComplete="off"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              data-testid="membro-senha"
            />
            {/*
              Em texto claro, e de propósito: quem cria precisa LER a senha para
              repassá-la. Um campo mascarado aqui só criaria erro de digitação
              numa senha que a própria pessoa acabou de inventar.
            */}
            <p className="text-xs text-muted-foreground">
              {t("Mínimo de 8 caracteres. Fica visível para você poder repassá-la.")}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="membro-papel">{t("Papel")}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger id="membro-papel" data-testid="membro-papel">
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
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancelar")}
          </Button>
          <Button onClick={salvar} disabled={!podeSalvar} data-testid="membro-salvar">
            {criar.isPending ? t("Criando...") : t("Criar usuário")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
