# AI Digest

A personal daily AI news digest. Pulls the top AI stories from Hacker News, summarizes them with Claude, and lets you ask follow-up questions on any story.

**Live:** [ai-digest-next.vercel.app](https://ai-digest-next.vercel.app)

![AI Digest screenshot](https://ai-digest-next.vercel.app/apple-touch-icon.png)

## What it does

- Fetches top AI-related stories from the Hacker News API daily, ranked by score
- Summarizes each story into a clean 2-sentence digest using Claude Haiku
- Caches digests in MongoDB so repeat visits are instant
- Date navigation to browse past days (via Algolia's HN search API)
- Click any card to open a modal with the full summary, source link, and a Q&A interface powered by Claude

## Stack

- **Next.js 16** (App Router, TypeScript)
- **Anthropic Claude Haiku** — story summarization and Q&A
- **Hacker News Firebase API** — today's top stories
- **Algolia HN Search API** — historical story lookup by date
- **MongoDB Atlas** — digest caching
- **Vercel** — hosting and deployment

## How it works

1. On page load, the client calls `/api/digest`
2. The API checks MongoDB for a cached digest for today's date
3. If no cache, it fetches the top ~160 stories from HN's `topstories` + `beststories` endpoints, filters for AI-related titles by keyword, and takes the top 8 by score
4. Those 8 stories are sent to Claude Haiku for summarization — Claude writes a punchy headline, assigns a tag (Model/Research/Policy/Business/Safety/Infrastructure), and writes a 2-sentence plain-English summary
5. The result is stored in MongoDB and returned to the client
6. Q&A on individual stories streams responses from Claude via `/api/ask`

## Running locally

```bash
npm install
```

Create `.env.local`:

```
ANTHROPIC_API_KEY=your_key
MONGODB_URI=your_mongodb_connection_string
DIGEST_SECRET=any_secret_string
NEXT_PUBLIC_DIGEST_SECRET=same_secret_string
```

```bash
npm run dev
```
