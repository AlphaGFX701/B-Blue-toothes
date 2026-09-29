import { Buffer } from 'buffer';
import type { NearbyDevice } from '@/hooks/use-ble-lab';
import type { LabHistoryRecord } from '@/lib/lab-history';

export type SignalFilter = 'all' | 'medium' | 'strong';
export type DeviceMode = 'all' | 'teacher';

export function filterDevices(devices: NearbyDevice[], query: string, signal: SignalFilter, mode: DeviceMode = 'all'): NearbyDevice[] {
  const search = query.trim().toLocaleLowerCase();
  return devices.filter((device) => {
    if (mode === 'teacher' && (device.kind !== 'ble' || !device.advertisesService)) return false;
    if (search && !`${device.name} ${device.id}`.toLocaleLowerCase().includes(search)) return false;
    if (signal === 'strong') return device.rssi !== null && device.rssi >= -60;
    if (signal === 'medium') return device.rssi !== null && device.rssi >= -80;
    return true;
  });
}

export function deviceListMessage({ isPhysicalDevice, scanning, scanFinished, total, modeMatches, mode }: {
  isPhysicalDevice: boolean;
  scanning: boolean;
  scanFinished: boolean;
  total: number;
  modeMatches: number;
  mode: DeviceMode;
}): string {
  if (!isPhysicalDevice) return 'This emulator cannot discover nearby Bluetooth devices. Install the app on a physical phone to test scanning.';
  if (total === 0) {
    if (scanning) return 'Scanning now. Devices will appear here as soon as they are found.';
    if (scanFinished) return 'No devices found. Check Bluetooth and Nearby devices permission. On Android 11 or older, also turn on Location. BLE devices must advertise; new Classic devices must be discoverable. Then scan again.';
    return 'No devices listed yet. Tap Scan to discover nearby Bluetooth devices; no device name is needed.';
  }
  if (mode === 'teacher' && modeMatches === 0) {
    return 'No BLE device advertised the required Service UUID. The teacher device may omit it; switch to All devices to choose from the full list.';
  }
  return 'No devices match this search or signal filter.';
}

export function payloadPreview(ownName: string, buddyName: string): string {
  const own = ownName.trim();
  const buddy = buddyName.trim();
  return own || buddy ? `${own},${buddy}` : '';
}

export function payloadBytes(payload: string): number {
  return Buffer.byteLength(payload, 'utf8');
}

export function formatLabReport(record: LabHistoryRecord): string {
  const timestamp = new Date(record.completedAt);
  const localTime = Number.isNaN(timestamp.getTime())
    ? record.completedAt
    : timestamp.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  return [
    record.sessionKind === 'test' ? '=== BLE Grade Lab Test Report ===' : '=== BLE Grade Lab Submission ===',
    `Session: ${record.sessionKind === 'test' ? 'Test session (Windows BLE simulator)' : 'Real lab'}`,
    `Device: ${record.deviceName}`,
    `Device ID: ${record.deviceId}`,
    `Students: ${record.ownName} & ${record.buddyName}`,
    `Payload: ${record.payload} (${payloadBytes(record.payload)} bytes)`,
    `Initial Value: ${record.firstValue}`,
    `${record.sessionKind === 'test' ? 'Test result from device' : 'Result from device'}: ${record.secondValue}`,
    ...(record.sessionKind === 'test' ? ['TEST OK checks BLE communication; it is not a teacher grade.'] : []),
    `Timestamp: ${localTime}`,
    '================================',
  ].join('\n');
}
