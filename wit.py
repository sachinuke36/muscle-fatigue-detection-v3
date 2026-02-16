
import asyncio
import bleak
import device_model
import time
from server import broadcast

devices = []
BLEDevice = None
last_update_time = 0


async def scan():
    global BLEDevice

    print("Searching for Bluetooth devices......")
    devices = await bleak.BleakScanner.discover(timeout=20.0)
    print("Search ended")

    for d in devices:
        if d.name and "WT" in d.name:
            print(f"{d.address}: {d.name}")

    addr = input("Please enter the device UUID shown above: ").strip()

    for d in devices:
        if d.address == addr:
            BLEDevice = d
            return

    print("Device not found.")


# def updateData(DeviceModel):
#     global last_update_time
#     now = time.time()
#     if now - last_update_time > 0.5:
#         last_update_time = now
#         print("\033[H\033[J", end="")
#         print(
#             f"""
# AccX: {DeviceModel.get("AccX")} | AccY: {DeviceModel.get("AccY")} | AccZ: {DeviceModel.get("AccZ")}
# AsX:  {DeviceModel.get("AsX")}  | AsY:  {DeviceModel.get("AsY")}  | AsZ:  {DeviceModel.get("AsZ")}
# AngX: {DeviceModel.get("AngX")} | AngY: {DeviceModel.get("AngY")} | AngZ: {DeviceModel.get("AngZ")}
# HX:   {DeviceModel.get("HX")}   | HY:   {DeviceModel.get("HY")}   | HZ:   {DeviceModel.get("HZ")}
# Q0:   {DeviceModel.get("Q0")}   | Q1:   {DeviceModel.get("Q1")}   | Q2:   {DeviceModel.get("Q2")} | Q3: {DeviceModel.get("Q3")}
# """
#         )

def updateData(DeviceModel):
    data = {
        "AccX": DeviceModel.get("AccX"),
        "AccY": DeviceModel.get("AccY"),
        "AccZ": DeviceModel.get("AccZ"),
        "AngX": DeviceModel.get("AngX"),
        "AngY": DeviceModel.get("AngY"),
        "AngZ": DeviceModel.get("AngZ"),
        "Q0": DeviceModel.get("Q0"),
        "Q1": DeviceModel.get("Q1"),
        "Q2": DeviceModel.get("Q2"),
        "Q3": DeviceModel.get("Q3"),
    }

    asyncio.create_task(broadcast(data))



async def main():
    await scan()

    if BLEDevice is None:
        print("No device selected.")
        return

    device = device_model.DeviceModel("MyBle5.0", BLEDevice, updateData)
    await device.openDevice()   # ✅ awaited, NOT asyncio.run()


if __name__ == "__main__":
    asyncio.run(main())   # ✅ the ONLY asyncio.run in the program
