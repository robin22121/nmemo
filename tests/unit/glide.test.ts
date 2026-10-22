import { describe, expect, it } from 'vitest';
import { MOTION } from '../../src/ui/globe/config';
import { glideTarget, releaseVelocity, springStep } from '../../src/ui/globe/engine';

// D34: 밀고 난 움직임은 손 뗀 속도를 이어받아 처음 빠르고, 정가운데에 가까울수록 서서히 느려진다(튀거나 끊기지 않음)

/** 목표까지 스프링을 프레임(1/60s)마다 풀어 (x, v) 궤적을 돌려준다 */
function run(x0: number, v0: number, om: number, frames = 240) {
  const out = [{ x: x0, v: v0 }];
  for (let i = 0; i < frames; i++) out.push(springStep(out[out.length - 1]!.x, out[out.length - 1]!.v, om, 1 / 60));
  return out;
}

describe('releaseVelocity', () => {
  it('일정한 속도면 그 속도, 이벤트 간격이 흔들려도 튀지 않는다', () => {
    const even = [0, 16, 32, 48, 64, 80, 96].map((t) => ({ t, phi: t * 0.2 }));
    expect(releaseVelocity(even, 100)).toBeCloseTo(200, 5);
    // 1ms 간격으로 붙어 온 이벤트가 섞여도(옛 EMA는 여기서 튀었다)
    const jitter = [0, 14, 15, 30, 31, 47, 60, 61, 78, 92].map((t) => ({ t, phi: t * 0.2 }));
    expect(releaseVelocity(jitter, 96)).toBeCloseTo(200, 5);
  });

  it('창(100ms)보다 오래된 표본은 보지 않는다', () => {
    const s = [{ t: 0, phi: 0 }, { t: 10, phi: 50 }, ...[60, 76, 92].map((t) => ({ t: t + 60, phi: 50 + t * 0.1 }))];
    expect(releaseVelocity(s, 160)).toBeCloseTo(100, 5);
  });

  it('멈췄다 떼면 속도를 깎고, 창 안에 움직임이 없으면 0', () => {
    const s = [0, 16, 32, 48].map((t) => ({ t, phi: t * 0.2 }));
    const moving = releaseVelocity(s, 52);
    const rested = releaseVelocity(s, 48 + MOTION.restMs + 20);
    expect(rested).toBeLessThan(moving * 0.7);
    expect(rested).toBeGreaterThanOrEqual(0);
    expect(releaseVelocity(s, 48 + MOTION.velWindowMs + 1)).toBe(0);
    expect(releaseVelocity([], 10)).toBe(0);
  });
});

describe('springStep', () => {
  it('t=0에서 속도가 이어진다(손 뗀 속도에서 출발)', () => {
    const s = springStep(-40, 300, 5, 0.001);
    expect(s.v).toBeGreaterThan(300 * 0.99);
    expect(s.v).toBeLessThanOrEqual(300);
  });

  it('dt가 커도 넘치지 않는다', () => {
    const s = springStep(-40, 160, 4, 0.5);
    expect(s.x).toBeLessThanOrEqual(0);
  });
});

describe('glideTarget', () => {
  const topics = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

  it('빠르게 밀면 관성으로 멈출 곳(φ + v·inertiaLead)에 가장 가까운 앞쪽 주제로, 빠를수록 멀리', () => {
    const slowish = glideTarget(5, 120, topics);
    const fast = glideTarget(5, 600, topics);
    expect(slowish.target).toBe(30);
    expect(fast.target).toBe(150);
    expect(fast.target).toBeGreaterThan(slowish.target);
    for (const g of [slowish, fast]) {
      expect(g.omega).toBeGreaterThanOrEqual(MOTION.glideOmegaMin);
      expect(g.omega).toBeLessThanOrEqual(MOTION.glideOmegaMax);
    }
  });

  it('왼쪽으로 밀면 왼쪽 주제로, 한 바퀴 넘어가도 이어진 각으로', () => {
    expect(glideTarget(10, -120, topics).target).toBe(-30);
    expect(glideTarget(350, 600, topics).target).toBe(510);
  });

  it('느리게 놓으면 가장 가까운 주제(snapOmega)', () => {
    expect(glideTarget(12, 10, topics)).toEqual({ target: 0, omega: MOTION.snapOmega });
    expect(glideTarget(20, 0, topics)).toEqual({ target: 30, omega: MOTION.snapOmega });
  });

  it('이 속도로 넘칠 만큼 가까운 앞 주제는 건너뛴다', () => {
    // 1° 앞 주제는 400°/s로는 넘친다 → 그다음
    const g = glideTarget(29, 400, topics);
    expect(g.target).toBeGreaterThan(30);
  });

  it('감속: 손 뗀 속도에서 출발해 넘치지 않고 속도가 줄곧 줄어 0으로(앞쪽 주제)', () => {
    for (const [phi, v] of [[5, 120], [5, 300], [5, 600], [17, 900], [100, -250], [3, 60]] as const) {
      const g = glideTarget(phi, v, topics);
      const dir = Math.sign(v);
      expect((g.target - phi) * dir).toBeGreaterThan(0);
      const tr = run(phi - g.target, v, g.omega);
      for (let i = 1; i < tr.length; i++) {
        // 목표를 넘지 않는다(x의 부호가 바뀌지 않는다)
        expect(tr[i]!.x * dir).toBeLessThanOrEqual(1e-9);
        // 반대로 돌지 않는다
        expect(tr[i]!.v * dir).toBeGreaterThanOrEqual(-1e-9);
      }
      expect(Math.abs(tr[tr.length - 1]!.x)).toBeLessThan(0.05);
      // ω = |v|/거리 범위 안이면 속도는 처음부터 줄곧 준다(가속 없이 감속만)
      if (g.omega * Math.abs(g.target - phi) <= 2 * Math.abs(v))
        for (let i = 1; i < tr.length; i++) expect(Math.abs(tr[i]!.v)).toBeLessThanOrEqual(Math.abs(tr[i - 1]!.v) + 1e-9);
    }
  });
});
