import Parser from 'rss-parser'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

interface Article {
  id: string
  title: string
  summary: string
  url: string
  source: string
  publishedAt: string
  scrapedAt: string
  topics: string[]
}

const TOPICS_KEYWORDS: Record<string, string[]> = {
  'PhD Life': ['phd', 'doctoral', 'dissertation', 'graduate student', 'grad school', 'thesis'],
  'PostDoc Life': ['postdoc', 'post-doc', 'postdoctoral', 'early-career researcher', 'junior faculty'],
  'Academic Life': [
    'academia', 'academic', 'professor', 'faculty', 'tenure', 'university', 'higher education',
    'peer review', 'publish', 'journal', 'research funding', 'grant', 'sabbatical',
    'teaching', 'lecture', 'campus', 'scholarly', 'scientist', 'researcher',
  ],
  'Academic Careers': [
    'academic career', 'job market', 'hiring', 'recruitment', 'career path', 'industry',
    'leaving academia', 'alt-ac', 'academic job',
  ],
  'Mental Health & Wellbeing': [
    'burnout', 'mental health', 'wellbeing', 'work-life balance', 'stress', 'imposter syndrome',
    'anxiety', 'depression', 'isolation',
  ],
  'Research Culture': [
    'open access', 'open science', 'reproducibility', 'replication', 'preprint',
    'research integrity', 'misconduct', 'retraction', 'dei', 'diversity', 'equity', 'inclusion',
  ],
  'AI & Tech in Academia': [
    'artificial intelligence', 'ai', 'chatgpt', 'llm', 'machine learning', 'automation',
    'technology', 'digital', 'online learning', 'edtech',
  ],
  'Science Policy': [
    'funding cut', 'policy', 'government', 'nsf', 'nih', 'erc', 'horizon europe',
    'research policy', 'science policy', 'budget',
  ],
}

function matchTopics(text: string): string[] {
  const lower = text.toLowerCase()
  const matched: string[] = []
  for (const [topic, keywords] of Object.entries(TOPICS_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matched.push(topic)
    }
  }
  return matched
}

function makeId(url: string): string {
  return createHash('md5').update(url).digest('hex').slice(0, 12)
}

function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

const FEEDS = [
  // Nature
  { url: 'https://www.nature.com/nature.rss', source: 'Nature' },
  { url: 'https://www.nature.com/nathumbehav.rss', source: 'Nature Human Behaviour' },
  { url: 'https://www.nature.com/news.rss', source: 'Nature News' },
  // Science
  { url: 'https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science', source: 'Science' },
  { url: 'https://www.science.org/blogs/pipeline/feed', source: 'Science - Pipeline' },
  // arXiv (cs.AI and cs.CY for societal/academic topics)
  { url: 'https://rss.arxiv.org/rss/cs.DL', source: 'arXiv - Digital Libraries' },
  // Times Higher Education
  { url: 'https://www.timeshighereducation.com/rss.xml', source: 'Times Higher Education' },
  // The Conversation - Education
  { url: 'https://theconversation.com/articles.atom', source: 'The Conversation' },
  // Inside Higher Ed
  { url: 'https://www.insidehighered.com/rss.xml', source: 'Inside Higher Ed' },
  // Retraction Watch
  { url: 'https://retractionwatch.com/feed/', source: 'Retraction Watch' },
  // Stanford HAI
  { url: 'https://hai.stanford.edu/news/feed', source: 'Stanford HAI' },
  // MIT News - Research
  { url: 'https://news.mit.edu/topic/mitresearch-rss.xml', source: 'MIT News' },
]

async function scrapeFeed(
  feedConfig: { url: string; source: string },
  parser: Parser,
): Promise<Article[]> {
  try {
    const feed = await parser.parseURL(feedConfig.url)
    const now = new Date()
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)

    const articles: Article[] = []

    for (const item of feed.items || []) {
      if (!item.title || !item.link) continue

      const pubDate = item.pubDate ? new Date(item.pubDate) : now
      if (pubDate < fiveDaysAgo) continue

      const text = `${item.title} ${item.contentSnippet || item.content || item.summary || ''}`
      const topics = matchTopics(text)

      // Only include articles that match at least one topic
      if (topics.length === 0) continue

      const summary = cleanHtml(
        item.contentSnippet || item.content || item.summary || 'No summary available',
      ).slice(0, 500)

      articles.push({
        id: makeId(item.link),
        title: cleanHtml(item.title),
        summary,
        url: item.link,
        source: feedConfig.source,
        publishedAt: pubDate.toISOString(),
        scrapedAt: now.toISOString(),
        topics,
      })
    }

    console.log(`  ${feedConfig.source}: ${articles.length} relevant articles`)
    return articles
  } catch (err) {
    console.error(`  ${feedConfig.source}: FAILED - ${(err as Error).message}`)
    return []
  }
}

async function main() {
  console.log('Scraping academic feeds...\n')

  const parser = new Parser({
    timeout: 15000,
    headers: {
      'User-Agent': 'AcademicFeed/1.0 (personal research tool)',
    },
  })

  const results = await Promise.allSettled(
    FEEDS.map((feed) => scrapeFeed(feed, parser)),
  )

  const allArticles = results.flatMap((r) =>
    r.status === 'fulfilled' ? r.value : [],
  )

  // Deduplicate by ID
  const seen = new Set<string>()
  const unique = allArticles.filter((a) => {
    if (seen.has(a.id)) return false
    seen.add(a.id)
    return true
  })

  // Sort by publish date (newest first)
  unique.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  )

  // Load existing articles to preserve history
  const outPath = join(process.cwd(), 'public', 'articles.json')
  let existing: Article[] = []
  if (existsSync(outPath)) {
    try {
      existing = JSON.parse(readFileSync(outPath, 'utf-8'))
    } catch {
      // ignore
    }
  }

  // Merge: new articles take priority, keep old ones up to 14 days
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const existingById = new Map(existing.map((a) => [a.id, a]))
  for (const article of unique) {
    existingById.set(article.id, article)
  }
  const merged = Array.from(existingById.values())
    .filter((a) => new Date(a.publishedAt) >= twoWeeksAgo)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())

  writeFileSync(outPath, JSON.stringify(merged, null, 2))
  console.log(`\nDone! ${unique.length} new articles, ${merged.length} total in feed.`)
}

main()
