import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import { usePreferences, type AppLocale } from "../app/preferences";
import { messages, type MessageKey } from "./messages";

type Primitive = string | number | boolean | null | undefined;
type MessageParams = Record<string, Primitive>;

type I18nContextValue = {
  locale: AppLocale;
  t: (key: MessageKey, params?: MessageParams) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatPercent: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

let runtimeLocale: AppLocale = "en";

export function setRuntimeLocale(locale: AppLocale) {
  runtimeLocale = locale;
}

export function normalizeLocale(input: string | null | undefined): AppLocale | null {
  if (!input) {
    return null;
  }

  const normalized = input.toLowerCase();
  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en";
  }
  if (normalized === "zh" || normalized.startsWith("zh-")) {
    return "zh-CN";
  }

  return null;
}

function interpolate(template: string, params?: MessageParams) {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function translate(
  key: MessageKey,
  params?: MessageParams,
  locale: AppLocale = runtimeLocale,
): string {
  return interpolate(messages[locale][key], params);
}

export function formatNumberValue(
  value: number,
  locale: AppLocale = runtimeLocale,
  options?: Intl.NumberFormatOptions,
) {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatPercentValue(
  value: number,
  locale: AppLocale = runtimeLocale,
  options?: Intl.NumberFormatOptions,
) {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
    ...options,
  }).format(value);
}

export function formatDateValue(
  value: string | number | Date,
  locale: AppLocale = runtimeLocale,
  options?: Intl.DateTimeFormatOptions,
) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { locale } = usePreferences();

  const value = useMemo<I18nContextValue>(() => {
    setRuntimeLocale(locale);

    return {
      locale,
      t: (key, params) => translate(key, params, locale),
      formatNumber: (value, options) => formatNumberValue(value, locale, options),
      formatPercent: (value, options) => formatPercentValue(value, locale, options),
      formatDate: (value, options) => formatDateValue(value, locale, options),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used within I18nProvider");
  }

  return value;
}
