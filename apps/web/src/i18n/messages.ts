import { enMessages } from "./locales/en";
import { zhCNMessages } from "./locales/zh-CN";

export const messages = {
  en: enMessages,
  "zh-CN": zhCNMessages,
} as const;

export type AppMessages = typeof messages.en;
export type MessageKey = keyof AppMessages;
