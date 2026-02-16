import { useEffect, useRef, useState } from "react";
import {
  Text,
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { BleManager, Device, State } from "react-native-ble-plx";
import { Buffer } from "buffer";
import { PermissionsAndroid } from "react-native";

// ===== UUIDs =====
const SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb";
const READ_UUID    = "0000ffe4-0000-1000-8000-00805f9a34fb";
const WRITE_UUID   = "0000ffe9-0000-1000-8000-00805f9a34fb";

const bleManager = new BleManager();
const int16 = (n: number) => (n >= 0x8000 ? n - 0x10000 : n);

// ===== Permissions =====
async function requestPerms() {
  if (Platform.OS !== "android") return true;
  const g = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);
  return g["android.permission.BLUETOOTH_SCAN"] === "granted";
}

export default function Index() {
  const [status, setStatus] = useState("Initializing Bluetooth...");
  const [devices, setDevices] = useState<Record<string, Device>>({});
  const [connected, setConnected] = useState<Device | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [data, setData] = useState<any>({});

  const tempBytes = useRef<number[]>([]);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ===== INIT =====
  useEffect(() => {
    let sub: any;

    (async () => {
      await requestPerms();
      if (Platform.OS === "android") {
        try { await bleManager.enable(); } catch {}
      }

      const s = await bleManager.state();
      if (s === State.PoweredOn) scan();

      sub = bleManager.onStateChange((st) => {
        if (st === State.PoweredOn) scan();
      }, true);
    })();

    return () => {
      if (sub) sub.remove();
      if (pollTimer.current) clearInterval(pollTimer.current);
      bleManager.destroy();
    };
  }, []);

  // ===== SCAN =====
  const scan = () => {
    setStatus("Scanning for devices...");
    setDevices({});
    bleManager.startDeviceScan(null, null, (_, d) => {
      if (!d) return;
      setDevices((prev) => ({ ...prev, [d.id]: d }));
    });
  };

  // ===== CONNECT =====
  const connect = async (d: Device) => {
    bleManager.stopDeviceScan();
    setDropdownOpen(false);
    setStatus("Connecting...");

    const dev = await d.connect();
    await dev.discoverAllServicesAndCharacteristics();

    dev.onDisconnected(() => {
      setConnected(null);
      setStatus("Disconnected");
      if (pollTimer.current) clearInterval(pollTimer.current);
    });

    setConnected(dev);
    setStatus("Connected");

    startNotify(dev);
    startPolling(dev);
  };

  // ===== WRITE =====
  const writeCmd = async (dev: Device, bytes: number[]) => {
    await dev.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      WRITE_UUID,
      Buffer.from(bytes).toString("base64")
    );
  };

  // ===== SAME AS sendDataTh =====
  const startPolling = async (dev: Device) => {
    await new Promise((r) => setTimeout(r, 3000));
    pollTimer.current = setInterval(async () => {
      await writeCmd(dev, [0xff, 0xaa, 0x27, 0x3a, 0x00]);
      await writeCmd(dev, [0xff, 0xaa, 0x27, 0x51, 0x00]);
    }, 200);
  };

  // ===== NOTIFY =====
  const startNotify = (dev: Device) => {
    dev.monitorCharacteristicForService(
      SERVICE_UUID,
      READ_UUID,
      (_, char) => {
        if (!char?.value) return;
        handleIncoming(Buffer.from(char.value, "base64"));
      }
    );
  };

  // ===== PYTHON onDataReceived =====
  const handleIncoming = (buf: Buffer) => {
    for (const b of buf) {
      tempBytes.current.push(b);

      if (tempBytes.current.length === 1 && tempBytes.current[0] !== 0x55) {
        tempBytes.current = [];
        return;
      }

      if (
        tempBytes.current.length === 2 &&
        ![0x61, 0x71].includes(tempBytes.current[1])
      ) {
        tempBytes.current = [];
        return;
      }

      if (tempBytes.current.length === 20) {
        processFrame([...tempBytes.current]);
        tempBytes.current = [];
      }
    }
  };

  // ===== PYTHON processData =====
  const processFrame = (B: number[]) => {
    if (B[1] === 0x61) {
      setData((d: any) => ({
        ...d,
        AccX: +(int16(B[3] << 8 | B[2]) / 32768 * 16).toFixed(3),
        AccY: +(int16(B[5] << 8 | B[4]) / 32768 * 16).toFixed(3),
        AccZ: +(int16(B[7] << 8 | B[6]) / 32768 * 16).toFixed(3),
        AngX: +(int16(B[15] << 8 | B[14]) / 32768 * 180).toFixed(3),
        AngY: +(int16(B[17] << 8 | B[16]) / 32768 * 180).toFixed(3),
        AngZ: +(int16(B[19] << 8 | B[18]) / 32768 * 180).toFixed(3),
      }));
    }

    if (B[2] === 0x51) {
      setData((d: any) => ({
        ...d,
        Q0: +(int16(B[5] << 8 | B[4]) / 32768).toFixed(5),
        Q1: +(int16(B[7] << 8 | B[6]) / 32768).toFixed(5),
        Q2: +(int16(B[9] << 8 | B[8]) / 32768).toFixed(5),
        Q3: +(int16(B[11] << 8 | B[10]) / 32768).toFixed(5),
      }));
    }
  };

  // ===== UI =====
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>WT Sensor</Text>
      <Text>Status: {status}</Text>

      {/* Connected device */}
      <View style={styles.card}>
        <Text style={styles.header}>Connected Device</Text>
        <Text>
          {connected
            ? `${connected.name ?? "Unnamed"} (${connected.id})`
            : "None"}
        </Text>
      </View>

      {/* Dropdown */}
      <View style={styles.card}>
        <TouchableOpacity onPress={() => setDropdownOpen(!dropdownOpen)}>
          <Text style={styles.header}>
            Available Devices {dropdownOpen ? "▲" : "▼"}
          </Text>
        </TouchableOpacity>

        {dropdownOpen &&
          Object.values(devices).map((d) => (
            <TouchableOpacity
              key={d.id}
              style={styles.row}
              onPress={() => connect(d)}
            >
              <Text>{d.name ?? "Unnamed"}</Text>
              <Text style={styles.small}>{d.id}</Text>
            </TouchableOpacity>
          ))}
      </View>

      {/* Data */}
      <View style={styles.card}>
        <Text style={styles.header}>Live Data</Text>
        {Object.entries(data).map(([k, v]) => (
          <Text key={k}>{k}: {String(v)}</Text>
        ))}
      </View>
    </ScrollView>
  );
}

// ===== STYLES =====
const styles = StyleSheet.create({
  container: { padding: 20 },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 6 },
  card: {
    backgroundColor: "#f2f2f2",
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  header: { fontSize: 16, fontWeight: "600", marginBottom: 6 },
  row: {
    padding: 10,
    backgroundColor: "#e6e6e6",
    borderRadius: 6,
    marginTop: 6,
  },
  small: { fontSize: 11, color: "#666" },
});
