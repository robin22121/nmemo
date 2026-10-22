import { describe, expect, it } from 'vitest';
import { afterDelete, FOCUS, josaWa, nearestDot, spacedPositions } from '../../src/core/layout/focus';
import { SHAPE_IDS } from '../../src/core/shapes';

// 390×844 화면, 가장자리 18px 안쪽 상자, 정중앙 카드(최대 높이 40%)를 피한다
const BOX = { x: 18, y: 18, w: 354, h: 780 };
const AVOID = { l: 22, r: 368, t: 241, b: 655 };
const inside = ([x, y]: [number, number]) => x >= AVOID.l && x <= AVOID.r && y >= AVOID.t && y <= AVOID.b;
const inBox = ([x, y]: [number, number]) => x >= BOX.x - 1e-6 && x <= BOX.x + BOX.w + 1e-6 && y >= BOX.y - 1e-6 && y <= BOX.y + BOX.h + 1e-6;
const minDist = (ps: [number, number][]) => {
  let m = Infinity;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) m = Math.min(m, Math.hypot(ps[i]![0] - ps[j]![0], ps[i]![1] - ps[j]![1]));
  return m;
};

describe('포커스 메모 점 자리', () => {
  it('n=0 → 빈 배열, n=1·2는 깨지지 않는다', () => {
    expect(spacedPositions('heart', 0, BOX, AVOID)).toEqual([]);
    expect(spacedPositions('heart', 1, BOX, AVOID)).toHaveLength(1);
    expect(spacedPositions('heart', 2, BOX, AVOID)).toHaveLength(2);
  });

  it('12개 모양 모두 24개 점이 카드를 피하고 상자 안, 간격 ≥ 26px', () => {
    for (const id of SHAPE_IDS) {
      const ps = spacedPositions(id, FOCUS.maxDots, BOX, AVOID);
      expect(ps.length, id).toBeGreaterThan(0);
      expect(ps.every((p) => !inside(p) && inBox(p)), id).toBe(true);
      expect(minDist(ps), id).toBeGreaterThanOrEqual(FOCUS.minGap - 1e-6);
    }
  });

  it('원은 24개를 다 놓고, 놓을 자리가 모자라면 있는 만큼만(앞쪽부터)', () => {
    expect(spacedPositions('circle', 24, BOX, AVOID)).toHaveLength(24);
    const few = spacedPositions('circle', 500, BOX, AVOID);
    expect(few.length).toBeLessThan(500);
    expect(minDist(few)).toBeGreaterThanOrEqual(FOCUS.minGap - 1e-6);
  });

  it('시간순 = 윤곽 순서: 원은 위에서 시작해 시계 방향으로 돈다', () => {
    const ps = spacedPositions('circle', 6, BOX, AVOID);
    // 첫 점은 위쪽 반, 각도가 단조 증가
    expect(ps[0]![1]).toBeLessThan(AVOID.t);
    const ang = ps.map(([x, y]) => (Math.atan2(y - (BOX.y + BOX.h / 2), x - (BOX.x + BOX.w / 2)) + Math.PI * 2.5) % (Math.PI * 2));
    for (let i = 1; i < ang.length; i++) expect(ang[i]!).toBeGreaterThan(ang[i - 1]!);
  });
});

describe('포커스 도우미', () => {
  it('삭제 뒤: 다음, 마지막이면 이전, 없으면 null', () => {
    expect(afterDelete(['a', 'b', 'c'], 'b')).toBe('c');
    expect(afterDelete(['a', 'b', 'c'], 'c')).toBe('b');
    expect(afterDelete(['a'], 'a')).toBeNull();
    expect(afterDelete(['a'], 'x')).toBeNull();
  });

  it('조사: 받침 있으면 과, 없으면 와', () => {
    expect(josaWa('제주 여행')).toBe('과');
    expect(josaWa('동네 카페')).toBe('와');
    expect(josaWa('Run')).toBe('와');
  });

  it('가장 가까운 점(반경 18px 안)', () => {
    const dots = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 120, y: 100 }];
    expect(nearestDot(dots, 112, 100)).toBe('b');
    expect(nearestDot(dots, 100, 117)).toBe('a');
    expect(nearestDot(dots, 100, 130)).toBeNull();
  });
});
