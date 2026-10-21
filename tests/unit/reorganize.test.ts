import { beforeEach, describe, expect, it } from 'vitest';
import { renameTopic } from '../../src/core/actions';
import { LocalAnalyzer } from '../../src/core/organize/local';
import {
  applyReorganize, buildReorganizeRequest, isReorgDue, undoReorganize, MOVE_COOLDOWN_MS, REORG_INTERVAL_MS,
} from '../../src/core/organize/reorganize';
import type { ReorganizeResult } from '../../src/core/organize/types';
import { validateReorganize } from '../../src/core/organize/validate';
import { MemoryRepo, mkMemo, mkTopic } from './memoryRepo';

const NOW = 10_000_000;
let repo: MemoryRepo;

async function seedMarathon() {
  await repo.addTopic(mkTopic({ id: 'run', name: '마라톤', summary: '마라톤 이야기', centerKeywords: ['마라톤'], sinceReorg: 5 }));
  await repo.addTopic(mkTopic({ id: 'person', name: '인물', summary: '인물', centerKeywords: ['황영조', '올림픽', '금메달'] }));
  const m = (id: string, summary: string, keywords: string[]) => repo.addMemo(mkMemo({ id, summary, keywords, topicId: 'run' }));
  await m('shoes', '마라톤화 새 용품 사기', ['마라톤화', '용품']);
  await m('garmin', '가민 시계 용품 비교', ['가민', '시계', '용품']);
  await m('socks', '러닝 양말 용품 주문', ['러닝', '양말', '용품']);
  await m('hwang', '황영조 마라톤 올림픽 금메달', ['황영조', '마라톤', '올림픽', '금메달']);
  await m('sale', '운동 용품 세일', ['운동', '용품']);
  await repo.addMemo(mkMemo({ id: 'p1', summary: '올림픽 금메달 기록', keywords: ['올림픽', '금메달'], topicId: 'person' }));
}

async function runLocal(topicId = 'run', now = NOW) {
  const req = (await buildReorganizeRequest(repo, topicId))!;
  const result = validateReorganize(await new LocalAnalyzer().reorganize(req), req);
  return applyReorganize(repo, topicId, result, now);
}

beforeEach(() => { repo = new MemoryRepo(); });

describe('재구성 트리거', () => {
  it('메모 5개 이상 + 10분 간격일 때만 대상이 된다', () => {
    const t = mkTopic({ id: 't', name: 'a', sinceReorg: 5, lastReorgAt: NOW - REORG_INTERVAL_MS });
    expect(isReorgDue(t, NOW)).toBe(true);
    expect(isReorgDue({ ...t, sinceReorg: 4 }, NOW)).toBe(false);
    expect(isReorgDue({ ...t, lastReorgAt: NOW - 1000 }, NOW)).toBe(false);
  });
});

describe('사용자가 이름을 고치면', () => {
  it('이름이 잠기고 10분 규칙과 상관없이 바로 재구성 대상이 된다', async () => {
    await repo.addTopic(mkTopic({ id: 't', name: '카페', lastReorgAt: NOW - 1000, sinceReorg: 0 }));
    await renameTopic(repo, 't', '  원두 탐방  ');
    const t = (await repo.getTopic('t'))!;
    expect(t.name).toBe('원두 탐방');
    expect(t.nameLocked).toBe(true);
    expect(isReorgDue(t, NOW)).toBe(true);
  });

  it('빈 이름은 무시한다', async () => {
    await repo.addTopic(mkTopic({ id: 't', name: '카페' }));
    await renameTopic(repo, 't', '   ');
    expect((await repo.getTopic('t'))?.name).toBe('카페');
  });
});

describe('마라톤 예시 (LocalAnalyzer)', () => {
  it('중심이 용품으로 옮겨가면 이름이 바뀌고 황영조만 빠진다', async () => {
    await seedMarathon();
    const out = await runLocal();
    expect(out?.renamed).toBe(true);
    expect(out?.oldName).toBe('마라톤');
    expect(out?.newName).toContain('용품');
    expect(out?.moved.map((m) => m.memoId)).toEqual(['hwang']);
    expect(out?.moved[0]?.toTopicId).toBe('person');

    expect((await repo.getMemo('hwang'))?.topicId).toBe('person');
    for (const id of ['shoes', 'garmin', 'socks', 'sale']) expect((await repo.getMemo(id))?.topicId).toBe('run');
    const t = await repo.getTopic('run');
    expect(t?.sinceReorg).toBe(0);
    expect(t?.lastReorgAt).toBe(NOW);
    expect(repo.batches.size).toBe(1);
    expect(repo.moves.size).toBe(1);
  });

  it('이름이 잠겨 있으면 이름을 지키고 그 이름을 중심에 포함한다', async () => {
    await seedMarathon();
    await repo.updateTopic('run', { nameLocked: true });
    const req = (await buildReorganizeRequest(repo, 'run'))!;
    const res = await new LocalAnalyzer().reorganize(req);
    expect(res.topic.centerKeywords).toContain('마라톤');
    const out = await runLocal();
    expect(out?.renamed).toBe(false);
    expect((await repo.getTopic('run'))?.name).toBe('마라톤');
  });

  it('되돌리기는 이름과 메모를 복원하고 되돌린 메모를 잠근다', async () => {
    await seedMarathon();
    const out = await runLocal();
    expect(await undoReorganize(repo, out!.batchId!)).toBe(true);
    expect((await repo.getTopic('run'))?.name).toBe('마라톤');
    const h = await repo.getMemo('hwang');
    expect(h?.topicId).toBe('run');
    expect(h?.topicLocked).toBe(true);
    expect(repo.moves.size).toBe(0);
    expect(await undoReorganize(repo, out!.batchId!)).toBe(false);
  });
});

describe('흔들림 방지 (적용 단계에서 강제)', () => {
  const askAll = (fit: number): ReorganizeResult => ({
    topic: { name: '마라톤', summary: '', centerKeywords: [] },
    moves: ['shoes', 'garmin', 'socks', 'hwang'].map((memoId, i) => ({
      memoId, to: { existingId: 'person' }, fit: fit - i * 0.01, reason: 'r',
    })),
  });

  it('locked 메모는 옮기지 않는다', async () => {
    await seedMarathon();
    await repo.updateMemo('hwang', { topicLocked: true });
    const out = await applyReorganize(repo, 'run', { topic: { name: '마라톤', summary: '', centerKeywords: [] }, moves: [{ memoId: 'hwang', to: { existingId: 'person' }, fit: 0.99, reason: '' }] }, NOW);
    expect(out?.moved).toEqual([]);
    expect((await repo.getMemo('hwang'))?.topicId).toBe('run');
  });

  it('fit 0.6 미만은 버린다', async () => {
    await seedMarathon();
    const out = await applyReorganize(repo, 'run', askAll(0.59), NOW);
    expect(out?.moved).toEqual([]);
  });

  it('한 번에 무리의 40%를 넘게 빼지 않고, fit 높은 순으로 자른다', async () => {
    await seedMarathon(); // 멤버 5개 → 최대 2개
    const out = await applyReorganize(repo, 'run', askAll(0.95), NOW);
    expect(out?.moved.map((m) => m.memoId)).toEqual(['shoes', 'garmin']);
    expect(await repo.countMemosByTopic('run')).toBe(3);
  });

  it('옮긴 메모는 30분 동안 다시 옮기지 않는다', async () => {
    await seedMarathon();
    const first = await runLocal();
    await undoReorganize(repo, first!.batchId!);
    // 되돌린 메모는 locked라 어차피 제외되지만, 쿨다운 자체도 확인: locked를 풀고 다시 시도
    await repo.updateMemo('hwang', { topicLocked: false });
    await repo.addMoves([{ id: 'x', batchId: 'b0', memoId: 'hwang', fromTopicId: 'run', toTopicId: 'person', reason: '', at: NOW }]);
    const again = await applyReorganize(repo, 'run', { topic: { name: '마라톤', summary: '', centerKeywords: [] }, moves: [{ memoId: 'hwang', to: { existingId: 'person' }, fit: 0.9, reason: '' }] }, NOW + 1000);
    expect(again?.moved).toEqual([]);
    const later = await applyReorganize(repo, 'run', { topic: { name: '마라톤', summary: '', centerKeywords: [] }, moves: [{ memoId: 'hwang', to: { existingId: 'person' }, fit: 0.9, reason: '' }] }, NOW + MOVE_COOLDOWN_MS + 1);
    expect(later?.moved).toHaveLength(1);
  });

  it('새 주제로 보내면 주제가 만들어지고 되돌리면 사라진다', async () => {
    await seedMarathon();
    const out = await applyReorganize(repo, 'run', {
      topic: { name: '마라톤', summary: '', centerKeywords: [] },
      moves: [{ memoId: 'hwang', to: { newName: '올림픽 영웅', newSummary: '' }, fit: 0.9, reason: '' }],
    }, NOW);
    expect(out?.newTopicIds).toHaveLength(1);
    expect(await repo.getTopic(out!.newTopicIds[0]!)).toBeTruthy();
    await undoReorganize(repo, out!.batchId!);
    expect(await repo.getTopic(out!.newTopicIds[0]!)).toBeUndefined();
  });

  it('바뀐 게 없으면 되돌리기 대상(batch)을 만들지 않는다', async () => {
    await seedMarathon();
    const out = await applyReorganize(repo, 'run', { topic: { name: '마라톤', summary: '마라톤 이야기', centerKeywords: ['마라톤'] }, moves: [] }, NOW);
    expect(out?.batchId).toBeNull();
    expect(repo.batches.size).toBe(0);
  });
});
