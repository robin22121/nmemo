import Anthropic from '@anthropic-ai/sdk';
import { MAX_MEMBERS, MAX_RECENT, MAX_TOPICS } from '../src/core/organize/types.ts';
import type { AnalyzeRequest, AnalyzeResult, ReorganizeRequest, ReorganizeResult } from '../src/core/organize/types.ts';
import { InvalidResultError, validateReorganize, validateResult } from '../src/core/organize/validate.ts';
import {
  ANALYZE_TOOL,
  REORGANIZE_SYSTEM_PROMPT,
  REORGANIZE_TOOL,
  SYSTEM_PROMPT,
  buildAnalyzeContent,
  buildReorganizeContent,
} from './prompt.ts';

export const MODEL = 'claude-haiku-5-5';

/** 테스트에서 모킹할 수 있도록 SDK 클라이언트에서 필요한 면만 정의 */
export interface MessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

export function createClient(env: Record<string, string | undefined>): MessagesClient | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

async function callTool(
  client: MessagesClient,
  system: string,
  tool: Anthropic.Tool,
  content: Anthropic.ContentBlockParam[],
): Promise<unknown> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content }],
  });
  if (res.stop_reason === 'refusal') throw new InvalidResultError('모델이 응답을 거절했어요');
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === tool.name);
  if (!block) throw new InvalidResultError('구조화된 출력이 없어요');
  return block.input;
}

export async function organize(client: MessagesClient, req: AnalyzeRequest): Promise<AnalyzeResult> {
  const safe: AnalyzeRequest = { ...req, topics: req.topics.slice(0, MAX_TOPICS), recent: req.recent.slice(0, MAX_RECENT) };
  const raw = await callTool(client, SYSTEM_PROMPT, ANALYZE_TOOL, buildAnalyzeContent(safe));
  return validateResult(raw, safe);
}

export async function reorganize(client: MessagesClient, req: ReorganizeRequest): Promise<ReorganizeResult> {
  const safe: ReorganizeRequest = { ...req, members: req.members.slice(0, MAX_MEMBERS) };
  const raw = await callTool(client, REORGANIZE_SYSTEM_PROMPT, REORGANIZE_TOOL, buildReorganizeContent(safe));
  return validateReorganize(raw, safe);
}

// ---- HTTP 핸들러(프레임워크 무관) ----

export interface ApiResponse {
  status: number;
  json: unknown;
}

const MAX_TEXT = 4000;
const MAX_PHOTO_B64 = 8_000_000;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseAnalyzeRequest(b: unknown): AnalyzeRequest | null {
  if (!isObj(b) || !isObj(b.memo) || !Array.isArray(b.topics) || !Array.isArray(b.recent)) return null;
  const m = b.memo;
  if (typeof m.id !== 'string' || typeof m.text !== 'string' || !['text', 'voice', 'photo'].includes(String(m.input))) return null;
  if (m.text.length > MAX_TEXT) return null;
  if (m.photoBase64 !== undefined && (typeof m.photoBase64 !== 'string' || m.photoBase64.length > MAX_PHOTO_B64)) return null;
  return b as unknown as AnalyzeRequest;
}

function parseReorganizeRequest(b: unknown): ReorganizeRequest | null {
  if (!isObj(b) || !isObj(b.topic) || !Array.isArray(b.members) || !Array.isArray(b.otherTopics)) return null;
  if (typeof b.topic.id !== 'string' || typeof b.topic.name !== 'string') return null;
  return b as unknown as ReorganizeRequest;
}

export interface HandleInput {
  method: string;
  /** `/api/...` 경로(쿼리 제외) */
  path: string;
  body: unknown;
  client: MessagesClient | null;
}

export async function handleApi({ method, path, body, client }: HandleInput): Promise<ApiResponse> {
  if (path === '/api/health') {
    return method === 'GET' ? { status: 200, json: { ai: client !== null } } : { status: 405, json: { error: 'method_not_allowed' } };
  }
  if (path !== '/api/organize' && path !== '/api/reorganize') return { status: 404, json: { error: 'not_found' } };
  if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  if (!client) return { status: 503, json: { error: 'ai_unavailable' } };

  try {
    if (path === '/api/organize') {
      const req = parseAnalyzeRequest(body);
      if (!req) return { status: 400, json: { error: 'bad_request' } };
      return { status: 200, json: await organize(client, req) };
    }
    const req = parseReorganizeRequest(body);
    if (!req) return { status: 400, json: { error: 'bad_request' } };
    return { status: 200, json: await reorganize(client, req) };
  } catch (e) {
    if (e instanceof InvalidResultError) return { status: 502, json: { error: 'invalid_result' } };
    if (e instanceof Anthropic.RateLimitError) return { status: 429, json: { error: 'rate_limited' } };
    if (e instanceof Anthropic.APIError) return { status: 502, json: { error: 'upstream_error' } };
    return { status: 500, json: { error: 'internal' } };
  }
}
