import { Buffer } from 'buffer';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { PermissionsAndroid, Platform } from 'react-native';
import { SERVICE_UUID, useBleLab } from '../use-ble-lab';
import { filterDevices } from '@/lib/lab-presentation';
import { classicDiscovery } from '@/lib/classic-discovery';

let mockClassicListeners: Record<string, (value?: never) => void> = {};

jest.mock('@/lib/classic-discovery', () => ({
  classicDiscovery: {
    getPairedDevicesAsync: jest.fn(async () => []),
    startDiscoveryAsync: jest.fn(async () => true),
    stopDiscoveryAsync: jest.fn(async () => undefined),
    addListener: jest.fn((event: string, listener: (value?: never) => void) => {
      mockClassicListeners[event] = listener;
      return { remove: jest.fn() };
    }),
  },
}));

let mockManager: {
  scanListener?: (error: Error | null, device?: unknown) => void;
  disconnectListener?: (error?: Error) => void;
  state: jest.Mock;
  startDeviceScan: jest.Mock;
  stopDeviceScan: jest.Mock;
  connectToDevice: jest.Mock;
  onDeviceDisconnected: jest.Mock;
  cancelDeviceConnection: jest.Mock;
};
let mockSaved: unknown[] = [];

jest.mock('@/lib/lab-history', () => ({
  loadHistory: jest.fn(async () => mockSaved),
  saveHistory: jest.fn(async (records: unknown[]) => { mockSaved = records; }),
}));

jest.mock('react-native-ble-plx', () => ({
  State: { PoweredOn: 'PoweredOn' },
  BleManager: jest.fn().mockImplementation(() => {
    mockManager = {
      state: jest.fn(async () => 'PoweredOn'),
      startDeviceScan: jest.fn(async (_uuids, _options, listener) => { mockManager.scanListener = listener; }),
      stopDeviceScan: jest.fn(async () => undefined),
      connectToDevice: jest.fn(),
      onDeviceDisconnected: jest.fn((_id, listener) => {
        mockManager.disconnectListener = listener;
        return { remove: jest.fn() };
      }),
      cancelDeviceConnection: jest.fn(async () => undefined),
    };
    return {
      ...mockManager,
      onStateChange: (listener: (state: string) => void) => {
        listener('PoweredOn');
        return { remove: jest.fn() };
      },
      destroy: jest.fn(async () => undefined),
    };
  }),
}));

const nearby = { id: 'teacher-1', name: 'Teacher BLE', rssi: -48, advertisesService: true, kind: 'ble' as const };

function fakeConnection() {
  const characteristic = {
    uuid: 'cde07b1a-889b-44b7-a99f-c888dddac729',
    isReadable: true,
    isWritableWithResponse: true,
    isWritableWithoutResponse: false,
    read: jest.fn()
      .mockResolvedValueOnce({ value: Buffer.from('before').toString('base64') })
      .mockResolvedValue({ value: Buffer.from('grade A').toString('base64') }),
    writeWithResponse: jest.fn(async () => undefined),
  };
  const device: {
    id: string;
    discoverAllServicesAndCharacteristics: jest.Mock;
    services: jest.Mock;
    characteristicsForService: jest.Mock;
  } = {
    id: nearby.id,
    discoverAllServicesAndCharacteristics: jest.fn(async () => device),
    services: jest.fn(async () => [{ uuid: 'aee04821-1973-4e1f-a590-e84b10d580e7' }]),
    characteristicsForService: jest.fn(async () => [characteristic]),
  };
  mockManager.connectToDevice.mockResolvedValue(device);
  return characteristic;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSaved = [];
  mockClassicListeners = {};
  jest.mocked(classicDiscovery!.getPairedDevicesAsync).mockResolvedValue([]);
});

test('BLE scan refreshes RSSI before moving to Classic discovery', async () => {
  jest.useFakeTimers();
  const hook = await renderHook(() => useBleLab());
  await act(async () => { await hook.result.current.scan(); });
  await act(async () => {
    mockManager.scanListener?.(null, { id: 'weak', name: 'Weak', rssi: -85 });
    mockManager.scanListener?.(null, { id: 'strong', name: 'Strong', rssi: -50 });
    mockManager.scanListener?.(null, { id: 'weak', name: 'Weak', rssi: -40 });
  });
  expect(hook.result.current.nearbyDevices.map((device) => device.id)).toEqual(['weak', 'strong']);
  expect(hook.result.current.nearbyDevices[0].rssi).toBe(-40);
  await act(async () => { jest.advanceTimersByTime(12000); });
  expect(hook.result.current.scanPhase).toBe('classic');
  await act(async () => { mockClassicListeners.onDiscoveryFinished?.(); });
  expect(hook.result.current.scanFinished).toBe(true);
  expect(hook.result.current.scanning).toBe(false);
  const oldScan = mockManager.scanListener;
  await act(async () => { await hook.result.current.scan(); });
  await act(async () => { oldScan?.(null, { id: 'stale', name: 'Stale', rssi: -20 }); });
  expect(hook.result.current.nearbyDevices).toHaveLength(0);
  await hook.unmount();
  jest.useRealTimers();
});

test('one scan lists paired and discoverable Classic devices but never sends them to BLE connect', async () => {
  jest.useFakeTimers();
  jest.mocked(classicDiscovery!.getPairedDevicesAsync).mockResolvedValue([
    { id: 'AA:BB:CC:00:00:01', name: 'Paired speaker', rssi: null, paired: true, dualMode: false },
  ]);
  const hook = await renderHook(() => useBleLab());
  await act(async () => { await hook.result.current.scan(); });
  expect(hook.result.current.nearbyDevices).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'AA:BB:CC:00:00:01', kind: 'classic', paired: true }),
  ]));
  await act(async () => {
    mockManager.scanListener?.(null, { id: 'ble-1', name: 'BLE test device', rssi: -50 });
    jest.advanceTimersByTime(12000);
  });
  expect(hook.result.current.scanPhase).toBe('classic');
  await act(async () => {
    mockClassicListeners.onDeviceFound?.({
      id: 'AA:BB:CC:00:00:02', name: 'New speaker', rssi: -70, paired: false, dualMode: false,
    } as never);
  });
  expect(hook.result.current.nearbyDevices.map((item) => item.kind)).toEqual(['ble', 'classic', 'classic']);
  expect(filterDevices(hook.result.current.nearbyDevices, '', 'all', 'teacher')).toHaveLength(0);
  await act(async () => { hook.result.current.connect(hook.result.current.nearbyDevices[1]); });
  expect(mockManager.connectToDevice).not.toHaveBeenCalled();
  await act(async () => { mockClassicListeners.onDiscoveryFinished?.(); });
  expect(hook.result.current.scanFinished).toBe(true);
  await hook.unmount();
  jest.useRealTimers();
});

test('scan lists every discovered device before the timeout', async () => {
  const hook = await renderHook(() => useBleLab());
  await act(async () => { await hook.result.current.scan(); });
  await act(async () => {
    for (let index = 0; index < 35; index += 1) {
      mockManager.scanListener?.(null, { id: `device-${index}`, name: `Device ${index}`, rssi: -50 - index });
    }
  });
  expect(hook.result.current.scanning).toBe(true);
  expect(hook.result.current.nearbyDevices).toHaveLength(35);
  expect(hook.result.current.nearbyDevices[0].id).toBe('device-0');
  await hook.unmount();
});

test('Android 12+ scans when Nearby devices is allowed even if Location is denied', async () => {
  const originalOS = Platform.OS;
  Platform.OS = 'android';
  const version = jest.spyOn(Platform, 'Version', 'get').mockReturnValue(34);
  const permissions = jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
    [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]: PermissionsAndroid.RESULTS.GRANTED,
    [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]: PermissionsAndroid.RESULTS.GRANTED,
    [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]: PermissionsAndroid.RESULTS.DENIED,
    [PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION]: PermissionsAndroid.RESULTS.DENIED,
  } as never);
  try {
    const hook = await renderHook(() => useBleLab());
    await act(async () => { await hook.result.current.scan(); });
    expect(permissions).toHaveBeenCalledWith([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    expect(mockManager.startDeviceScan).toHaveBeenCalledTimes(1);
    await act(async () => {
      mockManager.scanListener?.(null, { id: 'nearby-1', name: 'Nearby BLE', rssi: -55 });
    });
    expect(hook.result.current.nearbyDevices.map((device) => device.id)).toEqual(['nearby-1']);
    await hook.unmount();
  } finally {
    permissions.mockRestore();
    version.mockRestore();
    Platform.OS = originalOS;
  }
});

test('live scan keeps all BLE results while teacher mode uses advertised service UUID', async () => {
  const hook = await renderHook(() => useBleLab());
  await act(async () => { await hook.result.current.scan(); });
  expect(mockManager.startDeviceScan).toHaveBeenCalledWith(null, expect.anything(), expect.any(Function));
  await act(async () => {
    mockManager.scanListener?.(null, { id: 'other', name: 'Other', rssi: -60 });
    mockManager.scanListener?.(null, { id: 'teacher', name: 'Teacher', rssi: -50, serviceUUIDs: [SERVICE_UUID.toUpperCase()] });
  });
  expect(hook.result.current.scanning).toBe(true);
  expect(filterDevices(hook.result.current.nearbyDevices, '', 'all', 'all')).toHaveLength(2);
  expect(filterDevices(hook.result.current.nearbyDevices, '', 'all', 'teacher').map((item) => item.id)).toEqual(['teacher']);
  expect(mockManager.startDeviceScan).toHaveBeenCalledTimes(1);
  await hook.unmount();
});

test('disconnect keeps the completed session; reconnect does not write again; reset clears the session', async () => {
  const hook = await renderHook(() => useBleLab());
  const characteristic = fakeConnection();
  await act(async () => { hook.result.current.connect(nearby); });
  await waitFor(() => expect(hook.result.current.connectedDevice?.id).toBe(nearby.id));
  await act(async () => { hook.result.current.readFirst(); });
  await waitFor(() => expect(hook.result.current.firstValue).toBe('before'));
  await act(async () => { hook.result.current.writeNames('Alice', 'Bob'); });
  await waitFor(() => expect(hook.result.current.writtenValue).toBe('Alice,Bob'));
  await act(async () => { hook.result.current.readFirst(); });
  expect(characteristic.read).toHaveBeenCalledTimes(1);
  await act(async () => { mockManager.disconnectListener?.(new Error('Device disconnected')); });
  expect(hook.result.current.connectionLost).toBe(true);
  expect(hook.result.current.firstValue).toBe('before');
  expect(hook.result.current.writtenValue).toBe('Alice,Bob');
  await act(async () => { hook.result.current.reconnect(); });
  await waitFor(() => expect(hook.result.current.connectedDevice?.id).toBe(nearby.id));
  expect(characteristic.writeWithResponse).toHaveBeenCalledTimes(1);
  await act(async () => { await hook.result.current.resetLab(); });
  expect(hook.result.current.firstValue).toBeNull();
  expect(hook.result.current.writtenValue).toBeNull();
  expect(hook.result.current.connectedDevice).toBeNull();
  await hook.unmount();
});

test('repeat result updates one history entry and history survives remount', async () => {
  const hook = await renderHook(() => useBleLab());
  fakeConnection();
  await act(async () => { hook.result.current.connect(nearby); });
  await waitFor(() => expect(hook.result.current.connectedDevice).not.toBeNull());
  await act(async () => { hook.result.current.readFirst(); });
  await waitFor(() => expect(hook.result.current.firstValue).toBe('before'));
  await act(async () => { hook.result.current.writeNames('Alice', 'Bob'); });
  await waitFor(() => expect(hook.result.current.writtenValue).toBe('Alice,Bob'));
  await act(async () => { hook.result.current.readSecond(); });
  await waitFor(() => expect(hook.result.current.history).toHaveLength(1));
  expect(hook.result.current.latestRecord?.secondValue).toBe('grade A');
  await act(async () => { hook.result.current.readSecond(); });
  expect(hook.result.current.history).toHaveLength(1);
  expect(hook.result.current.history[0].secondValue).toBe('grade A');
  await hook.unmount();
  const next = await renderHook(() => useBleLab());
  await waitFor(() => expect(next.result.current.history).toHaveLength(1));
  await act(async () => { await next.result.current.resetLab(); });
  expect(next.result.current.history).toHaveLength(1);
  expect(next.result.current.latestRecord).toBeNull();
  await act(async () => { await next.result.current.clearHistory(); });
  expect(next.result.current.historyError).toBeNull();
  await waitFor(() => expect(next.result.current.history).toHaveLength(0));
  await next.unmount();
});

test('test session is locked after connecting, saved as test, and reset restores real lab', async () => {
  const hook = await renderHook(() => useBleLab());
  const characteristic = fakeConnection();
  characteristic.read.mockReset()
    .mockResolvedValueOnce({ value: Buffer.from('68').toString('base64') })
    .mockResolvedValue({ value: Buffer.from('TEST OK').toString('base64') });
  await act(async () => { hook.result.current.setSessionKind('test'); });
  expect(hook.result.current.sessionKind).toBe('test');
  await act(async () => { await hook.result.current.scan(); });
  await act(async () => { hook.result.current.connect(nearby); });
  await waitFor(() => expect(hook.result.current.connectedDevice?.id).toBe(nearby.id));
  expect(hook.result.current.sessionLocked).toBe(true);
  await act(async () => { hook.result.current.setSessionKind('lab'); });
  expect(hook.result.current.sessionKind).toBe('test');
  await act(async () => { hook.result.current.readFirst(); });
  await waitFor(() => expect(hook.result.current.firstValue).toBe('68'));
  await act(async () => { hook.result.current.writeNames('Alice', 'Bob'); });
  await waitFor(() => expect(hook.result.current.writtenValue).toBe('Alice,Bob'));
  await act(async () => { hook.result.current.readSecond(); });
  await waitFor(() => expect(hook.result.current.history).toHaveLength(1));
  expect(hook.result.current.latestRecord).toMatchObject({ sessionKind: 'test', firstValue: '68', secondValue: 'TEST OK' });
  await act(async () => { await hook.result.current.resetLab(); });
  expect(hook.result.current.sessionKind).toBe('lab');
  expect(hook.result.current.sessionLocked).toBe(false);
  expect(hook.result.current.history[0].sessionKind).toBe('test');
  await hook.unmount();
});

test('rejects a device without the required service and cancels its connection', async () => {
  const hook = await renderHook(() => useBleLab());
  fakeConnection();
  const device = await mockManager.connectToDevice(nearby.id);
  device.services.mockResolvedValue([{ uuid: 'another-service' }]);
  await act(async () => { await hook.result.current.scan(); });
  await act(async () => {
    mockManager.scanListener?.(null, { id: 'wrong-device', name: 'Wrong device', rssi: -40 });
    mockManager.scanListener?.(null, { id: nearby.id, name: nearby.name, rssi: nearby.rssi });
  });
  await act(async () => { hook.result.current.connect(hook.result.current.nearbyDevices[0]); });
  await waitFor(() => expect(hook.result.current.error).toContain('Service UUID'));
  expect(hook.result.current.connectedDevice).toBeNull();
  expect(hook.result.current.nearbyDevices).toHaveLength(2);
  expect(mockManager.cancelDeviceConnection).toHaveBeenCalledWith(device.id);
  device.services.mockResolvedValue([{ uuid: 'aee04821-1973-4e1f-a590-e84b10d580e7' }]);
  await act(async () => { hook.result.current.connect(nearby); });
  await waitFor(() => expect(hook.result.current.connectedDevice?.id).toBe(nearby.id));
  expect(hook.result.current.error).toBeNull();
  await hook.unmount();
});

test('reset ignores a connection that finishes afterward', async () => {
  const hook = await renderHook(() => useBleLab());
  fakeConnection();
  const device = await mockManager.connectToDevice(nearby.id);
  let finishConnect: (value: typeof device) => void = () => undefined;
  mockManager.connectToDevice.mockImplementation(() => new Promise((resolve) => { finishConnect = resolve; }));
  await act(async () => { hook.result.current.connect(nearby); });
  await waitFor(() => expect(mockManager.connectToDevice).toHaveBeenCalledTimes(2));
  await act(async () => { await hook.result.current.resetLab(); });
  await act(async () => { finishConnect(device); });
  await waitFor(() => expect(mockManager.cancelDeviceConnection).toHaveBeenCalledWith(nearby.id));
  expect(hook.result.current.connectedDevice).toBeNull();
  await hook.unmount();
});

test('disconnect during a read keeps the previous result and offers reconnect', async () => {
  const hook = await renderHook(() => useBleLab());
  const characteristic = fakeConnection();
  await act(async () => { hook.result.current.connect(nearby); });
  await waitFor(() => expect(hook.result.current.connectedDevice).not.toBeNull());
  await act(async () => { hook.result.current.readFirst(); });
  await waitFor(() => expect(hook.result.current.firstValue).toBe('before'));
  let rejectRead: (error: Error) => void = () => undefined;
  characteristic.read.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
  await act(async () => { hook.result.current.readFirst(); });
  await act(async () => { mockManager.disconnectListener?.(new Error('Device disconnected')); });
  await act(async () => { rejectRead(new Error('Device disconnected')); });
  await waitFor(() => expect(hook.result.current.action).toBeNull());
  expect(hook.result.current.connectionLost).toBe(true);
  expect(hook.result.current.firstValue).toBe('before');
  expect(hook.result.current.lastDevice?.id).toBe(nearby.id);
  await hook.unmount();
});
