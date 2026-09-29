import { Platform } from 'react-native';

import ClassicDiscovery from '../../modules/classic-discovery/src/ClassicDiscoveryModule';

export type { ClassicDevice } from '../../modules/classic-discovery/src/ClassicDiscoveryModule';

export const classicDiscovery = Platform.OS === 'android' ? ClassicDiscovery : null;
