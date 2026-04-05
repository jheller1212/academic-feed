import { useState, useEffect, useCallback } from 'react'
import type { Article, ArticleState } from './types'
import { markSeen, markUsed, getAllStates, getApiKey, setApiKey } from './store'
import { generateLinkedInPost } from './generate'

type Filter = 'all' | 'new' | 'seen' | 'used'
type SortBy = 'date' | 'source'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function Badge({ text, variant }: { text: string; variant: 'topic' | 'new' | 'seen' | 'used' | 'source' }) {
  const colors = {
    topic: 'bg-blue-100 text-blue-700',
    new: 'bg-green-100 text-green-700 font-semibold',
    seen: 'bg-gray-100 text-gray-500',
    used: 'bg-purple-100 text-purple-700',
    source: 'bg-amber-100 text-amber-700',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${colors[variant]}`}>
      {text}
    </span>
  )
}

function ArticleCard({
  article,
  state,
  onGeneratePost,
  onMarkSeen,
}: {
  article: Article
  state: ArticleState
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
            : 'bg-white border-gray-200 shadow-sm hover:shadow-md'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {statusBadge}
        <Badge text={article.source} variant="source" />
        <span className="text-xs text-gray-400">{timeAgo(article.publishedAt)}</span>
      </div>

      <h3 className="font-semibold text-base sm:text-lg leading-snug mb-2">
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

      <p className="text-sm text-gray-600 mb-3 line-clamp-3">{article.summary}</p>

      <div className="flex flex-wrap items-center gap-2">
        {article.topics.map((t) => (
          <Badge key={t} text={t} variant="topic" />
        ))}
        <div className="flex-1" />
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

function ApiKeyPrompt({ onSave }: { onSave: (key: string) => void }) {
  const [key, setKey] = useState('')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-md w-full p-6">
        <h2 className="font-bold text-lg mb-2">Claude API Key</h2>
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
  const [topicFilter, setTopicFilter] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  // Filtering & sorting
  const allTopics = [...new Set(articles.flatMap((a) => a.topics))].sort()

  const filtered = articles.filter((a) => {
    const state = states[a.id] || { seen: false, used: false }
    if (filter === 'new' && (state.seen || state.used)) return false
    if (filter === 'seen' && !state.seen) return false
    if (filter === 'used' && !state.used) return false
    if (topicFilter && !a.topics.includes(topicFilter)) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'source') return a.source.localeCompare(b.source)
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
        <h1 className="text-2xl sm:text-3xl font-bold">Academic Feed</h1>
        <p className="text-gray-500 mt-1">
          {articles.length} articles &middot; {newCount} new
        </p>
      </header>

      {error && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-700 text-sm mb-6">
          {error}
        </div>
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
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 border-0"
        >
          <option value="date">Newest first</option>
          <option value="source">By source</option>
        </select>
        <div className="flex-1" />
        <button
          onClick={() => setShowApiKeyPrompt(true)}
          className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 hover:bg-gray-200 text-gray-500"
          title="Set Claude API key"
        >
          API Key
        </button>
      </div>

      {/* Article list */}
      <div className="space-y-3">
        {sorted.length === 0 ? (
          <p className="text-center text-gray-400 py-12">No articles match your filters.</p>
        ) : (
          sorted.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              state={states[article.id] || { seen: false, used: false }}
              onGeneratePost={handleGeneratePost}
              onMarkSeen={handleMarkSeen}
            />
          ))
        )}
      </div>

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
      {showApiKeyPrompt && <ApiKeyPrompt onSave={handleSaveApiKey} />}

      <footer className="mt-12 text-center text-xs text-gray-400">
        Academic Feed &middot; Last scraped: {articles[0]?.scrapedAt ? timeAgo(articles[0].scrapedAt) : 'never'}
      </footer>
    </div>
  )
}
