import { createContext, useContext, type ReactNode } from "react";

export type ThemeMode = "light" | "dark";

const ThemeContext = createContext<ThemeMode>("dark");

export function ThemeProvider({
  children,
  theme,
}: {
  children: ReactNode;
  theme: ThemeMode;
}) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useThemeMode() {
  return useContext(ThemeContext);
}
