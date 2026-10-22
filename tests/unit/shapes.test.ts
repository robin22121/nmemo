import { describe, expect, it } from 'vitest';
import { SHAPE_IDS, getShape, memoPositions, sampleShape } from '../../src/core/shapes';

const BOX = { x: 20, y: 40, w: 300, h: 300 };
const inBox = ([x, y]: [number, number]) => x >= BOX.x - 1e-6 && x <= BOX.x + BOX.w + 1e-6 && y >= BOX.y - 1e-6 && y <= BOX.y + BOX.h + 1e-6;

describe('shapes', () => {
  it('모양 12개, 모두 0~1 안의 점으로 이루어진다', () => {
    expect(SHAPE_IDS).toHaveLength(12);
    for (const id of SHAPE_IDS) {
      const polys = getShape(id);
      expect(polys.length).toBeGreaterThan(0);
      for (const p of polys) for (const [x, y] of p) {
        expect(x).toBeGreaterThanOrEqual(-1e-9); expect(x).toBeLessThanOrEqual(1 + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9); expect(y).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('모르는 id는 원', () => {
    expect(getShape('nope')).toEqual(getShape('circle'));
    expect(getShape(undefined)).toEqual(getShape('circle'));
  });

  it('12개 모양 모두 표본이 상자 안, 개수 n', () => {
    for (const id of SHAPE_IDS) {
      const pts = sampleShape(getShape(id), 150, BOX);
      expect(pts).toHaveLength(150);
      expect(pts.every(inBox)).toBe(true);
    }
  });

  it('n=0·1·2·30', () => {
    const c = getShape('circle');
    expect(sampleShape(c, 0, BOX)).toEqual([]);
    expect(sampleShape(c, 1, BOX)).toHaveLength(1);
    expect(sampleShape(c, 2, BOX)).toHaveLength(2);
    expect(sampleShape(c, 30, BOX)).toHaveLength(30);
    expect(sampleShape(c, 30, BOX).every(inBox)).toBe(true);
  });

  it('avoid 사각형 안의 점이 없고 개수를 채우며 순서를 지킨다', () => {
    const avoid = { l: 70, t: 140, r: 270, b: 240 };
    for (const id of SHAPE_IDS) {
      const all = sampleShape(getShape(id), 20, BOX);
      const pts = sampleShape(getShape(id), 20, BOX, avoid);
      expect(pts).toHaveLength(20);
      for (const [x, y] of pts) expect(x >= avoid.l && x <= avoid.r && y >= avoid.t && y <= avoid.b).toBe(false);
      expect(all).toHaveLength(20);
    }
    // 순서: 원은 위에서 시계방향으로 돌므로 피한 뒤에도 각도가 단조 증가(한 바퀴 안에서)
    const pts = sampleShape(getShape('circle'), 12, BOX, avoid);
    const cx = BOX.x + BOX.w / 2, cy = BOX.y + BOX.h / 2;
    const ang = pts.map(([x, y]) => (Math.atan2(y - cy, x - cx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI));
    for (let i = 1; i < ang.length; i++) expect(ang[i]!).toBeGreaterThan(ang[i - 1]!);
  });

  it('윤곽이 전부 가려지면 있는 만큼(0개)만 돌려준다', () => {
    const all = { l: -1e6, t: -1e6, r: 1e6, b: 1e6 };
    expect(sampleShape(getShape('star'), 10, BOX, all)).toEqual([]);
  });

  it('memoPositions는 시간순으로 윤곽을 따라 n개', () => {
    const pts = memoPositions('heart', 7, BOX);
    expect(pts).toHaveLength(7);
    expect(pts).toEqual(sampleShape(getShape('heart'), 7, BOX));
  });
});
