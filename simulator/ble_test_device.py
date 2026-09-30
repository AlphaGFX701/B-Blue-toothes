"""Windows BLE test peripheral for the BLE Grade Lab phone app.

This device returns 68 before a write and TEST OK afterward. It never
calculates a grade and must not be used as a teacher result.
"""

import argparse
import asyncio
import sys
import threading
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
    result_after_write = b"TEST OK"
    has_written = False
    stop_event = asyncio.Event()
    command_queue = asyncio.Queue()

    def read_console():
        while True:
            line = sys.stdin.readline()
            if not line:
                return
            loop.call_soon_threadsafe(command_queue.put_nowait, line.strip())

    async def handle_console():
        nonlocal current_value, result_after_write, has_written
        while True:
            command = await command_queue.get()
            action, _, value = command.partition(" ")
            action = action.lower()
            if action in ("help", "?"):
                print("Commands: result <text> | show | reset | quit", flush=True)
            elif action == "result" and value:
                encoded = value.encode("utf-8")
                if len(encoded) > 512:
                    print("Result is too long (maximum 512 UTF-8 bytes).", flush=True)
                    continue
                result_after_write = encoded
                if has_written:
                    current_value = encoded
                print(f"Next result set to {value!r}. The phone must tap Read result to fetch it.", flush=True)
            elif action == "show":
                print(f"Current READ -> {current_value.decode('utf-8')!r}; after WRITE -> {result_after_write.decode('utf-8')!r}", flush=True)
            elif action == "reset":
                current_value = b"68"
                result_after_write = b"TEST OK"
                has_written = False
                print("Session reset. First READ -> 68; after WRITE -> TEST OK.", flush=True)
            elif action == "quit":
                stop_event.set()
                return
            elif command:
                print("Unknown command. Type help for available commands.", flush=True)

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
        nonlocal current_value, has_written
        try:
            request = await args.get_request_async()
            if request is None:
                print("WRITE request expired", flush=True)
                return
            raw = bytes(request.value)
            names = raw.decode("utf-8", errors="replace")
            current_value = result_after_write
            has_written = True
            if request.option == GattWriteOption.WRITE_WITH_RESPONSE:
                request.respond()
            print(f"WRITE <- {names!r} ({len(raw)} bytes)", flush=True)
            print(f"Next READ will return {current_value.decode('utf-8')!r} (test result, not a teacher grade).", flush=True)
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
        print("Type 'result <text>' here to change the value returned after WRITE, then tap Read result on the phone.", flush=True)
        print("Commands: result <text> | show | reset | quit", flush=True)
        print("If Teacher BLE mode is empty, switch to All devices. Press Ctrl+C or type quit to stop.", flush=True)
        threading.Thread(target=read_console, daemon=True, name="ble-lab-console").start()
        console_task = asyncio.create_task(handle_console())
        try:
            await stop_event.wait()
        finally:
            console_task.cancel()
            try:
                await console_task
            except asyncio.CancelledError:
                pass
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
