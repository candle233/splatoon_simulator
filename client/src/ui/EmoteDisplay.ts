import { EmoteType, Team } from '@ink/shared';
import { t } from '../i18n.js';

/**
 * DOM-based quick-chat bubbles (Booyah! / Ouch! / tactical callouts), rendered
 * above characters. Bubbles are plain positioned divs — not Three.js sprites —
 * projected from world space by a projector callback each frame.
 *
 * Elements are pooled (max 8 concurrent): the render loop only repositions
 * active bubbles and never creates or destroys nodes.
 */

export const MAX_EMOTE_BUBBLES = 8;

/** How long a bubble stays on screen (CSS animation matches this duration). */
const EMOTE_BUBBLE_LIFETIME_MS = 2400;

/** Localized quick-chat label per emote type. */
const EMOTE_LABEL_KEYS: Record<EmoteType, string> = {
  booyah: 'emote.booyah',
  ouch: 'emote.ouch',
  ping_enemy: 'emote.pingEnemy',
  ping_area: 'emote.pingArea',
  ping_defend: 'emote.pingDefend'
};

/** Glyph prefix shown inside the bubble. */
const EMOTE_ICONS: Record<EmoteType, string> = {
  booyah: '⭐',
  ouch: '❗',
  ping_enemy: '☠',
  ping_area: '➤',
  ping_defend: '🛡'
};

/** CSS modifier per emote type (drives the float / shake animation). */
const EMOTE_CLASS: Record<EmoteType, string> = {
  booyah: 'emote-booyah',
  ouch: 'emote-ouch',
  ping_enemy: 'emote-ping',
  ping_area: 'emote-ping',
  ping_defend: 'emote-ping'
};

/** Reused screen-space projection result (no per-frame allocation). */
export interface EmoteScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

/** Reused head-position result for bubbles that follow a moving player. */
export interface EmoteHeadPoint {
  x: number;
  y: number;
  z: number;
}

/** Projects a world point to CSS-pixel screen coordinates into `out`. */
export type EmoteScreenProjector = (
  wx: number,
  wy: number,
  wz: number,
  out: EmoteScreenPoint
) => void;

/**
 * Fills `out` with a player's current head position; false when the player is
 * no longer in the scene (left the match) and the bubble should keep its last
 * anchored position.
 */
export type EmoteHeadResolver = (playerId: string, out: EmoteHeadPoint) => boolean;

interface PooledEmoteBubble {
  root: HTMLDivElement;
  inner: HTMLDivElement;
  nameEl: HTMLDivElement;
  textEl: HTMLDivElement;
  /** Anchored world position (follows the player while they exist). */
  x: number;
  y: number;
  z: number;
  playerId: string;
  bornAt: number;
  active: boolean;
}

export class EmoteDisplay {
  private container: HTMLElement;
  private pool: PooledEmoteBubble[] = [];
  private readonly scratchScreen: EmoteScreenPoint = { x: 0, y: 0, visible: false };
  private readonly scratchHead: EmoteHeadPoint = { x: 0, y: 0, z: 0 };

  constructor() {
    let cont = document.getElementById('emote-layer');
    if (!cont) {
      cont = document.createElement('div');
      cont.id = 'emote-layer';
      document.getElementById('game-container')?.appendChild(cont);
    }
    this.container = cont;

    for (let i = 0; i < MAX_EMOTE_BUBBLES; i++) {
      this.pool.push(this.createBubble());
    }
  }

  private createBubble(): PooledEmoteBubble {
    const root = document.createElement('div');
    root.className = 'emote-bubble hidden';
    const inner = document.createElement('div');
    inner.className = 'emote-inner';
    const nameEl = document.createElement('div');
    nameEl.className = 'emote-name';
    const textEl = document.createElement('div');
    textEl.className = 'emote-text';
    inner.appendChild(nameEl);
    inner.appendChild(textEl);
    root.appendChild(inner);
    this.container.appendChild(root);
    return { root, inner, nameEl, textEl, x: 0, y: 0, z: 0, playerId: '', bornAt: 0, active: false };
  }

  /**
   * Shows a quick-chat bubble above a world position. Reuses the sender's
   * existing bubble when they spam, else a free pool slot, else steals the
   * oldest active bubble (pool is capped at MAX_EMOTE_BUBBLES).
   */
  show(
    playerId: string,
    playerName: string,
    team: Team,
    type: EmoteType,
    x: number,
    y: number,
    z: number
  ): void {
    let bubble = this.pool.find((b) => b.active && b.playerId === playerId);
    if (!bubble) {
      bubble = this.pool.find((b) => !b.active);
      if (!bubble) {
        let oldest = this.pool[0]!;
        for (const b of this.pool) {
          if (b.bornAt < oldest.bornAt) oldest = b;
        }
        bubble = oldest;
      }
    }

    bubble.active = true;
    bubble.playerId = playerId;
    bubble.x = x;
    bubble.y = y;
    bubble.z = z;
    bubble.bornAt = performance.now();
    bubble.nameEl.textContent = playerName;
    bubble.textEl.textContent = `${EMOTE_ICONS[type]} ${t(EMOTE_LABEL_KEYS[type])}`;

    const teamClass = team === Team.PINK ? 'team-pink' : 'team-cyan';
    bubble.root.className = `emote-bubble ${EMOTE_CLASS[type]} ${teamClass}`;

    // Restart the CSS animation even when the same node is reused back-to-back.
    bubble.inner.style.animation = 'none';
    void bubble.inner.offsetWidth;
    bubble.inner.style.animation = '';
  }

  /**
   * Per-frame update: follows the sender's head, projects to screen space and
   * positions the pooled DOM nodes. Lifetime / fade / shake are CSS-driven.
   */
  update(now: number, project: EmoteScreenProjector, resolveHead: EmoteHeadResolver | null): void {
    for (const bubble of this.pool) {
      if (!bubble.active) continue;

      if (now - bubble.bornAt >= EMOTE_BUBBLE_LIFETIME_MS) {
        bubble.active = false;
        bubble.root.className = 'emote-bubble hidden';
        continue;
      }

      if (bubble.playerId && resolveHead && resolveHead(bubble.playerId, this.scratchHead)) {
        bubble.x = this.scratchHead.x;
        bubble.y = this.scratchHead.y;
        bubble.z = this.scratchHead.z;
      }

      project(bubble.x, bubble.y, bubble.z, this.scratchScreen);
      if (!this.scratchScreen.visible) {
        bubble.root.classList.add('offscreen');
        continue;
      }
      bubble.root.classList.remove('offscreen');
      bubble.root.style.transform = `translate(${this.scratchScreen.x}px, ${this.scratchScreen.y}px)`;
    }
  }

  /** Hides every bubble (match reset / disconnect). */
  clear(): void {
    for (const bubble of this.pool) {
      bubble.active = false;
      bubble.root.className = 'emote-bubble hidden';
    }
  }
}
