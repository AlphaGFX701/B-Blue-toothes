import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { ThemeProvider, useTheme } from '../theme';

let mockSavedTheme: string | null = null;

jest.mock('../theme-storage', () => ({
  readTheme: jest.fn(async () => mockSavedTheme),
  writeTheme: jest.fn(async (value: string) => { mockSavedTheme = value; }),
}));

const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;

beforeEach(() => { mockSavedTheme = null; });

test('starts dark, persists a light preference, and restores it on remount', async () => {
  const first = await renderHook(() => useTheme(), { wrapper });
  expect(first.result.current.mode).toBe('dark');
  await act(async () => { first.result.current.toggleTheme(); });
  expect(first.result.current.mode).toBe('light');
  await waitFor(() => expect(mockSavedTheme).toBe('light'));
  await first.unmount();

  const next = await renderHook(() => useTheme(), { wrapper });
  await waitFor(() => expect(next.result.current.mode).toBe('light'));
  await next.unmount();
});
