import Storage from 'expo-sqlite/kv-store';

const HISTORY_KEY = 'ble-grade-lab/history/v1';

export type LabSessionKind = 'lab' | 'test';

export type LabHistoryRecord = {
  id: string;
  completedAt: string;
  deviceId: string;
  deviceName: string;
  ownName: string;
  buddyName: string;
  payload: string;
  firstValue: string;
  secondValue: string;
  // Older records have no kind and are treated as real lab sessions.
  sessionKind?: LabSessionKind;
};

export async function loadHistory(): Promise<LabHistoryRecord[]> {
  const raw = await Storage.getItem(HISTORY_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Saved lab history could not be read.');
  return parsed as LabHistoryRecord[];
}

export async function saveHistory(records: LabHistoryRecord[]): Promise<void> {
  await Storage.setItem(HISTORY_KEY, JSON.stringify(records));
}
