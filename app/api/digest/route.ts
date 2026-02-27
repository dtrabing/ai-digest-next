import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-digest-secret')
  if (secret !== process.env.DIGEST_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const today = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          tools: [{ type: 'web_search_20250305' as const, name: 'web_search' }],
          system: `You are an AI news curator. Today is ${today}.
Search for the most important AI news from the last 48 hours. Cover: model releases, research breakthroughs, major company moves, policy/regulation, safety, infrastructure. Include ALL stories that are genuinely important — usually 6–12. Skip minor or redundant items.
Respond ONLY with a valid JSON array, no markdown, no preamble, no trailing text:
[{"headline":"Short punchy headline max 12 words","tag":"Model|Research|Policy|Business|Safety|Infrastructure","summary":"2-3 sentences. Conversational tone. Written for audio — no jargon, no bullet points. Explain it like you're telling a smart friend."}]`,
          messages: [{
            role: 'user',
            content: 'Give me the most important AI news from the last 48 hours as a JSON array.'
          }]
        })

        const text = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('')

        const match = text.match(/\[[\s\S]*\]/)
        if (!match) throw new Error('Could not parse news response')

        controller.enqueue(encoder.encode(match[0]))
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
