import * as THREE from 'three';
import { Team, Vec3 } from '@ink/shared';

interface ActiveTracer {
  line: THREE.Line;
  startTime: number;
  duration: number;
}

export class VisualWeapon {
  readonly group = new THREE.Group();
  private poolSize = 64;
  private tracerPool: THREE.Line[] = [];
  private activeTracers: ActiveTracer[] = [];

  constructor() {
    this.createPool();
  }

  private createPool(): void {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(6); // 2 points * 3 components
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    for (let i = 0; i < this.poolSize; i++) {
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        linewidth: 3,
        transparent: true,
        opacity: 0.9
      });
      const line = new THREE.Line(geo.clone(), mat);
      line.visible = false;
      this.tracerPool.push(line);
      this.group.add(line);
    }
  }

  spawnTracer(start: Vec3, end: Vec3, team: Team): void {
    const line = this.tracerPool.pop();
    if (!line) return; // Pool exhausted

    const color = team === Team.PINK ? 0xff007f : 0x00ffff;
    (line.material as THREE.LineBasicMaterial).color.setHex(color);
    (line.material as THREE.LineBasicMaterial).opacity = 0.9;

    const posAttr = line.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.setXYZ(0, start.x, start.y, start.z);
    posAttr.setXYZ(1, end.x, end.y, end.z);
    posAttr.needsUpdate = true;

    line.visible = true;

    this.activeTracers.push({
      line,
      startTime: performance.now(),
      duration: 80 // 80ms beam life
    });
  }

  update(): void {
    const now = performance.now();
    for (let i = this.activeTracers.length - 1; i >= 0; i--) {
      const tracer = this.activeTracers[i]!;
      const elapsed = now - tracer.startTime;

      if (elapsed >= tracer.duration) {
        tracer.line.visible = false;
        this.tracerPool.push(tracer.line);
        this.activeTracers.splice(i, 1);
      } else {
        const fade = 1 - elapsed / tracer.duration;
        (tracer.line.material as THREE.LineBasicMaterial).opacity = fade * 0.9;
      }
    }
  }

  dispose(): void {
    for (const tracer of this.tracerPool) {
      tracer.geometry.dispose();
      (tracer.material as THREE.Material).dispose();
    }
    for (const tracer of this.activeTracers) {
      tracer.line.geometry.dispose();
      (tracer.line.material as THREE.Material).dispose();
    }
  }
}
