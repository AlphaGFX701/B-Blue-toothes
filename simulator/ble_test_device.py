"""Windows BLE test peripheral for the BLE Grade Lab phone app.

This device returns 68 before a write and TEST OK afterward. It never
calculates a grade and must not be used as a teacher result.
"""

import argparse
import asyncio
import uuid

from winrt.windows.devices.bluetooth import BluetoothAdapter, BluetoothError
from winrt.windows.devices.bluetooth.genericattributeprofile import (
    GattCharacteristicProperties,
    GattLocalCharacteristicParameters,
    GattProtectionLevel,
    GattServiceProvider,
    GattServiceProviderAdvertisementStatus,
    GattServiceProviderAdvertisingParameters,
    GattWriteOption,
)
from winrt.windows.storage.streams import DataWriter


SERVICE_UUID = uuid.UUID("aee04821-1973-4e1f-a590-e84b10d580e7")
CHARACTERISTIC_UUID = uuid.UUID("cde07b1a-889b-44b7-a99f-c888dddac729")


def to_buffer(data: bytes):
    writer = DataWriter()
    try:
        writer.write_bytes(data)
        return writer.detach_buffer()
    finally:
        writer.close()


async def check_adapter():
    adapter = await BluetoothAdapter.get_default_async()
    if adapter is None:
        raise RuntimeError("Windows did not find a Bluetooth adapter. Enable Bluetooth and try again.")
    if not adapter.is_peripheral_role_supported:
        raise RuntimeError("This Bluetooth adapter cannot advertise as a BLE peripheral. Use an adapter with peripheral-role support.")
    print("Bluetooth adapter supports the BLE peripheral role.", flush=True)


async def serve():
    await check_adapter()
    created = await GattServiceProvider.create_async(SERVICE_UUID)
    if created.error != BluetoothError.SUCCESS or created.service_provider is None:
        raise RuntimeError(f"Windows could not create the BLE service: {created.error}")
    provider = created.service_provider

    settings = GattLocalCharacteristicParameters()
    settings.characteristic_properties = GattCharacteristicProperties.READ | GattCharacteristicProperties.WRITE
    settings.read_protection_level = GattProtectionLevel.PLAIN
    settings.write_protection_level = GattProtectionLevel.PLAIN
    settings.user_description = "BLE Grade Lab test value"
    created_characteristic = await provider.service.create_characteristic_async(CHARACTERISTIC_UUID, settings)
    if created_characteristic.error != BluetoothError.SUCCESS or created_characteristic.characteristic is None:
        raise RuntimeError(f"Windows could not create the BLE characteristic: {created_characteristic.error}")
    characteristic = created_characteristic.characteristic

    loop = asyncio.get_running_loop()
    current_value = b"68"

    async def answer_read(args, deferral):
        try:
            request = await args.get_request_async()
            if request is None:
                print("READ request expired", flush=True)
                return
            request.respond_with_value(to_buffer(current_value))
            print(f"READ  -> {current_value.decode('utf-8')}", flush=True)
        except Exception as error:
            print(f"READ failed: {error}", flush=True)
        finally:
            deferral.complete()

    async def answer_write(args, deferral):
        nonlocal current_value
        try:
            request = await args.get_request_async()
            if request is None:
                print("WRITE request expired", flush=True)
                return
            raw = bytes(request.value)
            names = raw.decode("utf-8", errors="replace")
            current_value = b"TEST OK"
            if request.option == GattWriteOption.WRITE_WITH_RESPONSE:
                request.respond()
            print(f"WRITE <- {names!r} ({len(raw)} bytes)", flush=True)
            print("Next READ will return TEST OK (test result, not a teacher grade).", flush=True)
        except Exception as error:
            print(f"WRITE failed: {error}", flush=True)
        finally:
            deferral.complete()

    def on_read(_sender, args):
        deferral = args.get_deferral()
        asyncio.run_coroutine_threadsafe(answer_read(args, deferral), loop)

    def on_write(_sender, args):
        deferral = args.get_deferral()
        asyncio.run_coroutine_threadsafe(answer_write(args, deferral), loop)

    def on_status(_sender, args):
        print(f"BLE advertising: {args.status} (error: {args.error})", flush=True)

    read_token = characteristic.add_read_requested(on_read)
    write_token = characteristic.add_write_requested(on_write)
    status_token = provider.add_advertisement_status_changed(on_status)
    advertising = GattServiceProviderAdvertisingParameters()
    advertising.is_connectable = True
    advertising.is_discoverable = True
    try:
        provider.start_advertising_with_parameters(advertising)
        await asyncio.sleep(1)
        if provider.advertisement_status not in (
            GattServiceProviderAdvertisementStatus.STARTED,
            GattServiceProviderAdvertisementStatus.STARTED_WITHOUT_ALL_ADVERTISEMENT_DATA,
        ):
            raise RuntimeError(f"BLE advertising did not start: {provider.advertisement_status}")
        print("BLE Grade Lab test device is running. Leave this window open.", flush=True)
        print(f"Service: {SERVICE_UUID}", flush=True)
        print(f"Characteristic: {CHARACTERISTIC_UUID}", flush=True)
        print("On the Android phone: Scan, Connect, Read 68, Write names, Read TEST OK.", flush=True)
        print("If Teacher BLE mode is empty, switch to All BLE devices. Press Ctrl+C to stop.", flush=True)
        await asyncio.Event().wait()
    finally:
        provider.stop_advertising()
        characteristic.remove_read_requested(read_token)
        characteristic.remove_write_requested(write_token)
        provider.remove_advertisement_status_changed(status_token)


def main():
    parser = argparse.ArgumentParser(description="Run a real Windows BLE test peripheral")
    parser.add_argument("--check", action="store_true", help="check Bluetooth peripheral-role support only")
    args = parser.parse_args()
    try:
        asyncio.run(check_adapter() if args.check else serve())
    except KeyboardInterrupt:
        print("BLE test device stopped.", flush=True)
    except Exception as error:
        print(f"ERROR: {error}", flush=True)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
