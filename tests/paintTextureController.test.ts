import { describe, it, expect } from 'vitest';
import { PaintTextureController } from '../client/src/world/PaintEngine.js';

describe('Subagent 16: Paint Texture GPU Update & Dirty Flag Throttling', () => {
  it('does not increment texture uploads when dirty flag is false', () => {
    let mockNeedsUpdate = false;
    const mockTexture = {
      get needsUpdate() {
        return mockNeedsUpdate;
      },
      set needsUpdate(val: boolean) {
        mockNeedsUpdate = val;
      }
    };

    const controller = new PaintTextureController(mockTexture);
    expect(controller.textureUploads).toBe(0);

    // 10 render frames with no paint events
    for (let frame = 0; frame < 10; frame++) {
      const flushed = controller.flushTextureUpdate();
      expect(flushed).toBe(false);
      expect(mockNeedsUpdate).toBe(false);
    }

    expect(controller.textureUploads).toBe(0);
  });

  it('triggers exactly ONE GPU texture upload even if 100 paint events occur in the same frame', () => {
    let mockNeedsUpdate = false;
    const mockTexture = {
      get needsUpdate() {
        return mockNeedsUpdate;
      },
      set needsUpdate(val: boolean) {
        mockNeedsUpdate = val;
      }
    };

    const controller = new PaintTextureController(mockTexture);

    // 100 paint events occur before next render frame
    for (let i = 0; i < 100; i++) {
      controller.markDirty();
    }

    expect(controller.isDirty()).toBe(true);

    // Render frame arrives: flushTextureUpdate() is called ONCE
    const flushed = controller.flushTextureUpdate();
    expect(flushed).toBe(true);
    expect(mockNeedsUpdate).toBe(true);
    expect(controller.textureUploads).toBe(1);
    expect(controller.isDirty()).toBe(false);

    // Next frame has no new paint: uploads stay at 1
    mockNeedsUpdate = false;
    const secondFrame = controller.flushTextureUpdate();
    expect(secondFrame).toBe(false);
    expect(mockNeedsUpdate).toBe(false);
    expect(controller.textureUploads).toBe(1);
  });
});
