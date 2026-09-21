import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-border bg-surface-elevated px-4 py-3 dark:rounded-sm dark:border-white/10 dark:bg-surface",
          "text-sm leading-relaxed text-text placeholder:text-text-subtle",
          "transition-[background-color,border-color,box-shadow] duration-base ease-out",
          "hover:border-border-strong",
          // `outline-hidden` é o nome v4 do antigo `outline-none`; o resto da
          // linha é a escolha visual do tema.
          "focus-visible:border-accent-400 focus-visible:bg-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-soft dark:focus-visible:bg-surface",
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
Textarea.displayName = "Textarea";

export { Textarea };
