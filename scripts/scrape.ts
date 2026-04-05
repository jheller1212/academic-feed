import Parser from 'rss-parser'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

interface Article {
  id: string
  title: string
  summary: string
  whyItMatters: string
  relevanceScore: number
  url: string
  source: string
  publishedAt: string
  scrapedAt: string
  topics: string[]
}

// Higher-weight keywords indicate stronger relevance to Jonas's audience
const TOPICS_KEYWORDS: Record<string, { keywords: string[]; weight: number }> = {
  'PhD Life': {
    keywords: ['phd', 'doctoral', 'dissertation', 'graduate student', 'grad school', 'thesis', 'phd student', 'phd candidate'],
    weight: 3,
  },
  'PostDoc Life': {
    keywords: ['postdoc', 'post-doc', 'postdoctoral', 'early-career researcher', 'junior faculty', 'early career'],
    weight: 3,
  },
  'Academic Life': {
    keywords: [
      'academia', 'academic life', 'professor', 'faculty', 'tenure', 'higher education',
      'peer review', 'research funding', 'grant', 'sabbatical', 'university',
      'teaching load', 'campus', 'scholarly', 'scientist', 'researcher',
      'lab', 'career in science', 'career fulfilment', 'working scientist',
      'procrastination', 'productivity', 'collaboration', 'mentoring',
    ],
    weight: 2,
  },
  'Academic Careers': {
    keywords: [
      'academic career', 'job market', 'hiring', 'recruitment', 'career path', 'industry',
      'leaving academia', 'alt-ac', 'academic job', 'career column', 'career advice',
      'career development', 'career transition', 'job search', 'CV', 'resume',
      'interview', 'networking',
    ],
    weight: 3,
  },
  'Mental Health & Wellbeing': {
    keywords: [
      'burnout', 'mental health', 'wellbeing', 'work-life balance', 'stress', 'imposter syndrome',
      'anxiety', 'depression', 'isolation',
    ],
    weight: 2,
  },
  'Research Culture': {
    keywords: [
      'open access', 'open science', 'reproducibility', 'replication', 'preprint',
      'research integrity', 'misconduct', 'retraction', 'dei', 'diversity', 'equity', 'inclusion',
    ],
    weight: 2,
  },
  'AI & Tech in Academia': {
    keywords: [
      'artificial intelligence', 'chatgpt', 'large language model',
      'machine learning', 'online learning', 'edtech', 'ai tools',
      'generative ai', 'ai plagiarism', 'ai detection', 'ai in education',
      'ai in research', 'ai in academia',
    ],
    weight: 2,
  },
  'Science Policy': {
    keywords: [
      'funding cut', 'nsf', 'nih', 'erc', 'horizon europe',
      'research policy', 'science policy', 'research budget', 'science funding',
    ],
    weight: 1,
  },
}

// Bonus keywords that boost relevance (things Jonas's audience cares about)
const BONUS_KEYWORDS = [
  { pattern: 'marketing', weight: 2 },
  { pattern: 'consumer', weight: 1 },
  { pattern: 'social media', weight: 1 },
  { pattern: 'linkedin', weight: 2 },
  { pattern: 'career advice', weight: 2 },
  { pattern: 'work culture', weight: 1 },
  { pattern: 'publish or perish', weight: 3 },
  { pattern: 'impact factor', weight: 2 },
  { pattern: 'adjunct', weight: 2 },
  { pattern: 'precari', weight: 2 },
  { pattern: 'mentor', weight: 2 },
  { pattern: 'supervision', weight: 1 },
  { pattern: 'europe', weight: 1 },
  { pattern: 'netherlands', weight: 2 },
  { pattern: 'dutch', weight: 2 },
]

function stripAuthorBios(text: string): string {
  // Remove common author bio patterns from The Conversation, etc.
  // e.g., "Professor of X at University of Y", "PhD candidate in Z"
  return text
    .replace(/\b(professor|lecturer|researcher|postdoc|post-doc|phd candidate|phd student|doctoral candidate) (of|in|at|for) [^.]+\./gi, '')
    .replace(/\b(assistant|associate|full|emeritus|adjunct) professor\b[^.]*\./gi, '')
    .replace(/\bUniversity of [A-Z][^.]+\./g, '')
}

function matchTopics(title: string, body: string): { topics: string[]; score: number } {
  const lowerTitle = title.toLowerCase()
  const lowerBody = stripAuthorBios(body).toLowerCase()
  const matched: string[] = []
  let score = 0

  for (const [topic, config] of Object.entries(TOPICS_KEYWORDS)) {
    const titleMatches = config.keywords.filter((kw) => lowerTitle.includes(kw)).length
    const bodyMatches = config.keywords.filter((kw) => lowerBody.includes(kw)).length

    // Require a title match OR at least 2 body matches to qualify as a topic
    if (titleMatches > 0 || bodyMatches >= 2) {
      matched.push(topic)
      score += config.weight * (titleMatches * 3 + bodyMatches)
    }
  }

  // Bonus scoring (full text)
  const fullLower = `${lowerTitle} ${lowerBody}`
  for (const bonus of BONUS_KEYWORDS) {
    if (fullLower.includes(bonus.pattern)) {
      score += bonus.weight
    }
  }

  return { topics: matched, score }
}

function generateWhyItMatters(title: string, topics: string[], source: string): string {
  const topicStr = topics.join(', ')

  // Generate contextual "why it matters" based on topics
  if (topics.includes('PhD Life') || topics.includes('PostDoc Life')) {
    return `Directly relevant to early-career academics navigating ${topics.includes('PhD Life') ? 'doctoral' : 'postdoctoral'} life. From ${source}.`
  }
  if (topics.includes('AI & Tech in Academia')) {
    return `AI is reshaping how research is done and taught — this has implications for every academic. From ${source}.`
  }
  if (topics.includes('Science Policy')) {
    return `Policy decisions shape funding, hiring, and what research gets done. This affects academic careers at every level. From ${source}.`
  }
  if (topics.includes('Mental Health & Wellbeing')) {
    return `Academic wellbeing is an institutional issue, not a personal one. This matters for the culture we build. From ${source}.`
  }
  if (topics.includes('Research Culture')) {
    return `How we publish, review, and share research defines academic culture. This challenges the status quo. From ${source}.`
  }
  if (topics.includes('Academic Careers')) {
    return `The academic job market is changing — this has real implications for career strategy. From ${source}.`
  }
  return `Relevant to ${topicStr.toLowerCase()}. From ${source}.`
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
  // arXiv
  { url: 'https://rss.arxiv.org/rss/cs.DL', source: 'arXiv - Digital Libraries' },
  { url: 'https://rss.arxiv.org/rss/cs.CY', source: 'arXiv - Computers & Society' },
  // Times Higher Education
  { url: 'https://www.timeshighereducation.com/rss.xml', source: 'Times Higher Education' },
  // The Conversation
  { url: 'https://theconversation.com/articles.atom', source: 'The Conversation' },
  // Inside Higher Ed
  { url: 'https://www.insidehighered.com/rss.xml', source: 'Inside Higher Ed' },
  // Retraction Watch
  { url: 'https://retractionwatch.com/feed/', source: 'Retraction Watch' },
  // Stanford HAI
  { url: 'https://hai.stanford.edu/news/feed', source: 'Stanford HAI' },
  // MIT News
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

      const body = item.contentSnippet || item.content || item.summary || ''
      const { topics, score } = matchTopics(item.title, body)

      if (topics.length === 0) continue

      const summary = cleanHtml(
        item.contentSnippet || item.content || item.summary || 'No summary available',
      ).slice(0, 500)

      const title = cleanHtml(item.title)

      articles.push({
        id: makeId(item.link),
        title,
        summary,
        whyItMatters: generateWhyItMatters(title, topics, feedConfig.source),
        relevanceScore: score,
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

  // Sort by relevance score (highest first), then by date
  unique.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  })

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
  const existingById = new Map(existing.map((a: Article) => [a.id, a]))
  for (const article of unique) {
    existingById.set(article.id, article)
  }
  const merged = Array.from(existingById.values())
    .filter((a: Article) => new Date(a.publishedAt) >= twoWeeksAgo)
    .sort((a: Article, b: Article) => {
      if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    })

  writeFileSync(outPath, JSON.stringify(merged, null, 2))

  // Show top 10
  console.log('\n--- TOP 10 PICKS ---')
  merged.slice(0, 10).forEach((a: Article, i: number) => {
    console.log(`${i + 1}. [score:${a.relevanceScore}] ${a.title}`)
    console.log(`   ${a.source} · ${a.topics.join(', ')}`)
    console.log(`   → ${a.whyItMatters}`)
    console.log()
  })

  console.log(`Done! ${unique.length} new articles, ${merged.length} total in feed.`)
}

main()
