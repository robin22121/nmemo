import { afterEach, describe, expect, it } from 'vitest';
import { globeViewport, projectGlobe } from '../../src/core/layout/globe';
import { splitGeom } from '../../src/core/layout/globe';
import { MOTION } from '../../src/ui/globe/config';
import { measureBoard } from '../../src/ui/globe/engine';

// U1: 크기 0 측정이 NaN으로 번지지 않는다

const root = (cw: number, ch: number, rw = 0, rh = 0) => ({ clientWidth: cw, clientHeight: ch, getBoundingClientRect: () => ({ width: rw, height: rh }) }) as unknown as HTMLElement;

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('globeViewport: 크기 0', () => {
  it('폭·높이가 0이어도 NaN이 아니라 반지름 0', () => {
    const vp = globeViewport(0, 0, 70);
    expect(vp.r).toBe(0);
    const q = projectGlobe(40, 20, 0, vp);
    expect(Number.isNaN(q.x) || Number.isNaN(q.y) || Number.isNaN(q.scale)).toBe(false);
  });
});

describe('measureBoard: 0은 실패로 다룬다', () => {
  it('모든 값이 0이면 0을 돌려준다(저장하지 않는다)', () => {
    (globalThis as { window?: unknown }).window = { innerWidth: 0, innerHeight: 0, visualViewport: { width: 0, height: 0 } };
    expect(measureBoard(root(0, 0))).toEqual({ w: 0, h: 0 });
  });

  it('clientWidth가 0이면 rect → visualViewport → innerWidth 순으로 대신 쓴다', () => {
    (globalThis as { window?: unknown }).window = { innerWidth: 390, innerHeight: 844, visualViewport: { width: 380, height: 800 } };
    expect(measureBoard(root(0, 0, 370, 700))).toEqual({ w: 370, h: 700 });
    expect(measureBoard(root(0, 0))).toEqual({ w: 380, h: 800 });
    (globalThis as { window?: unknown }).window = { innerWidth: 390, innerHeight: 844 };
    expect(measureBoard(root(0, 0))).toEqual({ w: 390, h: 844 });
    expect(measureBoard(root(300, 600))).toEqual({ w: 300, h: 600 });
  });
});

describe('splitGeom: + 버튼 여백과 safe-area(D37 펼친 상태)', () => {
  it('구 아래 끝은 bottomPad(70) + 아래 inset 위, 제목·거품 시작선은 위 inset만큼 내려간다', () => {
    const a = splitGeom(390, 844, MOTION.bottomPad);
    const b = splitGeom(390, 844, MOTION.bottomPad + 34);
    expect(a.globe.cy + a.globe.r).toBeLessThanOrEqual(844 - 70);
    expect(b.globe.cy).toBe(a.globe.cy - 34);
    expect(b.globe.r).toBe(a.globe.r);
    expect(b.top).toBe(a.top);
    expect(splitGeom(390, 844, MOTION.bottomPad + 34, 47).top).toBe(a.top + 47);
    expect(splitGeom(390, 844, MOTION.bottomPad + 34, 47).title.y).toBe(a.title.y + 47);
  });
});
