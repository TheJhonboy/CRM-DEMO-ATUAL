import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Button — Sage design system.
 * Variants:
 *   - primary (default): accent fill, branded CTA
 *   - secondary: surface-elevated com border, ação neutra
 *   - ghost: transparent, hover suave (toolbar/inline)
 *   - destructive: error fill (delete/cancel destrutivo)
 *   - outline: alias de secondary com background transparente (compat shadcn)
 *   - link: text-only com underline
 *   - default: alias de primary (compat shadcn)
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-md font-semibold",
    "transition-[background-color,border-color,color,box-shadow,transform]",
    "duration-fast ease-out",
    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    // O levante de 1px no hover não vale para quem pediu menos movimento:
    // `motion-reduce:` é emitido DEPOIS do `hover:` (mesma especificidade) e o
    // zera. Provado no CSS compilado por tests/unit/botao-movimento-reduzido.test.ts.
    "hover:-translate-y-px active:translate-y-0 motion-reduce:hover:translate-y-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-foreground hover:bg-accent-hover shadow-xs",
        default: "bg-accent text-accent-foreground hover:bg-accent-hover shadow-xs",
        secondary:
          "bg-surface text-accent-800 border border-accent-700 hover:border-accent-800 hover:bg-surface-hover hover:text-accent-900 dark:border-border dark:bg-surface-elevated dark:text-text dark:hover:border-accent dark:hover:bg-surface-elevated dark:hover:text-accent",
        outline:
          "bg-surface text-accent-800 border border-border hover:border-accent-700 hover:bg-surface-hover hover:text-accent-900 dark:bg-transparent dark:text-text dark:hover:border-accent dark:hover:bg-surface-elevated dark:hover:text-accent",
        ghost:
          "bg-transparent text-text hover:bg-surface-hover hover:text-accent-800 dark:hover:bg-accent-soft dark:hover:text-accent",
        // No escuro `--color-error` é #e78378, um fundo CLARO: a regra do tema é tinta
        // escura sobre fundo claro. `text-white` dava 2,65:1; `accent-foreground`
        // (#07110b) dá 7,24:1. Medido em tests/unit/tema-contraste-dos-componentes.test.ts.
        destructive: "bg-error text-white hover:brightness-95 shadow-xs dark:text-accent-foreground",
        link: "bg-transparent text-accent underline underline-offset-4 decoration-1 hover:decoration-2 h-auto p-0",
      },
      // Alturas de toque: abaixo de `lg` (mesmo corte que o resto da casca
      // usa pra decidir "é celular/tablet, é mouse") toda variante bate os
      // 44px recomendados pra alvo de toque; de `lg:` pra cima, onde quem
      // aciona é cursor, volta pro tamanho compacto original — mudar isso
      // globalmente pro app inteiro em telas grandes infla a densidade sem
      // necessidade nenhuma. `lg` já nascia com 44px e não precisou mudar.
      size: {
        sm: "h-11 px-3 text-xs lg:h-8",
        default: "h-11 px-4 text-sm lg:h-9",
        md: "h-11 px-4 text-sm lg:h-9",
        lg: "h-11 px-6 text-sm",
        icon: "h-11 w-11 lg:h-9 lg:w-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
