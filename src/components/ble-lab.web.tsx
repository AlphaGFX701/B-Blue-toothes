import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ThemeProvider, useTheme } from '@/theme/theme';

function WebNotice() {
  const { colors, mode, toggleTheme } = useTheme();
  const styles = StyleSheet.create({
    page: { flex: 1, minHeight: 600, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 520, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 22, padding: 28, gap: 16 },
    eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 2 },
    title: { color: colors.text, fontSize: 30, fontWeight: '900' },
    body: { color: colors.muted, fontSize: 15, lineHeight: 24 },
    toggle: { alignSelf: 'flex-start', backgroundColor: colors.raised, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12 },
  });
  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>BLE GRADE LAB</Text>
        <Text style={styles.title}>Use the mobile app for this lab</Text>
        <Text style={styles.body}>
          Bluetooth LE scanning, connecting, reading and writing require the Android or iOS development build.
          Install that build on a phone to complete the classroom experiment.
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Switch to ${mode === 'dark' ? 'light' : 'dark'} theme`}
          onPress={toggleTheme} style={styles.toggle}>
          <Text style={{ color: colors.accent, fontWeight: '800' }}>Switch to {mode === 'dark' ? 'Light' : 'Dark'} theme</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function BleLab() {
  return <ThemeProvider><WebNotice /></ThemeProvider>;
}
