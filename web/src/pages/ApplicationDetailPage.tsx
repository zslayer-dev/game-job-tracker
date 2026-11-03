import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApplicationForm } from '../components/ApplicationForm'
import { deleteApplication, getApplication, updateApplication, type Application, type ApplicationInput } from '../lib/applications'
import { errorMessage, type AppError } from '../lib/errors'
import { useListPath } from '../lib/listLocation'

// 지원 건 상세·편집·삭제
export function ApplicationDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const listPath = useListPath()
  const [app, setApp] = useState<Application | null>(null)
  const [loadError, setLoadError] = useState<AppError | null>(null)
  const [saved, setSaved] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const [deleteError, setDeleteError] = useState<AppError | null>(null)

  useEffect(() => {
    let cancelled = false
    getApplication(id).then((result) => {
      if (cancelled) return
      setApp(result.data)
      setLoadError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [id])

  async function handleSubmit(input: ApplicationInput) {
    setSaved(false)
    const { data, error } = await updateApplication(id, input)
    if (error) return error
    setApp(data)
    setSaved(true)
    return null
  }

  async function handleDelete() {
    if (deletingRef.current) return
    if (!app || !window.confirm(`'${app.company}' 지원 건을 삭제할까요? 되돌릴 수 없습니다.`)) return
    deletingRef.current = true
    setDeleting(true)
    setDeleteError(null)
    const { error } = await deleteApplication(id)
    if (error) {
      setDeleteError(error)
      setDeleting(false)
      deletingRef.current = false
      return
    }
    navigate(listPath, { replace: true })
  }

  return (
    <>
      <p className="back">
        <Link to={listPath}>← 목록</Link>
      </p>

      {loadError && (
        <p className="error" role="alert">
          {errorMessage(loadError)}
        </p>
      )}
      {!loadError && !app && <p className="status">불러오는 중…</p>}

      {app && (
        <>
          <div className="page-head">
            <h1>{app.company}</h1>
            <button type="button" className="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? '삭제 중…' : '삭제'}
            </button>
          </div>
          {deleteError && (
            <p className="error" role="alert">
              {errorMessage(deleteError)}
            </p>
          )}
          {saved && (
            <p className="success" role="status">
              저장했습니다.
            </p>
          )}
          {/* 저장 후 서버 값으로 폼을 다시 채우도록 updated_at을 key로 쓴다 */}
          <ApplicationForm key={app.updated_at} initial={app} submitLabel="저장" onSubmit={handleSubmit} />
        </>
      )}
    </>
  )
}
