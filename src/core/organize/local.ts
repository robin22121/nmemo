import type { MemoKind } from '../types';
import {
  MAX_RELATED,
  MAX_SUMMARY,
  type AnalyzeRequest,
  type AnalyzeResult,
  type Analyzer,
  type ReorganizeRequest,
  type ReorganizeResult,
} from './types';
import { NEUTRAL_COLOR } from './validate';

/** 키 없이 동작하는 간이 분석기. 한국어 규칙 + 키워드 유사도. */

const PARTICLES = [
  '에서는', '에서도', '으로는', '이라고', '에서', '에게', '한테', '으로', '까지', '부터', '처럼', '보다', '이랑',
  '하고', '입니다', '이다', '에는', '에도', '라고', '은', '는', '이', '가', '을', '를', '의', '에', '로', '와',
  '과', '도', '만', '랑', '다',
].sort((a, b) => b.length - a.length);

const VERB_ENDINGS = [
  '했는데', '하기', '했다', '한다', '하는', '해야', '했어', '하자', '싶다', '싶어', '있다', '없다', '같다', '해서', '하면',
].sort((a, b) => b.length - a.length);

const STOPWORDS = new Set([
  '오늘', '어제', '내일', '그냥', '너무', '진짜', '정말', '아주', '매우', '좀', '이런', '저런', '그런', '이거', '저거',
  '그거', '우리', '그리고', '그래서', '하지만', '근데', '있는', '없는', '같은', '많이', '다시', '계속', '조금', '약간',
  '이번', '다음', '지금', '아직', '항상', '가끔', '생각', '느낌', '해야', '하기', '그래', '이제', '아니', '하나',
]);

export function stem(word: string): string {
  for (const suf of [...VERB_ENDINGS, ...PARTICLES]) {
    if (word.length - suf.length >= 2 && word.endsWith(suf)) return word.slice(0, -suf.length);
  }
  return word;
}

/** 텍스트 → 중복 없는 토큰(등장 순) */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    const t = stem(raw);
    if (t.length < 2 || STOPWORDS.has(t) || STOPWORDS.has(raw) || /^\d+$/.test(t)) continue;
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** 빈도 → 길이 → 등장 순으로 상위 n개 */
export function extractKeywords(text: string, n = 5): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    const t = stem(raw);
    if (t.length < 2 || STOPWORDS.has(t) || STOPWORDS.has(raw) || /^\d+$/.test(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const order = [...counts.keys()];
  return order
    .sort((a, b) => counts.get(b)! - counts.get(a)! || b.length - a.length || order.indexOf(a) - order.indexOf(b))
    .slice(0, n);
}

function same(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 2 && l.startsWith(s);
}

/** Dice 계수(접두 일치 허용) */
export function similarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let m = 0;
  for (const x of a) if (b.some((y) => same(x, y))) m++;
  return (2 * m) / (a.length + b.length);
}

function shared(a: string[], b: string[]): string[] {
  return a.filter((x) => b.some((y) => same(x, y)));
}

const EMOTIONS: { label: string; color: string; re: RegExp }[] = [
  { label: '기쁨', color: '#f6c453', re: /좋았|좋아|행복|기뻐|기쁘|신나|웃|즐거|최고|뿌듯/ },
  { label: '설렘', color: '#f4a6c0', re: /설레|두근|기대/ },
  { label: '평온', color: '#9ccfd8', re: /편안|평온|여유|차분|따뜻|포근|힐링/ },
  { label: '걱정', color: '#a9b4e8', re: /걱정|불안|초조|막막|무서|두려/ },
  { label: '슬픔', color: '#8fa7d6', re: /슬프|슬퍼|우울|외로|눈물|그립|그리워|허전/ },
  { label: '화남', color: '#e88e8e', re: /화나|화가|짜증|열받|답답|억울/ },
  { label: '피곤', color: '#b9b0a0', re: /피곤|지치|지쳤|졸려|힘들|피로/ },
  { label: '감사', color: '#f0b88a', re: /고마|감사|덕분/ },
  { label: '호기심', color: '#b58de8', re: /궁금|신기|재밌|재미있|흥미/ },
];

const TODO_RE = /해야|해야지|하기$|사기$|사야|예약|챙기|보내기|연락하기|☐|\[ ?\]|todo|잊지 말|까먹지/im;
const OBS_RE = /봤|보였|발견|알게 됐|알게됐|더라|이네|있었|들렸|맡았/;

export function detectEmotion(text: string): { label: string; color: string } | null {
  for (const e of EMOTIONS) if (e.re.test(text)) return { label: e.label, color: e.color };
  return null;
}

export function detectKind(text: string, input: AnalyzeRequest['memo']['input']): MemoKind {
  if (input === 'photo') return 'observation';
  const t = text.trim();
  if (TODO_RE.test(t)) return 'todo';
  if (detectEmotion(t)) return 'emotion';
  if (OBS_RE.test(t)) return 'observation';
  return 'idea';
}

export function summarize(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '사진 메모';
  const first = flat.split(/(?<=[.!?。])\s|\n/)[0] ?? flat;
  const chars = Array.from(first);
  return chars.length <= MAX_SUMMARY ? first : chars.slice(0, MAX_SUMMARY - 1).join('') + '…';
}

/** 멤버들의 키워드 문서 빈도 상위(2개 이상 메모에 등장). 없으면 전체 빈도 상위 3개. */
export function computeCenter(memberKeywords: string[][], seed: string[] = []): string[] {
  const df = new Map<string, number>();
  for (const kws of memberKeywords) for (const k of new Set(kws)) df.set(k, (df.get(k) ?? 0) + 1);
  const rank = (a: string, b: string) => df.get(b)! - df.get(a)! || b.length - a.length;
  const frequent = [...df.keys()].filter((k) => df.get(k)! >= 2).sort(rank);
  const base = frequent.length ? frequent : [...df.keys()].sort(rank).slice(0, 3);
  return [...new Set([...seed, ...base])].slice(0, 5);
}

const TOPIC_JOIN = 0.2;
const RELATED_MIN = 0.15;

export class LocalAnalyzer implements Analyzer {
  analyze(req: AnalyzeRequest): Promise<AnalyzeResult> {
    return Promise.resolve(this.run(req));
  }

  reorganize(req: ReorganizeRequest): Promise<ReorganizeResult> {
    return Promise.resolve(this.runReorganize(req));
  }

  private runReorganize(req: ReorganizeRequest): ReorganizeResult {
    const { topic, members, otherTopics } = req;
    const nameTokens = tokenize(topic.name);
    const center = computeCenter(members.map((m) => m.keywords), topic.nameLocked ? nameTokens : []);

    // 이름: 잠겨 있으면 유지. 아니면 중심이 이름에서 멀어졌을 때만 바꾼다.
    let name = topic.name;
    let summary = topic.summary;
    if (!topic.nameLocked && center.length > 0 && similarity(nameTokens, center) < 0.3) {
      name = center.slice(0, 2).join(' ').slice(0, 24);
      summary = `${center.slice(0, 3).join(', ')} 이야기`;
    }

    const moves: ReorganizeResult['moves'] = [];
    for (const m of members) {
      if (m.locked || m.keywords.length === 0) continue;
      const cur = similarity(m.keywords, center);
      let best: { id: string; sim: number } | null = null;
      for (const o of otherTopics) {
        const sim = similarity(m.keywords, o.centerKeywords.length ? o.centerKeywords : tokenize(`${o.name} ${o.summary}`));
        if (!best || sim > best.sim) best = { id: o.id, sim };
      }
      if (best && best.sim - cur >= 0.15) {
        moves.push({
          memoId: m.id,
          to: { existingId: best.id },
          fit: Math.min(1, best.sim),
          reason: '새 중심보다 다른 무리와 더 이어져요',
        });
      }
    }
    return { topic: { name, summary, centerKeywords: center }, moves };
  }

  private run(req: AnalyzeRequest): AnalyzeResult {
    const { memo, topics, recent } = req;
    const isBlankPhoto = memo.input === 'photo' && !memo.text.trim();
    const source = isBlankPhoto ? '사진' : memo.text;
    const keywords = extractKeywords(source, 5);
    const kw = keywords.length ? keywords : tokenize(source);
    const kind = detectKind(memo.text, memo.input);
    const emotion = detectEmotion(memo.text) ?? { label: '담담', color: NEUTRAL_COLOR };

    const recentTokens = recent.map((r) => ({ r, tokens: tokenize(r.summary) }));

    // 주제 배정: 주제 이름·설명과의 유사도(가중) vs 그 주제 최근 메모들과의 유사도
    let best: { id: string; score: number } | null = null;
    for (const t of topics) {
      const nameSim = Math.min(1, similarity(kw, tokenize(`${t.name} ${t.summary}`)) * 1.2);
      const sims = recentTokens
        .filter((x) => x.r.topicId === t.id)
        .map((x) => similarity(kw, x.tokens))
        .sort((a, b) => b - a)
        .slice(0, 2);
      const memoSim = sims.length ? sims.reduce((s, v) => s + v, 0) / sims.length : 0;
      const score = Math.max(nameSim, memoSim);
      if (!best || score > best.score) best = { id: t.id, score };
    }
    const summary = summarize(memo.text);
    const topic: AnalyzeResult['topic'] =
      best && best.score >= TOPIC_JOIN
        ? { existingId: best.id }
        : { newName: (kw.slice(0, 2).join(' ') || '메모').slice(0, 24), newSummary: summary };

    const related = recentTokens
      .map(({ r, tokens }) => ({ r, tokens, sim: similarity(kw, tokens) }))
      .filter((x) => x.sim >= RELATED_MIN)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, MAX_RELATED)
      .map(({ r, tokens, sim }) => {
        const words = shared(kw, tokens).slice(0, 2);
        return {
          id: r.id,
          strength: Math.min(1, Math.max(0.2, sim * 1.5)),
          reason: words.length ? `“${words.join('”, “')}” 이야기가 이어져요` : '내용이 닮았어요',
        };
      });

    return {
      kind,
      emotion,
      keywords: kw.slice(0, 5),
      summary,
      text: isBlankPhoto ? '사진 한 장' : undefined,
      topic,
      related,
    };
  }
}
