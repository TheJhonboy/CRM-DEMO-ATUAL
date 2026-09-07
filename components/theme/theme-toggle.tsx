"use client";

import * as React from "react";

import { useTheme } from "@/lib/theme";
import { useHotkeys } from "react-hotkeys-hook";
import { Sun, Moon, MonitorPlay } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);

  const cycle = () => {
    setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
  };

  useHotkeys("mod+shift+l", cycle, { preventDefault: true }, [theme]);

  // Antes do efeito, servidor e navegador desenham exatamente o mesmo botão.
  // Só depois de hidratar lemos a preferência persistida e trocamos o ícone.
  const Icon = !mounted ? Sun : theme === "dark" ? Moon : theme === "system" ? MonitorPlay : Sun;
  const ariaLabel = mounted ? `Tema: ${theme}. Cmd+Shift+L para alternar.` : "Alternar tema";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={ariaLabel}
    >
      <Icon size={16} aria-hidden />
    </Button>
  );
}
