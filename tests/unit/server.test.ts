import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { handleApi, MODEL, organize, reorganize, type MessagesClient } from '../../server/organize';
import type { AnalyzeRequest, ReorganizeRequest } from '../../src/core/organize/types';

const req: AnalyzeRequest = {
  memo: { id: 'm1', input: 'text', text: '카페 가기' },
  topics: [{ id: 't1', name: '카페', summary: '' }],
  recent: [{ id: 'r1', summary: '카페 책', topicId: 't1' }],
};

function mock(content: unknown[], stop_reason = 'tool_use') {
  const create = vi.fn().mockResolvedValue({ content, stop_reason });
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}
const toolUse = (name: string, input: unknown) => [{ type: 'tool_use', id: 'x', name, input }];
const goodInput = {
  kind: 'idea', emotion: { label: '평온', color: '#9ccfd8' }, keywords: ['카페'], summary: '카페 가기',
  topic: { existingId: 't1' }, related: [{ id: 'r1', strength: 0.8, reason: '이어져요' }, { id: 'ghost', strength: 0.9, reason: '' }],
};

describe('서버 organize', () => {
  it('claude-haiku-5-5로 tool use를 강제해서 부르고 결과를 검증한다', async () => {
    const { client, create } = mock(toolUse('record_analysis', goodInput));
    const out = await organize(client, req);
    expect(out.topic).toEqual({ existingId: 't1' });
    expect(out.related).toHaveLength(1); // 없는 id는 걸러짐
    const params = create.mock.calls[0]![0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(params.model).toBe('claude-haiku-5-5');
    expect(MODEL).toBe('claude-haiku-5-5');
    expect(params.tools?.[0]).toMatchObject({ name: 'record_analysis' });
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'record_analysis' });
    expect(params).not.toHaveProperty('temperature');
  });

  it('사진은 image 블록(base64)으로 보낸다', async () => {
    const { client, create } = mock(toolUse('record_analysis', goodInput));
    await organize(client, { ...req, memo: { id: 'm1', input: 'photo', text: '', photoBase64: 'QUJD', photoMime: 'image/png' } });
    const params = create.mock.calls[0]![0] as Anthropic.MessageCreateParamsNonStreaming;
    const content = params.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } });
    expect(content[1]!.type).toBe('text');
  });

  it('알 수 없는 mime은 jpeg로 보낸다', async () => {
    const { client, create } = mock(toolUse('record_analysis', goodInput));
    await organize(client, { ...req, memo: { id: 'm1', input: 'photo', text: '', photoBase64: 'QUJD', photoMime: 'image/heic' } });
    const content = (create.mock.calls[0]![0] as Anthropic.MessageCreateParamsNonStreaming).messages[0]!.content as Anthropic.ContentBlockParam[];
    expect((content[0] as Anthropic.ImageBlockParam).source).toMatchObject({ media_type: 'image/jpeg' });
  });

  it('도구 호출이 없거나 거절되면 실패한다', async () => {
    await expect(organize(mock([{ type: 'text', text: 'hi' }], 'end_turn').client, req)).rejects.toThrow();
    await expect(organize(mock([], 'refusal').client, req)).rejects.toThrow();
  });

  it('주제가 엉망인 응답은 실패한다', async () => {
    await expect(organize(mock(toolUse('record_analysis', { ...goodInput, topic: { existingId: 'ghost' } })).client, req)).rejects.toThrow();
  });

  it('재구성도 같은 방식으로 부른다', async () => {
    const rr: ReorganizeRequest = {
      topic: { id: 't', name: '마라톤', summary: '', nameLocked: false },
      members: [{ id: 'a', summary: '황영조', keywords: ['황영조'], locked: false }],
      otherTopics: [{ id: 'o', name: '인물', summary: '', centerKeywords: [] }],
    };
    const { client, create } = mock(toolUse('record_reorganization', {
      topic: { name: '운동용품', summary: 's', centerKeywords: ['용품'] },
      moves: [{ memoId: 'a', to: { existingId: 'o' }, fit: 0.9, reason: '인물' }],
    }));
    const out = await reorganize(client, rr);
    expect(out.moves).toHaveLength(1);
    expect((create.mock.calls[0]![0] as Anthropic.MessageCreateParamsNonStreaming).tool_choice).toEqual({ type: 'tool', name: 'record_reorganization' });
  });
});

describe('서버 HTTP 핸들러', () => {
  it('health는 키 유무를 알려준다', async () => {
    expect((await handleApi({ method: 'GET', path: '/api/health', body: undefined, client: null })).json).toEqual({ ai: false });
    expect((await handleApi({ method: 'GET', path: '/api/health', body: undefined, client: mock([]).client })).json).toEqual({ ai: true });
  });

  it('키가 없으면 503, 잘못된 요청은 400, 없는 경로는 404', async () => {
    expect((await handleApi({ method: 'POST', path: '/api/organize', body: req, client: null })).status).toBe(503);
    const c = mock([]).client;
    expect((await handleApi({ method: 'POST', path: '/api/organize', body: { nope: 1 }, client: c })).status).toBe(400);
    expect((await handleApi({ method: 'POST', path: '/api/zzz', body: req, client: c })).status).toBe(404);
    expect((await handleApi({ method: 'GET', path: '/api/organize', body: undefined, client: c })).status).toBe(405);
  });

  it('정상이면 200과 결과, 모델 응답이 이상하면 502 (키·내부 메시지는 새지 않는다)', async () => {
    const ok = await handleApi({ method: 'POST', path: '/api/organize', body: req, client: mock(toolUse('record_analysis', goodInput)).client });
    expect(ok.status).toBe(200);
    const bad = await handleApi({ method: 'POST', path: '/api/organize', body: req, client: mock([]).client });
    expect(bad.status).toBe(502);
    expect(JSON.stringify(bad.json)).not.toMatch(/sk-|key/i);
  });

  it('예상 못 한 오류는 500으로 감추고 내부 메시지를 흘리지 않는다', async () => {
    const client = { messages: { create: vi.fn().mockRejectedValue(new Error('secret')) } } as unknown as MessagesClient;
    const r = await handleApi({ method: 'POST', path: '/api/organize', body: req, client });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toContain('secret');
  });
});
