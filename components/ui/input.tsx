import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-border bg-surface-elevated px-4 py-2 dark:rounded-sm dark:border-white/10 dark:bg-surface",
          "text-sm text-text placeholder:text-text-subtle",
          "transition-[background-color,border-color,box-shadow] duration-base ease-out",
          "hover:border-border-strong",
          // `outline-hidden` e não `outline-none`: na v4 quem zera o contorno
          // mantendo o anel do modo de alto contraste é `outline-hidden`;
          // `outline-none` virou `outline-style: none`. O resto da linha é a
          // escolha visual do tema (borda 400 e campo que clareia no foco).
          "focus-visible:border-accent-400 focus-visible:bg-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-soft dark:focus-visible:bg-surface",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text",
          "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-tertiary disabled:text-text-subtle disabled:opacity-100 dark:disabled:opacity-55",
          "aria-[invalid=true]:border-error aria-[invalid=true]:focus-visible:ring-error-bg",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
