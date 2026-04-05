import { useState, useEffect, useCallback } from 'react'
import type { Article, ArticleState } from './types'
import { markSeen, markUsed, getAllStates, getApiKey, setApiKey } from './store'
import { generateLinkedInPost } from './generate'

type Filter = 'all' | 'new' | 'seen' | 'used'
type TimeRange = 'all' | '3d' | '7d' | '14d'
type SortBy = 'relevance' | 'date' | 'source'

const TIME_RANGES: Record<TimeRange, { label: string; days: number }> = {
  '3d': { label: 'Last 3 days', days: 3 },
  '7d': { label: 'Last week', days: 7 },
  '14d': { label: 'Last 2 weeks', days: 14 },
  'all': { label: 'All time', days: Infinity },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / (1000 * 60))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Badge({ text, variant }: { text: string; variant: 'topic' | 'new' | 'seen' | 'used' | 'source' | 'pick' }) {
  const colors = {
    topic: 'bg-blue-100 text-blue-700',
    new: 'bg-green-100 text-green-700 font-semibold',
    seen: 'bg-gray-100 text-gray-500',
    used: 'bg-purple-100 text-purple-700',
    source: 'bg-amber-100 text-amber-700',
    pick: 'bg-orange-100 text-orange-700 font-semibold',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${colors[variant]}`}>
      {text}
    </span>
  )
}

function RelevanceBar({ score, max }: { score: number; max: number }) {
  const pct = Math.min(100, Math.round((score / max) * 100))
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-orange-400 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-400">{score}</span>
    </div>
  )
}

function ArticleCard({
  article,
  state,
  rank,
  maxScore,
  onGeneratePost,
  onMarkSeen,
}: {
  article: Article
  state: ArticleState
  rank?: number
  maxScore: number
  onGeneratePost: (article: Article) => void
  onMarkSeen: (id: string) => void
}) {
  const statusBadge = state.used ? (
    <Badge text="USED" variant="used" />
  ) : state.seen ? (
    <Badge text="SEEN" variant="seen" />
  ) : (
    <Badge text="NEW" variant="new" />
  )

  return (
    <div
      className={`border rounded-xl p-4 sm:p-5 transition-all ${
        state.used
          ? 'bg-purple-50/50 border-purple-200'
          : state.seen
            ? 'bg-gray-50 border-gray-200'
            : rank
              ? 'bg-white border-orange-200 shadow-sm hover:shadow-md'
              : 'bg-white border-gray-200 shadow-sm hover:shadow-md'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {rank && <Badge text={`#${rank} Pick`} variant="pick" />}
        {statusBadge}
        <Badge text={article.source} variant="source" />
        <span className="text-xs text-gray-400">{timeAgo(article.publishedAt)}</span>
        <div className="flex-1" />
        <RelevanceBar score={article.relevanceScore ?? 0} max={maxScore} />
      </div>

      <h3 className="font-semibold text-base sm:text-lg leading-snug mb-1">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-blue-600 transition-colors"
          onClick={() => {
            if (!state.seen) onMarkSeen(article.id)
          }}
        >
          {article.title}
        </a>
      </h3>

      {article.whyItMatters && (
        <p className="text-sm text-orange-700 bg-orange-50 rounded px-2 py-1 mb-2 italic">
          {article.whyItMatters}
        </p>
      )}

      <p className="text-sm text-gray-600 mb-3 line-clamp-3">{article.summary}</p>

      <div className="flex flex-wrap items-center gap-2">
        {article.topics.map((t) => (
          <Badge key={t} text={t} variant="topic" />
        ))}
        <div className="flex-1" />
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
          onClick={() => {
            if (!state.seen) onMarkSeen(article.id)
          }}
        >
          Read article
        </a>
        <button
          onClick={() => onGeneratePost(article)}
          className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Draft Post
        </button>
      </div>
    </div>
  )
}

function PostModal({
  article,
  post,
  loading,
  error,
  onClose,
  onSave,
  onRegenerate,
}: {
  article: Article
  post: string
  loading: boolean
  error: string | null
  onClose: () => void
  onSave: () => void
  onRegenerate: () => void
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(post)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-5 sm:p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="font-bold text-lg">LinkedIn Post Draft</h2>
              <p className="text-sm text-gray-500 mt-1">Based on: {article.title}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">
              &times;
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
              <span className="ml-3 text-gray-500">Generating post...</span>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
              {error}
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-4 whitespace-pre-wrap text-sm leading-relaxed font-sans">
              {post}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-4">
            {!loading && !error && (
              <>
                <button
                  onClick={handleCopy}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy to clipboard'}
                </button>
                <button
                  onClick={onSave}
                  className="px-4 py-2 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg text-sm transition-colors"
                >
                  Mark as used
                </button>
              </>
            )}
            <button
              onClick={onRegenerate}
              disabled={loading}
              className="px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              Regenerate
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ApiKeyPrompt({ onSave, onClose }: { onSave: (key: string) => void; onClose: () => void }) {
  const [key, setKey] = useState('')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-md w-full p-6">
        <div className="flex justify-between items-start mb-2">
          <h2 className="font-bold text-lg">Claude API Key</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">
            &times;
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Enter your Anthropic API key to generate LinkedIn posts. It's stored locally in your browser only.
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-..."
          className="w-full border rounded-lg px-3 py-2 text-sm mb-4"
        />
        <button
          onClick={() => {
            if (key.trim()) onSave(key.trim())
          }}
          disabled={!key.trim()}
          className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [articles, setArticles] = useState<Article[]>([])
  const [states, setStates] = useState<Record<string, ArticleState>>({})
  const [filter, setFilter] = useState<Filter>('all')
  const [timeRange, setTimeRange] = useState<TimeRange>('7d')
  const [topicFilter, setTopicFilter] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortBy>('relevance')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAllArticles, setShowAllArticles] = useState(false)

  // Post generation
  const [generatingArticle, setGeneratingArticle] = useState<Article | null>(null)
  const [generatedPost, setGeneratedPost] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [showApiKeyPrompt, setShowApiKeyPrompt] = useState(false)

  useEffect(() => {
    fetch(import.meta.env.BASE_URL + 'articles.json')
      .then((r) => {
        if (!r.ok) throw new Error('No articles yet — run the scraper first')
        return r.json()
      })
      .then((data) => {
        setArticles(data)
        setStates(getAllStates())
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const refreshStates = useCallback(() => setStates(getAllStates()), [])

  const handleMarkSeen = (id: string) => {
    markSeen(id)
    refreshStates()
  }

  const handleGeneratePost = async (article: Article) => {
    const key = getApiKey()
    if (!key) {
      setGeneratingArticle(article)
      setShowApiKeyPrompt(true)
      return
    }

    setGeneratingArticle(article)
    setGenLoading(true)
    setGenError(null)
    setGeneratedPost('')
    markSeen(article.id)
    refreshStates()

    try {
      const post = await generateLinkedInPost(article, key)
      setGeneratedPost(post)
    } catch (err) {
      setGenError((err as Error).message)
    } finally {
      setGenLoading(false)
    }
  }

  const handleSaveApiKey = (key: string) => {
    setApiKey(key)
    setShowApiKeyPrompt(false)
    if (generatingArticle) {
      handleGeneratePost(generatingArticle)
    }
  }

  const handleSavePost = () => {
    if (generatingArticle && generatedPost) {
      markUsed(generatingArticle.id, generatedPost)
      refreshStates()
      setGeneratingArticle(null)
    }
  }

  const handleRegenerate = () => {
    if (generatingArticle) {
      handleGeneratePost(generatingArticle)
    }
  }

  // Derived data
  const allTopics = [...new Set(articles.flatMap((a) => a.topics))].sort()
  const maxScore = Math.max(...articles.map((a) => a.relevanceScore ?? 0), 1)
  const lastScraped = articles[0]?.scrapedAt

  // Top 10 picks (unseen, highest relevance)
  const topPicks = articles
    .filter((a) => {
      const s = states[a.id]
      return !s || (!s.seen && !s.used)
    })
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
    .slice(0, 10)

  // Filtered & sorted list for "all articles" view
  const filtered = articles.filter((a) => {
    const state = states[a.id] || { seen: false, used: false }
    if (filter === 'new' && (state.seen || state.used)) return false
    if (filter === 'seen' && !state.seen) return false
    if (filter === 'used' && !state.used) return false
    if (topicFilter && !a.topics.includes(topicFilter)) return false
    if (timeRange !== 'all') {
      const days = TIME_RANGES[timeRange].days
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
      if (new Date(a.publishedAt).getTime() < cutoff) return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'source') return a.source.localeCompare(b.source)
    if (sortBy === 'relevance') return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  })

  const newCount = articles.filter((a) => {
    const s = states[a.id]
    return !s || (!s.seen && !s.used)
  }).length

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10">
      <header className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Academic Feed</h1>
            <p className="text-gray-500 mt-1">
              {articles.length} articles &middot; {newCount} new
            </p>
          </div>
          <button
            onClick={() => setShowApiKeyPrompt(true)}
            className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 hover:bg-gray-200 text-gray-500"
            title="Set Claude API key"
          >
            API Key
          </button>
        </div>
        {lastScraped && (
          <p className="text-xs text-gray-400 mt-2">
            Last updated: {formatDate(lastScraped)} ({timeAgo(lastScraped)})
          </p>
        )}
      </header>

      {error && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-700 text-sm mb-6">
          {error}
        </div>
      )}

      {/* Top Picks Section */}
      {!showAllArticles && topPicks.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-bold mb-3">Today's Top Picks</h2>
          <p className="text-sm text-gray-500 mb-4">
            Ranked by relevance to academic life, PhD/postdoc experience, and emerging trends. Pick one to draft a LinkedIn post.
          </p>
          <div className="space-y-3">
            {topPicks.map((article, i) => (
              <ArticleCard
                key={article.id}
                article={article}
                state={states[article.id] || { seen: false, used: false }}
                rank={i + 1}
                maxScore={maxScore}
                onGeneratePost={handleGeneratePost}
                onMarkSeen={handleMarkSeen}
              />
            ))}
          </div>
          <button
            onClick={() => setShowAllArticles(true)}
            className="mt-4 w-full py-2 text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Show all {articles.length} articles
          </button>
        </section>
      )}

      {/* All Articles Section */}
      {(showAllArticles || topPicks.length === 0) && (
        <section>
          {showAllArticles && (
            <button
              onClick={() => setShowAllArticles(false)}
              className="mb-4 text-sm text-blue-600 hover:text-blue-800"
            >
              &larr; Back to Top Picks
            </button>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4">
            {(['all', 'new', 'seen', 'used'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm capitalize transition-colors ${
                  filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                {f}
              </button>
            ))}
            <div className="w-px bg-gray-200 mx-1" />
            <select
              value={topicFilter || ''}
              onChange={(e) => setTopicFilter(e.target.value || null)}
              className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 border-0"
            >
              <option value="">All topics</option>
              {allTopics.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRange)}
              className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 border-0"
            >
              {Object.entries(TIME_RANGES).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 border-0"
            >
              <option value="relevance">Most relevant</option>
              <option value="date">Newest first</option>
              <option value="source">By source</option>
            </select>
          </div>

          <div className="space-y-3">
            {sorted.length === 0 ? (
              <p className="text-center text-gray-400 py-12">No articles match your filters.</p>
            ) : (
              sorted.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  state={states[article.id] || { seen: false, used: false }}
                  maxScore={maxScore}
                  onGeneratePost={handleGeneratePost}
                  onMarkSeen={handleMarkSeen}
                />
              ))
            )}
          </div>
        </section>
      )}

      {/* Post generation modal */}
      {generatingArticle && !showApiKeyPrompt && (
        <PostModal
          article={generatingArticle}
          post={generatedPost}
          loading={genLoading}
          error={genError}
          onClose={() => setGeneratingArticle(null)}
          onSave={handleSavePost}
          onRegenerate={handleRegenerate}
        />
      )}

      {/* API key prompt */}
      {showApiKeyPrompt && (
        <ApiKeyPrompt
          onSave={handleSaveApiKey}
          onClose={() => {
            setShowApiKeyPrompt(false)
            setGeneratingArticle(null)
          }}
        />
      )}

      <footer className="mt-12 text-center text-xs text-gray-400">
        Academic Feed &middot; Updates every 3 hours
        {lastScraped && <> &middot; Last scraped: {formatDate(lastScraped)}</>}
      </footer>
    </div>
  )
}
