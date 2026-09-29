import Storage from 'expo-sqlite/kv-store';
import type { ThemeMode } from './theme';

const THEME_KEY = 'ble-grade-lab/theme/v1';

export function readTheme(): Promise<string | null> {
  return Storage.getItem(THEME_KEY);
}

export function writeTheme(mode: ThemeMode): Promise<void> {
  return Storage.setItem(THEME_KEY, mode);
}
