import { Buffer } from 'buffer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State } from 'react-native-ble-plx';
import type { Characteristic, Device, Subscription } from 'react-native-ble-plx';
import { classicDiscovery } from '@/lib/classic-discovery';
import type { ClassicDevice } from '@/lib/classic-discovery';
import { loadHistory, saveHistory } from '@/lib/lab-history';
import type { LabHistoryRecord, LabSessionKind } from '@/lib/lab-history';

export const SERVICE_UUID = 'aee04821-1973-4e1f-a590-e84b10d580e7';
export const CHAR_UUID = 'cde07b1a-889b-44b7-a99f-c888dddac729';
export const MAX_WRITE_BYTES = 20;

const BLE_SCAN_DURATION_MS = 12000;
const CLASSIC_SCAN_DURATION_MS = 18000;

export type NearbyDevice = {
  id: string;
  name: string;
  rssi: number | null;
  advertisesService: boolean;
  kind: 'ble' | 'classic';
  paired?: boolean;
  dualMode?: boolean;
};

type Action = 'connect' | 'first-read' | 'write' | 'second-read' | null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function friendlyError(error: unknown): string {
  const raw = errorMessage(error);
  if (raw.startsWith('Nearby devices permission') || raw.startsWith('Location permission')) return raw;
  if (/permission|unauthorized|denied/i.test(raw)) return 'Bluetooth permission is off. Allow Nearby devices in Android Settings, then try again.';
  if (/powered.?off|bluetooth.*off/i.test(raw)) return 'Bluetooth is off. Turn it on, then try again.';
  if (/disconnect|not connected|device.*lost/i.test(raw)) return 'Connection lost. Move closer to the device and tap Reconnect.';
  if (/timeout|timed out/i.test(raw)) return 'The device did not respond. Move closer and try again.';
  if (/cancel/i.test(raw)) return 'The operation was cancelled. Please try again.';
  return raw.startsWith('This device') || raw.startsWith('Enter ') || raw.startsWith('Payload ')
    ? raw
    : 'Could not complete the Bluetooth operation. Check the device and try again.';
}

function decodeValue(value: string | null): string {
  if (value === null) return '(no value from device)';

  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0) return '(empty value)';

  const text = bytes.toString('utf8').replace(/\0+$/, '').trim();
  if (text && !/[\u0000-\u001f\ufffd]/.test(text)) return text;

  return `0x${bytes.toString('hex').toUpperCase()}`;
}

function upsertDevice(current: NearbyDevice[], next: NearbyDevice): NearbyDevice[] {
  const prior = current.find((item) => item.kind === next.kind && item.id === next.id);
  const updated = prior ? {
    ...prior,
    ...next,
    name: next.name.startsWith('Unnamed') && !prior.name.startsWith('Unnamed') ? prior.name : next.name,
    rssi: next.rssi ?? prior.rssi,
    advertisesService: prior.advertisesService || next.advertisesService,
    paired: prior.paired || next.paired,
  } : next;
  return [...current.filter((item) => item.kind !== next.kind || item.id !== next.id), updated]
    .sort((a, b) => Number(a.kind === 'classic') - Number(b.kind === 'classic') ||
      (b.rssi ?? -120) - (a.rssi ?? -120) || Number(b.advertisesService) - Number(a.advertisesService));
}

async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  if (Number(Platform.Version) < 31) {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  const permissions = [
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  ];
  const results = await PermissionsAndroid.requestMultiple(permissions);
  return permissions.every((permission) => results[permission] === PermissionsAndroid.RESULTS.GRANTED);
}

export function useBleLab() {
  const managerRef = useRef<BleManager | null>(null);
  const connectedRef = useRef<Device | null>(null);
  const characteristicRef = useRef<Characteristic | null>(null);
  const disconnectSubscriptionRef = useRef<Subscription | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const classicDeviceSubscriptionRef = useRef<{ remove(): void } | null>(null);
  const classicFinishedSubscriptionRef = useRef<{ remove(): void } | null>(null);
  const actionRef = useRef(false);
  const actionTokenRef = useRef(0);
  const scanEpochRef = useRef(0);
  const scanPendingRef = useRef(false);
  const sessionEpochRef = useRef(0);
  const recordIdRef = useRef<string | null>(null);
  const sessionKindRef = useRef<LabSessionKind>('lab');
  const sessionLockedRef = useRef(false);

  const [adapterState, setAdapterState] = useState<State | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nearbyDevices, setNearbyDevices] = useState<NearbyDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanPhase, setScanPhase] = useState<'ble' | 'classic' | null>(null);
  const [classicWarning, setClassicWarning] = useState<string | null>(null);
  const [connectedDevice, setConnectedDevice] = useState<NearbyDevice | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [firstValue, setFirstValue] = useState<string | null>(null);
  const [writtenValue, setWrittenValue] = useState<string | null>(null);
  const [secondValue, setSecondValue] = useState<string | null>(null);
  const [submittedNames, setSubmittedNames] = useState<{ ownName: string; buddyName: string } | null>(null);
  const [lastDevice, setLastDevice] = useState<NearbyDevice | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [scanFinished, setScanFinished] = useState(false);
  const [history, setHistory] = useState<LabHistoryRecord[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [latestRecord, setLatestRecord] = useState<LabHistoryRecord | null>(null);
  const [sessionKind, setSessionKindState] = useState<LabSessionKind>('lab');
  const [sessionLocked, setSessionLocked] = useState(false);
  const historyRef = useRef<LabHistoryRecord[]>([]);
  const historyMutationRef = useRef(0);

  useEffect(() => {
    let active = true;
    const mutation = historyMutationRef.current;
    void loadHistory().then((records) => {
      if (!active || historyMutationRef.current !== mutation) return;
      historyRef.current = records;
      setHistory(records);
    }).catch(() => {
      if (active) setHistoryError('Could not load saved history on this device.');
    });
    return () => { active = false; };
  }, []);

  const clearScanTimer = useCallback(() => {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  }, []);

  const stopScan = useCallback(async () => {
    scanEpochRef.current += 1;
    clearScanTimer();
    classicDeviceSubscriptionRef.current?.remove();
    classicFinishedSubscriptionRef.current?.remove();
    classicDeviceSubscriptionRef.current = null;
    classicFinishedSubscriptionRef.current = null;
    setScanning(false);
    setScanPhase(null);
    const manager = managerRef.current;
    await Promise.allSettled([
      manager?.stopDeviceScan(),
      classicDiscovery?.stopDiscoveryAsync(),
    ]);
  }, [clearScanTimer]);

  const clearConnection = useCallback(() => {
    connectedRef.current = null;
    characteristicRef.current = null;
    disconnectSubscriptionRef.current?.remove();
    disconnectSubscriptionRef.current = null;
    setConnectedDevice(null);
  }, []);

  const clearSession = useCallback(() => {
    sessionEpochRef.current += 1;
    recordIdRef.current = null;
    setFirstValue(null);
    setWrittenValue(null);
    setSecondValue(null);
    setSubmittedNames(null);
    setLatestRecord(null);
  }, []);

  const setSessionKind = useCallback((kind: LabSessionKind) => {
    if (sessionLockedRef.current || connectedRef.current || actionRef.current) return;
    sessionKindRef.current = kind;
    setSessionKindState(kind);
  }, []);

  useEffect(() => {
    let active = true;
    let manager: BleManager;

    try {
      manager = new BleManager();
      managerRef.current = manager;
    } catch {
      queueMicrotask(() => {
        if (active) setSetupError('Bluetooth could not start. Rebuild the development app and try again.');
      });
      return () => {
        active = false;
      };
    }

    const subscription = manager.onStateChange((state) => {
      if (!active) return;
      setAdapterState(state);
      if (state !== State.PoweredOn) {
        void stopScan();
      }
    }, true);

    return () => {
      active = false;
      subscription.remove();
      disconnectSubscriptionRef.current?.remove();
      clearScanTimer();
      classicDeviceSubscriptionRef.current?.remove();
      classicFinishedSubscriptionRef.current?.remove();
      void classicDiscovery?.stopDiscoveryAsync().catch(() => undefined);
      managerRef.current = null;
      void manager.destroy().catch(() => undefined);
    };
  }, [clearScanTimer, stopScan]);

  const runAction = useCallback(async (nextAction: Exclude<Action, null>, task: () => Promise<void>) => {
    if (actionRef.current) return;
    actionRef.current = true;
    const token = ++actionTokenRef.current;
    setAction(nextAction);
    setError(null);
    try {
      await task();
    } catch (cause) {
      if (actionTokenRef.current === token) setError(friendlyError(cause));
    } finally {
      if (actionTokenRef.current === token) {
        actionRef.current = false;
        setAction(null);
      }
    }
  }, []);

  const scan = useCallback(async () => {
    const manager = managerRef.current;
    if (!manager || actionRef.current || connectedRef.current || scanPendingRef.current || scanning) return;

    scanPendingRef.current = true;
    const requestEpoch = scanEpochRef.current;
    setError(null);
    setClassicWarning(null);
    setScanFinished(false);
    try {
      if (!(await requestBlePermissions())) {
        throw new Error(Number(Platform.Version) >= 31
          ? 'Nearby devices permission is off. Allow it in Android Settings, then scan again.'
          : 'Location permission is required for Bluetooth scanning on this Android version. Allow it, then scan again.');
      }

      const state = await manager.state();
      if (scanEpochRef.current !== requestEpoch) return;
      if (state !== State.PoweredOn) {
        throw new Error('Bluetooth is off. Turn it on before scanning.');
      }

      await stopScan();
      const epoch = ++scanEpochRef.current;
      setNearbyDevices([]);
      setScanning(true);
      setScanPhase('ble');

      const addClassicDevice = (device: ClassicDevice) => {
        if (scanEpochRef.current !== epoch) return;
        setNearbyDevices((current) => upsertDevice(current, {
          id: device.id,
          name: device.name,
          rssi: device.rssi,
          advertisesService: false,
          kind: 'classic',
          paired: device.paired,
          dualMode: device.dualMode,
        }));
      };

      if (classicDiscovery) {
        void classicDiscovery.getPairedDevicesAsync().then((devices) => {
          devices.forEach(addClassicDevice);
        }).catch(() => {
          if (scanEpochRef.current === epoch) setClassicWarning('Paired Classic devices could not be read on this phone.');
        });
      } else if (Platform.OS === 'android') {
        setClassicWarning('Classic discovery needs the updated Android app. Install the new APK to include Classic devices.');
      }

      const finishScan = async () => {
        if (scanEpochRef.current !== epoch) return;
        setScanFinished(true);
        await stopScan();
      };

      let bleEnded = false;
      const beginClassicScan = async () => {
        if (scanEpochRef.current !== epoch || bleEnded) return;
        bleEnded = true;
        clearScanTimer();
        await manager.stopDeviceScan().catch(() => undefined);
        if (scanEpochRef.current !== epoch) return;
        if (!classicDiscovery) {
          await finishScan();
          return;
        }

        setScanPhase('classic');
        classicDeviceSubscriptionRef.current = classicDiscovery.addListener('onDeviceFound', addClassicDevice);
        classicFinishedSubscriptionRef.current = classicDiscovery.addListener('onDiscoveryFinished', () => {
          void finishScan();
        });
        try {
          const started = await classicDiscovery.startDiscoveryAsync();
          if (scanEpochRef.current !== epoch) return;
          if (!started) {
            setClassicWarning('Classic discovery did not start. Check Bluetooth and try Scan again.');
            await finishScan();
            return;
          }
          scanTimerRef.current = setTimeout(() => { void finishScan(); }, CLASSIC_SCAN_DURATION_MS);
        } catch (cause) {
          if (scanEpochRef.current === epoch) {
            setClassicWarning(`Classic discovery failed: ${friendlyError(cause)}`);
            await finishScan();
          }
        }
      };

      // Scan without a UUID filter: the classroom device may omit its service from advertisements.
      try {
        await manager.startDeviceScan(null, { allowDuplicates: true }, (scanError, device) => {
          if (scanEpochRef.current !== epoch || bleEnded) return;
          if (scanError) {
            setError(friendlyError(scanError));
            void beginClassicScan();
            return;
          }
          if (!device) return;
          setNearbyDevices((current) => upsertDevice(current, {
            id: device.id,
            name: device.name || device.localName || 'Unnamed BLE device',
            rssi: device.rssi,
            advertisesService:
              device.serviceUUIDs?.some((uuid) => uuid.toLowerCase() === SERVICE_UUID) ?? false,
            kind: 'ble',
          }));
        });
      } catch (cause) {
        setError(friendlyError(cause));
        await beginClassicScan();
      }

      if (scanEpochRef.current === epoch && !bleEnded) {
        scanTimerRef.current = setTimeout(() => {
          void beginClassicScan();
        }, BLE_SCAN_DURATION_MS);
      }
    } catch (cause) {
      setError(friendlyError(cause));
      await stopScan();
    } finally {
      scanPendingRef.current = false;
    }
  }, [clearScanTimer, scanning, stopScan]);

  const connectInternal = useCallback((nearby: NearbyDevice, preserveSession: boolean) => {
    const manager = managerRef.current;
    if (!manager || nearby.kind !== 'ble') return;

    void runAction('connect', async () => {
      sessionLockedRef.current = true;
      setSessionLocked(true);
      await stopScan();
      clearConnection();
      if (!preserveSession) {
        clearSession();
        setConnectionLost(false);
      }
      setLastDevice(nearby);
      const sessionEpoch = sessionEpochRef.current;
      let device: Device | null = null;

      try {
        device = await manager.connectToDevice(nearby.id, { autoConnect: false });
        if (sessionEpochRef.current !== sessionEpoch) {
          await manager.cancelDeviceConnection(device.id).catch(() => undefined);
          return;
        }
        connectedRef.current = device;
        disconnectSubscriptionRef.current = manager.onDeviceDisconnected(nearby.id, (reason) => {
          if (connectedRef.current?.id !== nearby.id) return;
          clearConnection();
          setConnectionLost(true);
          setError(reason ? friendlyError(reason) : 'Connection lost. Move closer to the device and tap Reconnect.');
        });

        const discovered = await device.discoverAllServicesAndCharacteristics();
        const services = await discovered.services();
        if (!services.some((service) => service.uuid.toLowerCase() === SERVICE_UUID)) {
          throw new Error('This device does not have the required Service UUID. Choose another device.');
        }
        const characteristics = await discovered.characteristicsForService(SERVICE_UUID);
        const characteristic = characteristics.find(
          (item) => item.uuid.toLowerCase() === CHAR_UUID
        );

        if (!characteristic) {
          throw new Error('This device does not have the required Characteristic UUID. Choose another device.');
        }
        if (!characteristic.isReadable) {
          throw new Error('This device characteristic cannot be read. Choose another device.');
        }
        if (!characteristic.isWritableWithResponse && !characteristic.isWritableWithoutResponse) {
          throw new Error('This device characteristic cannot be written. Choose another device.');
        }
        if (connectedRef.current?.id !== nearby.id || sessionEpochRef.current !== sessionEpoch) {
          throw new Error('Connection lost while checking the service. Tap Reconnect.');
        }

        characteristicRef.current = characteristic;
        setConnectedDevice(nearby);
        setConnectionLost(false);
      } catch (cause) {
        clearConnection();
        if (device) {
          await manager.cancelDeviceConnection(device.id).catch(() => undefined);
        }
        throw cause;
      }
    });
  }, [clearConnection, clearSession, runAction, stopScan]);

  const connect = useCallback((nearby: NearbyDevice) => connectInternal(nearby, false), [connectInternal]);
  const reconnect = useCallback(() => {
    if (lastDevice && !connectedRef.current) connectInternal(lastDevice, true);
  }, [connectInternal, lastDevice]);

  const disconnect = useCallback(() => {
    const manager = managerRef.current;
    const device = connectedRef.current;
    if (!manager || !device || actionRef.current) return;

    clearConnection();
    setConnectionLost(false);
    setLastDevice(null);
    setError(null);
    void manager.cancelDeviceConnection(device.id).catch(() => {
      setError('Could not disconnect cleanly. Check Bluetooth and try Reset Lab.');
    });
  }, [clearConnection]);

  const resetLab = useCallback(async () => {
    actionTokenRef.current += 1;
    actionRef.current = false;
    setAction(null);
    clearSession();
    sessionKindRef.current = 'lab';
    sessionLockedRef.current = false;
    setSessionKindState('lab');
    setSessionLocked(false);
    await stopScan();
    const device = connectedRef.current;
    clearConnection();
    setLastDevice(null);
    setNearbyDevices([]);
    setConnectionLost(false);
    setScanFinished(false);
    setError(null);
    setClassicWarning(null);
    if (device) {
      await managerRef.current?.cancelDeviceConnection(device.id).catch(() => undefined);
    }
  }, [clearConnection, clearSession, stopScan]);

  const readFirst = useCallback(() => {
    const characteristic = characteristicRef.current;
    if (!characteristic || writtenValue !== null) return;

    void runAction('first-read', async () => {
      const sessionEpoch = sessionEpochRef.current;
      const read = await characteristic.read();
      if (characteristicRef.current !== characteristic || sessionEpochRef.current !== sessionEpoch) return;
      setFirstValue(decodeValue(read.value));
    });
  }, [runAction, writtenValue]);

  const writeNames = useCallback((ownName: string, buddyName: string) => {
    const characteristic = characteristicRef.current;
    if (!characteristic || firstValue === null || writtenValue !== null) return;

    const payload = `${ownName.trim()},${buddyName.trim()}`;
    if (!ownName.trim() || !buddyName.trim()) {
      setError('Enter both student names before writing.');
      return;
    }
    if (Buffer.byteLength(payload, 'utf8') > MAX_WRITE_BYTES) {
      setError(`Payload is over ${MAX_WRITE_BYTES} bytes. Shorten one or both names.`);
      return;
    }

    void runAction('write', async () => {
      const sessionEpoch = sessionEpochRef.current;
      const base64 = Buffer.from(payload, 'utf8').toString('base64');
      if (characteristic.isWritableWithResponse) {
        await characteristic.writeWithResponse(base64);
      } else {
        await characteristic.writeWithoutResponse(base64);
      }
      if (characteristicRef.current !== characteristic || sessionEpochRef.current !== sessionEpoch) return;
      recordIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setSubmittedNames({ ownName: ownName.trim(), buddyName: buddyName.trim() });
      setWrittenValue(payload);
      setSecondValue(null);
      setLatestRecord(null);
    });
  }, [firstValue, runAction, writtenValue]);

  const readSecond = useCallback(() => {
    const characteristic = characteristicRef.current;
    if (!characteristic || writtenValue === null || firstValue === null || !submittedNames || !connectedDevice) return;

    void runAction('second-read', async () => {
      const sessionEpoch = sessionEpochRef.current;
      const read = await characteristic.read();
      if (characteristicRef.current !== characteristic || sessionEpochRef.current !== sessionEpoch) return;
      const result = decodeValue(read.value);
      setSecondValue(result);
      const record: LabHistoryRecord = {
        id: recordIdRef.current ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        completedAt: new Date().toISOString(),
        deviceId: connectedDevice.id,
        deviceName: connectedDevice.name,
        ownName: submittedNames.ownName,
        buddyName: submittedNames.buddyName,
        payload: writtenValue,
        firstValue,
        secondValue: result,
        sessionKind: sessionKindRef.current,
      };
      recordIdRef.current = record.id;
      setLatestRecord(record);
      const next = [record, ...historyRef.current.filter((item) => item.id !== record.id)];
      try {
        const mutation = ++historyMutationRef.current;
        await saveHistory(next);
        if (historyMutationRef.current === mutation) {
          historyRef.current = next;
          setHistory(next);
          setHistoryError(null);
        }
      } catch {
        setHistoryError('Result received, but history was not saved. Read the result again to retry.');
      }
    });
  }, [connectedDevice, firstValue, runAction, submittedNames, writtenValue]);

  const clearHistory = useCallback(async () => {
    try {
      historyMutationRef.current += 1;
      await saveHistory([]);
      historyRef.current = [];
      setHistory([]);
      setHistoryError(null);
    } catch {
      setHistoryError('Could not clear history. Please try again.');
    }
  }, []);

  return {
    action,
    adapterState,
    classicWarning,
    connectedDevice,
    error,
    firstValue,
    history,
    historyError,
    latestRecord,
    sessionKind,
    sessionLocked,
    lastDevice,
    nearbyDevices,
    connectionLost,
    scanFinished,
    scanning,
    scanPhase,
    secondValue,
    submittedNames,
    setupError,
    writtenValue,
    connect,
    reconnect,
    resetLab,
    clearHistory,
    setSessionKind,
    disconnect,
    readFirst,
    readSecond,
    scan,
    stopScan,
    writeNames,
  };
}
