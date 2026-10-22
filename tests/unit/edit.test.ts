import { beforeEach, describe, expect, it } from 'vitest';
import { editMemoText, setMemoEmotion, setMemoKind } from '../../src/core/actions';
import { applyResult } from '../../src/core/organize/apply';
import { OrganizeQueue } from '../../src/core/organize/queue';
import type { AnalyzeResult, Analyzer } from '../../src/core/organize/types';
import { MemoryRepo, mkMemo, mkTopic } from './memoryRepo';

// 메모장 수정·설정(E2~E4): 글을 고치면 다시 정돈하되 주제는 그대로, 직접 고른 종류·감정은 지킨다
const result: AnalyzeResult = {
  kind: 'todo', emotion: { label: '화남', color: '#e88e8e' }, keywords: ['새 키워드'], summary: '새 요약',
  topic: { existingId: 'other' }, related: [],
};
const mine = { label: '평온', color: '#9ccfd8' };
let repo: MemoryRepo;
beforeEach(async () => {
  repo = new MemoryRepo();
  await repo.addTopic(mkTopic({ id: 'mine', name: '내 주제' }));
  await repo.addTopic(mkTopic({ id: 'other', name: '다른 주제' }));
  await repo.addMemo(mkMemo({ id: 'keep', topicId: 'other' })); // 'other'가 빈 주제로 지워지지 않게
});

describe('메모장 수정·설정', () => {
  it('editReanalyze·kindLocked·emotionLocked면 결과의 주제·종류·감정이 달라도 그대로 둔다', async () => {
    await repo.addMemo(mkMemo({ id: 'm', topicId: 'mine', kind: 'idea', emotion: mine }));
    await setMemoKind(repo, 'm', 'observation');
    await setMemoEmotion(repo, 'm', mine);
    expect(await editMemoText(repo, 'm', '고친 글')).toBe('saved');
    await applyResult(repo, 'm', result, Date.now(), '고친 글');
    const m = (await repo.getMemo('m'))!;
    expect([m.topicId, m.kind, m.emotion]).toEqual(['mine', 'observation', mine]);
    expect([m.summary, m.keywords]).toEqual(['새 요약', ['새 키워드']]);
  });

  it('적용 뒤에는 editReanalyze만 false가 되고 잠금은 남는다', async () => {
    await repo.addMemo(mkMemo({ id: 'm', topicId: 'mine', kindLocked: true, emotionLocked: true }));
    await editMemoText(repo, 'm', '고친 글');
    expect((await repo.getMemo('m'))?.editReanalyze).toBe(true);
    await applyResult(repo, 'm', result, Date.now(), '고친 글');
    const m = (await repo.getMemo('m'))!;
    expect([m.editReanalyze, m.kindLocked, m.emotionLocked, m.topicLocked, m.status]).toEqual([false, true, true, false, 'organized']);
  });

  it('분석한 글이 지금 글과 다르면(분석 중 고쳐짐) 결과를 버리고 아무것도 바꾸지 않는다', async () => {
    await repo.addMemo(mkMemo({ id: 'm', topicId: 'mine', status: 'pending', kind: 'idea', summary: '옛 요약' }));
    await editMemoText(repo, 'm', '방금 고친 글');
    const before = structuredClone(await repo.getMemo('m'));
    expect(await applyResult(repo, 'm', result, Date.now(), 'm')).toBeNull();
    expect(await repo.getMemo('m')).toEqual(before);
    expect(repo.links.size).toBe(0);
  });

  it('다시 정돈이 실패해도 editReanalyze는 남는다', async () => {
    await repo.addMemo(mkMemo({ id: 'm', topicId: 'mine' }));
    await editMemoText(repo, 'm', '고친 글');
    const analyzer: Analyzer = {
      analyze: async () => { throw new Error('boom'); },
      reorganize: async () => { throw new Error('x'); },
    };
    const q = new OrganizeQueue(repo, analyzer);
    await q.drain();
    q.stop();
    const m = (await repo.getMemo('m'))!;
    expect([m.status, m.editReanalyze, m.topicId]).toEqual(['failed', true, 'mine']);
  });

  it('글 메모를 빈 글로 저장하면 원래 글을 지키고, 사진 메모는 빈 설명을 저장하며 다시 채우지 않는다', async () => {
    await repo.addMemo(mkMemo({ id: 't', text: '원래 글', topicId: 'mine' }));
    expect(await editMemoText(repo, 't', '   ')).toBe('empty');
    expect((await repo.getMemo('t'))?.text).toBe('원래 글');
    expect(await editMemoText(repo, 't', '원래 글')).toBe('same');

    await repo.addMemo(mkMemo({ id: 'p', input: 'photo', text: '설명', topicId: 'mine' }));
    expect(await editMemoText(repo, 'p', '')).toBe('saved');
    await applyResult(repo, 'p', { ...result, text: '노을 진 하늘' }, Date.now(), '');
    expect((await repo.getMemo('p'))?.text).toBe('');
  });
});
