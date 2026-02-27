'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import './globals.css'

const RATE = 1.28
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

type Status = 'loading' | 'playing' | 'answering' | 'paused' | 'done' | 'error'

export default function Home() {
  const [stories, setStories] = useState<Story[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [statusText, setStatusText] = useState('Fetching news')
  const [currentIdx, setCurrentIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [done, setDone] = useState(false)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [storyQA, setStoryQA] = useState<Record<number, QAItem[]>>({})
  const [streamingAnswer, setStreamingAnswer] = useState<{ idx: number; text: string } | null>(null)
  const [modalIdx, setModalIdx] = useState<number | null>(null)

  // Date navigation
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState<string>('today')
  const [todayLabel, setTodayLabel] = useState<string>('')

  const isSpeakingRef = useRef(false)
  const isPlayingRef = useRef(false)
  const isPausedRef = useRef(false)
  const isAnsweringRef = useRef(false)
  const currentIdxRef = useRef(0)
  const modalQARef = useRef<HTMLDivElement>(null)

  // Keep refs in sync
  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])
  useEffect(() => { currentIdxRef.current = currentIdx }, [currentIdx])

  // Scroll Q&A to bottom when new answers stream in
  useEffect(() => {
    if (modalQARef.current) {
      modalQARef.current.scrollTop = modalQARef.current.scrollHeight
    }
  }, [streamingAnswer, storyQA])

  const speakKeepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const speak = useCallback((text: string, onEnd: () => void) => {
    if (speakKeepaliveRef.current) { clearInterval(speakKeepaliveRef.current); speakKeepaliveRef.current = null }
    window.speechSynthesis.cancel()

    const doSpeak = () => {
      const u = new SpeechSynthesisUtterance(text)
      u.rate = RATE; u.pitch = 1.0; u.volume = 1.0
      const voices = window.speechSynthesis.getVoices()
      const v = voices.find(v =>
        v.name.includes('Samantha') ||
        v.name.includes('Google US English') ||
        (v.lang === 'en-US' && v.localService)
      )
      if (v) u.voice = v

      const cleanup = () => {
        if (speakKeepaliveRef.current) { clearInterval(speakKeepaliveRef.current); speakKeepaliveRef.current = null }
        isSpeakingRef.current = false
      }
      u.onend = () => { cleanup(); onEnd() }
      u.onerror = (e) => {
        if (e.error === 'interrupted' || e.error === 'canceled') { cleanup(); return }
        cleanup()
        isPlayingRef.current = false
        setIsPlaying(false)
        setStatus('paused')
        setStatusText('Paused')
      }

      isSpeakingRef.current = true
      window.speechSynthesis.speak(u)

      speakKeepaliveRef.current = setInterval(() => {
        if (!window.speechSynthesis.speaking) { clearInterval(speakKeepaliveRef.current!); speakKeepaliveRef.current = null; return }
        if (window.speechSynthesis.paused) return
        window.speechSynthesis.pause()
        window.speechSynthesis.resume()
      }, 10000)
    }

    setTimeout(doSpeak, 50)
  }, [])

  const readStory = useCallback((idx: number, stories: Story[]) => {
    if (idx >= stories.length) {
      isPlayingRef.current = false
      isSpeakingRef.current = false
      setIsPlaying(false)
      setStatus('done')
      setStatusText('Done')
      setDone(true)
      return
    }
    const s = stories[idx]
    speak(`Story ${idx + 1}. ${s.headline}. ${s.summary}`, () => {
      if (isPlayingRef.current && !isPausedRef.current && !isAnsweringRef.current) {
        setTimeout(() => {
          if (isPlayingRef.current && !isPausedRef.current && !isAnsweringRef.current) {
            const next = idx + 1
            currentIdxRef.current = next
            setCurrentIdx(next)
            readStory(next, stories)
          }
        }, 700)
      }
    })
  }, [speak])

  const fetchDigest = useCallback(async (date?: string) => {
    window.speechSynthesis.cancel()
    isPlayingRef.current = false
    isPausedRef.current = false
    isAnsweringRef.current = false

    setStatus('loading')
    setStatusText(date && date !== 'today' ? 'Loading archive' : 'Fetching news')
    setDone(false)
    setStories([])
    setStoryQA({})
    setCurrentIdx(0)
    setModalIdx(null)
    currentIdxRef.current = 0

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
      isPlayingRef.current = false
      isPausedRef.current = false
      setIsPlaying(false)
      setCurrentIdx(0)
      currentIdxRef.current = 0
      setStatus('paused')
      setStatusText('Ready')

      fetchDates()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Connection failed')
      setStatus('error')
      setStatusText('Error')
    }
  }, [readStory])

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
    fetchDigest(date)
  }

  const togglePlay = () => {
    if (!stories.length) return
    if (isSpeakingRef.current && !isPausedRef.current) {
      window.speechSynthesis.pause()
      isPausedRef.current = true
      setIsPlaying(false)
      setStatus('paused')
      setStatusText('Paused')
    } else if (isPausedRef.current) {
      window.speechSynthesis.resume()
      isPausedRef.current = false
      isPlayingRef.current = true
      setIsPlaying(true)
      setStatus('playing')
      setStatusText('Playing')
    } else {
      isPlayingRef.current = true
      isPausedRef.current = false
      setIsPlaying(true)
      setStatus('playing')
      setStatusText('Playing')
      readStory(currentIdxRef.current, stories)
    }
  }

  const goStory = (dir: number) => {
    const idx = Math.max(0, Math.min(stories.length - 1, currentIdxRef.current + dir))
    window.speechSynthesis.cancel()
    isAnsweringRef.current = false
    isPausedRef.current = false
    isPlayingRef.current = true
    currentIdxRef.current = idx
    setCurrentIdx(idx)
    setModalIdx(idx)
    setIsPlaying(true)
    setStatus('playing')
    setStatusText('Playing')
    readStory(idx, stories)
  }

  const openStory = (idx: number) => {
    setModalIdx(idx)
    setCurrentIdx(idx)
    currentIdxRef.current = idx
  }

  const closeModal = () => {
    setModalIdx(null)
  }

  const playFromModal = () => {
    window.speechSynthesis.cancel()
    isAnsweringRef.current = false
    isPausedRef.current = false
    isPlayingRef.current = true
    setIsPlaying(true)
    setStatus('playing')
    setStatusText('Playing')
    readStory(modalIdx!, stories)
  }

  const askQuestion = async () => {
    const q = question.trim()
    if (!q || asking) return
    const idx = modalIdx !== null ? modalIdx : currentIdxRef.current
    setQuestion('')
    setAsking(true)
    window.speechSynthesis.cancel()
    isSpeakingRef.current = false
    isAnsweringRef.current = true
    setStatus('answering')
    setStatusText('Answering')

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

      speak(full, () => {
        isAnsweringRef.current = false
        setAsking(false)
        if (isPlayingRef.current) {
          setStatus('playing'); setStatusText('Playing')
          readStory(currentIdxRef.current, stories)
        } else {
          setStatus('paused'); setStatusText('Paused')
        }
      })
    } catch {
      setStreamingAnswer(null)
      setStoryQA(prev => ({ ...prev, [idx]: [...(prev[idx] || []), { q, a: 'Something went wrong. Try again.' }] }))
      isAnsweringRef.current = false
      setAsking(false)
      setStatus('paused'); setStatusText('Paused')
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      if (e.code === 'ArrowRight') goStory(1)
      if (e.code === 'ArrowLeft') goStory(-1)
      if (e.code === 'Escape') closeModal()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [stories, modalIdx]) // eslint-disable-line

  const isPulse = ['loading', 'playing', 'answering'].includes(status)
  const displayDate = selectedDate === 'today' ? (todayLabel || 'Today') : selectedDate
  const dateIdx = selectedDate === 'today' ? 0 : availableDates.indexOf(selectedDate)
  const hasPrev = dateIdx < availableDates.length - 1
  const hasNext = dateIdx > 0

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
          <button
            className="date-nav-btn"
            onClick={() => handleDateChange(availableDates[dateIdx + 1])}
            disabled={!hasPrev || availableDates.length <= 1}
          >
            &#9664;
          </button>
          <span className="date-nav-label">{displayDate.toUpperCase()}</span>
          <button
            className="date-nav-btn"
            onClick={() => handleDateChange(dateIdx === 0 ? availableDates[1] : availableDates[dateIdx - 1])}
            disabled={!hasNext || availableDates.length <= 1}
          >
            &#9654;
          </button>
        </div>
        <div className="header-right">
          <div className={`status-badge ${status}`}>
            <div className={`dot${isPulse ? ' pulse' : ''}`} />
            <span>{statusText}</span>
          </div>
        </div>
      </header>

      {status === 'loading' && (
        <div className="loading-screen">
          <div className="load-animation">
            {[...Array(7)].map((_, i) => <div key={i} className="load-bar" />)}
          </div>
          <div className="load-label">
            {selectedDate && selectedDate !== 'today' ? 'Loading archive…' : 'Scanning AI news…'}
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="error-screen">
          <div className="error-title">Failed to Load</div>
          <div className="error-msg">{errorMsg}</div>
          <button className="btn-retry" onClick={() => fetchDigest(selectedDate)}>Try Again</button>
        </div>
      )}

      {stories.length > 0 && (
        <>
          {/* Playback strip */}
          <div className="playback-strip">
            <button className="btn-skip-sm" onClick={() => goStory(-1)}>&#9664;</button>
            <button className="btn-play-sm" onClick={togglePlay}>{isPlaying ? '⏸' : '▶'}</button>
            <button className="btn-skip-sm" onClick={() => goStory(1)}>&#9654;</button>
            <div className="strip-title">{stories[currentIdx]?.headline ?? '—'}</div>
            {done && <span className="strip-done">Done</span>}
          </div>

          {/* Story grid */}
          <div className="story-grid">
            {stories.map((s, i) => {
              const isActive = i === currentIdx && isPlaying
              return (
                <div
                  key={i}
                  className={`card${isActive ? ' card-active' : ''}`}
                  onClick={() => openStory(i)}
                >
                  <div className="card-top">
                    <span className="card-tag">{s.tag}</span>
                    <span className="card-num">{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <div className="card-headline">{s.headline}</div>
                  <div className="card-summary">{s.summary}</div>
                  {isActive && (
                    <div className="card-wave">
                      <div className="wave-bar" /><div className="wave-bar" /><div className="wave-bar" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Modal */}
      {activeModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-meta">
                <span className="card-tag">{activeModal.tag}</span>
                <span className="modal-num">{String(modalIdx! + 1).padStart(2, '0')} / {stories.length}</span>
              </div>
              <button className="modal-close" onClick={closeModal}>&#10005;</button>
            </div>

            <div className="modal-headline">{activeModal.headline}</div>
            <div className="modal-summary">{activeModal.summary}</div>

            <div className="modal-play-row">
              <button className="btn-skip-sm" onClick={() => goStory(-1)}>&#9664;</button>
              <button className="btn-play-md" onClick={modalIdx === currentIdx && isPlaying ? togglePlay : playFromModal}>
                {modalIdx === currentIdx && isPlaying ? '⏸' : '▶'}
              </button>
              <button className="btn-skip-sm" onClick={() => goStory(1)}>&#9654;</button>
            </div>

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
