import { describe, expect, it } from 'vitest';
import { fitSize } from '../../src/ui/image';

describe('fitSize', () => {
  it('긴 변을 1600px로 줄인다', () => {
    expect(fitSize(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 });
    expect(fitSize(3000, 4000, 1600)).toEqual({ w: 1200, h: 1600 });
  });
  it('작은 이미지는 그대로 둔다', () => {
    expect(fitSize(800, 600, 1600)).toEqual({ w: 800, h: 600 });
  });
});
