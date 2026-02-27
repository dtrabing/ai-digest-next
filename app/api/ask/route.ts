import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-digest-secret')
  if (secret !== process.env.DIGEST_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { question, headline, summary, priorQA } = await req.json()

  const prev = (priorQA as { q: string; a: string }[] || [])
    .map(p => `Q: ${p.q}\nA: ${p.a}`)
    .join('\n\n')

  const context = `Story: "${headline}"\n${summary}${prev ? '\n\nPrior Q&A:\n' + prev : ''}`

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await client.messages.stream({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 400,
          system: 'Answer follow-up questions about a news story. Be concise (2-4 sentences), conversational, direct. No markdown, no bullets — this will be read aloud.',
          messages: [{ role: 'user', content: `${context}\n\nQuestion: ${question}` }]
        })

        for await (const chunk of response) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text))
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        controller.enqueue(encoder.encode(msg))
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
