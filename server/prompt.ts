import type Anthropic from '@anthropic-ai/sdk';
import { MAX_MEMBERS, MAX_RECENT, MAX_TOPICS, type AnalyzeRequest, type ReorganizeRequest } from '../src/core/organize/types.ts';

export const SYSTEM_PROMPT = `너는 짧은 메모를 정돈하는 도우미다.
- 메모의 특성(종류·감정·키워드·한 줄 요약)을 파악한다.
- 주제는 기존 주제 중 가장 맞는 것을 고른다. 가능하면 기존 주제를 재사용하고, 정말 새로운 경우에만 짧은 새 주제(2~8자 정도)를 만든다. 주제가 과도하게 쪼개지지 않게 한다.
- 새 주제를 만들 때는 newColor도 정한다. 주제 뜻에 어울리는 색(#rrggbb)으로, 부드러운 중간 채도로 고른다. topics의 기존 주제 이름과 color를 보고, 비슷한 주제는 비슷한 색 계열로, 다른 주제는 기존 주제들과 확실히 다른 색 계열로 한다.
- 주제는 상하 관계 없이 평평하다. 폴더나 트리 구조로 생각하지 않는다.
- 관련 메모는 실제로 내용·감정·맥락이 이어지는 것만, 최대 5개. 억지로 채우지 않는다. 관련 있는 것이 없으면 빈 목록이다.
- 사진 메모는 사진 속 장면·글자·분위기를 한두 문장으로 text에 적는다.
- 모든 출력은 한국어로 쓴다. 반드시 record_analysis 도구로만 답한다.`;

export const REORGANIZE_SYSTEM_PROMPT = `너는 메모 주제를 다시 정리하는 도우미다.
주제는 시간이 지나며 중심이 바뀐다. 무리 전체를 보고 지금의 중심 주제를 다시 정하고, 새 중심에서 멀어진 메모만 골라 더 맞는 기존 주제나 새 주제로 보낸다.
- 확실하지 않으면 옮기지 않는다. 옮길 메모가 없으면 moves는 빈 목록이다.
- locked가 true인 메모는 사용자가 직접 정한 것이므로 옮기지 않는다.
- topic.nameLocked가 true면 사용자가 정한 이름이므로 name은 그대로 두고, 그 이름을 중심으로 삼는다.
- 주제 이름은 짧게(2~8자), 평평한 구조로. 모든 출력은 한국어. 반드시 record_reorganization 도구로만 답한다.`;

export const ANALYZE_TOOL: Anthropic.Tool = {
  name: 'record_analysis',
  description: '메모 하나를 정돈한 결과를 기록한다.',
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['idea', 'emotion', 'observation', 'todo'], description: '메모의 종류' },
      emotion: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '감정을 나타내는 짧은 단어(예: 설렘, 걱정, 평온)' },
          color: { type: 'string', description: '감정에 어울리는 부드러운 색, #rrggbb' },
        },
        required: ['label', 'color'],
      },
      keywords: { type: 'array', items: { type: 'string' }, description: '핵심 키워드 1~5개' },
      summary: { type: 'string', description: '한 줄 요약, 40자 이내' },
      text: { type: 'string', description: '사진 메모일 때만: 장면·글자·분위기 설명' },
      topic: {
        type: 'object',
        description: '기존 주제를 고르면 existingId, 정말 새로우면 newName+newSummary',
        properties: {
          existingId: { type: 'string' },
          newName: { type: 'string' },
          newSummary: { type: 'string' },
          newColor: { type: 'string', description: '새 주제일 때만: 주제 뜻에 어울리는 부드러운 색 #rrggbb. 비슷한 주제는 비슷한 계열, 다른 주제는 확실히 다른 계열' },
        },
      },
      related: {
        type: 'array',
        description: '실제로 이어지는 최근 메모, 최대 5개',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            strength: { type: 'number', description: '0~1' },
            reason: { type: 'string', description: '왜 관련 있는지 한 줄' },
          },
          required: ['id', 'strength', 'reason'],
        },
      },
    },
    required: ['kind', 'emotion', 'keywords', 'summary', 'topic', 'related'],
  },
};

export const REORGANIZE_TOOL: Anthropic.Tool = {
  name: 'record_reorganization',
  description: '주제 무리를 다시 정리한 결과를 기록한다.',
  input_schema: {
    type: 'object',
    properties: {
      topic: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          summary: { type: 'string' },
          centerKeywords: { type: 'array', items: { type: 'string' }, description: '무리의 중심 키워드 3~5개' },
        },
        required: ['name', 'summary', 'centerKeywords'],
      },
      moves: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            memoId: { type: 'string' },
            to: {
              type: 'object',
              properties: {
                existingId: { type: 'string' },
                newName: { type: 'string' },
                newSummary: { type: 'string' },
              },
            },
            fit: { type: 'number', description: '새 위치가 얼마나 확실히 더 맞는지 0~1' },
            reason: { type: 'string' },
          },
          required: ['memoId', 'to', 'fit', 'reason'],
        },
      },
    },
    required: ['topic', 'moves'],
  },
};

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageMime = (typeof IMAGE_MIMES)[number];

export function buildAnalyzeContent(req: AnalyzeRequest): Anthropic.ContentBlockParam[] {
  const payload = {
    topics: req.topics.slice(0, MAX_TOPICS),
    recent: req.recent.slice(0, MAX_RECENT),
    memo: { id: req.memo.id, input: req.memo.input, text: req.memo.text },
  };
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (req.memo.photoBase64) {
    const mime = (IMAGE_MIMES as readonly string[]).includes(req.memo.photoMime ?? '')
      ? (req.memo.photoMime as ImageMime)
      : 'image/jpeg';
    blocks.push({ type: 'image', source: { type: 'base64', media_type: mime, data: req.memo.photoBase64 } });
  }
  blocks.push({
    type: 'text',
    text: `아래 JSON의 memo를 정돈해 주세요. topics는 기존 주제, recent는 최근 정돈된 메모입니다.${
      req.memo.photoBase64 ? ' 위 이미지가 이 메모의 사진입니다.' : ''
    }\n${JSON.stringify(payload)}`,
  });
  return blocks;
}

export function buildReorganizeContent(req: ReorganizeRequest): Anthropic.ContentBlockParam[] {
  const payload = { ...req, members: req.members.slice(0, MAX_MEMBERS) };
  return [{ type: 'text', text: `아래 주제 무리를 다시 정리해 주세요.\n${JSON.stringify(payload)}` }];
}
