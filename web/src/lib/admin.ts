import type { PostgrestError } from '@supabase/supabase-js'
import { toAppError } from './applications'
import type { AppError } from './errors'
import { supabase } from './supabase'

// 관리자 기능 (PRD 5장 Could 7, design.md 4.5).
// 화면에서 메뉴를 숨기는 것은 편의일 뿐이고, 모든 관리자 함수는 DB가 is_admin()으로 확인한다.

export type AccessMode = 'all' | 'allowlist'

export type AdminUser = {
  user_id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  application_count: number
  ai_used_today: number
  ai_daily_limit: number
  ai_allowed: boolean // 실제 허용 여부(모드 반영)
  ai_allowlisted: boolean // 허용 목록에 있는지
}

type Result<T> = { data: T; error: null } | { data: null; error: AppError }

function adminError(error: PostgrestError): AppError {
  if (error.code === 'P0001' && error.message === 'NOT_FOUND') return { code: 'USER_NOT_FOUND' }
  if (error.code === 'P0001' && error.message === 'VALIDATION') return { code: 'VALIDATION' }
  return toAppError(error, {}, 'admin')
}

// 메뉴 표시용. 실패하면 관리자가 아닌 것으로 본다.
export async function isAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin')
  return !error && data === true
}

export async function listUsers(): Promise<Result<AdminUser[]>> {
  const { data, error } = await supabase.rpc('admin_list_users')
  if (error) return { data: null, error: adminError(error) }
  return { data: data as AdminUser[], error: null }
}

// 모드는 공개 정보라 일반 표 조회로 읽는다(쓰기는 관리자 함수만)
export async function getAccessMode(): Promise<Result<AccessMode>> {
  const { data, error } = await supabase.from('ai_settings').select('access_mode').single()
  if (error) return { data: null, error: adminError(error) }
  return { data: data.access_mode as AccessMode, error: null }
}

export async function setAccessMode(mode: AccessMode): Promise<Result<boolean>> {
  const { data, error } = await supabase.rpc('admin_set_ai_access_mode', { p_mode: mode })
  if (error) return { data: null, error: adminError(error) }
  return { data: data as boolean, error: null }
}

export async function setAllowed(userId: string, allowed: boolean): Promise<Result<boolean>> {
  const { data, error } = await supabase.rpc('admin_set_ai_allowed', { p_user_id: userId, p_allowed: allowed })
  if (error) return { data: null, error: adminError(error) }
  return { data: data as boolean, error: null }
}

export async function resetQuota(userId: string): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('admin_reset_ai_quota', { p_user_id: userId })
  if (error) return { data: null, error: adminError(error) }
  return { data: data as string, error: null }
}
