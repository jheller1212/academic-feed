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
  scoreVersion?: number
}

const SCORE_VERSION = 2

interface SourceMeta {
  source: string
  lastSuccess: string | null
  lastError: string | null
  articleCount: number
}

// ---------------------------------------------------------------------------
// Content pillars, rebuilt Oct 2026 from what actually performed on LinkedIn.
// Megahits (100k-260k impressions) were all an insider take on a news or
// career piece: leaving academia, PhD supervision, #IchBinHanna, AI vs.
// assessment, AI bots in online surveys. Generic US higher-ed admin news,
// management journals and marketing-journal tables of contents never travelled.
// Weight = how strongly the pillar predicts a post that spreads.
// ---------------------------------------------------------------------------
const TOPICS_KEYWORDS: Record<string, { keywords: string[]; weight: number; requires?: RegExp }> = {
  'PhD & Supervision': {
    keywords: [
      'phd', 'doctoral', 'dissertation', 'thesis', 'phd student', 'phd candidate',
      'graduate student', 'grad student', 'doctoral student', 'doctoral candidate',
      'supervisor', 'supervision', 'supervisee', 'advisor', 'adviser', 'mentoring', 'mentor',
      'early-career researcher', 'early career researcher', 'early-career', 'postdoc', 'post-doc', 'postdoctoral',
    ],
    weight: 7,
  },
  'Careers & Precarity': {
    keywords: [
      'leaving academia', 'left academia', 'quit academia', 'leave academia', 'alt-ac',
      'academic career', 'academic job', 'job market', 'tenure', 'tenure track', 'tenure-track',
      'temporary contract', 'fixed-term', 'short-term contract', 'precari', 'job security',
      'ichbinhanna', 'wisszeitvg', 'hanna', 'adjunct', 'casualisation', 'casualization',
      'salary', 'salaries', 'stipend', 'what does a phd pay', 'pay gap', 'wages', 'stay in academia', 'remain in academia', 'career outcomes', 'underpaid', 'layoff', 'redundanc', 'job cuts', 'brain drain',
      'industry job', 'career change', 'career transition', 'career advice', 'working scientist',
      'hiring committee', 'academic cv', 'promotion', 'recognition and rewards',
    ],
    weight: 7,
  },
  'AI & Research Integrity': {
    keywords: [
      'peer review', 'paper mill', 'retraction', 'misconduct', 'fabricat', 'fraud',
      'research integrity', 'ai-generated', 'ai generated', 'llm-generated', 'written by ai',
      'chatgpt', 'large language model', 'llm', 'generative ai', 'ai detection', 'detector',
      'hallucinat', 'fake reference', 'citation', 'ghostwrit', 'authorship', 'ai reviewer',
    ],
    weight: 6,
    requires: /\b(ai|artificial intelligence|llms?|chatgpt|generative|peer review|paper mills?|retract\w*|misconduct|fraud|integrity)\b/i,
  },
  'Methods & Data Quality': {
    keywords: [
      'online survey', 'survey research', 'survey data', 'respondent', 'participants',
      'mturk', 'mechanical turk', 'prolific', 'online panel', 'crowdsourc', 'bots', 'bot ',
      'synthetic participant', 'synthetic respondent', 'silicon sample', 'simulated participant',
      'attention check', 'data quality', 'replication', 'replicat', 'reproducib', 'preregist',
      'p-hacking', 'null result', 'effect size', 'lab study', 'field experiment',
    ],
    weight: 6,
  },
  'Academic Culture': {
    keywords: [
      'publish or perish', 'slow science', 'impact factor', 'h-index', 'metrics', 'research assessment',
      'burnout', 'mental health', 'work-life balance', 'overwork', 'workload', 'imposter',
      'academic culture', 'research culture', 'toxic', 'bullying', 'harassment', 'hierarchy',
      'open science', 'open access', 'preprint', 'academic freedom', 'sabbatical', 'grant writing',
      'rejection', 'reviewer 2', 'academic twitter', 'science communication',
    ],
    weight: 5,
  },
  'AI in Teaching & Assessment': {
    keywords: [
      'assessment', 'exam', 'grading', 'cheating', 'academic integrity', 'plagiarism',
      'essay', 'written assignment', 'oral exam', 'ai tutor', 'ai in education', 'ai in the classroom',
      'ai policy', 'ai ban', 'students use ai', 'critical thinking', 'deskilling', 'cognitive offloading',
      'learning outcomes', 'grade inflation',
    ],
    weight: 6,
    requires: /\b(ai|artificial intelligence|llms?|chatgpt|generative|students?|exams?|assessment)\b/i,
  },
  'AI & Consumers': {
    // Jonas's own research niche: credibility with industry, recruiters and future PhDs
    keywords: [
      'consumer', 'shopping', 'shopper', 'purchase', 'brand', 'marketing', 'advertising', 'retail',
      'ai agent', 'agentic', 'chatbot', 'recommendation', 'personalization', 'personalisation',
      'virtual reality', 'augmented reality', 'mixed reality', 'extended reality', 'xr', 'metaverse',
      'algorithm aversion', 'algorithm appreciation', 'trust in ai', 'human-ai', 'ai companion',
      'synthetic data', 'generative engine', 'ai search', 'virtual influencer', 'ai-generated ad',
    ],
    weight: 5,
    requires: /\b(ai|artificial intelligence|llms?|chatgpt|generative|algorithm\w*|agents?|chatbots?|virtual reality|augmented reality|vr|ar|xr)\b/i,
  },
  'Science Policy & Funding': {
    keywords: [
      'funding cut', 'budget cut', 'cuts to', 'bezuiniging', 'science funding', 'research budget',
      'research policy', 'science policy', 'horizon europe', 'erc', 'nwo', 'nih', 'nsf',
      'dutch universities', 'netherlands', 'international students', 'english-taught', 'internationalisation',
    ],
    weight: 5,
  },
  // Kept at low weight: context, rarely a post on its own
  'Higher Education (general)': {
    keywords: ['higher education', 'university', 'universities', 'campus', 'curriculum', 'pedagogy'],
    weight: 1,
  },
}

// Bonus keywords that boost score: tension, Europe, his own context
const BONUS_KEYWORDS = [
  { pattern: 'linkedin', weight: 4 },
  { pattern: 'counterintuitive', weight: 2 },
  { pattern: 'myth', weight: 2 },
  { pattern: 'europe', weight: 2 },
  { pattern: 'netherlands', weight: 4 },
  { pattern: 'dutch', weight: 4 },
  { pattern: 'germany', weight: 3 },
  { pattern: 'german', weight: 2 },
  { pattern: 'maastricht', weight: 6 },
  { pattern: 'business school', weight: 4 },
  { pattern: 'ichbinhanna', weight: 6 },
]

// Shape of a headline that travels: a number, a survey, a tension, a question.
// Every megahit opened on one of these.
const HOOK_PATTERNS: { re: RegExp; weight: number }[] = [
  { re: /\b\d{1,3}(\.\d)?\s?%|\bpercent\b/i, weight: 5 },
  { re: /\b(survey|poll|study finds|researchers found|data show|analysis finds|report finds)\b/i, weight: 4 },
  { re: /\b(quit|leav(e|ing)|exodus|crisis|cuts?|ban(ned)?|fake|fraud|bots?|cheat\w*|broken|burn\w*out|toxic|exploit\w*)\b/i, weight: 4 },
  { re: /\?\s*$/, weight: 3 },
  { re: /\b(how|why) (to|do|should|can) i\b|\bmy (phd|supervisor|student)\b/i, weight: 4 },
]

function hookScore(title: string): number {
  return HOOK_PATTERNS.reduce((s, h) => s + (h.re.test(title) ? h.weight : 0), 0)
}

// ---------------------------------------------------------------------------
// Exclusion patterns — reject junk before scoring
// ---------------------------------------------------------------------------
const EXCLUSION_PATTERNS = [
  /\bjob listing\b/i, /\bjob opening\b/i, /\bapply now\b/i, /\bnow hiring\b/i,
  /\bjob alert\b/i, /\bcareer fair\b/i,
  /\bregister now\b/i, /\bsave the date\b/i, /\brsvp\b/i,
  /\btable of contents\b/i, /\bissue highlights\b/i,
  /\bweekly round-?up\b/i,
  // US/UK institutional admin news that never travels with his audience
  /\bhigher education postcard\b/i, /\bbranch campus\b/i, /\bathletic/i, /\bfootball\b/i,
  /\bcommencement\b/i, /\bboard of (trustees|regents)\b/i, /\baccreditat/i, /\bpresidential search\b/i,
  /\bnamed (president|chancellor|provost)\b/i, /\benrollment (up|down|grows|falls|drops)\b/i,
  /\bcollege town\b/i, /\btitle ix\b/i, /\bcommunity college\b/i, /\bstate legislat/i,
  /\bpodcast:/i, /\bcorrection\b/i, /\berratum\b/i, /\bauthor correction\b/i,
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
  /** If true, only include items mentioning top institutions in author/body */
  stanfordOnly?: boolean
  /** Cap how many items to keep from this feed (for noisy feeds like arXiv) */
  maxItems?: number
  /** Minimum relevance score to include — use for noisy general feeds */
  minScore?: number
  /** Require at least this many topic matches — use for broad feeds */
  minTopics?: number
  /** Override maxAgeDays for this feed (e.g. 90 for slow-publishing journals) */
  maxAgeDays?: number
  /** Auto-assign these topics even if keyword matching finds nothing */
  forcedTopics?: string[]
  /** Skip topic keyword matching — always include (for curated journal feeds) */
  alwaysInclude?: boolean
  /** Source-level score bonus */
  boost?: number
}

// boost: source-level bonus. Big boosts go to sources his megahits were built on
// (Nature news & careers pieces, career columns), not to journal prestige.
// Journals now have to earn their place on topic + hook like everything else.
const HOOK = 14 // the "Nature piece + insider take" sources
const GOOD = 7
const FEEDS: FeedConfig[] = [
  // --- Tier 1: news & career pieces that became 100k+ posts ---
  { url: 'https://www.nature.com/careers.rss', source: 'Nature Careers', boost: HOOK },
  { url: 'https://www.nature.com/subjects/careers.rss', source: 'Nature - Careers', boost: HOOK },
  { url: 'https://www.nature.com/nature/articles?type=career-column.rss', source: 'Nature - Career Column', boost: HOOK },
  { url: 'https://www.nature.com/subjects/scientific-community.rss', source: 'Nature - Scientific Community', boost: HOOK },
  { url: 'https://www.nature.com/subjects/lab-life.rss', source: 'Nature - Lab Life', boost: HOOK },
  { url: 'https://www.nature.com/subjects/peer-review.rss', source: 'Nature - Peer Review', boost: HOOK },
  { url: 'https://www.nature.com/subjects/publishing.rss', source: 'Nature - Publishing', boost: GOOD },
  { url: 'https://www.nature.com/subjects/research-management.rss', source: 'Nature - Research Management', boost: GOOD },
  { url: 'https://www.nature.com/subjects/funding.rss', source: 'Nature - Funding', boost: GOOD },
  { url: 'https://www.nature.com/subjects/policy.rss', source: 'Nature - Policy', boost: GOOD, minScore: 15 },
  { url: 'https://www.nature.com/subjects/science-technology-and-society.rss', source: 'Nature - Science, Tech & Society', minScore: 18, maxItems: 5 },
  { url: 'https://www.nature.com/subjects/machine-learning.rss', source: 'Nature - Machine Learning', minScore: 18, maxItems: 4 },
  { url: 'https://www.nature.com/nature.rss', source: 'Nature', boost: GOOD, minScore: 15 },
  { url: 'https://www.science.org/rss/news_current.xml', source: 'Science News', boost: GOOD, minScore: 12 },
  { url: 'https://retractionwatch.com/feed/', source: 'Retraction Watch', boost: GOOD },
  { url: 'https://blogs.lse.ac.uk/impactofsocialsciences/feed/', source: 'LSE Impact Blog', boost: GOOD },

  // --- Tier 1b: academic-culture writers whose pieces spark debate ---
  { url: 'https://www.experimental-history.com/feed', source: 'Experimental History (Mastroianni)', boost: GOOD, alwaysInclude: true, forcedTopics: ['Academic Culture'], maxAgeDays: 21 },
  { url: 'https://thesiswhisperer.com/feed/', source: 'The Thesis Whisperer', boost: GOOD, alwaysInclude: true, forcedTopics: ['PhD & Supervision'], maxAgeDays: 21 },
  { url: 'https://stuartritchie.substack.com/feed', source: 'Science Fictions (Ritchie)', boost: GOOD, maxAgeDays: 21 },

  // --- European / Dutch higher-ed news (his home turf; US admin news never travelled) ---
  { url: 'https://dub.uu.nl/en/rss.xml', source: 'DUB (Utrecht)', boost: GOOD, minScore: 8 },
  { url: 'https://www.ukrant.nl/feed/', source: 'UKrant (Groningen)', boost: GOOD, minScore: 8 },
  { url: 'https://www.theguardian.com/education/higher-education/rss', source: 'The Guardian - Higher Education', minScore: 10 },
  { url: 'https://wonkhe.com/feed/', source: 'Wonkhe', minScore: 14, maxItems: 4 },
  { url: 'https://www.insidehighered.com/rss.xml', source: 'Inside Higher Ed', minScore: 16, maxItems: 5 },
  { url: 'https://www.highereddive.com/feeds/news/', source: 'Higher Ed Dive', minScore: 18, maxItems: 2 },
  { url: 'https://hechingerreport.org/feed/', source: 'The Hechinger Report', minScore: 16, maxItems: 2 },

  // --- Reflective AI voices (critical + pragmatic, not hype) ---
  { url: 'https://www.normaltech.ai/feed', source: 'AI as Normal Technology', forcedTopics: ['AI & Research Integrity'], alwaysInclude: true },
  { url: 'https://www.oneusefulthing.org/feed', source: 'One Useful Thing (Mollick)', alwaysInclude: true, forcedTopics: ['AI in Teaching & Assessment'] },
  { url: 'https://codeactsineducation.wordpress.com/feed/', source: 'Code Acts in Education (Williamson)', maxAgeDays: 60, forcedTopics: ['AI in Teaching & Assessment'], alwaysInclude: true, maxItems: 2 },
  { url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', source: 'MIT Technology Review - AI', minScore: 14, maxItems: 3 },
  { url: 'https://garymarcus.substack.com/feed', source: 'Gary Marcus', minScore: 12, maxItems: 1 },

  // --- His own field: only papers with an AI/tech or methods hook, max 2 per journal ---
  { url: 'https://journals.sagepub.com/action/showFeed?ui=0&mi=ehikzz&ai=2b4&jc=jmxa&type=etoc&feed=rss', source: 'Journal of Marketing', maxAgeDays: 90, minScore: 14, maxItems: 2 },
  { url: 'https://journals.sagepub.com/action/showFeed?ui=0&mi=ehikzz&ai=2b4&jc=mrja&type=etoc&feed=rss', source: 'Journal of Marketing Research', maxAgeDays: 90, minScore: 14, maxItems: 2 },
  { url: 'https://pubsonline.informs.org/action/showFeed?type=etoc&feed=rss&jc=mksc', source: 'Marketing Science', maxAgeDays: 90, minScore: 14, maxItems: 2 },
  { url: 'https://link.springer.com/search.rss?search-within=Journal&facet-journal-id=11747&query=*', source: 'J. of the Acad. of Marketing Science', maxAgeDays: 90, minScore: 14, maxItems: 2 },
  { url: 'https://www.nature.com/nathumbehav.rss', source: 'Nature Human Behaviour', minScore: 14, maxItems: 3 },
  { url: 'https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science', source: 'Science', minScore: 16, maxItems: 3 },
  { url: 'https://www.pnas.org/action/showFeed?type=etoc&feed=rss&jc=pnas', source: 'PNAS', maxItems: 2, minScore: 18 },
  { url: 'https://sloanreview.mit.edu/feed/', source: 'MIT Sloan Management Review', minScore: 14, maxItems: 2 },
  { url: 'https://knowledge.wharton.upenn.edu/feed/', source: 'Knowledge at Wharton', minScore: 14, maxItems: 2 },

  // --- arXiv: only synthetic-respondent / AI-in-research work from big labs ---
  { url: 'https://rss.arxiv.org/rss/cs.CY', source: 'arXiv - Computers & Society', stanfordOnly: true, maxItems: 3, minScore: 14 },
  { url: 'https://rss.arxiv.org/rss/cs.HC', source: 'arXiv - Human-Computer Interaction', stanfordOnly: true, maxItems: 3, minScore: 14 },
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

// Word-boundary match: plain substring matching tagged 'commerce' as ERC funding and
// 'imagine' as AGI. Short keywords must match whole words; longer ones may be stems.
const keywordRegexCache = new Map<string, RegExp>()
function hasKeyword(text: string, kw: string): boolean {
  let re = keywordRegexCache.get(kw)
  if (!re) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(`\\b${escaped}${kw.length <= 4 ? '\\b' : ''}`)
    keywordRegexCache.set(kw, re)
  }
  return re.test(text)
}

function matchTopics(title: string, body: string): { topics: string[]; score: number } {
  const lowerTitle = title.toLowerCase()
  const lowerBody = stripAuthorBios(body).toLowerCase()
  const matched: string[] = []
  let score = 0

  for (const [topic, config] of Object.entries(TOPICS_KEYWORDS)) {
    if (config.requires && !config.requires.test(`${lowerTitle} ${lowerBody}`)) continue
    const titleMatches = config.keywords.filter((kw) => hasKeyword(lowerTitle, kw)).length
    const bodyMatches = config.keywords.filter((kw) => hasKeyword(lowerBody, kw)).length

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

// Angle hints mirror the posts that went big. Order = priority.
function generateWhyItMatters(topics: string[], source: string): string {
  if (topics.includes('Careers & Precarity'))
    return 'Career/precarity story: your #IchBinHanna and leaving-academia posts hit 148k and 261k. Take the insider view, blame the system, not the people.'
  if (topics.includes('PhD & Supervision'))
    return 'PhD/supervision: your supervision post hit 252k. Share the decision you second-guess, not the conclusion.'
  if (topics.includes('AI in Teaching & Assessment'))
    return 'AI vs. assessment: your exams post hit 142k. Name what colleagues pretend not to see, then say who should pay for the fix.'
  if (topics.includes('Methods & Data Quality'))
    return 'Methods + AI: your online-survey post hit 75k and shows expertise industry and future PhDs look for.'
  if (topics.includes('AI & Research Integrity'))
    return 'AI and research integrity: claim vs. evidence, from someone who uses AI daily.'
  if (topics.includes('AI & Consumers'))
    return 'Your research niche: one clear finding on AI and consumers signals expertise to recruiters and prospective PhDs.'
  if (topics.includes('Academic Culture'))
    return 'Academic culture: your slow-science post hit 114k. Works when you are specific about one habit.'
  if (topics.includes('Science Policy & Funding'))
    return 'Policy and funding: strongest with a Dutch or German angle and a concrete consequence for researchers.'
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
    const effectiveMaxAge = feedConfig.maxAgeDays ?? maxAgeDays
    const cutoff = new Date(now.getTime() - effectiveMaxAge * 24 * 60 * 60 * 1000)

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

      let { topics, score: baseScore } = matchTopics(title, body)

      // For curated journal feeds: add forced topics and always include
      if (feedConfig.forcedTopics) {
        for (const ft of feedConfig.forcedTopics) {
          if (!topics.includes(ft)) topics.push(ft)
        }
      }
      if (feedConfig.alwaysInclude && topics.length === 0) {
        topics = feedConfig.forcedTopics ? [...feedConfig.forcedTopics] : ['Academic Culture']
        baseScore = Math.max(baseScore, 5)
      }
      if (topics.length === 0) continue

      // Strict filtering for noisy general feeds (e.g. The Conversation)
      if (feedConfig.minTopics && topics.length < feedConfig.minTopics) continue
      if (feedConfig.minScore && baseScore < feedConfig.minScore) continue

      // Source-level score adjustments
      const isArxiv = feedConfig.source.startsWith('arXiv')
      let score = baseScore

      // Source boost + headline shape. Topic match alone no longer wins.
      score += feedConfig.boost ?? 0
      score += hookScore(title)

      // Penalize arXiv to prevent domination
      if (isArxiv) score = Math.round(score * 0.6)
      if (isArxiv && /stanford/i.test(rawBody)) score += 5

      const summary = body.slice(0, 500)

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
        scoreVersion: SCORE_VERSION,
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
// Crossref-based scraper for journals with blocked RSS (e.g. JCR)
// ---------------------------------------------------------------------------
interface CrossrefJournal {
  issn: string
  source: string
  forcedTopics: string[]
}

const CROSSREF_JOURNALS: CrossrefJournal[] = [
  { issn: '0093-5301', source: 'Journal of Consumer Research', forcedTopics: ['AI & Consumers', 'Methods & Data Quality'] },
  { issn: '1057-7408', source: 'Journal of Consumer Psychology', forcedTopics: ['AI & Consumers', 'Methods & Data Quality'] },
  { issn: '0167-8116', source: 'Intl. Journal of Research in Marketing', forcedTopics: ['AI & Consumers', 'Methods & Data Quality'] },
  { issn: '0022-4359', source: 'Journal of Retailing', forcedTopics: ['AI & Consumers', 'Methods & Data Quality'] },
]

async function scrapeCrossref(journal: CrossrefJournal, maxAgeDays: number): Promise<Article[]> {
  try {
    const url = `https://api.crossref.org/journals/${journal.issn}/works?rows=20&sort=published&order=desc&select=title,published-online,published-print,issued,URL,abstract`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AcademicFeed/2.0 (mailto:j.heller@maastrichtuniversity.nl)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { message: { items: Array<{ title?: string[]; URL?: string; abstract?: string; 'published-online'?: { 'date-parts': number[][] }; 'published-print'?: { 'date-parts': number[][] }; issued?: { 'date-parts': number[][] } }> } }

    const now = new Date()
    const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000)
    const articles: Article[] = []

    for (const item of data.message.items) {
      const title = item.title?.[0]
      const link = item.URL
      if (!title || !link) continue

      // Elsevier journals often only deposit print/issued dates
      const dateParts = (item['published-online'] ?? item['published-print'] ?? item.issued)?.['date-parts']?.[0]
      if (!dateParts || dateParts.length < 2) continue
      const pubDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2] ?? 1)
      if (pubDate < cutoff || pubDate > now) continue

      const rawAbstract = item.abstract || ''
      const body = cleanHtml(rawAbstract)

      const { topics, score: topicScore } = matchTopics(title, body)
      // Journal papers must carry an AI/tech or methods hook to make the feed
      if (!topics.some((t) => journal.forcedTopics.includes(t))) continue
      const baseScore = topicScore + hookScore(title)
      if (baseScore < 14) continue

      articles.push({
        id: makeId(link),
        title,
        summary: body.slice(0, 500),
        whyItMatters: generateWhyItMatters(topics, journal.source),
        relevanceScore: baseScore,
        url: link,
        source: journal.source,
        publishedAt: pubDate.toISOString(),
        scrapedAt: now.toISOString(),
        topics,
        scoreVersion: SCORE_VERSION,
      })
    }

    articles.sort((a, b) => b.relevanceScore - a.relevanceScore)
    if (articles.length > 2) articles.length = 2
    console.log(`  ${journal.source}: ${articles.length} relevant articles (Crossref)`)
    return articles
  } catch (err) {
    console.error(`  ${journal.source}: FAILED - ${(err as Error).message}`)
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

  // Phase 1: scrape with preferred window (override via CLI: --days 30)
  const daysArg = process.argv.find((a) => a.startsWith('--days='))
  const customDays = daysArg ? parseInt(daysArg.split('=')[1], 10) : null
  const PREFERRED_DAYS = customDays || 5
  const EXPANDED_DAYS = customDays || 7

  // Scrape in batches of 8 to avoid rate limiting
  const BATCH_SIZE = 8
  let results: PromiseSettledResult<Article[]>[] = []
  for (let i = 0; i < FEEDS.length; i += BATCH_SIZE) {
    const batch = FEEDS.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.allSettled(
      batch.map((feed) => scrapeFeed(feed, parser, PREFERRED_DAYS)),
    )
    results.push(...batchResults)
  }

  // Scrape Crossref journals (JCR, etc.)
  const crossrefResults = await Promise.allSettled(
    CROSSREF_JOURNALS.map((j) => scrapeCrossref(j, 90)),
  )

  // Track source reliability
  const now = new Date().toISOString()
  for (const cr of crossrefResults) {
    if (cr.status === 'fulfilled') {
      for (const a of cr.value) {
        if (!sourceMeta[a.source]) sourceMeta[a.source] = { source: a.source, lastSuccess: null, lastError: null, articleCount: 0 }
        sourceMeta[a.source].lastSuccess = now
        sourceMeta[a.source].articleCount = cr.value.length
      }
    }
  }
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

  // Add Crossref articles
  for (const cr of crossrefResults) {
    if (cr.status === 'fulfilled') allArticles.push(...cr.value)
  }

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

    results = []
    for (let i = 0; i < FEEDS.length; i += BATCH_SIZE) {
      const batch = FEEDS.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.allSettled(
        batch.map((feed) => scrapeFeed(feed, parser, EXPANDED_DAYS)),
      )
      results.push(...batchResults)
    }

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

  // Source diversity: cap arXiv at 30% of total feed
  const totalNonArxiv = allArticles.filter((a) => !a.source.startsWith('arXiv')).length
  const maxArxiv = Math.max(10, Math.round(totalNonArxiv * 0.43)) // ~30% of final mix
  const arxivCount = { current: 0 }
  allArticles = allArticles.filter((a) => {
    if (!a.source.startsWith('arXiv')) return true
    arxivCount.current++
    return arxivCount.current <= maxArxiv
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

  // Merge: new articles take priority, keep old ones up to retention window
  const retentionDays = customDays || 14
  const retentionCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  // Items scored under an older scheme would keep their inflated scores for 14 days
  existing = existing.filter((a) => a.scoreVersion === SCORE_VERSION)
  const existingById = new Map(existing.map((a: Article) => [a.id, a]))
  for (const article of allArticles) {
    existingById.set(article.id, article)
  }
  const merged = Array.from(existingById.values())
    .filter((a: Article) => new Date(a.scrapedAt || a.publishedAt) >= retentionCutoff)
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

main().then(() => process.exit(0)).catch(() => process.exit(1))
