import type { PostgrestError } from '@supabase/supabase-js'
import { reportAuthRequired } from './authEvents'
import { logError, type AppError, type ValidationField } from './errors'
import { companySearchPattern } from './search'
import { supabase } from './supabase'

// DB CHECK 제약과 같은 값 (supabase/migrations/*_applications.sql)
export const STATUSES = ['관심', '지원 완료', '서류 통과', '과제·코테', '면접', '최종 합격', '불합격', '포기'] as const
export const CHANNELS = ['게임잡', '원티드', '잡코리아', '리멤버', '헤드헌터', '직접 지원', '기타'] as const
export const POSTING_TEXT_MAX = 8000
export const MEMO_MAX = 5000

export type Status = (typeof STATUSES)[number]
export type Channel = (typeof CHANNELS)[number]

export type Application = {
  id: string
  user_id: string
  company: string
  position: string
  channel: Channel | null
  status: Status
  applied_at: string | null
  deadline: string | null
  posting_text: string | null
  memo: string | null
  created_at: string
  updated_at: string
}

export type ApplicationInput = Pick<
  Application,
  'company' | 'position' | 'channel' | 'status' | 'applied_at' | 'deadline' | 'posting_text' | 'memo'
>

export type ApplicationListItem = Pick<Application, 'id' | 'company' | 'position' | 'status' | 'applied_at' | 'deadline'>

type Result<T> = { data: T; error: null } | { data: null; error: AppError }

// DB와 같은 기준(코드 포인트)으로 글자 수를 센다. 이모지 등에서 String.length와 다르다.
export function charCount(text: string): number {
  return [...text].length
}

// 저장 전 화면 검사. DB 제약이 최종 방어선이고, 이건 사용자 편의용.
export function validate(input: ApplicationInput): AppError | null {
  if (input.company.trim() === '') return { code: 'VALIDATION', field: 'company' }
  if (input.position.trim() === '') return { code: 'VALIDATION', field: 'position' }
  if (input.posting_text && charCount(input.posting_text) > POSTING_TEXT_MAX) {
    return { code: 'VALIDATION', field: 'posting_text' }
  }
  if (input.memo && charCount(input.memo) > MEMO_MAX) return { code: 'VALIDATION', field: 'memo' }
  return null
}

// CHECK 제약 이름 → 화면 필드
const APPLICATION_FIELDS: Record<string, ValidationField> = {
  applications_company_not_blank: 'company',
  applications_position_not_blank: 'position',
  applications_posting_text_len: 'posting_text',
  applications_memo_len: 'memo',
}

// 원본 오류는 화면에 띄우지 않고 정해진 코드로만 바꾼다(design.md 7.8)
export function toAppError(
  error: PostgrestError,
  fields: Record<string, ValidationField> = APPLICATION_FIELDS,
  context = 'applications',
): AppError {
  logError(context, error)
  if (error.code === '23514') {
    const constraint = /check constraint "([^"]+)"/.exec(error.message)?.[1]
    return { code: 'VALIDATION', field: fields[constraint ?? ''] }
  }
  if (error.code === '23502') return { code: 'VALIDATION' }
  if (error.code === 'P0001' && error.message === 'APP_LIMIT') return { code: 'APP_LIMIT' }
  if (error.code === 'P0001' && error.message === 'SAMPLE_NOT_EMPTY') return { code: 'SAMPLE_NOT_EMPTY' }
  if (error.code === 'P0001' && error.message === 'AUTH_REQUIRED') {
    reportAuthRequired()
    return { code: 'AUTH_REQUIRED' }
  }
  if (error.code === 'PGRST301' || error.code === 'PGRST303') {
    // 토큰 무효·만료: 세션을 정리하고 로그인 화면으로 보낸다(AuthProvider)
    reportAuthRequired()
    return { code: 'AUTH_REQUIRED' }
  }
  // 로그인한 상태의 42501은 토큰 문제가 아니라 권한 설정(RLS·GRANT) 문제다.
  // 로그아웃시키면 원인이 가려지므로 세션은 그대로 두고 문구만 보여준다.
  // (로그아웃 상태의 요청은 세션이 없어 RequireAuth가 먼저 로그인 화면으로 보낸다)
  if (error.code === '42501') return { code: 'FORBIDDEN' }
  return { code: 'INTERNAL' }
}

const LIST_COLUMNS = 'id, company, position, status, applied_at, deadline'

export type ListFilters = { status: Status | null; q: string }

// URL 쿼리 값 → 상태. 선택지에 없는 값은 "전체"로 본다.
export function parseStatus(value: string | null): Status | null {
  return STATUSES.find((s) => s === value) ?? null
}

// 필터·검색·정렬은 모두 DB 쿼리로 처리한다
export async function listApplications({ status, q }: ListFilters): Promise<Result<ApplicationListItem[]>> {
  let query = supabase.from('applications').select(LIST_COLUMNS)
  if (status) query = query.eq('status', status)
  const pattern = companySearchPattern(q)
  if (pattern !== null) query = query.filter('company', 'imatch', pattern)

  // PRD 8장: 지원일 최신순, 빈 지원일은 맨 아래, 그 안에서는 생성 최신순
  const { data, error } = await query
    .order('applied_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) return { data: null, error: toAppError(error) }
  return { data: data as ApplicationListItem[], error: null }
}

export async function getApplication(id: string): Promise<Result<Application>> {
  const { data, error } = await supabase.from('applications').select('*').eq('id', id).maybeSingle()
  // 형식이 잘못된 ID도 "없는 건"으로 다룬다
  if (error?.code === '22P02') return { data: null, error: { code: 'NOT_FOUND' } }
  if (error) return { data: null, error: toAppError(error) }
  // 남의 건도 RLS로 0건이 되어 여기로 온다
  if (!data) return { data: null, error: { code: 'NOT_FOUND' } }
  return { data: data as Application, error: null }
}

export async function createApplication(input: ApplicationInput): Promise<Result<Application>> {
  const { data, error } = await supabase.from('applications').insert(input).select().single()
  if (error) return { data: null, error: toAppError(error) }
  return { data: data as Application, error: null }
}

export async function updateApplication(id: string, input: ApplicationInput): Promise<Result<Application>> {
  const { data, error } = await supabase.from('applications').update(input).eq('id', id).select().maybeSingle()
  if (error) return { data: null, error: toAppError(error) }
  if (!data) return { data: null, error: { code: 'NOT_FOUND' } }
  return { data: data as Application, error: null }
}

// 지원 건이 하나도 없을 때만 가상 회사 샘플 6건을 넣는다(DB 함수가 확인과 삽입을 한 번에 처리)
export async function seedSampleData(): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('seed_sample_data')
  if (error) return { data: null, error: toAppError(error) }
  return { data: data as number, error: null }
}

export async function deleteApplication(id: string): Promise<Result<true>> {
  const { data, error } = await supabase.from('applications').delete().eq('id', id).select('id')
  if (error) return { data: null, error: toAppError(error) }
  if (data.length === 0) return { data: null, error: { code: 'NOT_FOUND' } }
  return { data: true, error: null }
}
