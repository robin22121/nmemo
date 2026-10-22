import { makeTopic, pruneEmptyTopics } from '../actions';
import type { Repo } from '../repo';
import { linkId, type Link, type Memo } from '../types';
import type { AnalyzeResult } from './types';

export interface ApplyOutcome {
  memoId: string;
  topicId: string;
  newTopic: boolean;
  /** 글을 고쳐 다시 정돈한 결과(카드는 제자리에 있었으므로 비행 연출 없음) */
  edited?: boolean;
}

/**
 * 분석 결과를 한 트랜잭션으로 반영한다.
 * 메모 갱신 + (필요하면) 새 주제 + 링크 upsert + 빈 주제 정리.
 * topicLocked 메모와 글을 고쳐 다시 정돈하는 메모(editReanalyze)는 topicId를 덮어쓰지 않는다(특성·링크는 갱신).
 * 사용자가 고른 종류·감정(kindLocked·emotionLocked)도 덮어쓰지 않는다.
 * analyzedText를 주면 분석한 글이 지금 글과 다를 때(분석 중 고쳐짐) 결과를 버린다.
 */
export async function applyResult(
  repo: Repo,
  memoId: string,
  result: AnalyzeResult,
  now = Date.now(),
  analyzedText?: string,
): Promise<ApplyOutcome | null> {
  return repo.transaction(async (r) => {
    const memo = await r.getMemo(memoId);
    if (!memo) return null; // 분석 중 지워짐
    if (analyzedText !== undefined && analyzedText !== memo.text) return null; // 옛 글의 결과

    let topicId: string;
    let newTopic = false;

    if ((memo.topicLocked || memo.editReanalyze) && memo.topicId && (await r.getTopic(memo.topicId))) {
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
      ...(memo.kindLocked ? {} : { kind: result.kind }),
      ...(memo.emotionLocked ? {} : { emotion: result.emotion }),
      keywords: result.keywords,
      summary: result.summary,
      topicId,
      status: 'organized',
      retryAt: undefined,
    };
    if (memo.editReanalyze) patch.editReanalyze = false;
    // 사용자가 일부러 비운 사진 설명(편집)은 다시 채우지 않는다
    if (memo.input === 'photo' && !memo.text.trim() && result.text && !memo.editReanalyze) patch.text = result.text;
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
    return { memoId, topicId, newTopic, ...(memo.editReanalyze ? { edited: true } : {}) };
  });
}
