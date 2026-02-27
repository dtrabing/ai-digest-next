import { NextRequest } from 'next/server'
import { getDigestsCollection } from '@/lib/db'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-digest-secret')
  if (secret !== process.env.DIGEST_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const collection = await getDigestsCollection()
  const docs = await collection
    .find({}, { projection: { date: 1, createdAt: 1, _id: 0 } })
    .sort({ createdAt: -1 })
    .toArray()

  const dates = docs.map(d => d.date as string)
  return new Response(JSON.stringify(dates), {
    headers: { 'Content-Type': 'application/json' }
  })
}
