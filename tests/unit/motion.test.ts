import { describe, expect, it } from 'vitest';
import { arcKeyframes, spring } from '../../src/motion/presets';

describe('motion presets', () => {
  it('포물선 경로의 중간점은 두 끝점보다 위로 솟는다', () => {
    const kf = arcKeyframes({ x: 180, y: 700 }, { x: 300, y: 200 }, 120);
    expect(kf.x).toHaveLength(3);
    expect(kf.y[1]!).toBeLessThan(Math.min(kf.y[0]!, kf.y[2]!));
    expect(kf.x[0]).toBe(180);
    expect(kf.x[2]).toBe(300);
    expect(kf.times).toEqual([0, 0.45, 1]);
  });

  it('가까운 이동은 덜 솟는다', () => {
    const near = arcKeyframes({ x: 0, y: 100 }, { x: 20, y: 100 }, 120);
    const far = arcKeyframes({ x: 0, y: 100 }, { x: 600, y: 100 }, 120);
    expect(100 - near.y[1]!).toBeLessThan(100 - far.y[1]!);
  });

  it('spring 설정은 설계 범위(stiffness 180~320, damping 18~26)', () => {
    for (const s of Object.values(spring)) {
      expect(s.stiffness).toBeGreaterThanOrEqual(180);
      expect(s.stiffness).toBeLessThanOrEqual(320);
      expect(s.damping).toBeGreaterThanOrEqual(18);
      expect(s.damping).toBeLessThanOrEqual(26);
    }
  });
});
