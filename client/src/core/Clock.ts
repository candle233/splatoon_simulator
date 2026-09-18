export class Clock {
  private lastTime = performance.now();
  private fpsCalcTime = performance.now();
  private frameCount = 0;
  private currentFps = 60;

  getDelta(): number {
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    this.frameCount++;
    if (now - this.fpsCalcTime >= 1000) {
      this.currentFps = Math.round((this.frameCount * 1000) / (now - this.fpsCalcTime));
      this.frameCount = 0;
      this.fpsCalcTime = now;
    }

    // Clamp dt to avoid huge jumps if tab is unfocused
    return Math.min(dt, 0.1);
  }

  getFPS(): number {
    return this.currentFps;
  }
}
