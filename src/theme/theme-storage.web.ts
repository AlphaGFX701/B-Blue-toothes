import type { ThemeMode } from './theme';

const THEME_KEY = 'ble-grade-lab/theme/v1';

export async function readTheme(): Promise<string | null> {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(THEME_KEY);
}

export async function writeTheme(mode: ThemeMode): Promise<void> {
  if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, mode);
}
