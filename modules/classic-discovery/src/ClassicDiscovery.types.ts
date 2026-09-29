export type ClassicDevice = {
  id: string;
  name: string;
  rssi: number | null;
  paired: boolean;
  dualMode: boolean;
};

export type ClassicDiscoveryEvents = {
  onDeviceFound: (device: ClassicDevice) => void;
  onDiscoveryFinished: () => void;
};
