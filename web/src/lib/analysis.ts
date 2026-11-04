import { FunctionsHttpError } from '@supabase/supabase-js'
import { toAppError } from './applications'
import { reportAuthRequired } from './authEvents'
import { logError, type AppError, type ErrorCode } from './errors'
import { supabase } from './supabase'

// Edge Function analyze-posting의 성공 응답 = ai_analyses에 저장하는 값
export type AnalysisResult = {
  fit_score: number
  matched_skills: string[]
  missing_skills: string[]
  comment: string
}

export type SavedAnalysis = AnalysisResult & { id: string; created_at: string }

export type Remaining = { remaining: number; daily_limit: number }

type Result<T> = { data: T; error: null } | { data: null; error: AppError }

// 함수가 보내는 오류 코드 중 화면이 아는 것. 그 밖은 INTERNAL.
const FUNCTION_CODES: ErrorCode[] = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'POSTING_EMPTY',
  'POSTING_TOO_LONG',
  'PROFILE_EMPTY',
  'AI_USER_LIMIT',
  'AI_GLOBAL_LIMIT',
  'AI_ERROR',
  'AI_TIMEOUT',
  'AI_FORMAT',
]

// 응답 본문 { error: 코드 }에서 코드만 읽는다. 원문 오류는 화면에 띄우지 않는다.
async function functionError(error: unknown): Promise<AppError> {
  logError('analyze-posting', error)
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await (error.context as Response).json()) as { error?: unknown }
      const code = FUNCTION_CODES.find((c) => c === body?.error)
      if (code === 'AUTH_REQUIRED') reportAuthRequired()
      if (code) return { code }
    } catch {
      // 본문이 JSON이 아니면 INTERNAL
    }
  }
  return { code: 'INTERNAL' }
}

// 분석 요청 (저장은 하지 않는다). 서버는 DB에 저장된 공고 원문을 분석한다.
export async function analyzePosting(applicationId: string): Promise<Result<AnalysisResult>> {
  const { data, error } = await supabase.functions.invoke<AnalysisResult>('analyze-posting', {
    body: { application_id: applicationId },
  })
  if (error || !data) return { data: null, error: await functionError(error) }
  return { data, error: null }
}

// 사용자가 [저장]을 눌렀을 때만 저장한다 (RLS + 복합 FK로 본인 지원 건에만)
export async function saveAnalysis(applicationId: string, result: AnalysisResult): Promise<Result<SavedAnalysis>> {
  const { data, error } = await supabase
    .from('ai_analyses')
    .insert({ application_id: applicationId, ...result })
    .select('id, created_at, fit_score, matched_skills, missing_skills, comment')
    .single()
  if (error) return { data: null, error: toAppError(error, {}, 'ai_analyses') }
  return { data: data as SavedAnalysis, error: null }
}

// 저장된 분석 중 가장 최근 1건 (PRD 7장)
export async function getLatestAnalysis(applicationId: string): Promise<Result<SavedAnalysis | null>> {
  const { data, error } = await supabase
    .from('ai_analyses')
    .select('id, created_at, fit_score, matched_skills, missing_skills, comment')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return { data: null, error: toAppError(error, {}, 'ai_analyses') }
  return { data: data as SavedAnalysis | null, error: null }
}

// 오늘 내 남은 분석 횟수 (서버 판정과 같은 기준, design.md 4.2)
export async function getRemaining(): Promise<Result<Remaining>> {
  const { data, error } = await supabase.rpc('my_ai_remaining')
  if (error) return { data: null, error: toAppError(error, {}, 'my_ai_remaining') }
  return { data: data as Remaining, error: null }
}
