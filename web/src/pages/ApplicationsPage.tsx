import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { listApplications, type ApplicationListItem } from '../lib/applications'
import { errorMessage, type AppError } from '../lib/errors'

// 지원 목록. 필터·검색·정렬은 M4, 빈 상태의 샘플 채우기는 M5에서 붙인다.
export function ApplicationsPage() {
  const [items, setItems] = useState<ApplicationListItem[] | null>(null)
  const [error, setError] = useState<AppError | null>(null)

  useEffect(() => {
    let cancelled = false
    listApplications().then((result) => {
      if (cancelled) return
      setItems(result.data)
      setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <div className="page-head">
        <h1>지원 목록</h1>
        <Link to="/applications/new" className="button primary">
          지원 건 추가
        </Link>
      </div>

      {error && (
        <p className="error" role="alert">
          {errorMessage(error)}
        </p>
      )}

      {!error && items === null && <p className="status">불러오는 중…</p>}

      {items?.length === 0 && (
        <div className="empty">
          <p>첫 지원 건을 추가해 보세요.</p>
          <Link to="/applications/new" className="button primary">
            지원 건 추가
          </Link>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th>회사</th>
                <th>포지션</th>
                <th>상태</th>
                <th>지원일</th>
                <th>마감일</th>
              </tr>
            </thead>
            <tbody>
              {items.map((app) => (
                <tr key={app.id}>
                  <td>
                    <Link to={`/applications/${app.id}`}>{app.company}</Link>
                  </td>
                  <td>{app.position}</td>
                  <td>
                    <span className="badge">{app.status}</span>
                  </td>
                  <td>{app.applied_at ?? '—'}</td>
                  <td>{app.deadline ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
