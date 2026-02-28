import { useEffect, useRef, useState } from "react";
import {
  Text,
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Image,
} from "react-native";
import { BleManager, Device, State } from "react-native-ble-plx";
import { Buffer } from "buffer";
import { PermissionsAndroid } from "react-native";
import { WristFatigueDetector } from "../services/detector";
import { requestPerms } from "../permissions";

const SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb";
const READ_UUID = "0000ffe4-0000-1000-8000-00805f9a34fb";
const WRITE_UUID = "0000ffe9-0000-1000-8000-00805f9a34fb";

const bleManager = new BleManager();
const int16 = (n: number) => (n >= 0x8000 ? n - 0x10000 : n);



/* ================= COMPONENT ================= */
export default function Index() {
  const [status, setStatus] = useState("Initializing...");
  const [devices, setDevices] = useState<Record<string, Device>>({});
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [connected, setConnected] = useState<Device | null>(null);
  const [gyroData, setGyroData] = useState<any>({});
  const [fatigue, setFatigue] = useState({
    rms: 0,
    percent: 0,
    detected: false,
    st: 0,
    zt: 0,
  });
  const [calibrating, setCalibrating] = useState(true);

  const detector = useRef(new WristFatigueDetector());
  const tempBytes = useRef<number[]>([]);

  useEffect(() => {
    (async () => {
      await requestPerms();
      const state = await bleManager.state();
      if (state === State.PoweredOn) scan();
    })();
  }, []);

  /* ===== SCAN ===== */
  const scan = () => {
    setDevices({});
    setStatus("Scanning...");

    bleManager.startDeviceScan(
      null,
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          console.log(error);
          return;
        }
        if (!device) return;

        setDevices((prev) => ({
          ...prev,
          [device.id]: device,
        }));
      }
    );
  };

  /* ===== CONNECT ===== */
  const connect = async (device: Device) => {
    bleManager.stopDeviceScan();
    setStatus("Connecting...");

    const dev = await device.connect();
    await dev.discoverAllServicesAndCharacteristics();
    setConnected(dev);
    setStatus("Connected");
    setDropdownOpen(false);

    dev.monitorCharacteristicForService(
      SERVICE_UUID,
      READ_UUID,
      (_, char) => {
        if (!char?.value) return;
        handleIncoming(Buffer.from(char.value, "base64"));
      }
    );
  };

  const handleIncoming = (buf: Buffer) => {
    for (const b of buf) {
      tempBytes.current.push(b);
      if (tempBytes.current.length === 20) {
        processFrame([...tempBytes.current]);
        tempBytes.current = [];
      }
    }
  };

  const processFrame = (B: number[]) => {
    const Gx = (int16((B[9] << 8) | B[8]) / 32768) * 2000;
    const Gy = (int16((B[11] << 8) | B[10]) / 32768) * 2000;
    const Gz = (int16((B[13] << 8) | B[12]) / 32768) * 2000;

    const result = detector.current.update(Gx, Gy, Gz);

    if (result?.calibrating) {
      setCalibrating(true);
      return;
    }

    setCalibrating(false);

    if (result && result.fatiguePercent !== undefined) {
      setFatigue({
        rms: +result.rms.toFixed(3),
        percent: +result.fatiguePercent.toFixed(1),
        detected: result.detected ?? false,
        st: +result.st.toFixed(3),
        zt: +result.zt.toFixed(3),
      });
    }

    setGyroData({
      Gx: Gx.toFixed(2),
      Gy: Gy.toFixed(2),
      Gz: Gz.toFixed(2),
    });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 120 }}
    >
      <View style={{ alignItems: "center" }}>
        <Image
          source={require("../assets/images/logo.png")}
          style={{ height: 100, width: 100 }}
        />
      </View>

      <View>
         <Text style={styles.subheading}>AICRP on ESAAS</Text>
        <Text style={styles.kgp}>IIT Kharagpur Center</Text>
      </View>


      <View style={styles.headerContainer}>
        <Text style={styles.mainTitle}>Muscle Fatigue Monitor</Text>
        <Text style={styles.subTitle}>
          Wrist Tremor Analysis System
        </Text>
      </View>

      {/* DROPDOWN */}
      <View style={styles.card}>
        <TouchableOpacity
          onPress={() => setDropdownOpen(!dropdownOpen)}
        >
          <Text style={styles.sectionTitle}>
            Available Devices {dropdownOpen ? "▲" : "▼"}
          </Text>
        </TouchableOpacity>

        {dropdownOpen &&
          Object.values(devices).map((d) => (
            <TouchableOpacity
              key={d.id}
              style={styles.deviceRow}
              onPress={() => connect(d)}
            >
              <Text>{d.name ?? "Unnamed Device"}</Text>
              <Text style={styles.smallText}>{d.id}</Text>
            </TouchableOpacity>
          ))}
      </View>

      {/* STATUS */}
      <View style={styles.statusCard}>
        <Text style={styles.statusText}>
          {connected ? "🟢 Connected" : "🔴 Not Connected"}
        </Text>
        <Text style={styles.smallText}>{status}</Text>
      </View>

      {/* GYRO */}
      {connected && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Gyroscope (deg/s)</Text>
          {Object.entries(gyroData).map(([k, v]) => (
            <Text key={k} style={styles.dataText}>
              {k}: {String(v)}
            </Text>
          ))}
        </View>
      )}

      {/* FATIGUE */}
      {connected && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Fatigue Detection</Text>

          {calibrating ? (
            <Text style={styles.calibrationText}>
              Calibrating... Keep sensor still
            </Text>
          ) : (
            <>
              <Text style={styles.dataText}>RMS: {fatigue.rms}</Text>
              <Text style={styles.dataText}>Z-score: {fatigue.zt}</Text>
              <Text style={styles.dataText}>CUSUM: {fatigue.st}</Text>
              <Text style={styles.dataText}>
                Fatigue %: {fatigue.percent}%
              </Text>

              <Text
                style={[
                  styles.statusResult,
                  {
                    color: fatigue.detected ? "red" : "green",
                  },
                ]}
              >
                {fatigue.detected
                  ? "⚠️ FATIGUE DETECTED"
                  : "Normal"}
              </Text>
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}

/* ================= STYLES ================= */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  headerContainer: {
    alignItems: "center",
    marginBottom: 20,
  },
  mainTitle: {
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
  },
  subTitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  card: {
    backgroundColor: "white",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  deviceRow: {
    marginTop: 10,
    padding: 10,
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
  },
  statusCard: {
    backgroundColor: "white",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 20,
    elevation: 2,
  },
  statusText: {
    fontSize: 18,
    fontWeight: "600",
  },
  smallText: {
    fontSize: 12,
    color: "#666",
  },
  dataText: {
    fontSize: 15,
    marginTop: 4,
  },
  calibrationText: {
    color: "#ff8800",
    marginTop: 6,
  },
  statusResult: {
    marginTop: 10,
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
  },
  subheading:{
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 5,
    color:"red"
  },
  kgp:{
    textAlign: "center",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 15,
    color:"#240e84"
  }
});
