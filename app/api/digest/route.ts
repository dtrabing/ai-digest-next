import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'
import { getDigestsCollection } from '@/lib/db'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const AI_KEYWORDS = [
  'ai', 'artificial intelligence', 'machine learning', 'deep learning',
  'llm', 'gpt', 'claude', 'gemini', 'openai', 'anthropic', 'deepmind',
  'neural', 'chatgpt', 'mistral', 'llama', 'diffusion', 'transformer',
  'copilot', 'midjourney', 'stable diffusion', 'hugging face', 'nvidia',
  'agi', 'alignment', 'reinforcement learning', 'fine-tun', 'inference',
  'foundation model', 'multimodal', 'robotics', 'autonomous'
]

function isAIRelated(title: string): boolean {
  const lower = title.toLowerCase()
  return AI_KEYWORDS.some(kw => lower.includes(kw))
}

function getTodayKey() {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function getDateKey(date?: string) {
  if (!date || date === 'today') return getTodayKey()
  return date
}

interface HNStory {
  title: string
  url?: string
  score: number
  objectID?: string
  text?: string
}

// Fetch today's top AI stories from HN top/best lists
async function fetchTodayFromHN(): Promise<HNStory[]> {
  const [topRes, bestRes] = await Promise.all([
    fetch('https://hacker-news.firebaseio.com/v0/topstories.json'),
    fetch('https://hacker-news.firebaseio.com/v0/beststories.json')
  ])
  const [topIds, bestIds]: number[][] = await Promise.all([topRes.json(), bestRes.json()])

  // Deduplicate and take top 80 from each list
  const ids = [...new Set([...topIds.slice(0, 80), ...bestIds.slice(0, 80)])]

  const stories = await Promise.all(
    ids.map(id =>
      fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
        .then(r => r.json())
        .catch(() => null)
    )
  )

  return stories
    .filter(s => s && s.title && s.score > 50 && isAIRelated(s.title))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(s => ({ title: s.title, url: s.url, score: s.score, text: s.text }))
}

// Fetch past date stories from Algolia HN search API
async function fetchPastFromAlgolia(dateKey: string): Promise<HNStory[]> {
  // Parse dateKey like "February 25, 2026" into a date range
  const d = new Date(dateKey + ' 12:00:00')
  const start = Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0).getTime() / 1000)
  const end = Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime() / 1000)

  // Search for AI-related stories on that date
  const queries = ['AI', 'artificial intelligence', 'LLM', 'OpenAI', 'machine learning']
  const results = await Promise.all(
    queries.map(q =>
      fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${start},created_at_i<${end},points>10&hitsPerPage=20`
      )
        .then(r => r.json())
        .catch(() => ({ hits: [] }))
    )
  )

  const seen = new Set<string>()
  const stories: HNStory[] = []

  for (const result of results) {
    for (const hit of result.hits || []) {
      if (!hit.title || seen.has(hit.objectID)) continue
      if (!isAIRelated(hit.title)) continue
      seen.add(hit.objectID)
      stories.push({
        title: hit.title,
        url: hit.url,
        score: hit.points || 0,
        objectID: hit.objectID,
        text: hit.story_text
      })
    }
  }

  return stories.sort((a, b) => b.score - a.score).slice(0, 12)
}

// Use Claude to write clean summaries — one entry per story, in the same order as input
// URLs are attached from the original HNStory array by position, not by Claude
async function summarizeStories(stories: HNStory[], dateKey: string): Promise<{ headline: string; tag: string; summary: string; url?: string }[]> {
  // Take top 8 by score — Claude summarizes all of them in order, no selection needed
  const top = stories.slice(0, 8)

  const storiesList = top
    .map((s, i) => `${i + 1}. ${s.title}${s.text ? `\n   Context: ${s.text.slice(0, 200)}` : ''}`)
    .join('\n\n')

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2000,
    system: `You are an AI news curator. Summarize each of the following Hacker News AI stories from ${dateKey}.
Write one entry per story, in the SAME ORDER as the input. Do not skip, reorder, or add stories.
Respond ONLY with a raw JSON array, no markdown fences, no preamble, no citations:
[{"headline":"Max 10 word punchy headline","tag":"Model|Research|Policy|Business|Safety|Infrastructure","summary":"2 sentences max. Plain English, no jargon, no source citations."}]`,
    messages: [{
      role: 'user',
      content: `Summarize these ${top.length} AI stories in order:\n\n${storiesList}`
    }]
  })

  const text = msg.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')

  const stripped = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '')
  const match = stripped.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('Could not parse summary response')

  const parsed = JSON.parse(match[0])
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Empty summary array')

  // Attach URLs by position — Claude preserves order, so index is reliable
  return parsed.map((item: { headline: string; tag: string; summary: string }, idx: number) => ({
    headline: item.headline,
    tag: item.tag,
    // Strip any <cite ...> tags Claude might still emit
    summary: item.summary.replace(/<cite[^>]*>.*?<\/cite>/g, '').replace(/<[^>]+>/g, '').trim(),
    url: top[idx]?.url ?? undefined
  }))
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-digest-secret')
  if (secret !== process.env.DIGEST_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const dateKey = getDateKey(body.date)

  let collection
  try {
    collection = await getDigestsCollection()
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : 'DB connection failed'
    return new Response(JSON.stringify({ error: `Database error: ${msg}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Check MongoDB cache
  const existing = await collection.findOne({ date: dateKey })
  if (existing) {
    return new Response(JSON.stringify(existing.stories), {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
    })
  }

  const today = getDateKey()
  const isToday = dateKey === today

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Step 1: Fetch from HN
        const hnStories = isToday
          ? await fetchTodayFromHN()
          : await fetchPastFromAlgolia(dateKey)

        if (hnStories.length === 0) {
          controller.enqueue(encoder.encode(JSON.stringify({ error: 'No AI stories found on HN for this date' })))
          return
        }

        // Step 2: Summarize with Claude
        const summarized = await summarizeStories(hnStories, dateKey)

        // Step 3: Persist to MongoDB
        await collection.insertOne({ date: dateKey, stories: summarized, createdAt: new Date() })

        controller.enqueue(encoder.encode(JSON.stringify(summarized)))
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        controller.enqueue(encoder.encode(JSON.stringify({ error: msg })))
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/json' }
  })
}
