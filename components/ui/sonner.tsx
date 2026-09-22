"use client"

import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

/**
 * ⚠️ Este componente NÃO é o toaster em uso. `app/layout.tsx` importa `Toaster`
 * direto de `"sonner"`; este arquivo existe porque o Design System 06 pede que
 * o componente shadcn esteja presente, e nada no repo o importa.
 *
 * O tema é `"light"` fixo. Ele lia `useTheme()` de `next-themes` — uma segunda
 * maquinaria de tema que este produto nunca teve, e que só não quebrava porque
 * ninguém montava o componente. O Gestalt CRM tem um tema só.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
