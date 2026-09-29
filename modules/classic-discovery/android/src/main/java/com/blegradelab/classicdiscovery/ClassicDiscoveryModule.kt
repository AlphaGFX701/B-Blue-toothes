package com.blegradelab.classicdiscovery

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Lists Classic devices only. BLE GATT connections remain in react-native-ble-plx. */
class ClassicDiscoveryModule : Module() {
  private var receiver: BroadcastReceiver? = null
  private var receiverContext: Context? = null
  private var scanningAdapter: BluetoothAdapter? = null

  override fun definition() = ModuleDefinition {
    Name("ClassicDiscovery")
    Events("onDeviceFound", "onDiscoveryFinished")

    AsyncFunction("getPairedDevicesAsync") {
      val adapter = bluetoothAdapter() ?: return@AsyncFunction emptyList<Map<String, Any?>>()
      if (!adapter.isEnabled) return@AsyncFunction emptyList<Map<String, Any?>>()
      adapter.bondedDevices
        .filter { isClassicCapable(it) }
        .map { deviceMap(it, null, true) }
    }

    AsyncFunction("startDiscoveryAsync") {
      val adapter = bluetoothAdapter() ?: throw IllegalStateException("This phone has no Bluetooth adapter.")
      if (!adapter.isEnabled) throw IllegalStateException("Bluetooth is off.")
      stopDiscovery()

      val context = requireNotNull(appContext.reactContext) { "Android context is unavailable." }
      val nextReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          when (intent.action) {
            BluetoothDevice.ACTION_FOUND -> {
              val device = foundDevice(intent) ?: return
              if (!isClassicCapable(device)) return
              val signal = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE)
              sendEvent("onDeviceFound", deviceMap(device, signal.takeUnless { it == Short.MIN_VALUE }?.toInt(),
                device.bondState == BluetoothDevice.BOND_BONDED))
            }
            BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
              unregisterReceiver()
              scanningAdapter = null
              sendEvent("onDiscoveryFinished", emptyMap<String, Any>())
            }
          }
        }
      }
      val filter = IntentFilter().apply {
        addAction(BluetoothDevice.ACTION_FOUND)
        addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
      }
      if (Build.VERSION.SDK_INT >= 33) {
        // Bluetooth broadcasts may come from a privileged process outside the system UID.
        context.registerReceiver(nextReceiver, filter, Context.RECEIVER_EXPORTED)
      } else {
        context.registerReceiver(nextReceiver, filter)
      }
      receiver = nextReceiver
      receiverContext = context
      scanningAdapter = adapter
      val started = adapter.startDiscovery()
      if (!started) {
        unregisterReceiver()
        scanningAdapter = null
      }
      started
    }

    AsyncFunction("stopDiscoveryAsync") { stopDiscovery() }
    OnDestroy { stopDiscovery() }
  }

  private fun bluetoothAdapter(): BluetoothAdapter? {
    val context = appContext.reactContext ?: return null
    return (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
  }

  private fun isClassicCapable(device: BluetoothDevice): Boolean =
    device.type == BluetoothDevice.DEVICE_TYPE_CLASSIC || device.type == BluetoothDevice.DEVICE_TYPE_DUAL

  private fun deviceMap(device: BluetoothDevice, rssi: Int?, paired: Boolean): Map<String, Any?> = mapOf(
    "id" to device.address,
    "name" to (device.name?.takeIf { it.isNotBlank() } ?: "Unnamed Classic device"),
    "rssi" to rssi,
    "paired" to paired,
    "dualMode" to (device.type == BluetoothDevice.DEVICE_TYPE_DUAL)
  )

  @Suppress("DEPRECATION")
  private fun foundDevice(intent: Intent): BluetoothDevice? =
    if (Build.VERSION.SDK_INT >= 33) {
      intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
    } else {
      intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
    }

  private fun unregisterReceiver() {
    val current = receiver ?: return
    receiver = null
    try {
      receiverContext?.unregisterReceiver(current)
    } catch (_: IllegalArgumentException) {
      // The system may already have unregistered it while Bluetooth turned off.
    } finally {
      receiverContext = null
    }
  }

  private fun stopDiscovery() {
    unregisterReceiver()
    try {
      scanningAdapter?.cancelDiscovery()
    } catch (_: SecurityException) {
      // Permissions can be revoked while a scan is in progress.
    } finally {
      scanningAdapter = null
    }
  }
}
