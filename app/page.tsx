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

  const isSpeakingRef = useRef(false)
  const isPlayingRef = useRef(false)
  const isPausedRef = useRef(false)
  const isAnsweringRef = useRef(false)
  const currentIdxRef = useRef(0)
  const storyRefs = useRef<(HTMLDivElement | null)[]>([])

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  }).toUpperCase()

  // Keep refs in sync
  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])
  useEffect(() => { currentIdxRef.current = currentIdx }, [currentIdx])

  const speak = useCallback((text: string, onEnd: () => void) => {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = RATE; u.pitch = 1.0; u.volume = 1.0
    const voices = window.speechSynthesis.getVoices()
    const v = voices.find(v =>
      v.name.includes('Samantha') ||
      v.name.includes('Google US English') ||
      (v.lang === 'en-US' && v.localService)
    )
    if (v) u.voice = v
    u.onend = () => { isSpeakingRef.current = false; onEnd() }
    u.onerror = () => { isSpeakingRef.current = false; onEnd() }
    isSpeakingRef.current = true
    window.speechSynthesis.speak(u)
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
            const next = currentIdxRef.current + 1
            currentIdxRef.current = next
            setCurrentIdx(next)
            readStory(next, stories)
          }
        }, 700)
      }
    })
  }, [speak])

  const fetchDigest = useCallback(async () => {
    setStatus('loading')
    setStatusText('Fetching news')
    setDone(false)
    setStories([])
    setStoryQA({})
    setCurrentIdx(0)
    currentIdxRef.current = 0

    try {
      const res = await fetch('/api/digest', {
        method: 'POST',
        headers: { 'x-digest-secret': SECRET }
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const text = await res.text()
      const parsed = JSON.parse(text)
      // Backend may return { error, raw } if parsing failed
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error) {
        throw new Error(parsed.error + (parsed.raw ? ': ' + parsed.raw : ''))
      }
      const stories: Story[] = parsed
      if (!Array.isArray(stories) || !stories.length) throw new Error('No stories returned')

      setStories(stories)
      storyRefs.current = new Array(parsed.length).fill(null)
      isPlayingRef.current = true
      isPausedRef.current = false
      setIsPlaying(true)
      setCurrentIdx(0)
      currentIdxRef.current = 0
      setStatus('playing')
      setStatusText('Playing')
      readStory(0, parsed)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Connection failed')
      setStatus('error')
      setStatusText('Error')
    }
  }, [readStory])

  useEffect(() => { fetchDigest() }, [fetchDigest])

  // Scroll active story into view
  useEffect(() => {
    storyRefs.current[currentIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [currentIdx])

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
    setIsPlaying(true)
    setStatus('playing')
    setStatusText('Playing')
    readStory(idx, stories)
  }

  const jumpToStory = (idx: number) => {
    window.speechSynthesis.cancel()
    isAnsweringRef.current = false
    isPausedRef.current = false
    isPlayingRef.current = true
    currentIdxRef.current = idx
    setCurrentIdx(idx)
    setIsPlaying(true)
    setStatus('playing')
    setStatusText('Playing')
    readStory(idx, stories)
  }

  const askQuestion = async () => {
    const q = question.trim()
    if (!q || asking) return
    setQuestion('')
    setAsking(true)
    window.speechSynthesis.cancel()
    isSpeakingRef.current = false
    isAnsweringRef.current = true
    setStatus('answering')
    setStatusText('Answering')

    const idx = currentIdxRef.current
    const story = stories[idx]
    const priorQA = storyQA[idx] || []

    setStreamingAnswer({ idx, text: '' })

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-digest-secret': SECRET
        },
        body: JSON.stringify({ question: q, headline: story.headline, summary: story.summary, priorQA })
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let full = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        full += chunk
        setStreamingAnswer({ idx, text: full })
      }

      setStreamingAnswer(null)
      setStoryQA(prev => ({
        ...prev,
        [idx]: [...(prev[idx] || []), { q, a: full }]
      }))

      speak(full, () => {
        isAnsweringRef.current = false
        setAsking(false)
        if (isPlayingRef.current) {
          setStatus('playing')
          setStatusText('Playing')
          readStory(currentIdxRef.current, stories)
        } else {
          setStatus('paused')
          setStatusText('Paused')
        }
      })
    } catch (e) {
      setStreamingAnswer(null)
      setStoryQA(prev => ({
        ...prev,
        [idx]: [...(prev[idx] || []), { q, a: 'Something went wrong. Try again.' }]
      }))
      isAnsweringRef.current = false
      setAsking(false)
      setStatus('paused')
      setStatusText('Paused')
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      if (e.code === 'ArrowRight') goStory(1)
      if (e.code === 'ArrowLeft') goStory(-1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [stories]) // eslint-disable-line

  const isPulse = ['loading', 'playing', 'answering'].includes(status)

  return (
    <div className="app">
      <header>
        <div className="masthead">
          <h1>AI <span>DIGEST</span></h1>
          <div className="subline">{dateStr}</div>
        </div>
        <div className="header-right">
          <div className={`status-badge ${status}`}>
            <div className={`dot${isPulse ? ' pulse' : ''}`} />
            <span>{statusText}</span>
          </div>
          {stories.length > 0 && (
            <div className="story-count">{stories.length} stories today</div>
          )}
        </div>
      </header>

      {status === 'loading' && (
        <div className="loading-screen">
          <div className="load-animation">
            {[...Array(7)].map((_, i) => <div key={i} className="load-bar" />)}
          </div>
          <div className="load-label">Scanning AI news…</div>
        </div>
      )}

      {status === 'error' && (
        <div className="error-screen">
          <div className="error-title">Failed to Load</div>
          <div className="error-msg">{errorMsg}</div>
          <button className="btn-retry" onClick={fetchDigest}>Try Again</button>
        </div>
      )}

      {stories.length > 0 && (
        <>
          <div>
            {stories.map((s, i) => {
              const isActive = i === currentIdx
              const qa = storyQA[i] || []
              const streaming = streamingAnswer?.idx === i ? streamingAnswer.text : null

              return (
                <div
                  key={i}
                  ref={el => { storyRefs.current[i] = el }}
                  className={`story-item${isActive ? ' active' : ''}`}
                  onClick={() => jumpToStory(i)}
                >
                  <div className="story-meta">
                    <span className="story-num">{String(i + 1).padStart(2, '0')}</span>
                    <span className="story-tag">{s.tag}</span>
                    <div className="story-playing-indicator">
                      <div className="wave-bar" /><div className="wave-bar" /><div className="wave-bar" />
                    </div>
                  </div>
                  <div className="story-headline">{s.headline}</div>
                  {isActive && <div className="story-summary">{s.summary}</div>}
                  {isActive && (qa.length > 0 || streaming !== null) && (
                    <div className="qa-thread">
                      {qa.map((item, j) => (
                        <div key={j} className="qa-item">
                          <div className="qa-q">{item.q}</div>
                          <div className="qa-a">{item.a}</div>
                        </div>
                      ))}
                      {streaming !== null && (
                        <div className="qa-item">
                          <div className="qa-q">{question || '…'}</div>
                          <div className="qa-a streaming">{streaming || '…'}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {done && (
            <div className="done-card">
              <div className="done-label">That&apos;s the digest.</div>
              <div className="done-sub">Tap any story or ask a question below</div>
            </div>
          )}

          <div className="playback-bar">
            <div className="playback-inner">
              <div className="playback-controls">
                <div className="now-playing">
                  <div className="np-label">Now Playing</div>
                  <div className="np-title">{stories[currentIdx]?.headline ?? '—'}</div>
                </div>
                <button className="btn-skip" onClick={() => goStory(-1)}>&#9664;</button>
                <button className="btn-play" onClick={togglePlay}>{isPlaying ? '⏸' : '▶'}</button>
                <button className="btn-skip" onClick={() => goStory(1)}>&#9654;</button>
              </div>
              <div className="question-row">
                <input
                  type="text"
                  className="q-input"
                  placeholder="Ask about this story…"
                  maxLength={300}
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') askQuestion() }}
                />
                <button className="btn-ask" onClick={askQuestion} disabled={asking}>Ask</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
