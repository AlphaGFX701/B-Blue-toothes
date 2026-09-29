import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { readTheme, writeTheme } from './theme-storage';

export type ThemeMode = 'dark' | 'light';

export const themes = {
  dark: {
    background: '#0A0E17',
    surface: '#121826',
    raised: '#1A2337',
    border: '#2A3950',
    text: '#F8FAFC',
    muted: '#B5C3D5',
    subtle: '#91A3BA',
    accent: '#38BDF8',
    accentText: '#061521',
    success: '#34D399',
    successText: '#05261B',
    warning: '#FBBF72',
    danger: '#FDA4AF',
    dangerSurface: '#3C1C2A',
    tint: '#163248',
  },
  light: {
    background: '#F8FAFC',
    surface: '#FFFFFF',
    raised: '#EDF3F8',
    border: '#D9E3ED',
    text: '#0F172A',
    muted: '#475569',
    subtle: '#64748B',
    accent: '#0284C7',
    accentText: '#FFFFFF',
    success: '#047857',
    successText: '#FFFFFF',
    warning: '#9A4D00',
    danger: '#B4233B',
    dangerSurface: '#FFF0F2',
    tint: '#DDF2FF',
  },
} as const;

type ThemeContextValue = {
  mode: ThemeMode;
  colors: typeof themes.dark | typeof themes.light;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('dark');
  const changedByUser = useRef(false);

  useEffect(() => {
    let mounted = true;
    void readTheme().then((saved) => {
      if (mounted && !changedByUser.current && (saved === 'dark' || saved === 'light')) setMode(saved);
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  const toggleTheme = () => {
    changedByUser.current = true;
    const next = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    void writeTheme(next).catch(() => undefined);
  };

  return <ThemeContext.Provider value={{ mode, colors: themes[mode], toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
