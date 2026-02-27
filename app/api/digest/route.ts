import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'
import { getDigestsCollection } from '@/lib/db'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function getTodayKey() {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function getDateKey(date?: string) {
  if (!date || date === 'today') return getTodayKey()
  return date
}

async function fetchWithRetry(today: string, retries = 3): Promise<Anthropic.Message> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305' as const, name: 'web_search' }],
        system: `You are an AI news curator. Today is ${today}.
Search for the top 6-8 most important AI news stories from the last 48 hours. Cover: model releases, research breakthroughs, major company moves, policy/regulation, safety.
Respond ONLY with a valid JSON array, no markdown, no preamble:
[{"headline":"Max 10 word headline","tag":"Model|Research|Policy|Business|Safety|Infrastructure","summary":"2 sentences max. Conversational, no jargon."}]`,
        messages: [{ role: 'user', content: 'Top AI news last 48 hours as JSON array.' }]
      })
    } catch (err: unknown) {
      const isRateLimit = err instanceof Error && err.message.includes('rate_limit')
      if (isRateLimit && attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 10000 * Math.pow(2, attempt)))
        continue
      }
      throw err
    }
  }
  throw new Error('Max retries exceeded')
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

  // Check MongoDB for existing digest for this date
  const existing = await collection.findOne({ date: dateKey })
  if (existing) {
    return new Response(JSON.stringify(existing.stories), {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
    })
  }

  // Only fetch fresh data for today — don't fabricate past dates
  const today = getDateKey()
  if (dateKey !== today) {
    return new Response(JSON.stringify({ error: `No digest found for ${dateKey}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await fetchWithRetry(today)

        const text = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('')

        const stripped = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '')
        const match = stripped.match(/\[[\s\S]*\]/)
        if (!match) {
          controller.enqueue(encoder.encode(JSON.stringify({ error: 'Could not parse news response', raw: text.slice(0, 500) })))
          return
        }

        const parsed = JSON.parse(match[0])
        if (!Array.isArray(parsed) || parsed.length === 0) {
          controller.enqueue(encoder.encode(JSON.stringify({ error: 'Empty or invalid stories array' })))
          return
        }

        // Persist to MongoDB
        await collection.insertOne({ date: today, stories: parsed, createdAt: new Date() })

        controller.enqueue(encoder.encode(JSON.stringify(parsed)))
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
