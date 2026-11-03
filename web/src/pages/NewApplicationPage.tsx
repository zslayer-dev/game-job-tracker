import { Link, useNavigate } from 'react-router'
import { ApplicationForm } from '../components/ApplicationForm'
import { createApplication, type ApplicationInput } from '../lib/applications'

export function NewApplicationPage() {
  const navigate = useNavigate()

  async function handleSubmit(input: ApplicationInput) {
    const { error } = await createApplication(input)
    if (error) return error
    navigate('/')
    return null
  }

  return (
    <>
      <p className="back">
        <Link to="/">← 목록</Link>
      </p>
      <h1>지원 건 추가</h1>
      <ApplicationForm submitLabel="추가" onSubmit={handleSubmit} />
    </>
  )
}
