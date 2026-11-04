// Edge Function analyze-posting (design.md 4.4, 7장)
// POST { application_id }  +  Authorization: Bearer <사용자 JWT>
// → 200 { fit_score, matched_skills, missing_skills, comment }  (저장은 하지 않음 — 화면이 사용자 JWT로 저장)
// 오류 응답 본문은 { "error": "<코드>" }만 보낸다(design.md 7.8).
//
// 로그 규칙: JWT·API 키·공고 원문·프로필은 남기지 않는다. 오류 코드, user_id, ai_usage id, 상태 코드만.
import Anthropic from 'npm:@anthropic-ai/sdk@1.0.0'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { ANALYSIS_SCHEMA, POSTING_TEXT_MAX, SYSTEM_PROMPT, buildUserMessage, charCount, hasText, validateAnalysis, type Analysis, type Profile } from './analysis.ts'
import { PREFLIGHT_HEADERS, corsFor, parseAllowedOrigins } from './cors.ts'

const MODEL = 'claude-haiku-5-5'
const AI_TIMEOUT_MS = 60_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''

// 로컬 스택 안에서만 true. 운영(*.supabase.co)에서는 테스트용 설정(AI_MOCK, 한도 덮어쓰기)을 무시한다.
const IS_LOCAL = (() => {
  try {
    return ['kong', 'localhost', '127.0.0.1', 'host.docker.internal'].includes(new URL(SUPABASE_URL).hostname)
  } catch {
    return false
  }
})()

function pickKey(jsonEnv: string, legacyEnv: string): string {
  const raw = Deno.env.get(jsonEnv)
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, string>
      if (keys.default) return keys.default
    } catch {
      // 형식이 다르면 아래 레거시 변수로
    }
  }
  return Deno.env.get(legacyEnv) ?? ''
}

const PUBLISHABLE_KEY = pickKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
const SECRET_KEY = pickKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
const ALLOWED_ORIGINS = parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS'))

type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'POSTING_EMPTY'
  | 'POSTING_TOO_LONG'
  | 'PROFILE_EMPTY'
  | 'AI_USER_LIMIT'
  | 'AI_GLOBAL_LIMIT'
  | 'AI_ERROR'
  | 'AI_TIMEOUT'
  | 'AI_FORMAT'
  | 'INTERNAL'

// 서버 로그: 정해진 필드만
function log(event: string, fields: Record<string, string | number | boolean | null | undefined> = {}) {
  console.error(JSON.stringify({ fn: 'analyze-posting', event, ...fields }))
}

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } })
}

// 로컬 테스트 전용 한도 덮어쓰기. 운영에서는 넘기지 않는다(null → DB 기본값 ai_daily_limits()).
function limitOverride(name: string): number | undefined {
  const raw = Deno.env.get(name)
  if (!raw) return undefined
  if (!IS_LOCAL) {
    log('ignored_env_outside_local', { name })
    return undefined
  }
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : undefined
}

// ── AI 호출 ──────────────────────────────────────────────────────────────────

type AiOutcome = { kind: 'ok'; analysis: Analysis } | { kind: 'ai_error' } | { kind: 'timeout' } | { kind: 'format_error' }

function parseAndValidate(text: string): AiOutcome {
  try {
    const analysis = validateAnalysis(JSON.parse(text))
    return analysis ? { kind: 'ok', analysis } : { kind: 'format_error' }
  } catch {
    return { kind: 'format_error' }
  }
}

// 로컬 테스트용 흉내(AI_MOCK). 요청 값으로는 바꿀 수 없고, 운영에서는 무시된다.
function mockOutcome(mode: string): AiOutcome | null {
  switch (mode) {
    case 'ok':
      return parseAndValidate(
        JSON.stringify({ fit_score: 72, matched_skills: ['C#', 'Unity'], missing_skills: ['GAS'], comment: '흉내 낸 분석 결과입니다.' }),
      )
    case 'ai_error':
      return { kind: 'ai_error' }
    case 'timeout':
      return { kind: 'timeout' }
    case 'format_error':
      return parseAndValidate('{"fit_score": 150, "matched_skills": "C#"')
    default:
      return null
  }
}

async function callClaude(postingText: string, profile: Profile): Promise<AiOutcome> {
  const mock = Deno.env.get('AI_MOCK')
  if (mock) {
    if (IS_LOCAL) {
      const outcome = mockOutcome(mock)
      if (outcome) return outcome
    }
    log('ignored_ai_mock', { local: IS_LOCAL })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    log('missing_api_key')
    return { kind: 'ai_error' }
  }

  // 재시도하지 않는다: 60초 안에 끝나야 하고, 재시도는 비용을 늘린다
  const client = new Anthropic({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 0 })
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(postingText, profile) }],
      output_config: { format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
    })
    // 거절(refusal)·길이 초과(max_tokens)는 정해진 형식이 아닐 수 있으므로 형식 오류로 센다.
    // (공고 원문으로 일부러 유도할 수 있으므로 사용자 횟수에 포함 — PRD 8장)
    if (response.stop_reason !== 'end_turn') {
      log('ai_stop_reason', { stop_reason: response.stop_reason })
      return { kind: 'format_error' }
    }
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    return parseAndValidate(text)
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      log('ai_timeout')
      return { kind: 'timeout' }
    }
    if (err instanceof Anthropic.APIError) {
      // 제공자 응답 상태와 오류 종류만 남긴다(메시지 본문은 남기지 않음)
      log('ai_api_error', { status: err.status ?? null, type: (err as { error?: { error?: { type?: string } } }).error?.error?.type ?? null })
      return { kind: 'ai_error' }
    }
    log('ai_unknown_error', { name: err instanceof Error ? err.name : typeof err })
    return { kind: 'ai_error' }
  }
}

// ── 요청 처리 ────────────────────────────────────────────────────────────────

async function handle(req: Request, cors: Record<string, string>): Promise<Response> {
  const fail = (status: number, code: ErrorCode) => json(status, { error: code }, cors)

  if (req.method !== 'POST') return fail(405, 'VALIDATION')

  // 1. JWT 검증(반드시, design.md 7.2). API 키(sb_...)는 사용자 토큰이 아니다.
  const auth = req.headers.get('authorization') ?? ''
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1]
  if (!token || token.startsWith('sb_')) return fail(401, 'AUTH_REQUIRED')

  const userClient: SupabaseClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser(token)
  const userId = userData?.user?.id
  if (userError || !userId) return fail(401, 'AUTH_REQUIRED')

  // 2. 본문은 application_id만 읽는다. user_id 등 다른 필드는 무시(#21).
  let applicationId: unknown
  try {
    applicationId = ((await req.json()) as { application_id?: unknown })?.application_id
  } catch {
    return fail(400, 'VALIDATION')
  }
  if (typeof applicationId !== 'string' || !UUID_RE.test(applicationId)) return fail(404, 'NOT_FOUND')

  // 3. 지원 건은 사용자 JWT 클라이언트(RLS)로 조회 → 남의 건은 0건 = 404
  const app = await userClient.from('applications').select('posting_text').eq('id', applicationId).maybeSingle()
  if (app.error) {
    log('db_error', { step: 'application', code: app.error.code, user_id: userId })
    return fail(500, 'INTERNAL')
  }
  if (!app.data) return fail(404, 'NOT_FOUND')
  const postingText = app.data.posting_text as string | null

  // 4. 횟수를 쓰기 전에 거부할 것들
  if (!hasText(postingText)) return fail(400, 'POSTING_EMPTY')
  if (charCount(postingText) > POSTING_TEXT_MAX) return fail(400, 'POSTING_TOO_LONG')

  const empty = await userClient.rpc('is_profile_empty')
  if (empty.error) {
    log('db_error', { step: 'is_profile_empty', code: empty.error.code, user_id: userId })
    return fail(500, 'INTERNAL')
  }
  if (empty.data === true) return fail(400, 'PROFILE_EMPTY')

  const prof = await userClient.from('profiles').select('summary, engines, skills, strengths, gaps').maybeSingle()
  if (prof.error || !prof.data) {
    log('db_error', { step: 'profile', code: prof.error?.code ?? 'none', user_id: userId })
    return fail(500, 'INTERNAL')
  }

  // 5. 한도 판정 + "진행 중" 기록 (service_role, user_id는 JWT에서 얻은 값만)
  const service = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const args: Record<string, unknown> = { p_user_id: userId }
  const userLimit = limitOverride('AI_USER_DAILY_LIMIT')
  const globalLimit = limitOverride('AI_GLOBAL_DAILY_LIMIT')
  if (userLimit !== undefined) args.p_user_limit = userLimit
  if (globalLimit !== undefined) args.p_global_limit = globalLimit

  const begin = await service.rpc('begin_ai_call', args)
  if (begin.error) {
    if (begin.error.message === 'AI_USER_LIMIT') return fail(429, 'AI_USER_LIMIT')
    if (begin.error.message === 'AI_GLOBAL_LIMIT') return fail(429, 'AI_GLOBAL_LIMIT')
    log('db_error', { step: 'begin_ai_call', code: begin.error.code, user_id: userId })
    return fail(500, 'INTERNAL')
  }
  const usageId = begin.data as string

  // 6~7. AI 호출과 형식 검증
  const outcome = await callClaude(postingText, prof.data as Profile)

  // 8. 결과 기록
  const [result, reason, status, code]: [string, string | null, number, ErrorCode | null] =
    outcome.kind === 'ok'
      ? ['성공', null, 200, null]
      : outcome.kind === 'timeout'
        ? ['실패', '시간 초과', 504, 'AI_TIMEOUT']
        : outcome.kind === 'format_error'
          ? ['실패', '형식 오류', 422, 'AI_FORMAT']
          : ['실패', 'AI 오류', 502, 'AI_ERROR']

  const finish = await service.rpc('finish_ai_call', { p_id: usageId, p_result: result, p_failure_reason: reason })
  if (finish.error) {
    // 기록이 "진행 중"으로 남아도 2분 뒤 사용자 횟수에서 빠진다(design.md 4.2)
    log('db_error', { step: 'finish_ai_call', code: finish.error.code, user_id: userId, usage_id: usageId })
    return fail(500, 'INTERNAL')
  }
  log('done', { user_id: userId, usage_id: usageId, result: outcome.kind })

  if (outcome.kind !== 'ok' || code) return fail(status, code ?? 'INTERNAL')
  return json(200, outcome.analysis, cors)
}

Deno.serve(async (req) => {
  // 0. CORS: Origin이 있고 허용 목록에 없으면 CORS 헤더 없이 403. 본문 처리·DB 호출 없음.
  const cors = corsFor(req.headers.get('origin'), ALLOWED_ORIGINS)
  if (!cors.allowed) return json(403, { error: 'FORBIDDEN' }, cors.headers)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors.headers, ...PREFLIGHT_HEADERS } })

  try {
    return await handle(req, cors.headers)
  } catch (err) {
    log('unhandled', { name: err instanceof Error ? err.name : typeof err })
    return json(500, { error: 'INTERNAL' }, cors.headers)
  }
})
