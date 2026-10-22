import { afterEach, describe, expect, it } from 'vitest';
import { fisheye, globeViewport } from '../../src/core/layout/globe';
import { measureBoard } from '../../src/ui/globe/engine';

// U1: 크기 0 측정이 NaN으로 번지지 않는다

const root = (cw: number, ch: number, rw = 0, rh = 0) => ({ clientWidth: cw, clientHeight: ch, getBoundingClientRect: () => ({ width: rw, height: rh }) }) as unknown as HTMLElement;

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('fisheye: 크기 0', () => {
  it('폭·높이가 0이어도 NaN이 아니라 1', () => {
    const vp = globeViewport(0, 0);
    expect(fisheye(0, 0, { cx: vp.cx, cy: vp.cy, width: 0, height: 0 })).toBe(1);
    expect(fisheye(10, 10, { cx: 0, cy: 0, width: 0, height: 100 })).toBe(1);
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
