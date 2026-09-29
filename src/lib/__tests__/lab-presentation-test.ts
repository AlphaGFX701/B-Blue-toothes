import { deviceListMessage, filterDevices, formatLabReport, payloadBytes, payloadPreview } from '../lab-presentation';
import type { NearbyDevice } from '@/hooks/use-ble-lab';
import type { LabHistoryRecord } from '@/lib/lab-history';

const devices: NearbyDevice[] = [
  { id: 'teacher-01', name: 'Teacher BLE', rssi: -48, advertisesService: true, kind: 'ble' },
  { id: 'student-02', name: 'Student', rssi: -75, advertisesService: false, kind: 'ble' },
  { id: 'unknown-03', name: 'Unnamed device', rssi: null, advertisesService: false, kind: 'ble' },
  { id: 'weak-04', name: 'Weak', rssi: -85, advertisesService: false, kind: 'ble' },
  { id: 'classic-05', name: 'Paired speaker', rssi: null, advertisesService: false, kind: 'classic', paired: true },
];

test('filters devices by case-insensitive name or ID and signal threshold', () => {
  expect(filterDevices(devices, 'TEACHER', 'all').map((item) => item.id)).toEqual(['teacher-01']);
  expect(filterDevices(devices, '02', 'all').map((item) => item.id)).toEqual(['student-02']);
  expect(filterDevices(devices, '', 'medium').map((item) => item.id)).toEqual(['teacher-01', 'student-02']);
  expect(filterDevices(devices, '', 'strong').map((item) => item.id)).toEqual(['teacher-01']);
  expect(filterDevices(devices, '', 'all')).toHaveLength(5);
  expect(filterDevices(devices, '', 'all', 'teacher').map((item) => item.id)).toEqual(['teacher-01']);
  expect(filterDevices(devices, 'TEACHER', 'strong', 'teacher').map((item) => item.id)).toEqual(['teacher-01']);
  expect(filterDevices(devices, 'STUDENT', 'all', 'teacher')).toHaveLength(0);
});

test('switching list modes filters existing scan results without changing them', () => {
  const allDevices = filterDevices(devices, '', 'all', 'all');
  const teacherDevices = filterDevices(devices, '', 'all', 'teacher');
  expect(allDevices).toHaveLength(5);
  expect(teacherDevices).toHaveLength(1);
  expect(filterDevices(devices, '', 'all', 'all')).toHaveLength(5);
  expect(filterDevices(devices, 'speaker', 'all', 'all').map((item) => item.kind)).toEqual(['classic']);
  expect(filterDevices(devices, 'speaker', 'all', 'teacher')).toHaveLength(0);
  expect(devices).toHaveLength(5);
});

test('empty-list guidance distinguishes emulator, no BLE results and no teacher UUID', () => {
  const state = { isPhysicalDevice: true, scanning: false, scanFinished: true, total: 0, modeMatches: 0, mode: 'all' as const };
  expect(deviceListMessage({ ...state, isPhysicalDevice: false })).toContain('physical phone');
  expect(deviceListMessage(state)).toContain('No devices found');
  expect(deviceListMessage({ ...state, scanning: true, scanFinished: false })).toContain('Scanning now');
  expect(deviceListMessage({ ...state, mode: 'teacher', total: 2 })).toContain('switch to All devices');
  expect(deviceListMessage({ ...state, mode: 'teacher', total: 2, modeMatches: 1 })).toContain('search or signal filter');
});

test('counts actual UTF-8 payload bytes including the separator', () => {
  expect(payloadBytes(payloadPreview(' Alice ', ' Bob '))).toBe(9);
  expect(payloadBytes(payloadPreview('ก', 'Bob'))).toBe(7);
  expect(payloadBytes(payloadPreview('123456789', '1234567890'))).toBe(20);
  expect(payloadBytes(payloadPreview('1234567890', '1234567890'))).toBe(21);
  expect(payloadBytes(payloadPreview('', ''))).toBe(0);
});

test('formats a copyable report from the saved record without inventing a grade', () => {
  const record: LabHistoryRecord = {
    id: 'one', completedAt: '2026-09-29T14:35:00.000Z', deviceId: 'teacher-01',
    deviceName: 'Teacher BLE', ownName: 'Alice', buddyName: 'Bob', payload: 'Alice,Bob',
    firstValue: 'READY_01', secondValue: 'grade A',
  };
  const report = formatLabReport(record);
  expect(report).toContain('Device ID: teacher-01');
  expect(report).toContain('Payload: Alice,Bob (9 bytes)');
  expect(report).toContain('Initial Value: READY_01');
  expect(report).toContain('Result from device: grade A');
  expect(report).toContain('Timestamp:');
  expect(report).not.toContain('Predicted Grade:');
  expect(report).toContain('Session: Real lab');

  const testReport = formatLabReport({ ...record, sessionKind: 'test', firstValue: '68', secondValue: 'TEST OK' });
  expect(testReport).toContain('BLE Grade Lab Test Report');
  expect(testReport).toContain('Session: Test session (Windows BLE simulator)');
  expect(testReport).toContain('Test result from device: TEST OK');
  expect(testReport).toContain('not a teacher grade');
});
