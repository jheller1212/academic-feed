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

// Topics tuned for Jonas's LinkedIn audience:
// - Academic life, PhD/postdoc experience, career navigation
// - AI/tech preprints and their impact on academia
// - Peer-reviewed research in marketing, management, consumer science, psychology
// - LinkedIn-worthy insights about research culture
const TOPICS_KEYWORDS: Record<string, { keywords: string[]; weight: number }> = {
  'PhD & PostDoc Life': {
    keywords: [
      'phd', 'doctoral', 'dissertation', 'graduate student', 'grad school', 'thesis',
      'phd student', 'phd candidate', 'postdoc', 'post-doc', 'postdoctoral',
      'early-career researcher', 'junior faculty', 'early career', 'doctoral student',
      'doctoral training', 'phd life', 'supervisor', 'supervision',
    ],
    weight: 5,
  },
  'Academic Careers': {
    keywords: [
      'academic career', 'job market', 'tenure', 'tenure track', 'faculty',
      'leaving academia', 'alt-ac', 'academic job', 'career column', 'career advice',
      'career development', 'career transition', 'career fulfilment', 'working scientist',
      'career in science', 'networking', 'publish or perish', 'adjunct', 'precari',
      'hiring committee', 'academic cv', 'promotion',
    ],
    weight: 5,
  },
  'Academic Culture': {
    keywords: [
      'academia', 'academic life', 'higher education', 'university',
      'peer review', 'research funding', 'grant', 'sabbatical',
      'teaching load', 'scholarly', 'mentoring', 'mentor',
      'open access', 'open science', 'reproducibility', 'replication', 'preprint',
      'research integrity', 'misconduct', 'retraction', 'impact factor',
      'work-life balance', 'burnout', 'imposter syndrome',
    ],
    weight: 3,
  },
  'AI & Tech': {
    keywords: [
      'artificial intelligence', 'chatgpt', 'large language model', 'llm',
      'machine learning', 'generative ai', 'ai tools', 'ai in education',
      'ai in research', 'ai in academia', 'ai plagiarism', 'ai detection',
      'edtech', 'online learning', 'deep learning', 'neural network',
      'automation', 'ai ethics', 'ai bias', 'ai regulation',
    ],
    weight: 4,
  },
  'Marketing & Consumer Science': {
    keywords: [
      'marketing', 'consumer', 'branding', 'advertising', 'persuasion',
      'consumer behavior', 'consumer behaviour', 'consumer psychology',
      'social media', 'linkedin', 'digital marketing', 'influencer',
      'choice architecture', 'nudge', 'behavioral economics', 'behavioural economics',
      'customer', 'brand', 'purchase', 'retail', 'e-commerce',
    ],
    weight: 5,
  },
  'Psychology & Behavior': {
    keywords: [
      'psychology', 'cognitive', 'decision making', 'decision-making',
      'motivation', 'bias', 'heuristic', 'behavioral science', 'behavioural science',
      'social psychology', 'judgment', 'attention', 'perception',
      'emotion', 'well-being', 'wellbeing', 'mental health',
      'personality', 'mindset', 'habit', 'self-control',
    ],
    weight: 4,
  },
  'Management & Organizations': {
    keywords: [
      'management', 'leadership', 'organizational', 'organisational',
      'innovation', 'entrepreneurship', 'startup', 'strategy',
      'teamwork', 'remote work', 'hybrid work', 'workplace',
      'diversity', 'inclusion', 'equity', 'dei',
    ],
    weight: 3,
  },
  'Science Policy': {
    keywords: [
      'funding cut', 'nsf', 'nih', 'erc', 'horizon europe',
      'research policy', 'science policy', 'research budget', 'science funding',
    ],
    weight: 2,
  },
}

// Bonus: things that make articles especially LinkedIn-worthy
const BONUS_KEYWORDS = [
  { pattern: 'linkedin', weight: 5 },
  { pattern: 'viral', weight: 2 },
  { pattern: 'surprising', weight: 1 },
  { pattern: 'counterintuitive', weight: 2 },
  { pattern: 'debunk', weight: 2 },
  { pattern: 'myth', weight: 1 },
  { pattern: 'europe', weight: 1 },
  { pattern: 'netherlands', weight: 3 },
  { pattern: 'dutch', weight: 3 },
  { pattern: 'maastricht', weight: 5 },
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

function generateWhyItMatters(topics: string[], source: string): string {
  if (topics.includes('Marketing & Consumer Science')) {
    return `Peer-reviewed consumer/marketing research — directly in your field. Great LinkedIn material.`
  }
  if (topics.includes('PhD & PostDoc Life')) {
    return `Early-career academic life — resonates strongly with your LinkedIn audience.`
  }
  if (topics.includes('Academic Careers')) {
    return `Academic career navigation — high engagement topic on LinkedIn.`
  }
  if (topics.includes('AI & Tech')) {
    return `AI/tech development with academic implications — trending topic.`
  }
  if (topics.includes('Psychology & Behavior')) {
    return `Behavioral science finding — the kind of insight that performs well on LinkedIn.`
  }
  if (topics.includes('Management & Organizations')) {
    return `Management/org research — relevant to your academic audience.`
  }
  if (topics.includes('Academic Culture')) {
    return `Research culture and how academia works — always gets engagement.`
  }
  if (topics.includes('Science Policy')) {
    return `Policy shaping funding and careers — affects every academic.`
  }
  return `${topics.join(', ')} — from ${source}.`
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
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const articles: Article[] = []

    for (const item of feed.items || []) {
      if (!item.title || !item.link) continue

      const pubDate = item.pubDate ? new Date(item.pubDate) : now
      if (pubDate < thirtyDaysAgo) continue

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
        whyItMatters: generateWhyItMatters(topics, feedConfig.source),
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
  const twoWeeksAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
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
