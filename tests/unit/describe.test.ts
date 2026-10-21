import { describe, expect, it } from 'vitest';
import { describeReorg, euro, iga } from '../../src/core/organize/describe';

describe('describeReorg', () => {
  it('조사를 받침에 맞춘다', () => {
    expect(iga('마라톤')).toBe('이');
    expect(iga('카페')).toBe('가');
    expect(euro('인물')).toBe('로');
    expect(euro('카페')).toBe('로');
    expect(euro('운동용품')).toBe('으로');
  });

  it('설계 예시 문구', () => {
    const msg = describeReorg({ oldName: '마라톤', newName: '운동용품', renamed: true, moved: [{ memoId: 'h', fromTopicId: 'a', toTopicId: 'b', toName: '인물' }] });
    expect(msg).toBe("'마라톤'이 '운동용품'이 되면서 메모 1개가 '인물'로 옮겨졌어요");
  });

  it('이름만 바뀌거나 이동만 있는 경우', () => {
    expect(describeReorg({ oldName: '카페', newName: '원두', renamed: true, moved: [] })).toBe("'카페'가 '원두'가 되었어요");
    expect(describeReorg({ oldName: 'a', newName: 'a', renamed: false, moved: [{ memoId: 'h', fromTopicId: 'a', toTopicId: 'b', toName: '운동용품' }] })).toBe("메모 1개가 '운동용품'으로 옮겨졌어요");
  });
});
