import { describe, it, expect } from 'vitest';
import { generateSplatters, PRNG } from '@ink/shared';

describe('Deterministic PRNG & Paint Splatters', () => {
  it('PRNG generates identical sequences for identical seeds', () => {
    const prng1 = new PRNG(424242);
    const prng2 = new PRNG(424242);

    for (let i = 0; i < 20; i++) {
      expect(prng1.next()).toBe(prng2.next());
    }
  });

  it('PRNG generates different sequences for different seeds', () => {
    const prng1 = new PRNG(101);
    const prng2 = new PRNG(102);

    const seq1 = Array.from({ length: 10 }, () => prng1.next());
    const seq2 = Array.from({ length: 10 }, () => prng2.next());

    expect(seq1).not.toEqual(seq2);
  });

  it('generateSplatters produces identical splatters for identical seeds', () => {
    const splattersA = generateSplatters(0.5, 0.5, 0.05, 987654, 5);
    const splattersB = generateSplatters(0.5, 0.5, 0.05, 987654, 5);

    expect(splattersA).toEqual(splattersB);
    expect(splattersA.length).toBe(5);
  });

  it('generateSplatters produces different splatters for different seeds', () => {
    const splattersA = generateSplatters(0.5, 0.5, 0.05, 11111, 4);
    const splattersB = generateSplatters(0.5, 0.5, 0.05, 22222, 4);

    expect(splattersA).not.toEqual(splattersB);
  });
});
