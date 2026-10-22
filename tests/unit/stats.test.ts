import { describe, expect, it } from 'vitest';
import { editMemoText, moveMemoToNewTopic, moveMemoToTopic } from '../../src/core/actions';
import { applyResult } from '../../src/core/organize/apply';
import type { AnalyzeResult } from '../../src/core/organize/types';
import { weeklyStats } from '../../src/core/stats';
import { MemoryRepo, mkMemo, mkTopic } from './memoryRepo';

// 오분류율 기록(Z5, 0단계 §2·§4-5)
const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

describe('weeklyStats: 최근 7일 정돈 N · 직접 옮김 M', () => {
  it('정돈 창 now−7일 ≤ organizedAt ≤ now 경계 양쪽', () => {
    const s = weeklyStats(
      [
        { organizedAt: NOW - 7 * DAY }, // 안(경계)
        { organizedAt: NOW }, // 안(경계)
        { organizedAt: NOW - 7 * DAY - 1 }, // 밖
        { organizedAt: NOW + 1 }, // 밖(미래)
        {}, // 기존 메모: 세지 않음
        { lockedAt: NOW }, // 정돈 기록 없이 옮김: 세지 않음
      ],
      NOW,
    );
    expect(s.organized).toBe(2);
    expect(s.moved).toBe(0);
    expect(s.rate).toBe(0);
  });

  it('옮김 창 organizedAt ≤ lockedAt ≤ organizedAt+7일 경계 양쪽', () => {
    const o = NOW - 7 * DAY;
    const s = weeklyStats(
      [
        { organizedAt: o, lockedAt: o }, // 안(경계)
        { organizedAt: o, lockedAt: o + 7 * DAY }, // 안(경계)
        { organizedAt: o, lockedAt: o + 7 * DAY + 1 }, // 밖
        { organizedAt: o, lockedAt: o - 1 }, // 정돈 전에 옮김(밖)
      ],
      NOW,
    );
    expect([s.organized, s.moved]).toEqual([4, 2]);
    expect(s.rate).toBe(0.5);
  });

  it('N=0이면 rate는 null(화면 "—")', () => {
    expect(weeklyStats([], NOW)).toEqual({ organized: 0, moved: 0, rate: null });
    expect(weeklyStats([{ organizedAt: NOW - 30 * DAY, lockedAt: NOW }], NOW).rate).toBeNull();
  });
});

describe('organizedAt·lockedAt 기록', () => {
  const result: AnalyzeResult = {
    kind: 'idea', emotion: { label: '담담', color: '#c9c2b0' }, keywords: ['k'], summary: 's',
    topic: { existingId: 'a' }, related: [],
  };
  const setup = async () => {
    const repo = new MemoryRepo();
    await repo.addTopic(mkTopic({ id: 'a', name: 'A' }));
    await repo.addTopic(mkTopic({ id: 'b', name: 'B' }));
    await repo.addMemo(mkMemo({ id: 'keep-b', topicId: 'b' }));
    return repo;
  };

  it('첫 정돈 때만 organizedAt, 글을 고쳐 다시 정돈해도 그대로', async () => {
    const repo = await setup();
    await repo.addMemo(mkMemo({ id: 'm', status: 'pending', text: '처음 글' }));
    await applyResult(repo, 'm', result, 1000, '처음 글');
    expect((await repo.getMemo('m'))?.organizedAt).toBe(1000);
    expect(await editMemoText(repo, 'm', '고친 글')).toBe('saved');
    await applyResult(repo, 'm', result, 5000, '고친 글');
    const m = (await repo.getMemo('m'))!;
    expect([m.status, m.organizedAt]).toEqual(['organized', 1000]);
  });

  it('organizedAt이 있는 메모를 다시 정돈해도(재시도 등) 바뀌지 않는다', async () => {
    const repo = await setup();
    await repo.addMemo(mkMemo({ id: 'm', status: 'pending', organizedAt: 1000 }));
    await applyResult(repo, 'm', result, 9000);
    expect((await repo.getMemo('m'))?.organizedAt).toBe(1000);
  });

  it('기존 메모(organizedAt 없음)를 고쳐 다시 정돈해도 organizedAt이 생기지 않는다', async () => {
    const repo = await setup();
    await repo.addMemo(mkMemo({ id: 'm', topicId: 'a', text: '옛 글' }));
    await editMemoText(repo, 'm', '새 글');
    await applyResult(repo, 'm', result, 9000, '새 글');
    expect((await repo.getMemo('m'))?.organizedAt).toBeUndefined();
  });

  it('쓸 때 주제를 고른 메모(이미 topicLocked)는 첫 정돈에도 organizedAt이 없고 세지 않는다', async () => {
    const repo = await setup();
    await repo.addMemo(mkMemo({ id: 'm', status: 'pending', topicId: 'a', topicLocked: true }));
    await applyResult(repo, 'm', result, 1000);
    const m = (await repo.getMemo('m'))!;
    expect([m.status, m.topicId, m.organizedAt]).toEqual(['organized', 'a', undefined]);
    expect(weeklyStats([...repo.memos.values()], 1000).organized).toBe(0);
  });

  it('직접 옮기기(주제·새 주제)는 lockedAt을 남긴다', async () => {
    const repo = await setup();
    await repo.addMemo(mkMemo({ id: 'm', topicId: 'a', organizedAt: 1000 }));
    await repo.addMemo(mkMemo({ id: 'keep-a', topicId: 'a' }));
    await moveMemoToTopic(repo, 'm', 'b', 2000);
    expect(await repo.getMemo('m')).toMatchObject({ topicId: 'b', topicLocked: true, lockedAt: 2000, organizedAt: 1000 });
    await moveMemoToNewTopic(repo, 'm', '새것', 3000);
    expect((await repo.getMemo('m'))?.lockedAt).toBe(3000);
    expect(weeklyStats([...repo.memos.values()], 3000)).toEqual({ organized: 1, moved: 1, rate: 1 });
  });
});
