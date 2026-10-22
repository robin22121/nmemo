import { similarity } from '../core/organize/local';
import { TOPIC_PALETTE } from '../core/palette';
import type { InputType, Link, Memo, MemoKind, Topic } from '../core/types';
import { linkId } from '../core/types';
import type { KkeujeogimDB } from './schema';

/** 개발용 샘플: 메모 40개, 주제 6개, 종류 네 가지가 고르게 섞인 데모 데이터 */

type Emo = [label: string, color: string];
const E: Record<string, Emo> = {
  평온: ['평온', '#9ccfd8'], 기쁨: ['기쁨', '#f6c453'], 설렘: ['설렘', '#f4a6c0'], 걱정: ['걱정', '#a9b4e8'],
  슬픔: ['슬픔', '#8fa7d6'], 감사: ['감사', '#f0b88a'], 피곤: ['피곤', '#b9b0a0'], 담담: ['담담', '#c9c2b0'],
};

interface Seed { t: string; k: MemoKind; s: string; kw: string[]; e?: keyof typeof E; photo?: [number, number] }

const TOPICS: Record<string, { name: string; summary: string; center: string[] }> = {
  cafe: { name: '동네 카페', summary: '작업하기 좋은 동네 카페 탐방', center: ['카페', '원두'] },
  run: { name: '달리기', summary: '마라톤 훈련과 달리기 기록', center: ['달리기', '마라톤'] },
  app: { name: '앱 아이디어', summary: '만들고 싶은 노트 앱 구상', center: ['노트', '앱'] },
  move: { name: '이사 준비', summary: '이사 전에 챙길 것들', center: ['이사', '정리'] },
  trip: { name: '제주 여행', summary: '제주 여행 계획과 설렘', center: ['제주', '여행'] },
  mind: { name: '요즘 마음', summary: '요즘의 기분과 감정 기록', center: ['기분', '마음'] },
};

const SEEDS: Seed[] = [
  { t: 'cafe', k: 'idea', s: '카페 지도에 콘센트·와이파이 표시하는 개인 지도 만들기', kw: ['카페', '지도', '콘센트'] },
  { t: 'cafe', k: 'observation', s: '골목 끝 카페 창가 자리는 오후 세 시에 햇빛이 딱 좋다', kw: ['카페', '창가', '햇빛'] },
  { t: 'cafe', k: 'observation', s: '라떼 아트가 예쁜 카페 발견', kw: ['카페', '라떼'], photo: [28, 24] },
  { t: 'cafe', k: 'todo', s: '토요일에 새로 생긴 로스터리 카페 가보기', kw: ['카페', '로스터리'] },
  { t: 'cafe', k: 'emotion', s: '카페에서 책 읽는 시간이 제일 편안하다', kw: ['카페', '책', '편안'], e: '평온' },
  { t: 'cafe', k: 'idea', s: '카페 쿠폰 도장을 앱 하나로 모아보면 좋겠다', kw: ['카페', '쿠폰', '앱'] },
  { t: 'cafe', k: 'observation', s: '원두 향이 진한 곳은 대체로 의자가 불편하다', kw: ['원두', '카페', '의자'] },

  { t: 'run', k: 'idea', s: '마라톤 훈련 기록을 지도 위에 그려서 보기', kw: ['마라톤', '기록', '지도'] },
  { t: 'run', k: 'todo', s: '러닝화 새로 사기, 쿠션 좋은 걸로', kw: ['러닝화', '쿠션'] },
  { t: 'run', k: 'emotion', s: '달리고 나면 머리가 맑아져서 기분이 좋다', kw: ['달리기', '기분', '맑아'], e: '기쁨' },
  { t: 'run', k: 'observation', s: '한강 둔치는 새벽 여섯 시가 제일 한적했다', kw: ['한강', '새벽', '달리기'] },
  { t: 'run', k: 'observation', s: '한강 노을을 보며 달린 저녁', kw: ['한강', '노을', '달리기'], photo: [18, 330] },
  { t: 'run', k: 'idea', s: '10킬로 완주하면 스스로에게 선물 주기', kw: ['완주', '선물', '마라톤'] },
  { t: 'run', k: 'todo', s: '이번 주말 장거리 달리기 코스 정하기', kw: ['달리기', '코스'] },

  { t: 'app', k: 'idea', s: '메모를 던지면 주제별로 모여드는 노트 앱', kw: ['메모', '노트', '앱'] },
  { t: 'app', k: 'idea', s: '카드가 둥둥 떠다니면 보는 재미가 있을 듯', kw: ['카드', '애니메이션', '앱'] },
  { t: 'app', k: 'todo', s: '프로토타입 모바일 화면부터 만들어 보기', kw: ['프로토타입', '모바일', '앱'] },
  { t: 'app', k: 'observation', s: '다른 노트 앱은 폴더 만들다 지쳐서 안 쓰게 된다', kw: ['노트', '폴더', '앱'] },
  { t: 'app', k: 'emotion', s: '아이디어가 줄줄 이어질 때 설렌다', kw: ['아이디어', '설렘'], e: '설렘' },
  { t: 'app', k: 'idea', s: '녹음 버튼을 길게 누르면 바로 받아쓰기', kw: ['녹음', '받아쓰기', '노트'] },
  { t: 'app', k: 'observation', s: '화이트보드에 적어 본 앱 구조 스케치', kw: ['앱', '구조', '스케치'], photo: [210, 190] },

  { t: 'move', k: 'todo', s: '이사 업체 견적 세 군데 비교하기', kw: ['이사', '견적'] },
  { t: 'move', k: 'todo', s: '전입신고 잊지 말고 하기', kw: ['전입신고', '이사'] },
  { t: 'move', k: 'emotion', s: '짐 싸다 보니 막막하고 걱정된다', kw: ['짐', '이사', '막막'], e: '걱정' },
  { t: 'move', k: 'observation', s: '안 쓰는 물건이 생각보다 많이 나왔다', kw: ['물건', '정리', '이사'] },
  { t: 'move', k: 'observation', s: '박스가 쌓인 거실', kw: ['박스', '이사', '정리'], photo: [35, 60] },
  { t: 'move', k: 'idea', s: '새 집 근처 카페부터 먼저 탐색해 두기', kw: ['새집', '카페', '동네'] },

  { t: 'trip', k: 'idea', s: '제주 동쪽 해안도로를 따라 천천히 드라이브', kw: ['제주', '해안도로', '드라이브'] },
  { t: 'trip', k: 'todo', s: '제주 렌터카 예약하기', kw: ['제주', '렌터카', '예약'] },
  { t: 'trip', k: 'emotion', s: '비행기 표 끊고 나니 벌써 설렌다', kw: ['비행기', '여행', '설렘'], e: '설렘' },
  { t: 'trip', k: 'observation', s: '겨울 제주는 바람이 세서 옷을 겹쳐 입어야 한대', kw: ['제주', '바람', '옷'] },
  { t: 'trip', k: 'observation', s: '오름 위에서 내려다본 제주 바다', kw: ['제주', '바다', '오름'], photo: [200, 170] },
  { t: 'trip', k: 'idea', s: '숙소는 바다 보이는 작은 독채가 좋겠다', kw: ['숙소', '바다', '독채'] },
  { t: 'trip', k: 'todo', s: '여행 가기 전에 제주 달리기 코스 찾아 두기', kw: ['제주', '달리기', '코스'] },

  { t: 'mind', k: 'emotion', s: '요즘 괜히 마음이 가라앉는 날이 있다', kw: ['마음', '기분'], e: '슬픔' },
  { t: 'mind', k: 'emotion', s: '친구가 해 준 말이 오래 고마웠다', kw: ['친구', '고마움'], e: '감사' },
  { t: 'mind', k: 'emotion', s: '일이 몰려서 지치고 피곤하다', kw: ['일', '피곤'], e: '피곤' },
  { t: 'mind', k: 'observation', s: '해가 길어지면 기분이 한결 나아지는 것 같다', kw: ['해', '기분'] },
  { t: 'mind', k: 'idea', s: '자기 전에 오늘 좋았던 것 세 가지 적어 보기', kw: ['좋았던', '기록', '마음'] },
  { t: 'mind', k: 'observation', s: '창밖으로 비 오는 저녁', kw: ['비', '창문', '기분'], photo: [215, 250] },
];

function photoBlob(hueA: number, hueB: number, n: number): Blob {
  const h = (n * 37) % 100;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hueA} 70% 72%)"/><stop offset="1" stop-color="hsl(${hueB} 65% 82%)"/></linearGradient></defs><rect width="320" height="240" fill="url(#g)"/><circle cx="${90 + h * 1.4}" cy="${70 + (h % 30)}" r="34" fill="hsl(${hueA} 90% 88%)" opacity=".9"/><path d="M0 190 Q80 ${140 + (h % 20)} 160 180 T320 170 V240 H0Z" fill="hsl(${hueB} 35% 45%)" opacity=".75"/><path d="M0 215 Q100 185 200 210 T320 200 V240 H0Z" fill="hsl(${hueB} 40% 32%)" opacity=".8"/></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

export function buildDemo(now = Date.now()): { topics: Topic[]; memos: Memo[]; links: Link[] } {
  const keys = Object.keys(TOPICS);
  const topics: Topic[] = keys.map((key, i) => ({
    id: `demo-topic-${key}`,
    name: TOPICS[key]!.name,
    summary: TOPICS[key]!.summary,
    color: TOPIC_PALETTE[i % TOPIC_PALETTE.length]!,
    createdAt: now - (keys.length - i) * 86_400_000 * 3,
    centerKeywords: TOPICS[key]!.center,
    nameLocked: false,
    lastReorgAt: now,
    sinceReorg: 0,
  }));
  const memos: Memo[] = SEEDS.map((s, i) => {
    const input: InputType = s.photo ? 'photo' : 'text';
    const emo = E[s.e ?? '담담']!;
    const m: Memo = {
      id: `demo-memo-${String(i).padStart(2, '0')}`,
      createdAt: now - (SEEDS.length - i) * 5_400_000 * 7,
      input,
      text: s.s,
      kind: s.k,
      emotion: { label: emo[0], color: emo[1] },
      keywords: s.kw,
      summary: s.s,
      topicId: `demo-topic-${s.t}`,
      topicLocked: false,
      status: 'organized',
      attempts: 0,
      done: s.k === 'todo' && i % 4 === 1 ? true : undefined,
    };
    if (s.photo) m.photo = photoBlob(s.photo[0], s.photo[1], i);
    return m;
  });

  // 관련 메모: 키워드 유사도 상위 2개(같은 주제 우선 아님) + 같은 주제 안 이웃 보장
  const links = new Map<string, Link>();
  const put = (a: Memo, b: Memo, strength: number, reason: string) => {
    const id = linkId(a.id, b.id);
    if (a.id !== b.id && !links.has(id)) links.set(id, { id, fromId: a.id, toId: b.id, strength, reason });
  };
  for (const a of memos) {
    const scored = memos
      .filter((b) => b.id !== a.id)
      .map((b) => ({ b, sim: similarity(a.keywords ?? [], b.keywords ?? []) }))
      .filter((x) => x.sim >= 0.3)
      .sort((x, y) => y.sim - x.sim)
      .slice(0, 2);
    for (const { b, sim } of scored) {
      const shared = (a.keywords ?? []).filter((k) => (b.keywords ?? []).includes(k));
      put(a, b, Math.min(1, 0.35 + sim), shared.length ? `“${shared[0]}” 이야기가 이어져요` : '내용이 닮았어요');
    }
  }
  for (const t of topics) {
    const mine = memos.filter((m) => m.topicId === t.id);
    mine.forEach((m, i) => {
      const n = mine[(i + 1) % mine.length]!;
      put(m, n, 0.35, '같은 흐름의 생각이에요');
    });
  }
  return { topics, memos, links: [...links.values()] };
}

export async function seedDemoIfEmpty(db: KkeujeogimDB): Promise<boolean> {
  if ((await db.memos.count()) > 0) return false;
  const { topics, memos, links } = buildDemo();
  await db.transaction('rw', db.topics, db.memos, db.links, async () => {
    await db.topics.bulkAdd(topics);
    await db.memos.bulkAdd(memos);
    await db.links.bulkAdd(links);
  });
  return true;
}

/** 성능 측정용 큰 데모(`?demo=big`): 주제 15개·메모 200개. 가장 큰 주제는 30장을 넘는다. 문장은 기본 데모를 돌려 쓴다 */
const BIG_TOPICS = ['동네 카페', '달리기', '앱 아이디어', '이사 준비', '제주 여행', '요즘 마음', '책 읽기', '요리', '회사 일', '영어 공부', '사진', '음악', '가족', '돈 관리', '건강'];
const BIG_LINES: [string, MemoKind][] = [
  ['하면서 떠오른 생각 적어 두기', 'idea'], ['다음 주에 다시 챙기기', 'todo'], ['할 때 기분이 좋았다', 'emotion'],
  ['관련해서 오늘 본 것', 'observation'], ['새로 해 보고 싶은 방법', 'idea'], ['기록 정리하기', 'todo'],
];
const BIG_SIZES = [34, 22, 18, 16, 14, 13, 12, 11, 10, 10, 9, 9, 8, 7, 7];

export function buildBigDemo(now = Date.now()): { topics: Topic[]; memos: Memo[]; links: Link[] } {
  const topics: Topic[] = BIG_TOPICS.map((name, i) => ({
    id: `big-topic-${String(i).padStart(2, '0')}`,
    name,
    summary: `${name} 이야기`,
    color: TOPIC_PALETTE[i % TOPIC_PALETTE.length]!,
    createdAt: now - (BIG_TOPICS.length - i) * 86_400_000,
    centerKeywords: [name],
    nameLocked: false,
    lastReorgAt: now,
    sinceReorg: 0,
  }));
  const memos: Memo[] = [];
  const links: Link[] = [];
  const link = (a: string, b: string, strength: number) => links.push({ id: linkId(a, b), fromId: a, toId: b, strength, reason: '내용이 닮았어요' });
  BIG_SIZES.forEach((size, t) => {
    const ids: string[] = [];
    for (let k = 0; k < size; k++) {
      const n = memos.length;
      // 앞 6개 주제는 기본 데모의 같은 주제 문장을 먼저 쓰고, 그 뒤·나머지 주제는 주제 이름으로 만든 문장(주제와 내용이 맞게)
      const own = SEEDS.filter((x) => TOPICS[x.t]!.name === BIG_TOPICS[t]);
      const tpl = BIG_LINES[k % BIG_LINES.length]!;
      const s: Seed = k < own.length ? own[k]! : { t: '', k: tpl[1], s: `${BIG_TOPICS[t]} ${tpl[0]}${k >= BIG_LINES.length + own.length ? ` (${k + 1})` : ''}`, kw: [BIG_TOPICS[t]!] };
      const emo = E[s.e ?? '담담']!;
      const id = `big-memo-${String(n).padStart(3, '0')}`;
      ids.push(id);
      memos.push({
        id, createdAt: now - (200 - n) * 3_600_000, input: 'text', text: s.s, kind: s.k,
        emotion: { label: emo[0], color: emo[1] }, keywords: s.kw, summary: s.s,
        topicId: topics[t]!.id, topicLocked: false, status: 'organized', attempts: 0,
      });
    }
    ids.forEach((id, k) => { if (size > 1 && k < size - 1) link(id, ids[k + 1]!, 0.4); });
    // 앞 주제와 이어지는 링크 → 원 위 순서가 생긴다
    if (t > 0) link(memos.find((m) => m.topicId === topics[t - 1]!.id)!.id, ids[0]!, 0.7);
  });
  return { topics, memos, links };
}

export async function seedBigDemoIfEmpty(db: KkeujeogimDB): Promise<boolean> {
  if ((await db.memos.count()) > 0) return false;
  const { topics, memos, links } = buildBigDemo();
  await db.transaction('rw', db.topics, db.memos, db.links, async () => {
    await db.topics.bulkAdd(topics);
    await db.memos.bulkAdd(memos);
    await db.links.bulkAdd(links);
  });
  return true;
}
