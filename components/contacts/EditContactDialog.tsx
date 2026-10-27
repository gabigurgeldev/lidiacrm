"use client";
import { useEffect, useState } from "react";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { contactPatchSchema, type ContactPatch } from "@/lib/schemas/contacts";
import { useUpdateContact } from "@/hooks/contacts/useUpdateContact";
import type { Contact } from "@/lib/types/contacts";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { SeletorDeTags } from "@/components/tags/SeletorDeTags";
import { avisarEfeitosNoKanban, type EfeitoNoKanban } from "@/components/tags/efeitos-no-kanban";

interface FormShape {
  name?: string;
  email?: string;
  phone_number?: string;
  birthdate?: string;
}

interface Props {
  contact: Contact;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function EditContactDialog({ contact, open, onOpenChange }: Props) {
  const t = useT();
  const update = useUpdateContact(contact.id);
  const [serverError, setServerError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>(contact.tags);
  const qc = useQueryClient();

  const form = useForm<FormShape>({
    defaultValues: {
      name: nomeDoContato(contact) ?? "",
      email: contact.email ?? "",
      phone_number: contact.phone_number ? phoneForDisplay(contact.phone_number) : "",
      birthdate: contact.birthdate ?? "",
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        // O nome que a tela MOSTRA: contato do WhatsApp só tem o do perfil
        // (`display_name`), e o campo vinha vazio — parecia que ele não tinha nome.
        name: nomeDoContato(contact) ?? "",
        email: contact.email ?? "",
        phone_number: contact.phone_number ? phoneForDisplay(contact.phone_number) : "",
        // Faltava: reabrir o diálogo deixava a data de nascimento da edição
        // anterior (ou vazia) no campo.
        birthdate: contact.birthdate ?? "",
      });
      setTags(contact.tags);
    }
  }, [open, contact, form]);

  async function onSubmit(values: FormShape) {
    setServerError(null);
    const payload: Record<string, unknown> = {};
    if (values.name?.trim()) payload.name = values.name.trim();
    if (values.email?.trim()) payload.email = values.email.trim();
    if (values.phone_number?.trim()) payload.phone_number = values.phone_number.trim();
    // Vazio APAGA a data (null) — o campo existe para corrigir, inclusive tirar.
    const nascimento = values.birthdate?.trim() ?? "";
    if (nascimento !== (contact.birthdate ?? "")) payload.birthdate = nascimento === "" ? null : nascimento;
    payload.tags = tags;

    const parsed = contactPatchSchema.safeParse(payload);
    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? t("Dados inválidos"));
      return;
    }
    try {
      const r = await update.mutateAsync(parsed.data as ContactPatch);
      toast.success(t("Contato atualizado"));
      const efeitos = (r.data as { kanban_efeitos?: EfeitoNoKanban[] }).kanban_efeitos;
      if (avisarEfeitosNoKanban(efeitos, t)) void qc.invalidateQueries({ queryKey: ["board"] });
      onOpenChange(false);
    } catch {
      // hook handles toast
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Editar contato")}</DialogTitle>
          <DialogDescription>{t("Atualize os dados deste contato.")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ec-name">{t("Nome")}</Label>
            <Input id="ec-name" {...form.register("name")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec-email">Email</Label>
            <Input id="ec-email" type="email" {...form.register("email")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec-phone">{t("Telefone (E.164)")}</Label>
            <Input id="ec-phone" {...form.register("phone_number")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec-birthdate">{t("Data de nascimento")}</Label>
            <Input id="ec-birthdate" type="date" max={new Date().toISOString().slice(0, 10)} {...form.register("birthdate")} />
            <p className="text-xs text-muted-foreground">{t("Usada para a mensagem de parabéns automática.")}</p>
          </div>
          <div className="space-y-2">
            <Label>{t("Tags")}</Label>
            <SeletorDeTags
              valor={tags}
              aoMudar={setTags}
              desabilitado={update.isPending}
              testIdDoBotao="editar-contato-adicionar-tag"
            />
          </div>
          {serverError && <p className="text-sm text-error-fg">{serverError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={update.isPending}
            >
              {t("Cancelar")}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? t("Salvando…") : t("Salvar")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
