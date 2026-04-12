export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export function normalizeThemeMode(input: string | null | undefined): ThemeMode | null {
  return input === "light" || input === "dark" || input === "system" ? input : null;
}

export function getSystemResolvedTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveThemeMode(
  mode: ThemeMode,
  systemTheme: ResolvedTheme = getSystemResolvedTheme(),
): ResolvedTheme {
  return mode === "system" ? systemTheme : mode;
}
