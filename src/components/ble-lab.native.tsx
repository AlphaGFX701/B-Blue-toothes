import { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, Animated, Image, KeyboardAvoidingView, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { State } from 'react-native-ble-plx';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';

import { CHAR_UUID, MAX_WRITE_BYTES, SERVICE_UUID, useBleLab } from '@/hooks/use-ble-lab';
import type { NearbyDevice } from '@/hooks/use-ble-lab';
import type { LabHistoryRecord } from '@/lib/lab-history';
import { deviceListMessage, filterDevices, formatLabReport, payloadBytes, payloadPreview } from '@/lib/lab-presentation';
import type { DeviceMode, SignalFilter } from '@/lib/lab-presentation';
import { ThemeProvider, themes, useTheme } from '@/theme/theme';

type Colors = typeof themes.dark | typeof themes.light;

function LabButton({ label, accessibilityLabel, onPress, colors, outline = false, disabled = false, busy = false }: {
  label: string; accessibilityLabel?: string; onPress: () => void; colors: Colors; outline?: boolean; disabled?: boolean; busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 46, borderRadius: 13, paddingHorizontal: 16, flexDirection: 'row',
        alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: outline ? colors.raised : colors.accent,
        borderWidth: outline ? 1 : 0, borderColor: colors.border,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      })}>
      {busy && <ActivityIndicator color={outline ? colors.accent : colors.accentText} size="small" />}
      <Text style={{ color: outline ? colors.text : colors.accentText, fontSize: 14, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}

function SignalBars({ rssi, colors }: { rssi: number | null; colors: Colors }) {
  const level = rssi === null ? 0 : rssi >= -60 ? 3 : rssi >= -80 ? 2 : 1;
  return (
    <View accessibilityLabel={level === 3 ? 'Strong signal' : level === 2 ? 'Medium signal' : level === 1 ? 'Weak signal' : 'Signal unknown'}
      style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 16 }}>
      {[7, 11, 15].map((height, index) => (
        <View key={height} style={{ width: 4, height, borderRadius: 2, backgroundColor: index < level ? colors.success : colors.border }} />
      ))}
    </View>
  );
}

function StepCard({ number, title, detail, done, active, colors, children }: {
  number: string; title: string; detail: string; done: boolean; active: boolean; colors: Colors; children: React.ReactNode;
}) {
  return (
    <View style={{ backgroundColor: colors.surface, borderColor: active ? colors.accent : colors.border,
      borderWidth: 1, borderRadius: 20, padding: 18, gap: 15 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? colors.success : colors.raised }}>
          <Text style={{ color: done ? colors.successText : colors.text, fontWeight: '800' }}>{done ? '✓' : number}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>{title}</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{detail}</Text>
        </View>
        {done && <Text style={{ color: colors.success, fontSize: 11, fontWeight: '800' }}>DONE</Text>}
      </View>
      {children}
    </View>
  );
}

function BleLabScreen() {
  const { colors, mode, toggleTheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [ownName, setOwnName] = useState('');
  const [buddyName, setBuddyName] = useState('');
  const [search, setSearch] = useState('');
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('all');
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('all');
  const [historyVisible, setHistoryVisible] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [celebration] = useState(() => new Animated.Value(1));
  const {
    action, adapterState, connectedDevice, connectionLost, error, firstValue, history,
    historyError, lastDevice, latestRecord, nearbyDevices, scanFinished, scanning, scanPhase, classicWarning, secondValue,
    sessionKind, sessionLocked, setSessionKind,
    setupError, writtenValue, connect, reconnect, resetLab, clearHistory, disconnect,
    readFirst, readSecond, scan, stopScan, writeNames,
  } = useBleLab();

  const candidatePayload = payloadPreview(ownName, buddyName);
  const byteCount = payloadBytes(candidatePayload);
  const bothNames = ownName.trim().length > 0 && buddyName.trim().length > 0;
  const canWrite = Boolean(connectedDevice && firstValue !== null && writtenValue === null && bothNames && byteCount <= MAX_WRITE_BYTES);
  const modeMatches = useMemo(() => filterDevices(nearbyDevices, '', 'all', deviceMode).length, [nearbyDevices, deviceMode]);
  const filteredDevices = useMemo(() => filterDevices(nearbyDevices, search, signalFilter, deviceMode), [nearbyDevices, search, signalFilter, deviceMode]);
  const bleCount = nearbyDevices.filter((device) => device.kind === 'ble').length;
  const classicCount = nearbyDevices.length - bleCount;
  const isPhysicalDevice = Device.isDevice;
  const ready = adapterState === State.PoweredOn;
  const currentStep = secondValue !== null ? 3 : writtenValue !== null ? 3 : firstValue !== null ? 2 : 1;
  const status = !isPhysicalDevice ? 'BLE unavailable on emulator' : action === 'connect' ? 'Connecting' : connectionLost ? 'Connection lost'
    : action === 'first-read' || action === 'second-read' ? 'Reading'
    : action === 'write' ? 'Writing' : secondValue !== null ? 'Result received'
    : connectedDevice ? 'Connected' : scanning ? 'Scanning' : ready ? 'Ready to scan' : 'Bluetooth off';
  const statusDetail = !isPhysicalDevice ? 'Install the app on a physical phone to scan and connect to nearby Bluetooth devices.'
    : connectionLost ? 'Your lab values are still here. Reconnect to the same device to continue.'
    : action === 'connect' ? 'Checking the required service and characteristic.'
    : connectedDevice ? 'Follow the three steps below.'
    : scanPhase === 'ble' ? 'Finding BLE devices now. Results appear as soon as they are found.'
    : scanPhase === 'classic' ? 'Finding discoverable Classic devices. Paired devices are already listed.'
    : scanFinished ? 'Scan complete. Select a device or scan again.'
    : 'Turn on Bluetooth, then tap Scan. Choose a device from the list; no device name is needed.';

  useEffect(() => {
    if (secondValue === null) return;
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (!active || reduceMotion) return;
      celebration.setValue(0.94);
      Animated.spring(celebration, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }).start();
    });
    return () => { active = false; celebration.stopAnimation(); };
  }, [secondValue, celebration]);

  const copyReport = async (record: LabHistoryRecord) => {
    try {
      const copied = await Clipboard.setStringAsync(formatLabReport(record));
      setCopyStatus(copied ? 'Report copied. Paste it into Google Classroom.' : 'Could not copy the report. Please try again.');
    } catch {
      setCopyStatus('Could not copy the report. Please try again.');
    }
  };

  const handleReset = () => {
    setOwnName('');
    setBuddyName('');
    setSearch('');
    setDeviceMode('all');
    setSignalFilter('all');
    setCopyStatus('');
    void resetLab();
  };

  const renderDevice = (device: NearbyDevice) => (
    <View key={`${device.kind}:${device.id}`} style={styles.deviceRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <SignalBars rssi={device.rssi} colors={colors} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.deviceName} numberOfLines={1}>{device.name}</Text>
          <Text style={{ color: device.kind === 'classic' ? colors.warning : colors.accent, fontSize: 11, fontWeight: '800' }}>
            {device.kind === 'classic' ? `Bluetooth Classic${device.paired ? ' · Paired' : ''}` : 'BLE · Can try connecting'}
          </Text>
          <Text style={styles.deviceMeta} selectable numberOfLines={2}>Device ID: {device.id}</Text>
          <Text style={styles.deviceMeta}>{device.rssi === null ? 'RSSI unknown' : `${device.rssi} dBm`}</Text>
          {device.advertisesService && <Text style={styles.match}>Required service advertised</Text>}
          {device.kind === 'classic' && <Text style={styles.deviceMeta}>This device cannot run the BLE read/write lab.</Text>}
        </View>
      </View>
      {device.kind === 'ble' && <LabButton label={action === 'connect' && lastDevice?.id === device.id ? 'Connecting...' : 'Connect'}
        accessibilityLabel={`Connect to ${device.name}, device ID ${device.id}`}
        onPress={() => connect(device)} disabled={action !== null || !ready} busy={action === 'connect' && lastDevice?.id === device.id} colors={colors} />}
    </View>
  );

  return (
    <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Image source={require('../../assets/images/icon.png')} style={styles.logo} accessibilityLabel="BLE Grade Lab icon" />
            <Text style={styles.brand}>BLE GRADE LAB</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Switch to ${mode === 'dark' ? 'light' : 'dark'} theme`}
              onPress={toggleTheme} style={styles.headerButton}><Text style={styles.headerButtonText}>{mode === 'dark' ? '☀' : '☾'}</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => { setCopyStatus(''); setHistoryVisible(true); }} style={styles.headerButton}>
              <Text style={styles.headerButtonText}>History {history.length}</Text>
            </Pressable>
          </View>

          <View style={{ gap: 7, marginBottom: 4 }}>
            <Text style={styles.eyebrow}>CLASSROOM BLUETOOTH LAB</Text>
            <Text style={styles.hero}>Read. Write. Discover.</Text>
            <Text style={styles.muted}>Connect to a BLE device and complete three steps to capture its result.</Text>
          </View>

          <View style={styles.statusCard}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Bluetooth status</Text>
              <Text style={{ color: connectionLost ? colors.danger : isPhysicalDevice && ready ? colors.success : colors.warning, fontWeight: '800', fontSize: 12 }}>{status}</Text>
            </View>
            <Text style={styles.muted}>{statusDetail}</Text>
            <Text style={styles.fieldLabel}>Session type</Text>
            <View style={styles.modeRow}>
              {([['lab', 'Real lab'], ['test', 'Test session']] as const).map(([value, label]) => (
                <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: sessionKind === value, disabled: sessionLocked }}
                  disabled={sessionLocked} onPress={() => setSessionKind(value)} style={[styles.modeButton, {
                    backgroundColor: sessionKind === value ? colors.tint : colors.raised,
                    borderColor: sessionKind === value ? colors.accent : colors.border,
                    opacity: sessionLocked ? 0.7 : 1,
                  }]}>
                  <Text style={{ color: sessionKind === value ? colors.accent : colors.text, fontSize: 12, fontWeight: '800' }}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {sessionKind === 'test' && <Text style={styles.smallMuted}>Use a real Android phone with the Windows BLE test device. TEST OK confirms communication, not a teacher grade.</Text>}
            {sessionLocked && <Text style={styles.smallMuted}>Session type is locked until Reset Lab.</Text>}
            {connectedDevice && (
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceName}>{connectedDevice.name}</Text>
                <Text style={styles.deviceMeta}>{connectedDevice.id}</Text>
                <Text style={styles.match}>Service and characteristic verified</Text>
              </View>
            )}
            {connectionLost && lastDevice && <LabButton label={action === 'connect' ? 'Reconnecting...' : `Reconnect ${lastDevice.name}`}
              onPress={reconnect} disabled={action !== null || !ready} busy={action === 'connect'} colors={colors} />}
            {connectedDevice && <LabButton label="Disconnect" onPress={disconnect} disabled={action !== null} outline colors={colors} />}
            {!connectedDevice && <LabButton label={scanning ? 'Scanning...' : scanFinished ? 'Scan again' : 'Scan nearby devices'}
              onPress={() => void scan()} disabled={!isPhysicalDevice || scanning || action !== null || setupError !== null} busy={scanning} colors={colors} />}
            {scanning && <LabButton label="Stop scan" onPress={() => void stopScan()} outline colors={colors} />}
          </View>

          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Lab progress</Text>
            <Text style={styles.smallMuted}>STEP {currentStep} OF 3</Text>
          </View>
          <View style={styles.progressRow}>
            {['1 · Initial read', '2 · Write names', '3 · Result'].map((label, index) => (
              <View key={label} style={[styles.progressChip, { borderColor: currentStep === index + 1 ? colors.accent : colors.border,
                backgroundColor: index + 1 < currentStep ? colors.tint : colors.surface }]}>
                <Text style={{ color: currentStep === index + 1 ? colors.accent : colors.muted, fontSize: 10, fontWeight: '800', textAlign: 'center' }}>{label}</Text>
              </View>
            ))}
          </View>

          {!connectedDevice && (
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>Nearby devices</Text>
                <Text style={styles.smallMuted}>{nearbyDevices.length} found</Text>
              </View>
              <Text style={styles.smallMuted}>{bleCount} BLE · {classicCount} Classic</Text>
              <View style={styles.modeRow}>
                {([['all', 'All devices'], ['teacher', 'Teacher BLE device']] as const).map(([value, label]) => (
                  <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: deviceMode === value }}
                    onPress={() => setDeviceMode(value)} style={[styles.modeButton, {
                      backgroundColor: deviceMode === value ? colors.tint : colors.raised,
                      borderColor: deviceMode === value ? colors.accent : colors.border,
                    }]}>
                    <Text style={{ color: deviceMode === value ? colors.accent : colors.text, fontSize: 12, fontWeight: '800', textAlign: 'center' }}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.smallMuted}>{modeMatches} in this mode · {filteredDevices.length} shown after filters</Text>
              {nearbyDevices.length > 0 && <TextInput accessibilityLabel="Optional: filter found devices" placeholder="Optional: filter found devices"
                placeholderTextColor={colors.subtle} value={search} onChangeText={setSearch} style={styles.input} autoCorrect={false} />}
              {nearbyDevices.length > 0 && <View style={styles.filterRow}>
                {([['all', 'All'], ['medium', 'Medium+'], ['strong', 'Strong']] as const).map(([value, label]) => (
                  <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: signalFilter === value }}
                    onPress={() => setSignalFilter(value)} style={[styles.filterChip, { backgroundColor: signalFilter === value ? colors.tint : colors.raised,
                      borderColor: signalFilter === value ? colors.accent : colors.border }]}>
                    <Text style={{ color: signalFilter === value ? colors.accent : colors.muted, fontSize: 12, fontWeight: '700' }}>{label}</Text>
                  </Pressable>
                ))}
              </View>}
              {filteredDevices.length ? filteredDevices.map(renderDevice) : <Text style={styles.muted}>
                {deviceListMessage({ isPhysicalDevice, scanning, scanFinished, total: nearbyDevices.length, modeMatches, mode: deviceMode })}
              </Text>}
              <Text style={styles.smallMuted}>Signal strength is an estimate, not a distance. Unknown RSSI appears only with the All signal filter.</Text>
            </View>
          )}

          {classicWarning && <View style={styles.errorBox}>
            <Text style={{ color: colors.warning, fontWeight: '800' }}>Classic discovery notice</Text>
            <Text style={{ color: colors.text, lineHeight: 20 }}>{classicWarning}</Text>
          </View>}

          {(setupError || error || historyError) && <View style={styles.errorBox}>
            <Text style={{ color: colors.danger, fontWeight: '800' }}>Check this before continuing</Text>
            <Text style={{ color: colors.text, lineHeight: 20 }}>{setupError || error || historyError}</Text>
          </View>}

          <StepCard number="1" title="Initial read" detail="Read before writing the student names" done={firstValue !== null} active={currentStep === 1} colors={colors}>
            <View style={styles.valueBox}>
              <Text style={styles.smallMuted}>INITIAL VALUE</Text>
              <Text selectable style={styles.valueText}>{firstValue ?? 'Waiting for first read'}</Text>
            </View>
            <LabButton label={action === 'first-read' ? 'Reading...' : 'Read initial value'} onPress={readFirst}
              disabled={!connectedDevice || writtenValue !== null || action !== null} busy={action === 'first-read'} outline colors={colors} />
          </StepCard>

          <StepCard number="2" title="Write student names" detail="Send one UTF-8 payload: YourName,BuddyName" done={writtenValue !== null} active={currentStep === 2} colors={colors}>
            <Text style={styles.fieldLabel}>Your name</Text>
            <TextInput accessibilityLabel="Your name" placeholder="e.g. Alice" placeholderTextColor={colors.subtle}
              value={ownName} onChangeText={setOwnName} editable={writtenValue === null} maxLength={40}
              autoCapitalize="words" autoCorrect={false} style={styles.input} />
            <Text style={styles.fieldLabel}>Buddy name</Text>
            <TextInput accessibilityLabel="Buddy name" placeholder="e.g. Bob" placeholderTextColor={colors.subtle}
              value={buddyName} onChangeText={setBuddyName} editable={writtenValue === null} maxLength={40}
              autoCapitalize="words" autoCorrect={false} style={styles.input} />
            <View style={styles.rowBetween}>
              <Text style={[styles.muted, { flex: 1 }]} numberOfLines={2}>{candidatePayload || 'YourName,BuddyName'}</Text>
              <Text style={{ color: byteCount > MAX_WRITE_BYTES ? colors.danger : colors.success, fontWeight: '800' }}>{byteCount}/{MAX_WRITE_BYTES} bytes</Text>
            </View>
            <View accessibilityLabel={`${byteCount} of ${MAX_WRITE_BYTES} bytes used`} style={styles.meterTrack}>
              <View style={{ width: `${Math.min(100, byteCount / MAX_WRITE_BYTES * 100)}%`, height: '100%', borderRadius: 5,
                backgroundColor: byteCount > MAX_WRITE_BYTES ? colors.danger : colors.success }} />
            </View>
            <Text style={styles.smallMuted}>{byteCount > MAX_WRITE_BYTES ? 'Payload is too long. Shorten the names.' : 'The 20-byte limit is this lab protocol rule.'}</Text>
            <LabButton label={action === 'write' ? 'Writing...' : 'Write names to device'} onPress={() => writeNames(ownName, buddyName)}
              disabled={!canWrite || action !== null} busy={action === 'write'} colors={colors} />
            {writtenValue !== null && <Text style={styles.match}>Sent: {writtenValue}</Text>}
          </StepCard>

          <StepCard number="3" title="Read device result" detail="Read the same characteristic after writing" done={secondValue !== null} active={currentStep === 3} colors={colors}>
            <LabButton label={action === 'second-read' ? 'Reading...' : secondValue === null ? 'Read result' : 'Read result again'}
              onPress={readSecond} disabled={!connectedDevice || writtenValue === null || action !== null}
              busy={action === 'second-read'} outline colors={colors} />
            {secondValue === null && <Text style={styles.muted}>Your result will appear here after the second read.</Text>}
          </StepCard>

          {secondValue !== null && <Animated.View style={[styles.resultCard, { transform: [{ scale: celebration }] }]}>
            <Text style={{ color: colors.success, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 }}>
              {sessionKind === 'test' ? 'TEST RESULT FROM DEVICE' : 'RESULT FROM DEVICE'}
            </Text>
            <Text selectable style={{ color: colors.text, fontSize: 32, fontWeight: '900' }}>{secondValue}</Text>
            <Text style={styles.muted}>{sessionKind === 'test'
              ? 'This value came from the connected test device. It is not a teacher grade.'
              : 'This is the value returned by the connected device.'}</Text>
            <LabButton label="Copy report" onPress={() => { if (latestRecord) void copyReport(latestRecord); }}
              disabled={!latestRecord} colors={colors} />
          </Animated.View>}
          {copyStatus ? <Text accessibilityLiveRegion="polite" style={{ color: colors.success, fontSize: 12 }}>{copyStatus}</Text> : null}

          <LabButton label="Reset Lab" onPress={handleReset} outline colors={colors} />
          <View style={{ paddingVertical: 10, gap: 5 }}>
            <Text style={styles.smallMuted}>TARGET SERVICE UUID</Text>
            <Text selectable style={styles.uuid}>{SERVICE_UUID}</Text>
            <Text style={styles.smallMuted}>TARGET CHARACTERISTIC UUID</Text>
            <Text selectable style={styles.uuid}>{CHAR_UUID}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={historyVisible} animationType="slide" onRequestClose={() => setHistoryVisible(false)}>
        <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.rowBetween}>
              <Text style={styles.hero}>Lab history</Text>
              <Pressable accessibilityRole="button" onPress={() => setHistoryVisible(false)}><Text style={styles.link}>Close</Text></Pressable>
            </View>
            <Text style={styles.muted}>Completed result reads saved on this device.</Text>
            {historyError && <Text style={{ color: colors.danger }}>{historyError}</Text>}
            {history.length === 0 && <Text style={styles.muted}>No completed labs yet.</Text>}
            {history.map((record) => (
              <View key={record.id} style={styles.card}>
                <Text style={styles.cardTitle}>{record.deviceName}</Text>
                <Text style={{ color: record.sessionKind === 'test' ? colors.warning : colors.accent, fontWeight: '800' }}>
                  {record.sessionKind === 'test' ? 'Test session · Not a teacher grade' : 'Real lab'}
                </Text>
                <Text style={styles.smallMuted}>{new Date(record.completedAt).toLocaleString('en-US')}</Text>
                <Text style={styles.muted}>Students: {record.ownName} & {record.buddyName}</Text>
                <Text style={styles.muted}>Payload: {record.payload}</Text>
                <Text style={styles.muted}>Initial value: {record.firstValue}</Text>
                <Text style={{ color: colors.success, fontWeight: '800' }}>
                  {record.sessionKind === 'test' ? 'Test result from device' : 'Result from device'}: {record.secondValue}
                </Text>
                <LabButton label="Copy report" onPress={() => void copyReport(record)} outline colors={colors} />
              </View>
            ))}
            {copyStatus ? <Text accessibilityLiveRegion="polite" style={{ color: colors.success }}>{copyStatus}</Text> : null}
            {history.length > 0 && <LabButton label="Clear all history" onPress={() => Alert.alert('Clear all history?',
              'This removes completed lab records from this device.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Clear', style: 'destructive', onPress: () => void clearHistory() },
              ])} outline colors={colors} />}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 54, gap: 16 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    logo: { width: 32, height: 32, backgroundColor: colors.accent, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    brand: { color: colors.text, fontSize: 13, fontWeight: '900', letterSpacing: 1, flex: 1 },
    headerButton: { borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surface, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 9 },
    headerButtonText: { color: colors.accent, fontSize: 11, fontWeight: '800' },
    eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
    hero: { color: colors.text, fontSize: 30, fontWeight: '900', lineHeight: 36 },
    muted: { color: colors.muted, fontSize: 13, lineHeight: 20 },
    smallMuted: { color: colors.subtle, fontSize: 11, lineHeight: 17 },
    statusCard: { backgroundColor: colors.surface, borderRadius: 20, borderColor: colors.border, borderWidth: 1, padding: 18, gap: 13 },
    card: { backgroundColor: colors.surface, borderRadius: 18, borderColor: colors.border, borderWidth: 1, padding: 16, gap: 12 },
    cardTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
    progressRow: { flexDirection: 'row', gap: 6 },
    progressChip: { flex: 1, minHeight: 38, borderWidth: 1, borderRadius: 10, padding: 6, justifyContent: 'center' },
    deviceInfo: { backgroundColor: colors.raised, padding: 12, borderRadius: 12, gap: 4 },
    deviceRow: { backgroundColor: colors.raised, gap: 12, padding: 12, borderRadius: 12 },
    deviceName: { color: colors.text, fontSize: 15, fontWeight: '800' },
    deviceMeta: { color: colors.muted, fontSize: 11 },
    match: { color: colors.success, fontSize: 12, fontWeight: '800' },
    modeRow: { flexDirection: 'row', gap: 8 },
    modeButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 11, paddingHorizontal: 8, paddingVertical: 7,
      alignItems: 'center', justifyContent: 'center' },
    input: { color: colors.text, backgroundColor: colors.raised, borderColor: colors.border, borderWidth: 1,
      borderRadius: 11, minHeight: 46, paddingHorizontal: 13, fontSize: 14 },
    filterRow: { flexDirection: 'row', gap: 7 },
    filterChip: { borderWidth: 1, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 11 },
    errorBox: { backgroundColor: colors.dangerSurface, borderColor: colors.danger, borderWidth: 1, borderRadius: 14, padding: 14, gap: 5 },
    valueBox: { backgroundColor: colors.raised, borderRadius: 12, padding: 13, gap: 6 },
    valueText: { color: colors.text, fontSize: 17, fontWeight: '700' },
    fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
    meterTrack: { height: 10, borderRadius: 5, backgroundColor: colors.raised, overflow: 'hidden' },
    resultCard: { backgroundColor: colors.surface, borderColor: colors.success, borderWidth: 2, borderRadius: 20, padding: 20, gap: 12 },
    uuid: { color: colors.muted, fontSize: 11 },
    link: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  });
}

export default function BleLab() {
  return <ThemeProvider><BleLabScreen /></ThemeProvider>;
}
