import { describe, it } from 'vitest';
import { Match } from '../server/src/Match.js';
import { PaintGrid } from '../server/src/PaintGrid.js';

describe('trace WEAPON_SELECT', () => {
  it('traces transitions with real timestamps', () => {
    let reset = false;
    const grid = new PaintGrid(128);
    const match = new Match(grid, () => {
      reset = true;
    });
    const startTime = 100000;
    console.log(
      't=100000:',
      match.update(1, startTime).newPhase,
      'phaseEnds',
      match.phaseEndsAt
    );
    console.log(
      't=103100:',
      match.update(1, startTime + 3100).newPhase,
      'matchEnds',
      match.matchEndsAt
    );
    console.log(
      't=183200:',
      match.update(1, startTime + 183200).newPhase,
      'phaseEnds',
      match.phaseEndsAt
    );
    console.log(
      't=191300:',
      match.update(1, startTime + 191300).newPhase,
      'phaseEnds',
      match.phaseEndsAt,
      'reset',
      reset
    );
    const r = match.update(1, startTime + 201400);
    console.log('t=201400:', r.newPhase, 'reset', reset);
  });
});
