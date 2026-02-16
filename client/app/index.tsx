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

const SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb";
const READ_UUID = "0000ffe4-0000-1000-8000-00805f9a34fb";
const WRITE_UUID = "0000ffe9-0000-1000-8000-00805f9a34fb";

const bleManager = new BleManager();
const int16 = (n: number) => (n >= 0x8000 ? n - 0x10000 : n);

/* ================= FIR ================= */
class FIRBandpass {
  fastAlpha = 0.2;
  slowAlpha = 0.02;
  fast = 0;
  slow = 0;

  filter(x: number) {
    this.fast += this.fastAlpha * (x - this.fast);
    this.slow += this.slowAlpha * (x - this.slow);
    return this.fast - this.slow;
  }

  reset() {
    this.fast = 0;
    this.slow = 0;
  }
}

/* ================= FATIGUE ================= */
class WristFatigueDetector {
  win = 200;
  alpha = 0.02;
  beta = 0.02;
  k = 0.3;
  thresholdFactor = 7;
  deadband = 0.5;

  biasX = 0;
  biasY = 0;
  biasZ = 0;
  calibrating = true;
  calibrationSamples = 0;
  calibrationLimit = 600;

  buffer: number[] = [];
  meanEst = 0;
  varEst = 1;
  cusumPos = 0;
  detected = false;

  filter = new FIRBandpass();

  applyDeadband(v: number) {
    return Math.abs(v) < this.deadband ? 0 : v;
  }

  magnitude(gx: number, gy: number, gz: number) {
    return Math.sqrt(gx * gx + gy * gy + gz * gz);
  }

  rms(arr: number[]) {
    const sum = arr.reduce((a, b) => a + b * b, 0);
    return Math.sqrt(sum / arr.length);
  }

  update(gx: number, gy: number, gz: number) {
    if (this.calibrating) {
      this.biasX += gx;
      this.biasY += gy;
      this.biasZ += gz;
      this.calibrationSamples++;

      if (this.calibrationSamples >= this.calibrationLimit) {
        this.biasX /= this.calibrationLimit;
        this.biasY /= this.calibrationLimit;
        this.biasZ /= this.calibrationLimit;
        this.calibrating = false;
      }
      return { calibrating: true };
    }

    gx -= this.biasX;
    gy -= this.biasY;
    gz -= this.biasZ;

    gx = this.applyDeadband(gx);
    gy = this.applyDeadband(gy);
    gz = this.applyDeadband(gz);

    const mag = this.magnitude(gx, gy, gz);
    const tremor = this.filter.filter(mag);

    this.buffer.push(tremor);
    if (this.buffer.length < this.win) return null;

    const segment = this.buffer.splice(0, this.win);
    const currentRMS = this.rms(segment);

    this.meanEst =
      (1 - this.alpha) * this.meanEst + this.alpha * currentRMS;

    this.varEst =
      (1 - this.beta) * this.varEst +
      this.beta * Math.pow(currentRMS - this.meanEst, 2);

    const stdEst = Math.sqrt(this.varEst);
    if (stdEst < 1e-6) return null;

    const z = (currentRMS - this.meanEst) / stdEst;
    const s = z - this.k;

    this.cusumPos = Math.max(0, this.cusumPos + s);

    const fatiguePercent = Math.min(
      100,
      (this.cusumPos / this.thresholdFactor) * 100
    );

    if (this.cusumPos > this.thresholdFactor)
      this.detected = true;

    return {
      rms: currentRMS,
      fatiguePercent,
      detected: this.detected,
      st: this.cusumPos,
      zt: z,
      calibrating: false,
    };
  }
}

/* ================= PERMISSIONS ================= */
async function requestPerms() {
  if (Platform.OS !== "android") return true;
  const granted = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);
  return granted["android.permission.BLUETOOTH_SCAN"] === "granted";
}

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
