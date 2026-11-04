import { useId, useState, type KeyboardEvent } from 'react'
import { charCount } from '../lib/applications'

type Props = {
  label: string
  tags: string[]
  max: number
  maxLength: number
  placeholder?: string
  onChange: (tags: string[]) => void
}

// 엔진·기술 스택처럼 짧은 항목 여러 개를 태그로 추가·삭제한다.
// 항목은 텍스트로만 그린다(HTML로 해석하지 않음).
export function TagInput({ label, tags, max, maxLength, placeholder, onChange }: Props) {
  const titleId = useId()
  const [draft, setDraft] = useState('')
  const [hint, setHint] = useState<string | null>(null)

  function add() {
    const value = draft.trim()
    if (value === '') return
    if (charCount(value) > maxLength) return setHint(`항목은 ${maxLength}자 이하로 입력해 주세요.`)
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) return setHint('이미 있는 항목입니다.')
    if (tags.length >= max) return setHint(`${max}개까지 넣을 수 있습니다.`)
    onChange([...tags, value])
    setDraft('')
    setHint(null)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // 한글 조합 중 Enter는 조합 확정용이라 무시한다(안 그러면 마지막 글자가 따로 한 번 더 들어간다)
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault() // 폼 제출 대신 항목 추가
    add()
  }

  return (
    <div className="tag-field" role="group" aria-labelledby={titleId}>
      <span className="field-title">
        <span id={titleId}>{label}</span>
        <span className={tags.length > max ? 'counter over' : 'counter'}>
          {tags.length} / {max}개
        </span>
      </span>
      {tags.length > 0 && (
        <ul className="tags">
          {tags.map((tag) => (
            <li key={tag} className="tag">
              <span>{tag}</span>
              <button type="button" aria-label={`${tag} 삭제`} onClick={() => onChange(tags.filter((t) => t !== tag))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="tag-add">
        <input
          value={draft}
          aria-label={`${label} 추가`}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => {
            setDraft(e.target.value)
            setHint(null)
          }}
          onKeyDown={handleKeyDown}
        />
        <button type="button" onClick={add}>
          추가
        </button>
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}
