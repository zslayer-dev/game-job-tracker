import { useLocation } from 'react-router'

// 목록에서 상세로 갈 때 목록의 필터·검색(?status=&q=)을 함께 넘겨, "← 목록"으로 돌아와도 유지되게 한다
export type ListLinkState = { listSearch?: string }

export function useListPath(): string {
  const state = useLocation().state as ListLinkState | null
  return state?.listSearch ? `/?${state.listSearch}` : '/'
}
