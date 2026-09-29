import { requireOptionalNativeModule } from 'expo';

import type { ClassicDevice } from './ClassicDiscovery.types';

export type { ClassicDevice };

export type ClassicDiscoveryModule = {
  addListener(event: 'onDeviceFound', listener: (device: ClassicDevice) => void): { remove(): void };
  addListener(event: 'onDiscoveryFinished', listener: () => void): { remove(): void };
  getPairedDevicesAsync(): Promise<ClassicDevice[]>;
  startDiscoveryAsync(): Promise<boolean>;
  stopDiscoveryAsync(): Promise<void>;
};

// The Android-only module is absent on iOS and in Expo Go.
export default requireOptionalNativeModule<ClassicDiscoveryModule>('ClassicDiscovery');
