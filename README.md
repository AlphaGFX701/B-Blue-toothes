<div align="center">
  <img src="assets/images/icon.png" width="120" alt="BLE Grade Lab logo" />

  # BLE Grade Lab

  **Scan devices. Connect to BLE. Read → write → read.**

  An Android classroom app for a three-step Bluetooth Low Energy experiment.

  [Download Android APK](https://github.com/AlphaGFX701/B-Blue-toothes/releases/latest) · [How to install](#install-on-android) · [Run from source](#run-from-source)
</div>

---

## What it does

| Step | In the app |
| --- | --- |
| **01 · Discover** | Scan nearby BLE devices and tap **Connect** on the device you want. No device name needs to be typed. |
| **02 · Initial read** | Read the value from the connected device. |
| **03 · Send & read** | Enter two student names, send `Name1,Name2`, then read the device response. |

The app displays the value returned by the device. It does **not** calculate or invent a grade.

### Device list

- **All devices** shows BLE devices, paired Bluetooth Classic devices, and newly discovered Classic devices. BLE results appear during scanning. Classic discovery follows the BLE scan.
- **Teacher BLE device** shows BLE devices advertising the lab's Service UUID. A device can still be selected from **All devices** if it does not advertise that UUID.
- Each BLE row has **Connect**. Classic rows are labeled as unavailable for this BLE read/write lab and have no Connect button.
- Search by name or ID, signal filters, RSSI, connection status, reconnect, history, copy report, and Dark/Light themes are included.

## Install on Android

1. Open the [latest release](https://github.com/AlphaGFX701/B-Blue-toothes/releases/latest) on an **Android phone** and download the `.apk` file.
2. Open the downloaded file and allow installation from that source if Android asks. This permission is usually under **Settings → Install unknown apps**.
3. Launch **BLE Grade Lab**, turn on Bluetooth, and allow **Nearby devices** when prompted. On Android 11 or older, also allow Location and turn Location on for scanning.
4. Choose **Real lab** or **Test session**, tap **Scan nearby devices**, then tap **Connect** on a BLE device in the list.

You can transfer the APK to the phone by chat, cloud storage, or cable. A USB cable is **not** needed for the Bluetooth connection itself. If Android rejects an update because the installed app uses a different signing key, uninstall that older copy before installing this APK; uninstalling removes that copy's local history.

> **Use a real Android phone for Bluetooth testing.** The Android emulator is only for previewing the interface and does not confirm nearby BLE scanning or read/write. Expo Go cannot run this app because it uses native Bluetooth modules.

## Try the classroom workflow

1. Select **All devices** and scan. BLE devices found nearby appear in the list. If your teacher's device advertises the lab UUID, it also appears under **Teacher BLE device**.
2. Tap **Connect** on the BLE device you want. The app checks the required Service, Characteristic, and read/write capabilities after connecting.
3. Tap **Read initial value**.
4. Enter the two **student names** and tap **Write names to device**. The byte counter shows the actual UTF-8 payload size; the current app rule limits it to 20 bytes.
5. Tap **Read result**. You can copy a report or inspect saved history. **Reset Lab** clears the current session while keeping history.

The text fields in step 4 are for **student names**, not for finding a Bluetooth device.

## Protocol

| Field | Value |
| --- | --- |
| Service UUID | `aee04821-1973-4e1f-a590-e84b10d580e7` |
| Characteristic UUID | `cde07b1a-889b-44b7-a99f-c888dddac729` |
| Write payload | `Name1,Name2` in UTF-8, at most 20 bytes under the app's current rule |

The UUIDs, payload, and teacher device's response format must be verified against the **physical classroom device** before treating a result as a real grade.

## Test with a Windows BLE device

The included Windows test device can help verify a real wireless read/write cycle if the laptop's Bluetooth adapter supports the **BLE peripheral role**.

1. On Windows 11 with Python 3.9+, run [`start-test-device.cmd`](start-test-device.cmd). It installs the simulator's Python dependencies locally and shows read/write events in its window.
2. On a physical Android phone, install the APK, choose **Test session**, scan **All devices**, and connect to the test BLE device. It may have no display name.
3. The first read should return `68`. After sending student names, the Windows window should log `WRITE <- ...`. The next read should return `TEST OK`.

To send your own test result from the Windows CMD window, type `result HELLO FROM PC` before tapping **Read result** on the phone. The phone then reads `HELLO FROM PC` from the laptop. Use `show` to inspect the value, `reset` to restore `68` / `TEST OK`, and `quit` to stop. These are test responses, not teacher grades.

`TEST OK` checks the Bluetooth link. **It is not a teacher grade.** If the Windows adapter cannot advertise as a BLE peripheral, use compatible hardware or the teacher's device. You can check support with `powershell.exe -ExecutionPolicy Bypass -File .\start-test-device.ps1 -Check`.

## Run from source

Requirements: Node.js, Android Studio with the Android SDK, and an Android phone for Bluetooth testing.

```powershell
git clone https://github.com/AlphaGFX701/B-Blue-toothes.git
cd B-Blue-toothes
npm ci
npx expo run:android
```

For a standalone APK on Windows, set `ANDROID_HOME` to your Android SDK directory and build a release APK:

```powershell
npx expo prebuild --platform android --no-install
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
cd android
.\gradlew.bat assembleRelease
```

The output is `android/app/build/outputs/apk/release/app-release.apk`. This local build uses a development signing key and is intended for testing and presentation, not store publication. Changes to native modules require a new build.

## Project checks

```powershell
npm test
npx tsc --noEmit
npx expo lint
```

## Troubleshooting

| Problem | Check |
| --- | --- |
| No device appears | Bluetooth is on; Nearby devices permission is granted; the target is powered and advertising or discoverable; retry closer to it. |
| Classic device has no Connect button | This lab uses BLE GATT read/write; Classic devices are listed for visibility only. |
| Connected device has the wrong UUID | Select another BLE device or check the teacher hardware's protocol. |
| Connection drops | Tap **Reconnect**. The app keeps the visible results and does not resend names automatically. |
| Payload is too long | Shorten the student names until the UTF-8 counter is at most 20 bytes. |

---

<div align="center"><sub>Built with Expo and React Native · Physical BLE testing still required for the teacher's device</sub></div>
