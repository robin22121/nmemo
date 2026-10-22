import { makeTopic, pruneEmptyTopics } from '../actions';
import type { Repo } from '../repo';
import { linkId, type Link, type Memo } from '../types';
import type { AnalyzeResult } from './types';

export interface ApplyOutcome {
  memoId: string;
  topicId: string;
  newTopic: boolean;
}

/**
 * 분석 결과를 한 트랜잭션으로 반영한다.
 * 메모 갱신 + (필요하면) 새 주제 + 링크 upsert + 빈 주제 정리.
 * topicLocked 메모는 topicId를 덮어쓰지 않는다(특성·링크는 갱신).
 */
export async function applyResult(
  repo: Repo,
  memoId: string,
  result: AnalyzeResult,
  now = Date.now(),
): Promise<ApplyOutcome | null> {
  return repo.transaction(async (r) => {
    const memo = await r.getMemo(memoId);
    if (!memo) return null; // 분석 중 지워짐

    let topicId: string;
    let newTopic = false;

    if (memo.topicLocked && memo.topicId && (await r.getTopic(memo.topicId))) {
      topicId = memo.topicId;
    } else {
      const existing = 'existingId' in result.topic ? await r.getTopic(result.topic.existingId) : undefined;
      if (existing) {
        topicId = existing.id;
        await r.updateTopic(existing.id, { sinceReorg: existing.sinceReorg + 1 });
      } else {
        const all = await r.listTopics();
        const name = 'newName' in result.topic ? result.topic.newName : (result.keywords[0] ?? '새 주제');
        const same = all.find((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase());
        if (same) {
          topicId = same.id;
          await r.updateTopic(same.id, { sinceReorg: same.sinceReorg + 1 });
        } else {
          const t = makeTopic(
            name,
            'newSummary' in result.topic ? result.topic.newSummary : '',
            all,
            now,
            result.keywords,
            'newColor' in result.topic ? result.topic.newColor : undefined,
          );
          await r.addTopic(t);
          topicId = t.id;
          newTopic = true;
        }
      }
    }

    const patch: Partial<Memo> = {
      kind: result.kind,
      emotion: result.emotion,
      keywords: result.keywords,
      summary: result.summary,
      topicId,
      status: 'organized',
      retryAt: undefined,
    };
    if (memo.input === 'photo' && !memo.text.trim() && result.text) patch.text = result.text;
    await r.updateMemo(memoId, patch);

    for (const rel of result.related) {
      if (!(await r.getMemo(rel.id))) continue;
      const link: Link = {
        id: linkId(memoId, rel.id),
        fromId: memoId,
        toId: rel.id,
        strength: rel.strength,
        reason: rel.reason,
      };
      await r.putLink(link);
    }

    await pruneEmptyTopics(r);
    return { memoId, topicId, newTopic };
  });
}
