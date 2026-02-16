
# coding: UTF-8
import time
import struct
import bleak
import asyncio


class DeviceModel:
    def __init__(self, deviceName, BLEDevice, callback_method):
        print("Initialize device model")
        self.deviceName = deviceName
        self.BLEDevice = BLEDevice
        self.client = None
        self.writer_characteristic = None
        self.isOpen = False
        self.callback_method = callback_method
        self.deviceData = {}
        self.TempBytes = []
        self.send_task = None

    # ---------------- Device Data ----------------

    def set(self, key, value):
        self.deviceData[key] = value

    def get(self, key):
        return self.deviceData.get(key)

    # ---------------- Device Control ----------------

    async def openDevice(self):
        print("Opening device......")

        async with bleak.BleakClient(self.BLEDevice, timeout=15) as client:
            self.client = client
            self.isOpen = True

            target_service_uuid = "0000ffe5-0000-1000-8000-00805f9a34fb"
            char_read_uuid = "0000ffe4-0000-1000-8000-00805f9a34fb"
            char_write_uuid = "0000ffe9-0000-1000-8000-00805f9a34fb"

            notify_characteristic = None

            print("Matching services......")
            for service in client.services:
                if service.uuid == target_service_uuid:
                    for char in service.characteristics:
                        if char.uuid == char_read_uuid:
                            notify_characteristic = char
                        elif char.uuid == char_write_uuid:
                            self.writer_characteristic = char

            if self.writer_characteristic:
                print("Starting register reads")
                await asyncio.sleep(3)
                self.send_task = asyncio.create_task(self.sendDataTh())

            if notify_characteristic:
                print(f"Using characteristic: {notify_characteristic.uuid}")
                await client.start_notify(
                    notify_characteristic.uuid, self.onDataReceived
                )

                try:
                    while self.isOpen:
                        await asyncio.sleep(1)
                finally:
                    if self.send_task:
                        self.send_task.cancel()
                    await client.stop_notify(notify_characteristic.uuid)
            else:
                print("No matching services or characteristics found")

    def closeDevice(self):
        self.isOpen = False
        print("The device is turned off")

    # ---------------- Communication ----------------

    async def sendDataTh(self):
        while self.isOpen:
            await self.readReg(0x3A)
            await asyncio.sleep(0.1)
            await self.readReg(0x51)
            await asyncio.sleep(0.1)

    def onDataReceived(self, sender, data):
        tempdata = bytes.fromhex(data.hex())
        for var in tempdata:
            self.TempBytes.append(var)

            if len(self.TempBytes) == 1 and self.TempBytes[0] != 0x55:
                self.TempBytes.clear()
                continue

            if len(self.TempBytes) == 2 and self.TempBytes[1] not in (0x61, 0x71):
                self.TempBytes.clear()
                continue

            if len(self.TempBytes) == 20:
                self.processData(self.TempBytes)
                self.TempBytes.clear()

    # ---------------- Data Parsing ----------------

    def processData(self, Bytes):
        if Bytes[1] == 0x61:
            Ax = self.getSignInt16(Bytes[3] << 8 | Bytes[2]) / 32768 * 16
            Ay = self.getSignInt16(Bytes[5] << 8 | Bytes[4]) / 32768 * 16
            Az = self.getSignInt16(Bytes[7] << 8 | Bytes[6]) / 32768 * 16
            Gx = self.getSignInt16(Bytes[9] << 8 | Bytes[8]) / 32768 * 2000
            Gy = self.getSignInt16(Bytes[11] << 8 | Bytes[10]) / 32768 * 2000
            Gz = self.getSignInt16(Bytes[13] << 8 | Bytes[12]) / 32768 * 2000
            AngX = self.getSignInt16(Bytes[15] << 8 | Bytes[14]) / 32768 * 180
            AngY = self.getSignInt16(Bytes[17] << 8 | Bytes[16]) / 32768 * 180
            AngZ = self.getSignInt16(Bytes[19] << 8 | Bytes[18]) / 32768 * 180

            self.set("AccX", round(Ax, 3))
            self.set("AccY", round(Ay, 3))
            self.set("AccZ", round(Az, 3))
            self.set("AsX", round(Gx, 3))
            self.set("AsY", round(Gy, 3))
            self.set("AsZ", round(Gz, 3))
            self.set("AngX", round(AngX, 3))
            self.set("AngY", round(AngY, 3))
            self.set("AngZ", round(AngZ, 3))
            self.callback_method(self)

        elif Bytes[2] == 0x3A:
            Hx = self.getSignInt16(Bytes[5] << 8 | Bytes[4]) / 120
            Hy = self.getSignInt16(Bytes[7] << 8 | Bytes[6]) / 120
            Hz = self.getSignInt16(Bytes[9] << 8 | Bytes[8]) / 120
            self.set("HX", round(Hx, 3))
            self.set("HY", round(Hy, 3))
            self.set("HZ", round(Hz, 3))

        elif Bytes[2] == 0x51:
            Q0 = self.getSignInt16(Bytes[5] << 8 | Bytes[4]) / 32768
            Q1 = self.getSignInt16(Bytes[7] << 8 | Bytes[6]) / 32768
            Q2 = self.getSignInt16(Bytes[9] << 8 | Bytes[8]) / 32768
            Q3 = self.getSignInt16(Bytes[11] << 8 | Bytes[10]) / 32768
            self.set("Q0", round(Q0, 5))
            self.set("Q1", round(Q1, 5))
            self.set("Q2", round(Q2, 5))
            self.set("Q3", round(Q3, 5))

    @staticmethod
    def getSignInt16(num):
        return num - 65536 if num >= 32768 else num

    # ---------------- GATT Helpers ----------------

    async def sendData(self, data):
        if self.client and self.client.is_connected and self.writer_characteristic:
            await self.client.write_gatt_char(
                self.writer_characteristic.uuid, bytes(data)
            )

    async def readReg(self, regAddr):
        await self.sendData(self.get_readBytes(regAddr))

    @staticmethod
    def get_readBytes(regAddr):
        return [0xFF, 0xAA, 0x27, regAddr, 0x00]
