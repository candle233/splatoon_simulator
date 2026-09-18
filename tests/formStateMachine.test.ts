import { describe, it, expect } from 'vitest';
import { nextPlayerForm, PlayerMode, Team } from '@ink/shared';

describe('Subagent 11: Player Form State Machine', () => {
  it('defaults to HUMANOID when not pressing squid/shift', () => {
    const form = nextPlayerForm(
      PlayerMode.HUMANOID,
      true, // alive
      true, // grounded
      false, // squidPressed
      Team.PINK,
      Team.PINK
    );
    expect(form).toBe(PlayerMode.HUMANOID);
  });

  it('successfully transitions to SUBMERGED when grounded in own ink and pressing shift', () => {
    const formPink = nextPlayerForm(
      PlayerMode.HUMANOID,
      true,
      true,
      true,
      Team.PINK,
      Team.PINK
    );
    expect(formPink).toBe(PlayerMode.SUBMERGED);

    const formCyan = nextPlayerForm(
      PlayerMode.HUMANOID,
      true,
      true,
      true,
      Team.CYAN,
      Team.CYAN
    );
    expect(formCyan).toBe(PlayerMode.SUBMERGED);
  });

  it('forbids swimming in NEUTRAL ink', () => {
    const form = nextPlayerForm(
      PlayerMode.HUMANOID,
      true,
      true,
      true, // shift pressed
      Team.NEUTRAL,
      Team.PINK
    );
    expect(form).toBe(PlayerMode.HUMANOID);
  });

  it('forces exit from SUBMERGED when standing on ENEMY ink', () => {
    const form = nextPlayerForm(
      PlayerMode.SUBMERGED,
      true,
      true,
      true, // shift still held
      Team.CYAN, // enemy ink
      Team.PINK
    );
    expect(form).toBe(PlayerMode.HUMANOID);
  });

  it('forces exit from SUBMERGED when airborne (e.g. during a jump)', () => {
    const form = nextPlayerForm(
      PlayerMode.SUBMERGED,
      true,
      false, // airborne
      true,
      Team.PINK,
      Team.PINK
    );
    expect(form).toBe(PlayerMode.HUMANOID);
  });

  it('forces exit from SUBMERGED when shift is released', () => {
    const form = nextPlayerForm(
      PlayerMode.SUBMERGED,
      true,
      true,
      false, // released shift
      Team.PINK,
      Team.PINK
    );
    expect(form).toBe(PlayerMode.HUMANOID);
  });

  it('sets form to DEAD when alive is false', () => {
    const form = nextPlayerForm(
      PlayerMode.SUBMERGED,
      false, // dead
      true,
      true,
      Team.PINK,
      Team.PINK
    );
    expect(form).toBe(PlayerMode.DEAD);
  });
});
