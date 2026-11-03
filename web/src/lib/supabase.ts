import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
// 공개돼도 되는 키(publishable/anon)만. service_role·secret 키는 절대 여기 오지 않는다.
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY가 설정되지 않았습니다. web/.env.example을 참고하세요.')
}

export const supabase = createClient(url, key, {
  auth: {
    // 구글 로그인 후 ?code= 로 돌아오면 라이브러리가 세션으로 교환하고 URL에서 지운다
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})
