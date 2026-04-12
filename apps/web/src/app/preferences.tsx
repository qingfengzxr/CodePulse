import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { normalizeLocale, setRuntimeLocale } from "../i18n";
import {
  getSystemResolvedTheme,
  normalizeThemeMode,
  resolveThemeMode,
  type ResolvedTheme,
  type ThemeMode,
} from "../theme";

export type AppLocale = "zh-CN" | "en";

type PreferencesContextValue = {
  locale: AppLocale;
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setLocale: (locale: AppLocale) => void;
  setThemeMode: (mode: ThemeMode) => void;
};

const LOCALE_STORAGE_KEY = "code-dance-locale";
const THEME_STORAGE_KEY = "code-dance-theme-mode";

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function readStoredLocale(): AppLocale | null {
  if (typeof window === "undefined") {
    return null;
  }

  return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
}

function readNavigatorLocale(): AppLocale | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  for (const candidate of navigator.languages) {
    const locale = normalizeLocale(candidate);
    if (locale) {
      return locale;
    }
  }

  return normalizeLocale(navigator.language);
}

export function readInitialLocale(): AppLocale {
  return readStoredLocale() ?? readNavigatorLocale() ?? "en";
}

export function readInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }

  return normalizeThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY)) ?? "system";
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(() => readInitialLocale());
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readInitialThemeMode());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemResolvedTheme());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => {
      setSystemTheme(mediaQuery.matches ? "dark" : "light");
    };

    listener();
    mediaQuery.addEventListener("change", listener);
    return () => {
      mediaQuery.removeEventListener("change", listener);
    };
  }, []);

  const resolvedTheme = useMemo(
    () => resolveThemeMode(themeMode, systemTheme),
    [systemTheme, themeMode],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
    setRuntimeLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme, themeMode]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      locale,
      themeMode,
      resolvedTheme,
      setLocale,
      setThemeMode,
    }),
    [locale, resolvedTheme, themeMode],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) {
    throw new Error("usePreferences must be used within PreferencesProvider");
  }

  return value;
}
