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

interface SourceMeta {
  source: string
  lastSuccess: string | null
  lastError: string | null
  articleCount: number
}

// ---------------------------------------------------------------------------
// Topic keywords – tuned for Jonas's LinkedIn audience
// ---------------------------------------------------------------------------
const TOPICS_KEYWORDS: Record<string, { keywords: string[]; weight: number }> = {
  'PhD & PostDoc Life': {
    keywords: [
      'phd', 'doctoral', 'dissertation', 'graduate student', 'grad school', 'thesis',
      'phd student', 'phd candidate', 'postdoc', 'post-doc', 'postdoctoral',
      'early-career researcher', 'junior faculty', 'early career', 'doctoral student',
      'doctoral training', 'phd life', 'supervisor', 'supervision', 'mentoring', 'mentor',
    ],
    weight: 5,
  },
  'Academic Careers': {
    keywords: [
      'academic career', 'job market', 'tenure', 'tenure track', 'faculty',
      'leaving academia', 'alt-ac', 'academic job', 'career column', 'career advice',
      'career development', 'career transition', 'career fulfilment', 'working scientist',
      'career in science', 'publish or perish', 'adjunct', 'precari',
      'hiring committee', 'academic cv', 'promotion', 'scientific career',
    ],
    weight: 5,
  },
  'Research Culture': {
    keywords: [
      'academia', 'academic life', 'higher education', 'university',
      'peer review', 'research funding', 'grant', 'sabbatical',
      'teaching load', 'scholarly', 'open access', 'open science',
      'reproducibility', 'replication', 'preprint', 'research integrity',
      'misconduct', 'retraction', 'impact factor', 'research assessment',
      'work-life balance', 'burnout', 'imposter syndrome', 'academic identity',
      'research workflow', 'scientific workflow', 'research practice',
      'publishing', 'scholarly communication',
    ],
    weight: 4,
  },
  'AI & Emerging Tech': {
    keywords: [
      'artificial intelligence', 'chatgpt', 'large language model', 'llm',
      'machine learning', 'generative ai', 'ai tools', 'ai in education',
      'ai in research', 'ai in academia', 'ai plagiarism', 'ai detection',
      'deep learning', 'neural network', 'ai ethics', 'ai bias', 'ai regulation',
      'augmented reality', 'virtual reality', 'mixed reality', 'extended reality',
      'brain-computer interface', 'bci',
      'human-computer interaction', 'hci',
    ],
    weight: 4,
  },
  'Higher Education': {
    keywords: [
      'higher education', 'university policy', 'college', 'campus',
      'tuition', 'enrollment', 'enrolment', 'student experience',
      'online learning', 'edtech', 'curriculum', 'pedagogy',
      'academic freedom', 'dei', 'diversity', 'inclusion',
    ],
    weight: 3,
  },
  'Human Behaviour & Cognition': {
    keywords: [
      'psychology', 'cognitive', 'decision making', 'decision-making',
      'human behaviour', 'human behavior', 'behavioural science', 'behavioral science',
      'social psychology', 'cognition', 'attention', 'perception',
      'emotion', 'motivation', 'bias', 'heuristic', 'creativity',
      'learning', 'memory', 'nudge', 'choice architecture',
    ],
    weight: 3,
  },
  'Science Policy & Funding': {
    keywords: [
      'funding cut', 'nsf', 'nih', 'erc', 'horizon europe',
      'research policy', 'science policy', 'research budget', 'science funding',
      'research assessment', 'research evaluation', 'dora',
    ],
    weight: 3,
  },
}

// Bonus keywords that boost score
const BONUS_KEYWORDS = [
  { pattern: 'linkedin', weight: 5 },
  { pattern: 'surprising', weight: 1 },
  { pattern: 'counterintuitive', weight: 2 },
  { pattern: 'debunk', weight: 2 },
  { pattern: 'myth', weight: 1 },
  { pattern: 'europe', weight: 1 },
  { pattern: 'netherlands', weight: 3 },
  { pattern: 'dutch', weight: 3 },
  { pattern: 'maastricht', weight: 5 },
  { pattern: 'stanford', weight: 2 },
]

// ---------------------------------------------------------------------------
// Exclusion patterns — reject junk before scoring
// ---------------------------------------------------------------------------
const EXCLUSION_PATTERNS = [
  /\bjob listing\b/i, /\bjob opening\b/i, /\bapply now\b/i, /\bnow hiring\b/i,
  /\bjob alert\b/i, /\bcareer fair\b/i,
  /\bregister now\b/i, /\bsave the date\b/i, /\brsvp\b/i,
  /\btable of contents\b/i, /\bissue highlights\b/i,
  /\bweekly round-?up\b/i,
]

function isExcluded(title: string, body: string): boolean {
  const text = `${title} ${body}`
  return EXCLUSION_PATTERNS.some((p) => p.test(text))
}

// ---------------------------------------------------------------------------
// RSS Feeds — verified working as of 2026-04
// ---------------------------------------------------------------------------

type FeedConfig = {
  url: string
  source: string
  /** If true, only include items mentioning Stanford in author/body */
  stanfordOnly?: boolean
  /** Cap how many items to keep from this feed (for noisy feeds like arXiv) */
  maxItems?: number
}

const FEEDS: FeedConfig[] = [
  // --- Primary: Nature (subject feeds that work) ---
  { url: 'https://www.nature.com/subjects/careers.rss', source: 'Nature Careers' },
  { url: 'https://www.nature.com/subjects/scientific-community.rss', source: 'Nature - Scientific Community' },
  { url: 'https://www.nature.com/subjects/peer-review.rss', source: 'Nature - Peer Review' },
  { url: 'https://www.nature.com/subjects/research-management.rss', source: 'Nature - Research Management' },
  { url: 'https://www.nature.com/subjects/publishing.rss', source: 'Nature - Publishing' },
  { url: 'https://www.nature.com/subjects/machine-learning.rss', source: 'Nature - Machine Learning' },
  { url: 'https://www.nature.com/subjects/human-behaviour.rss', source: 'Nature - Human Behaviour' },
  { url: 'https://www.nature.com/nathumbehav.rss', source: 'Nature Human Behaviour' },
  { url: 'https://www.nature.com/nature.rss', source: 'Nature' },

  // --- Primary: arXiv (Stanford-focused, capped) ---
  { url: 'https://rss.arxiv.org/rss/cs.AI', source: 'arXiv - AI', stanfordOnly: true, maxItems: 15 },
  { url: 'https://rss.arxiv.org/rss/cs.HC', source: 'arXiv - Human-Computer Interaction', maxItems: 15 },
  { url: 'https://rss.arxiv.org/rss/cs.CY', source: 'arXiv - Computers & Society', maxItems: 15 },
  { url: 'https://rss.arxiv.org/rss/cs.DL', source: 'arXiv - Digital Libraries', maxItems: 15 },

  // --- Secondary: Higher Ed publications ---
  { url: 'https://www.insidehighered.com/rss.xml', source: 'Inside Higher Ed' },
  { url: 'https://www.highereddive.com/feeds/news/', source: 'Higher Ed Dive' },

  // --- Secondary: The Conversation (academia-focused) ---
  { url: 'https://theconversation.com/articles.atom', source: 'The Conversation' },

  // --- Secondary: Research institutions ---
  { url: 'https://knowledge.wharton.upenn.edu/feed/', source: 'Knowledge at Wharton' },

  // --- Secondary: Retraction Watch ---
  { url: 'https://retractionwatch.com/feed/', source: 'Retraction Watch' },

  // --- Secondary: Working papers ---
  { url: 'https://www.nber.org/rss/new.xml', source: 'NBER Working Papers' },
]

// Institutions to match for arXiv Stanford-only filter
const INSTITUTION_PATTERNS = [
  /\bstanford\b/i,
  /\bmit\b/i,
  /\bharvard\b/i,
  /\boxford\b/i,
  /\bcambridge\b/i,
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function stripAuthorBios(text: string): string {
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

    if (titleMatches > 0 || bodyMatches >= 2) {
      matched.push(topic)
      score += config.weight * (titleMatches * 3 + bodyMatches)
    }
  }

  const fullLower = `${lowerTitle} ${lowerBody}`
  for (const bonus of BONUS_KEYWORDS) {
    if (fullLower.includes(bonus.pattern)) {
      score += bonus.weight
    }
  }

  return { topics: matched, score }
}

function generateWhyItMatters(topics: string[]): string {
  if (topics.includes('PhD & PostDoc Life'))
    return 'Early-career academic life — resonates strongly with your LinkedIn audience.'
  if (topics.includes('Academic Careers'))
    return 'Academic career navigation — high engagement topic on LinkedIn.'
  if (topics.includes('Research Culture'))
    return 'Research culture and how academia works — always gets engagement.'
  if (topics.includes('AI & Emerging Tech'))
    return 'AI/tech development with academic implications — trending topic.'
  if (topics.includes('Higher Education'))
    return 'Higher education trends — relevant to your academic audience.'
  if (topics.includes('Human Behaviour & Cognition'))
    return 'Behavioural science finding — the kind of insight that performs well on LinkedIn.'
  if (topics.includes('Science Policy & Funding'))
    return 'Policy shaping funding and careers — affects every academic.'
  return `${topics.join(', ')}.`
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

function hasVerifiableDate(item: Parser.Item): boolean {
  if (!item.pubDate && !item.isoDate) return false
  const d = new Date(item.pubDate || item.isoDate || '')
  return !isNaN(d.getTime())
}

function getPublishedDate(item: Parser.Item): Date {
  return new Date(item.pubDate || item.isoDate || '')
}

// ---------------------------------------------------------------------------
// Scrape a single feed
// ---------------------------------------------------------------------------
async function scrapeFeed(
  feedConfig: FeedConfig,
  parser: Parser,
  maxAgeDays: number,
): Promise<Article[]> {
  try {
    const feed = await parser.parseURL(feedConfig.url)
    const now = new Date()
    const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000)

    const articles: Article[] = []

    for (const item of feed.items || []) {
      if (!item.title || !item.link) continue

      // Strict date verification
      if (!hasVerifiableDate(item)) continue
      const pubDate = getPublishedDate(item)
      if (pubDate < cutoff || pubDate > now) continue

      const rawBody = item.contentSnippet || item.content || item.summary || ''
      const title = cleanHtml(item.title)
      const body = cleanHtml(rawBody)

      // Institution filter for noisy arXiv feeds
      if (feedConfig.stanfordOnly) {
        const authorField = item.creator || (item as Record<string, string>)['dc:creator'] || ''
        const searchText = `${authorField} ${rawBody}`
        const matchesInstitution = INSTITUTION_PATTERNS.some((p) => p.test(searchText))
        if (!matchesInstitution) continue
      }

      // Exclusion rules
      if (isExcluded(title, body)) continue

      const { topics, score: baseScore } = matchTopics(title, body)
      if (topics.length === 0) continue

      // Boost Stanford-authored arXiv papers
      const isArxiv = feedConfig.source.startsWith('arXiv')
      let score = baseScore
      if (isArxiv && /stanford/i.test(rawBody)) score += 5

      const summary = body.slice(0, 500)

      articles.push({
        id: makeId(item.link),
        title,
        summary,
        whyItMatters: generateWhyItMatters(topics),
        relevanceScore: score,
        url: item.link,
        source: feedConfig.source,
        publishedAt: pubDate.toISOString(),
        scrapedAt: now.toISOString(),
        topics,
      })
    }

    // Cap noisy feeds
    if (feedConfig.maxItems && articles.length > feedConfig.maxItems) {
      articles.sort((a, b) => b.relevanceScore - a.relevanceScore)
      articles.length = feedConfig.maxItems
    }

    console.log(`  ${feedConfig.source}: ${articles.length} relevant articles`)
    return articles
  } catch (err) {
    console.error(`  ${feedConfig.source}: FAILED - ${(err as Error).message}`)
    return []
  }
}

// ---------------------------------------------------------------------------
// Deduplication — keep the highest-scored version of duplicate stories
// ---------------------------------------------------------------------------
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractKeywords(title: string): Set<string> {
  const stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'it', 'its', 'not', 'no', 'from', 'as', 'how', 'why', 'what', 'which', 'who', 'whom', 'new', 'more', 'than'])
  return new Set(
    normalizeTitle(title)
      .split(' ')
      .filter((w) => w.length > 2 && !stopwords.has(w))
  )
}

function keywordOverlap(a: Set<string>, b: Set<string>): number {
  let overlap = 0
  for (const word of a) {
    if (b.has(word)) overlap++
  }
  const smaller = Math.min(a.size, b.size)
  return smaller > 0 ? overlap / smaller : 0
}

function deduplicateByContent(articles: Article[]): Article[] {
  // Sort by score descending so we keep the highest-scored version
  const sorted = [...articles].sort((a, b) => b.relevanceScore - a.relevanceScore)
  const kept: Article[] = []
  const keptKeywords: Set<string>[] = []

  for (const article of sorted) {
    const keywords = extractKeywords(article.title)
    // Check if this article is a duplicate of any already-kept article
    const isDuplicate = keptKeywords.some((existing) => keywordOverlap(keywords, existing) >= 0.6)
    if (!isDuplicate) {
      kept.push(article)
      keptKeywords.push(keywords)
    }
  }

  return kept
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Source reliability tracking
// ---------------------------------------------------------------------------
function loadSourceMeta(): Record<string, SourceMeta> {
  const metaPath = join(process.cwd(), 'public', 'sources_meta.json')
  if (existsSync(metaPath)) {
    try {
      const data = JSON.parse(readFileSync(metaPath, 'utf-8'))
      const result: Record<string, SourceMeta> = {}
      for (const m of data) result[m.source] = m
      return result
    } catch {
      return {}
    }
  }
  return {}
}

function saveSourceMeta(meta: Record<string, SourceMeta>) {
  const metaPath = join(process.cwd(), 'public', 'sources_meta.json')
  writeFileSync(metaPath, JSON.stringify(Object.values(meta), null, 2))
}

async function main() {
  console.log('Scraping academic feeds...\n')

  const parser = new Parser({
    timeout: 15000,
    headers: {
      'User-Agent': 'AcademicFeed/2.0 (personal research tool)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
  })

  const sourceMeta = loadSourceMeta()

  // Phase 1: scrape with 5-day window
  const PREFERRED_DAYS = 5
  const EXPANDED_DAYS = 7

  let results = await Promise.allSettled(
    FEEDS.map((feed) => scrapeFeed(feed, parser, PREFERRED_DAYS)),
  )

  // Track source reliability
  const now = new Date().toISOString()
  results.forEach((r, i) => {
    const source = FEEDS[i].source
    if (!sourceMeta[source]) {
      sourceMeta[source] = { source, lastSuccess: null, lastError: null, articleCount: 0 }
    }
    if (r.status === 'fulfilled' && r.value.length >= 0) {
      sourceMeta[source].lastSuccess = now
      sourceMeta[source].articleCount = r.value.length
    }
    if (r.status === 'rejected') {
      sourceMeta[source].lastError = now
    }
  })

  let allArticles = results.flatMap((r) =>
    r.status === 'fulfilled' ? r.value : [],
  )

  // Deduplicate by URL
  const seenUrls = new Set<string>()
  allArticles = allArticles.filter((a) => {
    if (seenUrls.has(a.id)) return false
    seenUrls.add(a.id)
    return true
  })

  // Content-level dedup
  allArticles = deduplicateByContent(allArticles)

  // Phase 2: if fewer than 10 strong items, expand to 7 days
  if (allArticles.length < 10) {
    console.log(`\nOnly ${allArticles.length} items in 5-day window — expanding to 7 days...\n`)

    results = await Promise.allSettled(
      FEEDS.map((feed) => scrapeFeed(feed, parser, EXPANDED_DAYS)),
    )

    const expandedArticles = results.flatMap((r) =>
      r.status === 'fulfilled' ? r.value : [],
    )

    for (const a of expandedArticles) {
      if (!seenUrls.has(a.id)) {
        seenUrls.add(a.id)
        allArticles.push(a)
      }
    }

    allArticles = deduplicateByContent(allArticles)
  }

  // Sort by relevance then date
  allArticles.sort((a, b) => {
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

  // Merge: new articles take priority, keep old ones up to 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const existingById = new Map(existing.map((a: Article) => [a.id, a]))
  for (const article of allArticles) {
    existingById.set(article.id, article)
  }
  const merged = Array.from(existingById.values())
    .filter((a: Article) => new Date(a.publishedAt) >= sevenDaysAgo)
    .sort((a: Article, b: Article) => {
      if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    })

  writeFileSync(outPath, JSON.stringify(merged, null, 2))

  // Show top 10
  const top = merged.slice(0, 10)
  if (top.length === 0) {
    console.log('\nNo qualifying new items today.')
  } else {
    console.log(`\n--- TOP ${top.length} PICKS ---`)
    top.forEach((a: Article, i: number) => {
      console.log(`${i + 1}. [score:${a.relevanceScore}] ${a.title}`)
      console.log(`   ${a.source} · ${new Date(a.publishedAt).toLocaleDateString('en-GB')}`)
      console.log(`   ${a.topics.join(', ')}`)
      console.log(`   → ${a.whyItMatters}`)
      console.log()
    })
  }

  // Save source reliability data
  saveSourceMeta(sourceMeta)

  console.log(`Done! ${allArticles.length} new articles, ${merged.length} total in feed.`)
}

main()
