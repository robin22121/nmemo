import { makeTopic, pruneEmptyTopics } from '../actions';
import { newId } from '../ids';
import type { Repo } from '../repo';
import type { Memo, Move, MoveBatch, Topic } from '../types';
import { MAX_MEMBERS, type ReorganizeRequest, type ReorganizeResult } from './types';

/** 흔들림 방지 상수 — 적용 단계에서 분석기 결과와 무관하게 강제한다. */
export const REORG_TRIGGER = 5;
export const REORG_INTERVAL_MS = 10 * 60 * 1000;
export const MIN_FIT = 0.6;
export const MAX_MOVE_RATIO = 0.4;
export const MOVE_COOLDOWN_MS = 30 * 60 * 1000;

export function isReorgDue(t: Topic, now: number): boolean {
  return t.sinceReorg >= REORG_TRIGGER && now - t.lastReorgAt >= REORG_INTERVAL_MS;
}

export async function buildReorganizeRequest(repo: Repo, topicId: string): Promise<ReorganizeRequest | null> {
  const topic = await repo.getTopic(topicId);
  if (!topic) return null;
  const members = (await repo.listMemosByTopic(topicId))
    .filter((m) => m.status === 'organized')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_MEMBERS);
  const others = (await repo.listTopics()).filter((t) => t.id !== topicId);
  return {
    topic: { id: topic.id, name: topic.name, summary: topic.summary, nameLocked: topic.nameLocked, ...(topic.shape ? { shape: topic.shape } : {}) },
    members: members.map((m) => ({
      id: m.id,
      summary: m.summary ?? m.text.slice(0, 40),
      keywords: m.keywords ?? [],
      locked: m.topicLocked,
    })),
    otherTopics: others.map((t) => ({ id: t.id, name: t.name, summary: t.summary, centerKeywords: t.centerKeywords })),
  };
}

export interface ReorgMoved {
  memoId: string;
  fromTopicId: string;
  toTopicId: string;
  toName: string;
}

export interface ReorgOutcome {
  topicId: string;
  oldName: string;
  newName: string;
  renamed: boolean;
  moved: ReorgMoved[];
  newTopicIds: string[];
  /** 이름이 바뀌었거나 메모가 옮겨졌을 때만 있다(되돌리기 대상) */
  batchId: string | null;
}

/**
 * 재구성 결과를 반영한다. 한 트랜잭션: 주제 갱신 + 메모 이동 + Move 기록 + 빈 주제 삭제.
 * 강제 규칙: locked 제외, fit<0.6 버림, 최근 30분 내 옮긴 메모 제외, 무리의 40% 초과 금지.
 */
export async function applyReorganize(
  repo: Repo,
  topicId: string,
  result: ReorganizeResult,
  now = Date.now(),
): Promise<ReorgOutcome | null> {
  return repo.transaction(async (r) => {
    const topic = await r.getTopic(topicId);
    if (!topic) return null;
    const members = await r.listMemosByTopic(topicId);
    const byId = new Map<string, Memo>(members.map((m) => [m.id, m]));
    const recentlyMoved = new Set((await r.listMovesSince(now - MOVE_COOLDOWN_MS)).map((m) => m.memoId));
    const others = new Map((await r.listTopics()).filter((t) => t.id !== topicId).map((t) => [t.id, t]));

    const candidates = result.moves
      .filter((mv) => {
        const m = byId.get(mv.memoId);
        if (!m || m.topicLocked || m.status !== 'organized') return false;
        if (recentlyMoved.has(m.id)) return false;
        if (mv.fit < MIN_FIT) return false;
        if ('existingId' in mv.to && !others.has(mv.to.existingId)) return false;
        return true;
      })
      .sort((a, b) => b.fit - a.fit)
      .slice(0, Math.floor(members.length * MAX_MOVE_RATIO));

    const newName = topic.nameLocked ? topic.name : result.topic.name.trim() || topic.name;
    const newSummary = topic.nameLocked ? topic.summary : result.topic.summary || topic.summary;
    const renamed = newName !== topic.name;

    const batchId = newId();
    const moves: Move[] = [];
    const moved: ReorgMoved[] = [];
    const newTopicIds: string[] = [];
    const created = new Map<string, Topic>();

    for (const mv of candidates) {
      let dest: Topic | undefined;
      if ('existingId' in mv.to) {
        dest = others.get(mv.to.existingId);
      } else {
        const key = mv.to.newName.trim().toLowerCase();
        dest =
          created.get(key) ??
          [...others.values()].find((t) => t.name.trim().toLowerCase() === key) ??
          undefined;
        if (!dest) {
          const mem = byId.get(mv.memoId)!;
          dest = makeTopic(mv.to.newName.trim(), mv.to.newSummary, [...(await r.listTopics()), ...created.values()], now, (mem.keywords ?? []).slice(0, 4));
          await r.addTopic(dest);
          created.set(key, dest);
          newTopicIds.push(dest.id);
        }
      }
      if (!dest) continue;
      await r.updateMemo(mv.memoId, { topicId: dest.id });
      moves.push({ id: newId(), batchId, memoId: mv.memoId, fromTopicId: topicId, toTopicId: dest.id, reason: mv.reason, at: now });
      moved.push({ memoId: mv.memoId, fromTopicId: topicId, toTopicId: dest.id, toName: dest.name });
    }

    await r.updateTopic(topicId, {
      name: newName,
      summary: newSummary,
      centerKeywords: result.topic.centerKeywords.length ? result.topic.centerKeywords : topic.centerKeywords,
      lastReorgAt: now,
      sinceReorg: 0,
      // 모양은 주제를 만들 때 한 번 정해진다: 아직 없는 옛 주제만 채우고, 이유는 매번 갱신
      ...(!topic.shape && result.topic.shape ? { shape: result.topic.shape } : {}),
      ...(result.topic.shapeReason ? { shapeReason: result.topic.shapeReason } : {}),
    });

    let outBatch: string | null = null;
    if (renamed || moves.length > 0) {
      const batch: MoveBatch = {
        id: batchId,
        topicId,
        at: now,
        prevName: topic.name,
        prevSummary: topic.summary,
        prevCenterKeywords: topic.centerKeywords,
        newName,
        moveCount: moves.length,
        prevShape: topic.shape,
        prevShapeReason: topic.shapeReason,
      };
      await r.putBatch(batch);
      if (moves.length) await r.addMoves(moves);
      outBatch = batchId;
    }
    await pruneEmptyTopics(r);
    return { topicId, oldName: topic.name, newName, renamed, moved, newTopicIds, batchId: outBatch };
  });
}

/** 그 batchId의 이동을 거꾸로 적용하고 이름도 복원한다. 되돌린 메모는 topicLocked=true. */
export async function undoReorganize(repo: Repo, batchId: string): Promise<boolean> {
  return repo.transaction(async (r) => {
    const batch = await r.getBatch(batchId);
    if (!batch || batch.undone) return false;
    const moves = await r.listMovesByBatch(batchId);

    let origin = await r.getTopic(batch.topicId);
    if (!origin) {
      // 그 사이 원래 주제가 사라졌다면 이전 이름으로 다시 만든다
      origin = { ...makeTopic(batch.prevName, batch.prevSummary, await r.listTopics(), Date.now(), batch.prevCenterKeywords), id: batch.topicId };
      await r.addTopic(origin);
    } else {
      await r.updateTopic(batch.topicId, {
        name: batch.prevName,
        summary: batch.prevSummary,
        centerKeywords: batch.prevCenterKeywords,
        sinceReorg: 0,
        shape: batch.prevShape,
        shapeReason: batch.prevShapeReason,
      });
    }
    for (const mv of moves) {
      const m = await r.getMemo(mv.memoId);
      // 그 뒤 사용자가 직접 다른 곳으로 옮긴 메모는 건드리지 않는다
      if (m && m.topicId === mv.toTopicId) await r.updateMemo(mv.memoId, { topicId: batch.topicId, topicLocked: true });
    }
    await r.deleteMovesByBatch(batchId);
    await r.putBatch({ ...batch, undone: true });
    await pruneEmptyTopics(r);
    return true;
  });
}
