import { describe, expect, it } from 'vitest';
import { OrganizeQueue, type QueueEvent } from '../../src/core/organize/queue';
import { LocalAnalyzer } from '../../src/core/organize/local';
import type { Analyzer } from '../../src/core/organize/types';
import { MemoryRepo, mkMemo, mkTopic } from './memoryRepo';

describe('OrganizeQueue', () => {
  it('오래된 순으로 한 번에 하나씩 정돈한다', async () => {
    const repo = new MemoryRepo();
    await repo.addMemo(mkMemo({ id: 'b', createdAt: 2, status: 'pending', text: '카페 커피 원두' }));
    await repo.addMemo(mkMemo({ id: 'a', createdAt: 1, status: 'pending', text: '카페 책 읽기' }));
    const order: string[] = [];
    const events: QueueEvent[] = [];
    const base = new LocalAnalyzer();
    const analyzer: Analyzer = {
      analyze: async (req) => { order.push(req.memo.id); return base.analyze(req); },
      reorganize: (r) => base.reorganize(r),
    };
    const q = new OrganizeQueue(repo, analyzer);
    q.subscribe((e) => events.push(e));
    await q.drain();
    expect(order).toEqual(['a', 'b']);
    expect((await repo.getMemo('a'))?.status).toBe('organized');
    expect((await repo.getMemo('b'))?.status).toBe('organized');
    // 비슷한 두 메모는 한 주제로 묶인다
    expect(repo.topics.size).toBe(1);
    expect(events.filter((e) => e.type === 'organized')).toHaveLength(2);
  });

  it('실패하면 attempts+1, failed, 지수 백오프로 재시도하고 3번이면 멈춘다', async () => {
    const repo = new MemoryRepo();
    await repo.addMemo(mkMemo({ id: 'a', createdAt: 1, status: 'pending' }));
    let clock = 1_000_000;
    let calls = 0;
    const analyzer: Analyzer = {
      analyze: async () => { calls++; throw new Error('boom'); },
      reorganize: async () => { throw new Error('x'); },
    };
    const q = new OrganizeQueue(repo, analyzer, { now: () => clock });
    await q.drain();
    let m = await repo.getMemo('a');
    expect([m?.status, m?.attempts, calls]).toEqual(['failed', 1, 1]);
    expect(m!.retryAt).toBeGreaterThan(clock);

    await q.drain(); // 아직 백오프 중
    expect(calls).toBe(1);
    clock = m!.retryAt!;
    await q.drain();
    m = await repo.getMemo('a');
    expect([m?.attempts, calls]).toEqual([2, 2]);
    clock = m!.retryAt!;
    await q.drain();
    expect((await repo.getMemo('a'))?.attempts).toBe(3);
    clock += 10 ** 9;
    await q.drain();
    expect(calls).toBe(3);
    q.stop();
  });

  it('잘못된 AI 응답은 실패로 처리하고 메모를 건드리지 않는다', async () => {
    const repo = new MemoryRepo();
    await repo.addMemo(mkMemo({ id: 'a', createdAt: 1, status: 'pending' }));
    const analyzer: Analyzer = {
      analyze: async () => ({ kind: 'idea', emotion: { label: '', color: '' }, keywords: [], summary: 's', topic: { existingId: 'ghost' }, related: [] }),
      reorganize: async () => { throw new Error('x'); },
    };
    const q = new OrganizeQueue(repo, analyzer);
    await q.drain();
    expect((await repo.getMemo('a'))?.status).toBe('failed');
    expect(repo.topics.size).toBe(0);
    q.stop();
  });

  it('주제에 메모가 5개 쌓이면 정돈 뒤에 재구성이 돈다', async () => {
    const repo = new MemoryRepo();
    await repo.addTopic(mkTopic({ id: 't', name: '카페', summary: '카페 이야기', centerKeywords: ['카페'], sinceReorg: 4, lastReorgAt: 0 }));
    await repo.addMemo(mkMemo({ id: 'old', topicId: 't', summary: '카페 커피', keywords: ['카페', '커피'] }));
    await repo.addMemo(mkMemo({ id: 'new', status: 'pending', text: '카페 원두 커피' }));
    const events: QueueEvent[] = [];
    const q = new OrganizeQueue(repo, new LocalAnalyzer(), { now: () => 50_000_000 });
    q.subscribe((e) => events.push(e));
    await q.drain();
    expect((await repo.getMemo('new'))?.topicId).toBe('t');
    expect((await repo.getTopic('t'))?.sinceReorg).toBe(0);
    expect((await repo.getTopic('t'))?.lastReorgAt).toBe(50_000_000);
    q.stop();
  });
});
