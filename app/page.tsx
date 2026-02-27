'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import './globals.css'

const SECRET = process.env.NEXT_PUBLIC_DIGEST_SECRET ?? ''

interface Story {
  headline: string
  tag: string
  summary: string
}

interface QAItem {
  q: string
  a: string
}

export default function Home() {
  const [stories, setStories] = useState<Story[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [storyQA, setStoryQA] = useState<Record<number, QAItem[]>>({})
  const [streamingAnswer, setStreamingAnswer] = useState<{ idx: number; text: string } | null>(null)
  const [modalIdx, setModalIdx] = useState<number | null>(null)

  // Date navigation
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState<string>('today')
  const [todayLabel, setTodayLabel] = useState<string>('')
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [pickerValue, setPickerValue] = useState('')

  const modalQARef = useRef<HTMLDivElement>(null)

  // Scroll Q&A to bottom when new answers stream in
  useEffect(() => {
    if (modalQARef.current) {
      modalQARef.current.scrollTop = modalQARef.current.scrollHeight
    }
  }, [streamingAnswer, storyQA])

  const fetchDigest = useCallback(async (date?: string) => {
    setLoading(true)
    setErrorMsg('')
    setStories([])
    setStoryQA({})
    setModalIdx(null)

    try {
      const res = await fetch('/api/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-digest-secret': SECRET },
        body: JSON.stringify({ date: date || 'today' })
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const text = await res.text()
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error) {
        throw new Error(parsed.error + (parsed.raw ? ': ' + parsed.raw : ''))
      }
      const stories: Story[] = parsed
      if (!Array.isArray(stories) || !stories.length) throw new Error('No stories returned')
      setStories(stories)
      fetchDates()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchDates = useCallback(async () => {
    try {
      const res = await fetch('/api/dates', { headers: { 'x-digest-secret': SECRET } })
      if (!res.ok) return
      const dates: string[] = await res.json()
      setAvailableDates(dates)
      if (dates.length > 0) setTodayLabel(dates[0])
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    fetchDates()
    fetchDigest('today')
    setSelectedDate('today')
  }, []) // eslint-disable-line

  const handleDateChange = (date: string) => {
    setSelectedDate(date)
    setShowDatePicker(false)
    fetchDigest(date)
  }

  const handlePickerSubmit = () => {
    if (!pickerValue) return
    const d = new Date(pickerValue + 'T12:00:00')
    const label = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    setPickerValue('')
    setShowDatePicker(false)
    setSelectedDate(label)
    fetchDigest(label)
  }

  // Step back/forward by calendar day from the current displayed date
  const stepDay = (dir: number) => {
    const currentLabel = selectedDate === 'today' ? (todayLabel || getTodayLabel()) : selectedDate
    const d = new Date(currentLabel + ' 12:00:00')
    d.setDate(d.getDate() + dir)
    const today = new Date()
    today.setHours(23, 59, 59, 999)
    if (d > today) return // can't go into the future
    const label = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    setSelectedDate(label)
    setShowDatePicker(false)
    fetchDigest(label)
  }

  function getTodayLabel() {
    return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }

  const askQuestion = async () => {
    const q = question.trim()
    if (!q || asking || modalIdx === null) return
    const idx = modalIdx
    setQuestion('')
    setAsking(true)

    const story = stories[idx]
    const priorQA = storyQA[idx] || []
    setStreamingAnswer({ idx, text: '' })

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-digest-secret': SECRET },
        body: JSON.stringify({ question: q, headline: story.headline, summary: story.summary, priorQA })
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += decoder.decode(value)
        setStreamingAnswer({ idx, text: full })
      }

      setStreamingAnswer(null)
      setStoryQA(prev => ({ ...prev, [idx]: [...(prev[idx] || []), { q, a: full }] }))
    } catch {
      setStreamingAnswer(null)
      setStoryQA(prev => ({ ...prev, [idx]: [...(prev[idx] || []), { q, a: 'Something went wrong. Try again.' }] }))
    } finally {
      setAsking(false)
    }
  }

  // Close date picker on outside click / escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { setModalIdx(null); setShowDatePicker(false) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!showDatePicker) return
    const handler = () => setShowDatePicker(false)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [showDatePicker])

  const displayDate = selectedDate === 'today' ? (todayLabel || 'Today') : selectedDate

  const activeModal = modalIdx !== null ? stories[modalIdx] : null
  const modalQA = modalIdx !== null ? (storyQA[modalIdx] || []) : []
  const modalStreaming = modalIdx !== null && streamingAnswer?.idx === modalIdx ? streamingAnswer.text : null

  return (
    <div className="app">
      <header>
        <div className="masthead">
          <h1>AI <span>DIGEST</span></h1>
        </div>
        <div className="header-center">
          <button className="date-nav-btn" onClick={() => stepDay(-1)}>
            &#9664;
          </button>
          <button className="date-label-btn" onClick={() => setShowDatePicker(v => !v)}>
            {displayDate.toUpperCase()} &#9660;
          </button>
          <button
            className="date-nav-btn"
            onClick={() => stepDay(1)}
            disabled={selectedDate === 'today' || displayDate === getTodayLabel()}
          >
            &#9654;
          </button>
        </div>

        <div className="header-right">
          {loading && (
            <div className="status-badge loading">
              <div className="dot pulse" />
              <span>{selectedDate !== 'today' ? 'Loading' : 'Fetching'}</span>
            </div>
          )}
          {!loading && stories.length > 0 && (
            <div className="story-count">{stories.length} stories</div>
          )}
        </div>
      </header>

      {showDatePicker && (
        <div className="date-picker-dropdown" onClick={e => e.stopPropagation()}>
          <div className="date-picker-title">Jump to date</div>
          <div className="date-picker-input-row">
            <input
              type="date"
              className="date-input"
              value={pickerValue}
              max={new Date().toISOString().split('T')[0]}
              onChange={e => setPickerValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handlePickerSubmit() }}
              autoFocus
            />
            <button className="btn-go" onClick={handlePickerSubmit}>Go</button>
          </div>
          {availableDates.length > 0 && (
            <div className="date-picker-history">
              <div className="date-picker-history-label">Cached</div>
              {availableDates.map(d => (
                <button key={d} className="date-history-item" onClick={() => handleDateChange(d)}>
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="loading-screen">
          <div className="load-animation">
            {[...Array(7)].map((_, i) => <div key={i} className="load-bar" />)}
          </div>
          <div className="load-label">
            {selectedDate && selectedDate !== 'today' ? 'Loading archive…' : 'Scanning AI news…'}
          </div>
        </div>
      )}

      {!loading && errorMsg && (
        <div className="error-screen">
          <div className="error-title">Failed to Load</div>
          <div className="error-msg">{errorMsg}</div>
          <button className="btn-retry" onClick={() => fetchDigest(selectedDate)}>Try Again</button>
        </div>
      )}

      {stories.length > 0 && (
        <div className="story-grid">
          {stories.map((s, i) => (
            <div
              key={i}
              className="card"
              onClick={() => setModalIdx(i)}
            >
              <div className="card-top">
                <span className="card-tag">{s.tag}</span>
                <span className="card-num">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <div className="card-headline">{s.headline}</div>
              <div className="card-summary">{s.summary}</div>
              {storyQA[i]?.length > 0 && (
                <div className="card-qa-indicator">{storyQA[i].length} Q&amp;A</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {activeModal && (
        <div className="modal-overlay" onClick={() => setModalIdx(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-meta">
                <span className="card-tag">{activeModal.tag}</span>
                <span className="modal-num">{String(modalIdx! + 1).padStart(2, '0')} / {stories.length}</span>
              </div>
              <button className="modal-close" onClick={() => setModalIdx(null)}>&#10005;</button>
            </div>

            <div className="modal-headline">{activeModal.headline}</div>
            <div className="modal-summary">{activeModal.summary}</div>

            {(modalQA.length > 0 || modalStreaming !== null) && (
              <div className="modal-qa" ref={modalQARef}>
                {modalQA.map((item, j) => (
                  <div key={j} className="qa-item">
                    <div className="qa-q">{item.q}</div>
                    <div className="qa-a">{item.a}</div>
                  </div>
                ))}
                {modalStreaming !== null && (
                  <div className="qa-item">
                    <div className="qa-q">{question || '…'}</div>
                    <div className="qa-a streaming">{modalStreaming || '…'}</div>
                  </div>
                )}
              </div>
            )}

            <div className="modal-input-row">
              <input
                type="text"
                className="q-input"
                placeholder="Ask about this story…"
                maxLength={300}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') askQuestion() }}
                autoFocus
              />
              <button className="btn-ask" onClick={askQuestion} disabled={asking}>Ask</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
