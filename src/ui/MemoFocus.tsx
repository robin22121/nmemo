import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform, type MotionValue } from 'framer-motion';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { connectedTopics, visibleMoves } from '../core/connections';
import { afterDelete, FOCUS, fitSquare, josaWa, nearestDot, REVEAL, spacedPositions } from '../core/layout/focus';
import { BASIC_EMOTIONS } from '../core/palette';
import { getShape, sampleShape, SHAPE_MIN_MEMOS, type Box as ShapeBox, type Rect } from '../core/shapes';
import { MEMO_KINDS } from '../core/types';
import { deleteMemo, editMemoText, moveMemoToNewTopic, moveMemoToTopic, setDone, setMemoEmotion, setMemoKind } from '../db/repo';
import { getDb, type Memo, type Topic } from '../db/schema';
import { motionBus } from '../motion/bus';
import { spring } from '../motion/presets';
import { getQueue } from '../organize/runtime';
import { useObjectUrl } from './hooks';
import { PenIcon } from './icons';

export const KIND_LABEL: Record<string, string> = { idea: '아이디어', emotion: '감정', observation: '관찰', todo: '할 일' };

const NEUTRAL = '#c9c2b0';
/** 포커스 카드: 화면 좌우 여백(폭 = 화면 − 68px, F1), 모서리, 보기 상태 최대 높이(화면 비율) */
const SIDE = 34;
const CARD_R = 28;
const MAX_H = 0.4;
/** 펼친 상태(고치기·설정·연결)에서 카드가 화면 위에서 떨어지는 여백(E7) */
const PAD = 12;
/** 앞뒤 이동 감속 곡선(D34): 처음 빠르게 → 끝에서 서서히 */
const GLIDE = { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const };
/** 모양 드러내기(F10) 시작: 빠르게 */
const REVEAL_IN = { duration: REVEAL.inS, ease: [0.2, 0, 0.2, 1] as const };

interface Props {
  memoId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  notify: (m: string) => void;
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface Box { left: number; top: number; width: number; height: number; r: number }

/** env(safe-area-inset-*)를 숫자로 읽는다 */
function insets(): { top: number; bottom: number } {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(p);
  const cs = getComputedStyle(p);
  const r = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  p.remove();
  return r;
}

const keyboardOpen = () => {
  const vv = window.visualViewport;
  return !!vv && vv.height < window.innerHeight - 80;
};

const cardSel = (id: string) => `.g-card[data-memo-id="${CSS.escape(id)}"]`;

/** 지구본 카드의 화면 사각형(회전 포함 외접)과 주제 색. 없거나 접혔거나 화면 밖이거나 지구본이 도는 중이면 null */
function cardBox(id: string): { box: Box; color: string } | null {
  const g = document.querySelector<HTMLElement>(cardSel(id));
  const c = g?.querySelector<HTMLElement>('.card');
  if (!g || !c || document.querySelector('[data-testid="board"][data-moving="1"]')) return null;
  const b = c.getBoundingClientRect();
  if (b.width < 4 || b.height < 4 || b.bottom < 0 || b.right < 0 || b.top > window.innerHeight || b.left > window.innerWidth) return null;
  const face = c.querySelector('.face');
  const rr = face ? getComputedStyle(face).borderTopLeftRadius : '0';
  const half = Math.min(b.width, b.height) / 2;
  const r = rr.endsWith('%') ? half : Math.min(parseFloat(rr) || 0, half);
  return {
    box: { left: b.left, top: b.top, width: b.width, height: b.height, r },
    color: g.closest<HTMLElement>('.g-cluster')?.style.getPropertyValue('--c') || NEUTRAL,
  };
}

const rectBox = (el: Element | null, r = CARD_R): Box | null => {
  const b = el?.getBoundingClientRect();
  return b && b.width > 0 ? { left: b.left, top: b.top, width: b.width, height: b.height, r } : null;
};

const setCardHidden = (id: string, hidden: boolean) => {
  for (const g of document.querySelectorAll<HTMLElement>(cardSel(id))) g.style.visibility = hidden ? 'hidden' : '';
};

/** 편집 중 닫기: 자판이 내려갈 때까지(보이는 화면 높이 복귀) 또는 400ms 기다린다 */
function keyboardClosed(): Promise<void> {
  const vv = window.visualViewport;
  if (!vv || !keyboardOpen()) return Promise.resolve();
  return new Promise((res) => {
    const done = () => {
      window.clearTimeout(t);
      vv.removeEventListener('resize', on);
      res();
    };
    const on = () => {
      if (!keyboardOpen()) done();
    };
    const t = window.setTimeout(done, 400);
    vv.addEventListener('resize', on);
  });
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

const autosize = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

type Drawer = 'more' | 'conn' | null;

interface BodyProps {
  memo: Memo;
  topics: Topic[];
  order: string[];
  onClose: () => void;
  onSelect: (id: string) => void;
  notify: (m: string) => void;
  editing: boolean;
  draft: string;
  onDraft: (t: string) => void;
  startEdit: () => void;
  commitEdit: () => void;
  editRef: RefObject<HTMLTextAreaElement>;
  drawer: Drawer;
  setDrawer: (d: Drawer) => void;
}

function CardBody({ memo, topics, order, onClose, onSelect, notify, editing, draft, onDraft, startEdit, commitEdit, editRef, drawer, setDrawer }: BodyProps) {
  const url = useObjectUrl(memo.photo);
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<'kind' | 'emotion' | null>(null);
  const [newName, setNewName] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  const topic = topics.find((t) => t.id === memo.topicId);
  const colorOf = (id?: string) => topics.find((t) => t.id === id)?.color ?? NEUTRAL;
  const related = useLiveQuery(
    async () => {
      const db = getDb();
      const ls = [
        ...(await db.links.where('fromId').equals(memo.id).toArray()),
        ...(await db.links.where('toId').equals(memo.id).toArray()),
      ];
      const out: { memo: Memo; strength: number; reason: string }[] = [];
      for (const l of ls) {
        const other = await db.memos.get(l.fromId === memo.id ? l.toId : l.fromId);
        if (other) out.push({ memo: other, strength: l.strength, reason: l.reason });
      }
      return out.sort((a, b) => b.strength - a.strength);
    },
    [memo.id],
    [],
  );
  // 고정 메모가 이어진 다른 주제들(D25)
  const conns = useMemo(
    () => connectedTopics([memo, ...related.map((r) => r.memo)], related.map((r) => ({ fromId: memo.id, toId: r.memo.id, strength: r.strength, reason: r.reason }))).get(memo.id) ?? [],
    [memo, related],
  );
  const relById = useMemo(() => new Map(related.map((r) => [r.memo.id, r.memo])), [related]);
  // AI 재정리로 옮겨진 기록, 되돌린 묶음 제외, 최근 것부터(D26)
  const moves = useLiveQuery(
    async () => {
      const db = getDb();
      const ms = await db.moves.where('memoId').equals(memo.id).toArray();
      const bs = await db.batches.bulkGet([...new Set(ms.map((m) => m.batchId))]);
      return visibleMoves(ms, bs.filter((b) => !!b));
    },
    [memo.id],
    [],
  );
  const topicName = (id: string) => topics.find((t) => t.id === id)?.name ?? '(사라진 주제)';
  // 연결 줄(F6): 다른 주제와 이어진 관련 메모 중 가장 강한 것의 주제(고정 여부와 무관)
  const linkTopic = topics.find((t) => t.id === related.find((r) => r.memo.topicId && r.memo.topicId !== memo.topicId)?.memo.topicId);

  useLayoutEffect(() => autosize(editRef.current), [editing, editRef]);

  // 다른 주제로 옮기면 포커스를 닫고 지구본이 그 주제로 돈다(F6)
  const leaveTo = (topicId: string, delay = 0) => {
    onClose();
    window.setTimeout(() => motionBus.emit({ type: 'focusTopic', topicId }), delay);
  };
  const choose = async (topicId: string) => {
    if (topicId !== memo.topicId) {
      await moveMemoToTopic(memo.id, topicId);
      notify('주제를 옮겼어요');
      leaveTo(topicId);
    }
    setPicking(false);
  };
  const createTopic = async () => {
    const name = newName.trim();
    if (!name) return;
    const t = await moveMemoToNewTopic(memo.id, name);
    setNewName('');
    setPicking(false);
    notify(`'${name}' 주제를 만들었어요`);
    // 새 주제가 지구본에 자리 잡은 뒤 돈다
    leaveTo(t.id, 400);
  };
  const remove = async () => {
    const next = afterDelete(order, memo.id);
    await deleteMemo(memo.id);
    setConfirmDel(false);
    setDrawer(null);
    if (next) onSelect(next);
    else onClose();
  };

  const photo = memo.input === 'photo';
  const hasConn = related.length > 0 || moves.length > 0;
  return (
    <>
      <div className="mf-head">
        <span className="mf-date">{fmtDate(memo.createdAt)}</span>
        {editing && (
          <button type="button" className="mp-done" data-testid="edit-done" onPointerDown={(e) => e.preventDefault()} onClick={commitEdit}>
            완료
          </button>
        )}
      </div>
      {url && <img className="mp-photo" src={url} alt="" />}
      {editing ? (
        <textarea
          ref={editRef}
          className="mp-edit mf-edit"
          data-testid="sheet-edit"
          aria-label="메모 고치기"
          rows={2}
          value={draft}
          placeholder={photo ? '사진 설명' : ''}
          onChange={(e) => {
            onDraft(e.target.value);
            autosize(e.target);
          }}
        />
      ) : (
        <div
          className="mp-text-wrap mf-text-wrap"
          role="button"
          tabIndex={0}
          aria-label="메모 고치기"
          data-testid="edit-text"
          onClick={startEdit}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            startEdit();
          }}
        >
          {memo.text ? (
            <p className="mp-text mf-text" data-testid="sheet-text">{memo.text}</p>
          ) : (
            <p className="mp-text mf-text mp-placeholder">{photo ? '사진 설명 붙이기' : '글 쓰기'}</p>
          )}
          <span className="mp-pen" aria-hidden>
            <PenIcon />
          </span>
        </div>
      )}
      {memo.editReanalyze && memo.status !== 'organized' && <p className="mp-status" data-testid="reanalyzing">고친 글로 다시 정돈하는 중…</p>}
      {memo.kind === 'todo' && (
        <button type="button" className={`mp-pill todo-toggle${memo.done ? ' on' : ''}`} data-testid="todo-toggle" aria-pressed={!!memo.done} onClick={() => void setDone(memo.id, !memo.done)}>
          {memo.done ? '완료했어요 · 눌러서 취소' : '완료로 표시'}
        </button>
      )}

      <div className="mf-meta">
        {photo ? (
          <span className="mp-chip">사진</span>
        ) : (
          <button type="button" className={`mp-chip${pick === 'kind' ? ' on' : ''}`} data-testid="kind-chip" aria-expanded={pick === 'kind'} onClick={() => setPick((p) => (p === 'kind' ? null : 'kind'))}>
            {KIND_LABEL[memo.kind ?? 'idea']}
          </button>
        )}
        <button
          type="button"
          className={`mp-chip emo${pick === 'emotion' ? ' on' : ''}`}
          data-testid="emotion-chip"
          aria-expanded={pick === 'emotion'}
          style={{ ['--emo' as string]: memo.emotion?.color ?? NEUTRAL }}
          onClick={() => setPick((p) => (p === 'emotion' ? null : 'emotion'))}
        >
          <i /> {memo.emotion?.label ?? '감정'}
        </button>
        <button
          type="button"
          className={`mf-more${drawer === 'more' ? ' on' : ''}`}
          data-testid="focus-more"
          aria-label="설정"
          aria-expanded={drawer === 'more'}
          onClick={() => setDrawer(drawer === 'more' ? null : 'more')}
        >
          ⋯
        </button>
      </div>
      {pick && (
        <div className="mp-pick mf-pick" data-testid={`${pick}-pick`}>
          {pick === 'kind'
            ? MEMO_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`mp-opt${memo.kind === k ? ' on' : ''}`}
                  data-testid={`kind-opt-${k}`}
                  aria-pressed={memo.kind === k}
                  onClick={() => {
                    void setMemoKind(memo.id, k);
                    setPick(null);
                  }}
                >
                  {KIND_LABEL[k]}
                </button>
              ))
            : BASIC_EMOTIONS.map((e) => (
                <button
                  key={e.label}
                  type="button"
                  className={`mp-opt emo${memo.emotion?.label === e.label ? ' on' : ''}`}
                  data-testid={`emotion-opt-${e.label}`}
                  aria-pressed={memo.emotion?.label === e.label}
                  style={{ ['--emo' as string]: e.color }}
                  onClick={() => {
                    void setMemoEmotion(memo.id, e);
                    setPick(null);
                  }}
                >
                  <i /> {e.label}
                </button>
              ))}
        </div>
      )}

      {hasConn && (
        <button
          type="button"
          className="mf-conn"
          data-testid="focus-conn"
          aria-expanded={drawer === 'conn'}
          style={{ ['--lc' as string]: linkTopic?.color ?? colorOf(memo.topicId) }}
          onClick={() => setDrawer(drawer === 'conn' ? null : 'conn')}
        >
          ↗{' '}
          {linkTopic ? (
            <>
              <b>{linkTopic.name}</b>
              {josaWa(linkTopic.name)} 이어짐
            </>
          ) : related.length > 0 ? (
            `관련 메모 ${related.length}개`
          ) : (
            `옮겨 온 기록 ${moves.length}개`
          )}
        </button>
      )}

      {drawer === 'conn' && (
        <div className="mf-drawer" data-testid="focus-conn-detail">
          <h3 className="mp-h">관련 메모</h3>
          {related.length === 0 ? (
            <p className="mp-empty">아직 이어진 메모가 없어요</p>
          ) : (
            <ul className="related-list" data-testid="related-list">
              {related.map((r) => (
                <li key={r.memo.id} style={{ ['--c' as string]: colorOf(r.memo.topicId) }}>
                  <button type="button" onClick={() => onSelect(r.memo.id)}>
                    <span className="rel-text">{r.memo.summary || r.memo.text || '사진'}</span>
                    <span className="rel-reason">{r.reason || '내용이 이어져요'}</span>
                    <span className="rel-bar" style={{ width: `${Math.round(r.strength * 100)}%` }} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {conns.length > 0 && (
            <>
              <h3 className="mp-h">연결된 주제</h3>
              <ul className="conn-list" data-testid="conn-list">
                {conns.map((c) => {
                  const t = topics.find((x) => x.id === c.topicId);
                  const head = (
                    <>
                      <i />
                      <span className="conn-name">{t?.name ?? '(사라진 주제)'}</span>
                    </>
                  );
                  return (
                    <li key={c.topicId} data-conn-topic={c.topicId} style={{ ['--c' as string]: t?.color ?? NEUTRAL }}>
                      {t ? (
                        <button type="button" className="conn-head" onClick={() => leaveTo(c.topicId)}>
                          {head}
                        </button>
                      ) : (
                        <div className="conn-head">{head}</div>
                      )}
                      {c.links.map((l) => {
                        const m = relById.get(l.memoId);
                        return (
                          <p key={l.memoId} className="conn-link">
                            {m ? m.summary || m.text || '사진' : ''}
                            <span> · {l.reason || '내용이 이어져요'}</span>
                          </p>
                        );
                      })}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {moves.length > 0 && (
            <>
              <h3 className="mp-h">이동 기록</h3>
              <ul className="move-list" data-testid="move-list">
                {moves.map((m) => (
                  <li key={m.id} style={{ ['--c' as string]: colorOf(m.toTopicId) }}>
                    <span className="move-line">
                      {fmtDate(m.at)} · {topicName(m.fromTopicId)} → {topicName(m.toTopicId)}
                    </span>
                    {m.reason && <span className="move-reason">{m.reason}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {drawer === 'more' && (
        <div className="mf-drawer" data-testid="focus-settings">
          {memo.summary && memo.summary !== memo.text && <p className="mp-summary">요약 · {memo.summary}</p>}
          {memo.keywords && memo.keywords.length > 0 && (
            <div className="chips" aria-label="키워드">
              {memo.keywords.map((k) => (
                <span key={k} className="mp-kw">#{k}</span>
              ))}
            </div>
          )}

          <h3 className="mp-h">주제</h3>
          <div className="topic-row">
            <span className="topic-chip current" style={{ ['--c' as string]: topic?.color ?? NEUTRAL }}>
              {topic?.name ?? '정돈 전'}
            </span>
            <button type="button" className="mp-pill" data-testid="change-topic" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
              {picking ? '접기' : '주제 바꾸기'}
            </button>
          </div>
          {picking && (
            <div className="topic-pick" data-testid="topic-pick">
              <div className="chips">
                {topics.filter((t) => t.id !== memo.topicId).map((t) => (
                  <button key={t.id} type="button" className="topic-chip" style={{ ['--c' as string]: t.color }} onClick={() => void choose(t.id)}>
                    {t.name}
                  </button>
                ))}
              </div>
              <form
                className="new-topic"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createTopic();
                }}
              >
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="새 주제 이름" aria-label="새 주제 이름" maxLength={24} />
                <button type="submit" disabled={!newName.trim()}>만들기</button>
              </form>
            </div>
          )}

          <div className="danger-row">
            {confirmDel ? (
              <>
                <span>정말 지울까요?</span>
                <button type="button" className="mp-pill danger" data-testid="confirm-delete" onClick={() => void remove()}>삭제</button>
                <button type="button" className="mp-pill" onClick={() => setConfirmDel(false)}>취소</button>
              </>
            ) : (
              <button type="button" className="mp-pill danger-text" data-testid="delete-memo" onClick={() => setConfirmDel(true)}>메모 삭제</button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

type Phase = 'grow' | 'open' | 'closing' | 'shrink';

/** 메모 점: 쉴 때 자리(x,y, 카드를 피함)와 다 드러났을 때 자리(fx,fy, 모양 윤곽 전체). 한쪽에만 있으면 다른 쪽에서는 사라진다 */
interface Dot { id: string; x: number; y: number; fx: number; fy: number; rest: boolean; full: boolean; color?: string }

/** 드러난 정도 r(0~1)에서 점의 자리·불투명도 */
const dotAt = (d: Dot, r: number) => ({ x: d.x + (d.fx - d.x) * r, y: d.y + (d.fy - d.y) * r, o: d.rest ? (d.full ? 1 : 1 - r) : d.full ? r : 0 });

function SkyDot({ d, reveal, on, aim }: { d: Dot; reveal: MotionValue<number>; on: boolean; aim: boolean }) {
  const left = useTransform(reveal, (r) => dotAt(d, r).x);
  const top = useTransform(reveal, (r) => dotAt(d, r).y);
  const opacity = useTransform(reveal, (r) => dotAt(d, r).o);
  return (
    <motion.span
      className={`mf-dot${on ? ' on' : ''}${aim ? ' aim' : ''}${d.color ? ' link' : ''}`}
      data-testid="focus-dot"
      data-memo-id={d.id}
      data-on={on ? '1' : undefined}
      data-aim={aim ? '1' : undefined}
      style={{ left, top, opacity, ...(d.color ? { ['--lc' as string]: d.color } : {}) }}
      aria-hidden
    >
      <i />
    </motion.span>
  );
}

/**
 * 메모 포커스 화면(F1~F10, E1의 열고 닫기 재사용): 누른 지구본 카드 자리에서 커져 화면 정중앙의 읽기 카드가 되고,
 * 같은 주제의 메모는 주제 모양 윤곽 위의 빛나는 점(시간순), 윤곽은 옅은 먼지. 밀어서 앞뒤, 점을 눌러 그 메모로, 빈 곳을 눌러 닫는다.
 * 고치기·설정·연결을 펼치면 카드가 위로 올라가고(E7) 점은 숨는다. 뒤 지구본의 배경 주제는 계속 돈다(F5).
 */
export function MemoFocus({ memoId, onClose, onSelect, notify }: Props) {
  const reduced = !!useReducedMotion();
  const [shown, setShown] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [ghost, setGhost] = useState<{ from: Box; to: Box | null; fade: boolean } | null>(null);
  const [flipFrom, setFlipFrom] = useState<string | undefined>();
  const [tint, setTint] = useState(NEUTRAL);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [dir, setDir] = useState(0);
  const [geom, setGeom] = useState<{ w: number; h: number; top: number; bottom: number; avoid: Rect } | null>(null);
  const memoLive = useLiveQuery(() => (shown ? getDb().memos.get(shown) : undefined), [shown]);
  // 지워진 메모도 닫히는 동안은 마지막 모습으로 보여 준다
  const last = useRef<Memo | undefined>(undefined);
  if (memoLive) last.current = memoLive;
  const memo = memoLive ?? (last.current?.id === shown ? last.current : undefined);
  const topics = useLiveQuery(() => getDb().topics.toArray(), [], []);
  const topic = topics.find((t) => t.id === memo?.topicId);
  const color = topic?.color ?? tint;
  // 같은 주제 메모, 만든 순서(F3 순서)
  const siblings = useLiveQuery(
    async () => (memo?.topicId ? (await getDb().memos.where('topicId').equals(memo.topicId).sortBy('createdAt')) : []),
    [memo?.topicId],
    [],
  );
  const order = useMemo(() => {
    const ids = siblings.map((m) => m.id);
    return memo && !ids.includes(memo.id) ? [...ids, memo.id] : ids;
  }, [siblings, memo]);
  // 다른 주제와 이어진 메모 → 그 주제 색(F2, 고정 여부와 무관하게 링크 기준)
  const linkColor = useLiveQuery(
    async () => {
      const ids = siblings.map((m) => m.id);
      const out = new Map<string, string>();
      if (!ids.length || !memo?.topicId) return out;
      const db = getDb();
      const ls = [...(await db.links.where('fromId').anyOf(ids).toArray()), ...(await db.links.where('toId').anyOf(ids).toArray())].sort((a, b) => b.strength - a.strength);
      const mine = new Set(ids);
      const others = await db.memos.bulkGet(ls.map((l) => (mine.has(l.fromId) ? l.toId : l.fromId)));
      const tcolor = new Map((await db.topics.toArray()).map((t) => [t.id, t.color]));
      ls.forEach((l, i) => {
        const o = others[i];
        const self = mine.has(l.fromId) ? l.fromId : l.toId;
        if (!o?.topicId || o.topicId === memo.topicId || out.has(self)) return;
        const c = tcolor.get(o.topicId);
        if (c) out.set(self, c);
      });
      return out;
    },
    [siblings, memo?.topicId],
    new Map<string, string>(),
  );

  const stackRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const token = useRef(0);
  const prevFocus = useRef<Element | null>(null);
  const dragX = useMotionValue(0);
  // 모양 드러내기(F10): 0 = 쉬는 큰 카드, 1 = 카드가 작게 흐려지고 모양·점이 다 보임
  const reveal = useMotionValue(0);
  const cardScale = useTransform(reveal, [0, 1], [1, REVEAL.scale]);
  const cardOpacity = useTransform(reveal, [0, 1], [1, REVEAL.opacity]);
  const restDustOpacity = useTransform(reveal, [0, 1], [1, 0]);
  const fullDustOpacity = reveal;
  const seq = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  // 드러난 동안 표시(시험·스타일용): 0이 아니면 data-revealed
  useMotionValueEvent(reveal, 'change', (r) => {
    const el = rootRef.current;
    if (!el) return;
    if (r > 0.001) el.setAttribute('data-revealed', '1');
    else el.removeAttribute('data-revealed');
  });
  const [aim, setAim] = useState<string | null>(null);
  const aimRef = useRef<string | null>(null);
  const gesture = useRef<{ id: number; x0: number; y0: number; lock: 'h' | 'v' | null; inCard: boolean; r0: number } | null>(null);
  // 밀고 뗀 손가락이 카드 안 버튼·본문의 클릭(고치기 등)으로 이어지지 않게
  const swallowClick = useRef(false);
  const live = useRef({ shown, phase, editing, draft, reduced, order, drawer });
  live.current = { shown, phase, editing, draft, reduced, order, drawer };

  const expanded = editing || drawer !== null;
  const closingNow = phase === 'closing' || phase === 'shrink';

  const commitEdit = useCallback(async () => {
    const { editing: on, draft: text, shown: id } = live.current;
    if (!on || !id) return;
    if (document.activeElement instanceof HTMLElement && document.activeElement === editRef.current) document.activeElement.blur();
    setEditing(false);
    const r = await editMemoText(id, text);
    if (r === 'saved') {
      getQueue().wake();
      notify('고친 글로 다시 정돈해요');
    } else if (r === 'empty') notify('빈 메모는 저장하지 않았어요');
  }, [notify]);

  const startEdit = () => {
    if (!memo) return;
    // iOS는 손가락 이벤트 안에서 바로 포커스해야 자판이 열린다 → 동기로 그린 뒤 포커스
    flushSync(() => {
      setDraft(memo.text);
      setEditing(true);
    });
    const el = editRef.current;
    if (el) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }
  };

  const finish = () => {
    const id = live.current.shown;
    if (id) setCardHidden(id, false);
    // 포커스는 카드(지구본) 또는 열기 전 자리로
    const g = id ? document.querySelector<HTMLElement>(cardSel(id)) : null;
    if (g) {
      g.tabIndex = -1;
      g.focus({ preventScroll: true });
    } else if (prevFocus.current instanceof HTMLElement && prevFocus.current.isConnected) prevFocus.current.focus({ preventScroll: true });
    setShown(null);
    setPhase(null);
    setGhost(null);
    setEditing(false);
    setDrawer(null);
    setGeom(null);
  };

  const startClose = async () => {
    const my = ++token.current;
    // 드러내던 중이면 멈추고 큰 카드로(닫히는 껍데기는 큰 카드에서 줄어든다)
    seq.current++;
    reveal.stop();
    reveal.set(0);
    setPhase('closing');
    await commitEdit();
    await keyboardClosed();
    if (my !== token.current) return;
    // 내용이 먼저 사라지고 껍데기가 줄어든다
    if (!live.current.reduced) await sleep(140);
    if (my !== token.current) return;
    const id = live.current.shown;
    const from = rectBox(cardRef.current) ?? { left: SIDE, top: window.innerHeight / 3, width: window.innerWidth - SIDE * 2, height: window.innerHeight / 3, r: CARD_R };
    // 닫기 직전에 카드 자리를 다시 잰다(열린 동안 옮겨졌거나 사라졌을 수 있다)
    const c = id && !live.current.reduced ? cardBox(id) : null;
    setGhost({ from, to: c?.box ?? from, fade: !c });
    setPhase('shrink');
  };

  // 열기·바꾸기·닫기
  useLayoutEffect(() => {
    const { shown: cur, phase: ph } = live.current;
    if (memoId) {
      if (cur && memoId !== cur && (ph === 'open' || ph === 'grow')) {
        // 다른 메모로(밀기·점·관련 메모): 포커스 화면은 그대로, 카드 내용만 바꾼다
        void commitEdit();
        setCardHidden(cur, false);
        setCardHidden(memoId, true);
        setShown(memoId);
        return;
      }
      if (cur && memoId === cur && (ph === 'open' || ph === 'grow')) return;
      token.current++; // 닫는 중이었으면 멈춘다
      if (cur) setCardHidden(cur, false);
      if (!cur) prevFocus.current = document.activeElement;
      const c = cardBox(memoId);
      setShown(memoId);
      setEditing(false);
      setDrawer(null);
      setDir(0);
      setFlipFrom(c ? [c.box.left, c.box.top, c.box.width, c.box.height].map((v) => v.toFixed(1)).join(',') : undefined);
      setTint(c?.color ?? NEUTRAL);
      setCardHidden(memoId, true);
      if (c && !live.current.reduced) {
        // 목표 사각형은 카드가 제자리에 그려진 뒤 잰다(아래 효과)
        setGhost({ from: c.box, to: null, fade: false });
        setPhase('grow');
      } else {
        setGhost(null);
        setPhase('open');
      }
    } else if (cur && (ph === 'open' || ph === 'grow')) {
      void startClose();
    }
    // memoId가 바뀔 때만(나머지는 live 참조)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoId]);

  const cardOn = !!memo && (phase === 'grow' || phase === 'open' || phase === 'closing');

  // 카드 자리(F1·E7): 보기 상태는 화면 정중앙, 펼치면 보이는 화면 위에 붙는다. 보이는 화면이 바뀌거나 밀리면(iOS pan) 바로 맞춘다. transition 없음
  useLayoutEffect(() => {
    const s = stackRef.current;
    const c = cardRef.current;
    if (!cardOn || !s || !c) return;
    let raf = 0;
    const run = () => {
      raf = 0;
      const ins = insets();
      const vv = window.visualViewport;
      const vh = vv?.height ?? window.innerHeight;
      const off = vv?.offsetTop ?? 0;
      if (expanded) {
        const top = off + ins.top + PAD;
        s.style.top = `${top}px`;
        s.style.transform = '';
        c.style.maxHeight = `${Math.max(160, vh - ins.top - PAD * 2 - (keyboardOpen() ? 0 : ins.bottom))}px`;
      } else {
        s.style.top = `${off + vh / 2}px`;
        s.style.transform = 'translateY(-50%)';
        c.style.maxHeight = `${Math.round(window.innerHeight * MAX_H)}px`;
      }
    };
    const req = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    run();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', req);
    vv?.addEventListener('scroll', req);
    window.addEventListener('resize', req);
    return () => {
      cancelAnimationFrame(raf);
      vv?.removeEventListener('resize', req);
      vv?.removeEventListener('scroll', req);
      window.removeEventListener('resize', req);
    };
  }, [cardOn, expanded]);

  // 커지기 목표: 제자리에 (보이지 않게) 그려진 포커스 카드의 사각형
  useLayoutEffect(() => {
    if (phase !== 'grow' || !ghost || ghost.to) return;
    const to = rectBox(cardRef.current);
    setGhost(to ? { ...ghost, to } : null);
    if (!to) setPhase('open');
  }, [phase, ghost]);

  // 점이 피할 사각형: 카드가 가장 클 때(최대 높이, 모양 이유 줄은 카드 안). 메모마다 카드 높이가 달라도 모양·점은 제자리(F3)
  useEffect(() => {
    if (!shown) return;
    const measure = () => {
      const ins = insets();
      const w = window.innerWidth;
      const h = window.innerHeight;
      const half = Math.round(h * MAX_H) / 2;
      const m = FOCUS.dot / 2 + 6; // 점 반지름 + 틈
      const avoid = { l: SIDE - m, r: w - SIDE + m, t: h / 2 - half - m, b: h / 2 + half + m };
      setGeom((g) => (g && g.w === w && g.h === h && g.top === ins.top && g.bottom === ins.bottom ? g : { w, h, top: ins.top, bottom: ins.bottom, avoid }));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [shown]);

  // 점·먼지(F2·F9·F10): 화면 가장자리에서 12px 안쪽 상자(아래 위치 막대 자리 빼고).
  // 쉴 때 = 그 상자에 맞춰 카드를 피해 시간순, 드러낼 때 = 비율 그대로 가장 큰 정사각형에 윤곽 전체. 최근 24개까지, 간격이 안 나오면 최근 것부터
  const { dots, dust, dustFull } = useMemo(() => {
    if (!geom || order.length < 2) return { dots: [] as Dot[], dust: '', dustFull: '' };
    const edge = 12 + FOCUS.dot / 2;
    const box: ShapeBox = { x: edge, y: geom.top + edge, w: geom.w - edge * 2, h: geom.h - geom.top - geom.bottom - edge * 2 - 28 };
    const square = fitSquare(box);
    const ids = order.slice(-FOCUS.maxDots);
    const restPos = spacedPositions(topic?.shape, ids.length, box, geom.avoid);
    const fullPos = spacedPositions(topic?.shape, ids.length, square);
    const rest = new Map(ids.slice(ids.length - restPos.length).map((id, i) => [id, restPos[i]!]));
    const full = new Map(ids.slice(ids.length - fullPos.length).map((id, i) => [id, fullPos[i]!]));
    const dots: Dot[] = [];
    for (const id of ids) {
      const a = rest.get(id);
      const b = full.get(id);
      if (!a && !b) continue;
      const [x, y] = a ?? b!;
      const [fx, fy] = b ?? a!;
      dots.push({ id, x, y, fx, fy, rest: !!a, full: !!b, color: linkColor.get(id) });
    }
    const path = (pts: [number, number][]) => pts.map(([x, y]) => `M${(x - 1.2).toFixed(1)} ${y.toFixed(1)}a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0`).join('');
    const shape = getShape(topic?.shape);
    const many = order.length >= SHAPE_MIN_MEMOS;
    return { dots, dust: many ? path(sampleShape(shape, FOCUS.dust, box, geom.avoid)) : '', dustFull: many ? path(sampleShape(shape, FOCUS.dust, square)) : '' };
  }, [geom, order, topic?.shape, linkColor]);

  const showSky = phase === 'open' && !expanded && !!geom;

  // 펼친 주제의 지구본 카드는 포커스 동안 숨긴다(카드 둘레로 비쳐 보이지 않게, F10). 닫기 시작하면 다시 보인다
  const hideTopic = shown && !closingNow ? memo?.topicId : undefined;
  useEffect(() => {
    if (!hideTopic) return;
    const el = document.querySelector<HTMLElement>(`.g-cluster[data-topic-id="${CSS.escape(hideTopic)}"]`);
    el?.setAttribute('data-mf-hide', '1');
    return () => el?.removeAttribute('data-mf-hide');
  }, [hideTopic]);

  /** 드러내고 → 그 메모로 바꾸고 → 빛이 옮겨 가는 동안 머문 뒤 → 큰 카드로 돌아온다(F10, D34 감속) */
  const travel = useCallback(
    async (id: string, delta: number) => {
      const my = ++seq.current;
      aimRef.current = null;
      setAim(null);
      if (live.current.reduced) {
        reveal.set(0);
        setDir(delta);
        onSelect(id);
        return;
      }
      if (reveal.get() < 0.99) await animate(reveal, 1, REVEAL_IN);
      if (my !== seq.current) return;
      setDir(delta);
      onSelect(id);
      await sleep(REVEAL.holdMs);
      if (my !== seq.current) return;
      await animate(reveal, 0, GLIDE);
    },
    [onSelect, reveal],
  );

  /** 드러낸 채 멈췄으면(취소·탭) 큰 카드로 되돌린다 */
  const settle = () => {
    aimRef.current = null;
    setAim(null);
    if (reveal.get() > 0) void animate(reveal, 0, spring.snappy);
  };

  const go = useCallback(
    (delta: number) => {
      const { order: o, shown: id } = live.current;
      const next = id ? o[o.indexOf(id) + delta] : undefined;
      if (!next) return false;
      void travel(next, delta);
      return true;
    },
    [travel],
  );

  const pickDot = (id: string) => {
    const { order: o, shown: cur } = live.current;
    if (!cur || id === cur) return settle();
    void travel(id, o.indexOf(id) > o.indexOf(cur) ? 1 : -1);
  };

  // 열려 있는 동안 문서 자체는 스크롤되지 않는다
  useEffect(() => {
    if (!shown) return;
    document.documentElement.classList.add('mp-open');
    return () => document.documentElement.classList.remove('mp-open');
  }, [shown]);

  // 다 열리면 카드로 포커스(닫기 버튼 없음, Escape·빈 곳 탭으로 닫는다)
  useEffect(() => {
    if (phase === 'open' && cardOn) cardRef.current?.focus({ preventScroll: true });
  }, [phase, cardOn]);

  // 화살표 키로 앞뒤
  useEffect(() => {
    if (phase !== 'open') return;
    const onKey = (e: KeyboardEvent) => {
      if (live.current.editing || live.current.drawer || (e.target as Element | null)?.closest?.('input, textarea')) return;
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, go]);

  // 손가락(F3·F4): 가로가 세로보다 크면 밀기(카드 안 세로 스크롤과 방향 잠금), 8px 안이면 탭 → 가까운 점, 빈 곳이면 닫기
  const onPointerDown = (e: RPointerEvent<HTMLElement>) => {
    swallowClick.current = false;
    if (live.current.phase !== 'open' || !e.isPrimary) return;
    // 드러내는 중에 다시 만지면 그 자리에서 멈추고 손가락을 따른다
    seq.current++;
    reveal.stop();
    gesture.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lock: null, inCard: !!(e.target as Element).closest('.mf-card'), r0: reveal.get() };
  };
  const onPointerMove = (e: RPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.lock && Math.hypot(dx, dy) > FOCUS.tapSlop) g.lock = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    if (g.lock !== 'h' || expanded) return;
    dragX.set(dx * 0.5);
    // 끄는 만큼 모양이 드러나고(60px에 다), 넘길 만큼 밀면 갈 점이 빛난다(F10)
    if (!showSky || dots.length < 2) return;
    reveal.set(Math.max(g.r0, Math.min(1, Math.abs(dx) / REVEAL.dragPx)));
    const { order: o, shown: cur } = live.current;
    const t = cur && Math.abs(dx) >= FOCUS.swipe ? (o[o.indexOf(cur) + (dx < 0 ? 1 : -1)] ?? null) : null;
    if (t !== aimRef.current) {
      aimRef.current = t;
      setAim(t);
    }
  };
  const onPointerUp = (e: RPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    const dx = e.clientX - g.x0;
    if (g.lock) swallowClick.current = true;
    if (g.lock === 'h') {
      void animate(dragX, 0, GLIDE);
      if (!(!expanded && Math.abs(dx) >= FOCUS.swipe && go(dx < 0 ? 1 : -1))) settle();
      return;
    }
    if (g.lock || g.inCard) return settle();
    if (!expanded) {
      // 지금 보이는 자리(드러난 정도에 따라)의 점
      const r = reveal.get();
      const id = nearestDot(
        dots.map((d) => ({ id: d.id, ...dotAt(d, r) })).filter((d) => d.o > 0.5),
        e.clientX,
        e.clientY,
      );
      if (id) return pickDot(id);
    }
    onClose();
  };
  const onPointerCancel = () => {
    gesture.current = null;
    void animate(dragX, 0, GLIDE);
    settle();
  };

  const box = (b: Box) => ({ left: b.left, top: b.top, width: b.width, height: b.height, borderRadius: b.r });
  const idx = memo ? order.indexOf(memo.id) : -1;
  const halo = dots.find((d) => d.id === memo?.id && d.full);

  return (
    <>
      {shown && (
        <motion.div
          className="mp-backdrop mf-backdrop"
          data-no-pan
          initial={{ opacity: 0 }}
          animate={{ opacity: closingNow ? 0 : 1 }}
          transition={{ duration: 0.25 }}
        />
      )}
      {ghost?.to && (phase === 'grow' || phase === 'shrink') && (
        <motion.div
          key={phase}
          className="mp-ghost mf-card-skin"
          aria-hidden
          style={{ ['--c' as string]: color }}
          initial={{ ...box(ghost.from), opacity: 1 }}
          animate={ghost.fade ? { opacity: 0 } : { ...box(ghost.to), opacity: 1 }}
          transition={ghost.fade ? { duration: 0.2 } : spring.glide}
          onAnimationComplete={() => {
            if (live.current.phase === 'grow') setPhase('open');
            else if (live.current.phase === 'shrink') finish();
          }}
        />
      )}
      {shown && phase !== 'shrink' && (
        <div
          ref={rootRef}
          className="mf"
          data-testid="memo-focus"
          data-phase={phase ?? undefined}
          data-no-pan
          data-expanded={expanded ? '1' : undefined}
          style={{ ['--c' as string]: color }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClickCapture={(e) => {
            if (!swallowClick.current) return;
            swallowClick.current = false;
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          {showSky && dust && (
            <motion.svg className="mf-dust" data-testid="focus-dust" data-shape={topic?.shape ?? 'circle'} width={geom.w} height={geom.h} style={{ opacity: restDustOpacity }} aria-hidden>
              <path d={dust} />
            </motion.svg>
          )}
          {showSky && dustFull && (
            <motion.svg className="mf-dust full" data-testid="focus-dust-full" width={geom.w} height={geom.h} style={{ opacity: fullDustOpacity }} aria-hidden>
              <path d={dustFull} />
            </motion.svg>
          )}
          {showSky && halo && (
            <motion.span
              className="mf-halo"
              data-testid="focus-halo"
              aria-hidden
              style={{ opacity: reveal }}
              initial={false}
              animate={{ left: halo.fx, top: halo.fy }}
              transition={reduced ? { duration: 0 } : GLIDE}
            />
          )}
          {showSky &&
            dots.map((d) => (
              <SkyDot key={`${d.id}:${d.x.toFixed(1)},${d.y.toFixed(1)},${d.fx.toFixed(1)},${d.fy.toFixed(1)},${d.rest ? 1 : 0}${d.full ? 1 : 0}`} d={d} reveal={reveal} on={d.id === memo?.id} aim={d.id === aim} />
            ))}
          {cardOn && memo && (
            <div ref={stackRef} className="mf-stack">
              <motion.div className="mf-shrink" style={{ scale: cardScale, opacity: cardOpacity }}>
                <motion.section
                  ref={cardRef}
                  className="mf-card mf-card-skin"
                  data-testid="memo-sheet"
                  data-focus-memo={memo.id}
                  data-flip-from={flipFrom}
                  data-editing={editing ? '1' : undefined}
                  role="dialog"
                  aria-modal="true"
                  aria-label="메모"
                  tabIndex={-1}
                  style={{ x: dragX }}
                  initial={false}
                  animate={{ opacity: phase === 'open' ? 1 : 0 }}
                  transition={{ duration: phase === 'closing' ? 0.13 : 0.2 }}
                >
                  <motion.div
                    key={memo.id}
                    className="mf-inner"
                    initial={dir && !reduced ? { x: dir * 56, opacity: 0.2 } : false}
                    animate={{ x: 0, opacity: 1 }}
                    transition={GLIDE}
                  >
                    <CardBody
                      memo={memo}
                      topics={topics}
                      order={order}
                      onClose={onClose}
                      onSelect={onSelect}
                      notify={notify}
                      editing={editing}
                      draft={draft}
                      onDraft={setDraft}
                      startEdit={startEdit}
                      commitEdit={() => void commitEdit()}
                      editRef={editRef}
                      drawer={drawer}
                      setDrawer={setDrawer}
                    />
                    {/* 모양 이유(F8·F10): 카드 안 맨 아래 작은 회색 글씨, 다른 것과 겹치지 않는다 */}
                    {topic?.shapeReason && !expanded && order.length >= SHAPE_MIN_MEMOS && (
                      <p className="mf-reason" data-testid="focus-reason">
                        {topic.shapeReason}
                      </p>
                    )}
                  </motion.div>
                </motion.section>
              </motion.div>
            </div>
          )}
          {showSky && order.length > 1 && idx >= 0 && (
            <div className="mf-bar" data-testid="focus-bar" data-index={idx} data-count={order.length} aria-hidden>
              <i style={{ width: `${100 / order.length}%`, left: `${(100 * idx) / order.length}%` }} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
