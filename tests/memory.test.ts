import { describe, it, expect } from 'vitest';
import { computeScore, recencyDecay } from '../src/memory.js';

describe('recencyDecay', () => {
  it('returns 1.0 for current access', () => {
    const now = Date.now();
    expect(recencyDecay(now, now)).toBeCloseTo(1.0, 3);
  });

  it('decays over time', () => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    expect(recencyDecay(thirtyDaysAgo, now)).toBeLessThan(0.75);
  });
});

describe('computeScore', () => {
  it('weights similarity, importance, recency correctly', () => {
    const now = Date.now();
    const score = computeScore({
      similarity: 1.0,
      importance: 1.0,
      lastAccessedAt: now,
      now,
    });
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('lower similarity lowers score', () => {
    const now = Date.now();
    const high = computeScore({ similarity: 1.0, importance: 0.5, lastAccessedAt: now, now });
    const low = computeScore({ similarity: 0.2, importance: 0.5, lastAccessedAt: now, now });
    expect(high).toBeGreaterThan(low);
  });
});
