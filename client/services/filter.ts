export class FIRBandpass {
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