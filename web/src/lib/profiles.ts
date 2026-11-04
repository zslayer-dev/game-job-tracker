import { toAppError, charCount } from './applications'
import type { AppError, ValidationField } from './errors'
import { supabase } from './supabase'

// DB 제약과 같은 값 (supabase/migrations/*_profiles.sql)
export const PROFILE_TEXT_MAX = 2000
export const TAGS_MAX = 30
export const TAG_LEN_MAX = 50

export type Profile = {
  user_id: string
  summary: string | null
  engines: string[]
  skills: string[]
  strengths: string | null
  gaps: string | null
  updated_at: string
}

export type ProfileInput = Pick<Profile, 'summary' | 'engines' | 'skills' | 'strengths' | 'gaps'>

type Result<T> = { data: T; error: null } | { data: null; error: AppError }

const PROFILE_FIELDS: Record<string, ValidationField> = {
  profiles_summary_len: 'summary',
  profiles_strengths_len: 'strengths',
  profiles_gaps_len: 'gaps',
  profiles_engines_count: 'engines',
  profiles_engines_items: 'engines',
  profiles_skills_count: 'skills',
  profiles_skills_items: 'skills',
}

const toError = (error: Parameters<typeof toAppError>[0]) => toAppError(error, PROFILE_FIELDS, 'profiles')

// 저장 전 화면 검사. DB 제약이 최종 방어선이고, 이건 사용자 편의용.
export function validateProfile(input: ProfileInput): AppError | null {
  for (const field of ['summary', 'strengths', 'gaps'] as const) {
    const value = input[field]
    if (value && charCount(value) > PROFILE_TEXT_MAX) return { code: 'VALIDATION', field }
  }
  for (const field of ['engines', 'skills'] as const) {
    const tags = input[field]
    if (tags.length > TAGS_MAX || tags.some((t) => t.trim() === '' || charCount(t) > TAG_LEN_MAX)) {
      return { code: 'VALIDATION', field }
    }
  }
  return null
}

// 아직 저장한 적이 없으면 null (RLS로 본인 행만 보인다)
export async function getMyProfile(): Promise<Result<Profile | null>> {
  const { data, error } = await supabase.from('profiles').select('*').maybeSingle()
  if (error) return { data: null, error: toError(error) }
  return { data: data as Profile | null, error: null }
}

// 사용자당 1행: 없으면 만들고 있으면 고친다. user_id는 DB 기본값(auth.uid())이 채운다.
export async function saveMyProfile(input: ProfileInput): Promise<Result<Profile>> {
  const { data, error } = await supabase.from('profiles').upsert(input, { onConflict: 'user_id' }).select().single()
  if (error) return { data: null, error: toError(error) }
  return { data: data as Profile, error: null }
}
