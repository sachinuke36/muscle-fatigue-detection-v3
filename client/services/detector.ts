import { FIRBandpass } from "./filter";

export class WristFatigueDetector {
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

    this.meanEst = (1 - this.alpha) * this.meanEst + this.alpha * currentRMS;

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
      (this.cusumPos / this.thresholdFactor) * 100,
    );

    if (this.cusumPos > this.thresholdFactor) this.detected = true;

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
