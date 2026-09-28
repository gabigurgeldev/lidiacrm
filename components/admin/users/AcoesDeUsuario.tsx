"use client";
/**
 * Ações de gestão de uma conta no painel da plataforma — os diálogos e o menu
 * que os abre. Montado na lista (`UsersTableAdmin`, uma linha = um vínculo) e
 * no detalhe (`/admin/users/[id]`).
 *
 * Os três verbos destrutivos têm escopos diferentes, e a tela os separa em
 * vez de juntá-los num "remover" ambíguo:
 *
 *   - Remover da organização — tira o vínculo com UMA organização. A conta
 *     segue existindo e segue entrando nas outras.
 *   - Suspender — bloqueia o login da conta em toda a instalação. Reversível.
 *   - Excluir — a conta deixa de existir. Sem volta, e por isso pede o e-mail
 *     digitado como confirmação.
 */
import { useState } from "react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import {
  useCriarUsuarioAdmin,
  useEditarUsuarioAdmin,
  useExcluirUsuarioAdmin,
  useReativarUsuarioAdmin,
  useRemoverDaOrgAdmin,
  useSuspenderUsuarioAdmin,
} from "@/hooks/useAdminUserActions";
import { ROTULO_DO_PAPEL } from "@/lib/auth/types";
import { ROLES, type Role } from "@/lib/schemas/team";
import {
  DotsThreeVertical,
  PencilSimple,
  Prohibit,
  SignOut,
  Trash,
  ArrowCounterClockwise,
} from "@/lib/ui/icons";

export type EstadoDaConta = "ativo" | "suspenso" | "pendente";

export interface AlvoDaAcao {
  id: string;
  email: string | null;
  full_name: string | null;
  status: EstadoDaConta;
}

// ---------------------------------------------------------------------------
// Selo de estado
// ---------------------------------------------------------------------------

export function SeloDeEstado({ status }: { status: EstadoDaConta }) {
  const t = useT();
  if (status === "suspenso") return <Badge variant="error">{t("Suspenso")}</Badge>;
  if (status === "pendente") return <Badge variant="warning">{t("Nunca entrou")}</Badge>;
  return <Badge variant="success">{t("Ativo")}</Badge>;
}

// ---------------------------------------------------------------------------
// Criar
// ---------------------------------------------------------------------------

const emailValido = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export function CriarUsuarioDialog({
  open,
  onClose,
  organizacoes,
  organizacaoInicial,
}: {
  open: boolean;
  onClose: () => void;
  organizacoes: Array<{ id: string; display_name: string }>;
  organizacaoInicial?: string;
}) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [org, setOrg] = useState(organizacaoInicial ?? "");
  const criar = useCriarUsuarioAdmin();

  const orgEscolhida = org || organizacoes[0]?.id || "";
  const pode = emailValido(email) && senha.length >= 8 && !!orgEscolhida && !criar.isPending;

  function fechar() {
    setEmail("");
    setNome("");
    setSenha("");
    setRole("agent");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Novo usuário")}</DialogTitle>
          <DialogDescription>
            {t("A pessoa entra com o e-mail e a senha definidos aqui. Nenhum e-mail é enviado.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label htmlFor="novo-email">{t("E-mail")}</Label>
            <Input
              id="novo-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pessoa@empresa.com.br"
              data-testid="novo-usuario-email"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="novo-nome">{t("Nome")}</Label>
            <Input
              id="novo-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={t("opcional")}
              data-testid="novo-usuario-nome"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="novo-senha">{t("Senha")}</Label>
            {/* Texto claro: quem cria precisa ler a senha para repassá-la. */}
            <Input
              id="novo-senha"
              type="text"
              autoComplete="off"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              data-testid="novo-usuario-senha"
            />
            <p className="text-xs text-muted-foreground">{t("Mínimo de 8 caracteres.")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="novo-org">{t("Organização")}</Label>
              <Select value={orgEscolhida} onValueChange={setOrg}>
                <SelectTrigger id="novo-org" data-testid="novo-usuario-org">
                  <SelectValue placeholder={t("Escolha")} />
                </SelectTrigger>
                <SelectContent>
                  {organizacoes.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="novo-papel">{t("Papel")}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger id="novo-papel" data-testid="novo-usuario-papel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(ROTULO_DO_PAPEL[r])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>
            {t("Cancelar")}
          </Button>
          <Button
            disabled={!pode}
            data-testid="novo-usuario-salvar"
            onClick={() =>
              criar.mutate(
                {
                  organizationId: orgEscolhida,
                  email: email.trim(),
                  senha,
                  role,
                  ...(nome.trim() ? { nome: nome.trim() } : {}),
                },
                { onSuccess: fechar },
              )
            }
          >
            {criar.isPending ? t("Criando...") : t("Criar usuário")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

export function EditarUsuarioDialog({
  alvo,
  open,
  onClose,
}: {
  alvo: AlvoDaAcao;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [nome, setNome] = useState(alvo.full_name ?? "");
  const [email, setEmail] = useState(alvo.email ?? "");
  const editar = useEditarUsuarioAdmin(alvo.id);

  const mudouNome = nome.trim() !== (alvo.full_name ?? "");
  const mudouEmail = email.trim().toLowerCase() !== (alvo.email ?? "").toLowerCase();
  const pode = (mudouNome || mudouEmail) && (!mudouEmail || emailValido(email)) && !editar.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Editar usuário")}</DialogTitle>
          <DialogDescription>
            {t("Trocar o e-mail muda o endereço com que a pessoa entra, já confirmado.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label htmlFor="editar-nome">{t("Nome")}</Label>
            <Input id="editar-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="editar-email">{t("E-mail")}</Label>
            <Input
              id="editar-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Cancelar")}
          </Button>
          <Button
            disabled={!pode}
            onClick={() =>
              editar.mutate(
                {
                  ...(mudouNome ? { full_name: nome.trim() || null } : {}),
                  ...(mudouEmail ? { email: email.trim() } : {}),
                },
                { onSuccess: onClose },
              )
            }
          >
            {editar.isPending ? t("Salvando...") : t("Salvar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Suspender
// ---------------------------------------------------------------------------

const motivoSchema = z.string().trim().min(10).max(500);

export function SuspenderUsuarioDialog({
  alvo,
  open,
  onClose,
}: {
  alvo: AlvoDaAcao;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [motivo, setMotivo] = useState("");
  const suspender = useSuspenderUsuarioAdmin(alvo.id);
  const pode = motivoSchema.safeParse(motivo).success && !suspender.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Suspender conta")}</DialogTitle>
          <DialogDescription>
            {t(
              "A pessoa deixa de conseguir entrar em todas as organizações. Sessões já abertas expiram em até 1 hora. Dá para reativar depois.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-1">
          <p className="truncate text-sm font-medium">{alvo.full_name ?? alvo.email}</p>
          <Label htmlFor="suspender-motivo">
            {t("Motivo")}{" "}
            <span className="text-xs font-normal text-muted-foreground">({motivo.length}/500)</span>
          </Label>
          <Textarea
            id="suspender-motivo"
            rows={3}
            maxLength={500}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={t("Mínimo de 10 caracteres. Fica registrado na auditoria.")}
            data-testid="suspender-motivo"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Cancelar")}
          </Button>
          <Button
            variant="destructive"
            disabled={!pode}
            data-testid="suspender-confirmar"
            onClick={() =>
              suspender.mutate(motivo.trim(), {
                onSuccess: () => {
                  setMotivo("");
                  onClose();
                },
              })
            }
          >
            {suspender.isPending ? t("Suspendendo...") : t("Suspender")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Excluir
// ---------------------------------------------------------------------------

export function ExcluirUsuarioDialog({
  alvo,
  open,
  onClose,
  onExcluido,
}: {
  alvo: AlvoDaAcao;
  open: boolean;
  onClose: () => void;
  onExcluido?: () => void;
}) {
  const t = useT();
  const [confirmacao, setConfirmacao] = useState("");
  const excluir = useExcluirUsuarioAdmin(alvo.id);
  const confere =
    !!alvo.email && confirmacao.trim().toLowerCase() === alvo.email.toLowerCase();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Excluir conta")}</DialogTitle>
          <DialogDescription>
            {t(
              "A conta deixa de existir e sai de todas as organizações. O histórico (mensagens, notas, auditoria) é preservado. Esta ação não pode ser desfeita.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-1">
          <Label htmlFor="excluir-confirmacao">
            {t("Digite o e-mail da conta para confirmar")}
          </Label>
          <p className="font-mono text-xs text-muted-foreground">{alvo.email}</p>
          <Input
            id="excluir-confirmacao"
            autoComplete="off"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            data-testid="excluir-confirmacao"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Cancelar")}
          </Button>
          <Button
            variant="destructive"
            disabled={!confere || excluir.isPending}
            data-testid="excluir-confirmar"
            onClick={() =>
              excluir.mutate(confirmacao.trim(), {
                onSuccess: () => {
                  setConfirmacao("");
                  onClose();
                  onExcluido?.();
                },
              })
            }
          >
            {excluir.isPending ? t("Excluindo...") : t("Excluir definitivamente")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Remover da organização
// ---------------------------------------------------------------------------

export function RemoverDaOrgDialog({
  alvo,
  organizacao,
  open,
  onClose,
}: {
  alvo: AlvoDaAcao;
  organizacao: { id: string; nome: string };
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const remover = useRemoverDaOrgAdmin(alvo.id);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Remover da organização")}</DialogTitle>
          <DialogDescription>
            {t("A pessoa perde o acesso a esta organização. A conta continua existindo e entrando nas outras.")}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          <span className="font-medium">{alvo.full_name ?? alvo.email}</span>
          {" · "}
          <span className="text-muted-foreground">{organizacao.nome}</span>
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Cancelar")}
          </Button>
          <Button
            variant="destructive"
            disabled={remover.isPending}
            data-testid="remover-da-org-confirmar"
            onClick={() => remover.mutate(organizacao.id, { onSuccess: onClose })}
          >
            {remover.isPending ? t("Removendo...") : t("Remover")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Menu de ações
// ---------------------------------------------------------------------------

type Aberto = null | "editar" | "suspender" | "excluir" | "remover";

export function MenuDeAcoesDoUsuario({
  alvo,
  organizacao,
  onExcluido,
}: {
  alvo: AlvoDaAcao;
  /** Presente = a linha é um vínculo, e "Remover da organização" aparece. */
  organizacao?: { id: string; nome: string; revogado: boolean };
  onExcluido?: () => void;
}) {
  const t = useT();
  const [aberto, setAberto] = useState<Aberto>(null);
  const reativar = useReativarUsuarioAdmin(alvo.id);
  const fechar = () => setAberto(null);

  return (
    <>
      {/* `modal={false}`: os diálogos abrem A PARTIR de um item deste menu, e
          com os dois modais o Radix pode deixar `pointer-events: none` preso no
          `<body>` quando o diálogo fecha — a tela inteira para de responder a
          clique, sem erro nenhum no console. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={t("Ações do usuário")}
            data-testid={`acoes-usuario-${alvo.id}`}
          >
            <DotsThreeVertical size={18} weight="bold" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
            {alvo.email}
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setAberto("editar")}>
            <PencilSimple size={16} weight="duotone" className="mr-2" aria-hidden />
            {t("Editar")}
          </DropdownMenuItem>
          {alvo.status === "suspenso" ? (
            <DropdownMenuItem
              disabled={reativar.isPending}
              onSelect={() => reativar.mutate()}
              data-testid="acao-reativar"
            >
              <ArrowCounterClockwise size={16} weight="duotone" className="mr-2" aria-hidden />
              {t("Reativar conta")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setAberto("suspender")} data-testid="acao-suspender">
              <Prohibit size={16} weight="duotone" className="mr-2" aria-hidden />
              {t("Suspender conta")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {organizacao && !organizacao.revogado && (
            <DropdownMenuItem onSelect={() => setAberto("remover")} data-testid="acao-remover-da-org">
              <SignOut size={16} weight="duotone" className="mr-2" aria-hidden />
              {t("Remover desta organização")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => setAberto("excluir")}
            className="text-destructive focus:text-destructive"
            data-testid="acao-excluir"
          >
            <Trash size={16} weight="duotone" className="mr-2" aria-hidden />
            {t("Excluir conta")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {aberto === "editar" && <EditarUsuarioDialog alvo={alvo} open onClose={fechar} />}
      {aberto === "suspender" && <SuspenderUsuarioDialog alvo={alvo} open onClose={fechar} />}
      {aberto === "excluir" && (
        <ExcluirUsuarioDialog alvo={alvo} open onClose={fechar} onExcluido={onExcluido} />
      )}
      {aberto === "remover" && organizacao && (
        <RemoverDaOrgDialog
          alvo={alvo}
          organizacao={{ id: organizacao.id, nome: organizacao.nome }}
          open
          onClose={fechar}
        />
      )}
    </>
  );
}
