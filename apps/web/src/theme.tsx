export {
  getSystemResolvedTheme,
  normalizeThemeMode,
  resolveThemeMode,
  type ResolvedTheme,
  type ThemeMode,
} from "./theme/index";

import { usePreferences } from "./app/preferences";

export function useThemeMode() {
  return usePreferences().resolvedTheme;
}
