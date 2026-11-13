import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "cim-theme";

function currentTheme(): Theme {
  if (typeof document !== "undefined") {
    const active = document.documentElement.dataset.theme;
    if (active === "light" || active === "dark") return active;
  }
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeMeta?.setAttribute("content", theme === "dark" ? "#020817" : "#f4f7fc");
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  // Keep browser chrome and the root dataset synchronized with React state.
  // Preference persistence only happens on an explicit click, allowing the OS
  // theme to remain authoritative until the user chooses otherwise.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const followSystem = (event: MediaQueryListEvent) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setTheme(event.matches ? "light" : "dark");
      }
    };
    media.addEventListener("change", followSystem);
    return () => media.removeEventListener("change", followSystem);
  }, []);

  const nextTheme = theme === "dark" ? "light" : "dark";

  function toggle() {
    localStorage.setItem(STORAGE_KEY, nextTheme);
    setTheme(nextTheme);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="group flex h-9 items-center gap-2 rounded border border-cim-border-strong bg-cim-surface-2 px-2.5 text-cim-muted transition hover:border-cim-cyan/40 hover:text-cim-text"
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
    >
      <span className="relative grid h-4 w-4 place-items-center overflow-hidden">
        {theme === "dark" ? (
          <Moon size={15} className="text-cim-violet-soft" aria-hidden="true" />
        ) : (
          <Sun size={15} className="text-cim-warning" aria-hidden="true" />
        )}
      </span>
      <span className="hidden text-[9px] font-bold tracking-[.1em] lg:inline">
        {theme === "dark" ? "DARK" : "LIGHT"}
      </span>
    </button>
  );
}
