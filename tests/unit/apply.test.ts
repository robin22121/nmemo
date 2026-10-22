import { beforeEach, describe, expect, it } from 'vitest';
import { deleteMemo } from '../../src/core/actions';
import { applyResult } from '../../src/core/organize/apply';
import type { AnalyzeResult } from '../../src/core/organize/types';
import { MemoryRepo, mkMemo, mkTopic } from './memoryRepo';

const base: AnalyzeResult = {
  kind: 'idea', emotion: { label: '평온', color: '#9ccfd8' }, keywords: ['카페'], summary: '카페 이야기',
  topic: { newName: '카페', newSummary: '카페 모음' }, related: [],
};
let repo: MemoryRepo;
beforeEach(() => { repo = new MemoryRepo(); });

describe('applyResult', () => {
  it('새 주제를 만들고 메모를 organized로 바꾼다', async () => {
    await repo.addMemo(mkMemo({ id: 'm', status: 'pending' }));
    const out = await applyResult(repo, 'm', base);
    expect(out?.newTopic).toBe(true);
    const m = await repo.getMemo('m');
    expect(m?.status).toBe('organized');
    expect(m?.topicId).toBe(out?.topicId);
    expect((await repo.getTopic(out!.topicId))?.centerKeywords).toEqual(['카페']);
  });

  it('newColor가 있으면 새 주제 색으로 쓰고, 없으면 팔레트에서 고른다', async () => {
    await repo.addMemo(mkMemo({ id: 'm', status: 'pending' }));
    const out = await applyResult(repo, 'm', { ...base, topic: { newName: '바다', newSummary: '', newColor: '#8ea9e8' } });
    expect((await repo.getTopic(out!.topicId))?.color).toBe('#8ea9e8');
    await repo.addMemo(mkMemo({ id: 'm2', status: 'pending' }));
    const out2 = await applyResult(repo, 'm2', { ...base, topic: { newName: '산', newSummary: '' } });
    expect((await repo.getTopic(out2!.topicId))?.color).toBe('#e8a87c');
  });

  it('기존 주제에 붙으면 sinceReorg가 올라간다', async () => {
    await repo.addTopic(mkTopic({ id: 't', name: '카페' }));
    await repo.addMemo(mkMemo({ id: 'm', status: 'pending' }));
    await applyResult(repo, 'm', { ...base, topic: { existingId: 't' } });
    expect((await repo.getTopic('t'))?.sinceReorg).toBe(1);
  });

  it('같은 이름의 새 주제는 기존 주제를 재사용한다', async () => {
    await repo.addTopic(mkTopic({ id: 't', name: '카페' }));
    await repo.addMemo(mkMemo({ id: 'm', status: 'pending' }));
    const out = await applyResult(repo, 'm', base);
    expect(out?.topicId).toBe('t');
    expect(out?.newTopic).toBe(false);
  });

  it('topicLocked 메모는 주제를 덮어쓰지 않지만 특성과 링크는 갱신한다', async () => {
    await repo.addTopic(mkTopic({ id: 'mine', name: '내 주제' }));
    await repo.addTopic(mkTopic({ id: 'other', name: '다른' }));
    await repo.addMemo(mkMemo({ id: 'm', status: 'pending', topicId: 'mine', topicLocked: true }));
    await repo.addMemo(mkMemo({ id: 'r', topicId: 'other' }));
    await applyResult(repo, 'm', { ...base, topic: { existingId: 'other' }, related: [{ id: 'r', strength: 0.7, reason: '이어짐' }] });
    const m = await repo.getMemo('m');
    expect(m?.topicId).toBe('mine');
    expect(m?.kind).toBe('idea');
    expect(m?.status).toBe('organized');
    expect(repo.links.get('m|r')?.strength).toBe(0.7);
  });

  it('사진 메모의 빈 글은 분석 설명으로 채우고 사용자 캡션은 지킨다', async () => {
    await repo.addMemo(mkMemo({ id: 'p1', input: 'photo', text: '', status: 'pending' }));
    await repo.addMemo(mkMemo({ id: 'p2', input: 'photo', text: '내 캡션', status: 'pending' }));
    await applyResult(repo, 'p1', { ...base, text: '노을 진 하늘' });
    await applyResult(repo, 'p2', { ...base, text: '노을 진 하늘' });
    expect((await repo.getMemo('p1'))?.text).toBe('노을 진 하늘');
    expect((await repo.getMemo('p2'))?.text).toBe('내 캡션');
  });

  it('분석 중 지워진 메모는 조용히 무시한다', async () => {
    expect(await applyResult(repo, 'gone', base)).toBeNull();
  });

  it('메모가 하나도 없는 주제는 자동 삭제된다', async () => {
    await repo.addTopic(mkTopic({ id: 'empty', name: '빈' }));
    await repo.addMemo(mkMemo({ id: 'm', status: 'pending' }));
    await applyResult(repo, 'm', base);
    expect(await repo.getTopic('empty')).toBeUndefined();
    const t = (await repo.listTopics())[0]!;
    await deleteMemo(repo, 'm');
    expect(await repo.getTopic(t.id)).toBeUndefined();
  });
});
