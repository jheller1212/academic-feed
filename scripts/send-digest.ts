import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

interface Article {
  title: string
  source: string
  publishedAt: string
  url: string
  topics: string[]
  relevanceScore: number
  summary: string
  whyItMatters: string
}

async function main() {
  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.DIGEST_EMAIL || 'j.heller@maastrichtuniversity.nl'

  if (!apiKey) {
    console.error('RESEND_API_KEY not set — skipping digest email')
    process.exit(0)
  }

  const articlesPath = join(process.cwd(), 'public', 'articles.json')
  if (!existsSync(articlesPath)) {
    console.log('No articles.json found — skipping digest')
    process.exit(0)
  }

  const articles: Article[] = JSON.parse(readFileSync(articlesPath, 'utf-8'))

  // Filter to last 2 days for the daily digest
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  const recent = articles
    .filter((a) => new Date(a.publishedAt) >= twoDaysAgo)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 10)

  if (recent.length === 0) {
    console.log('No recent articles — skipping digest')
    process.exit(0)
  }

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const articleRows = recent
    .map((a, i) => {
      const date = new Date(a.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      const pct = Math.min(100, Math.round((a.relevanceScore / (recent[0]?.relevanceScore || 1)) * 100))
      const label = pct >= 70 ? 'High' : pct >= 40 ? 'Medium' : 'Low'
      const safeUrl = a.url.startsWith('https://') ? esc(a.url) : '#'
      return `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 12px 0;">
            <div style="font-size: 13px; color: #6b7280; margin-bottom: 4px;">
              #${i + 1} &middot; ${esc(a.source)} &middot; ${date} &middot; <span style="color: ${pct >= 70 ? '#22c55e' : pct >= 40 ? '#f97316' : '#9ca3af'}">${label}</span>
            </div>
            <a href="${safeUrl}" style="color: #1e40af; text-decoration: none; font-weight: 600; font-size: 15px; line-height: 1.4;">
              ${esc(a.title)}
            </a>
            <div style="font-size: 13px; color: #6b7280; margin-top: 4px;">
              ${esc(a.summary.slice(0, 200))}${a.summary.length > 200 ? '...' : ''}
            </div>
            <div style="font-size: 12px; color: #ea580c; margin-top: 4px; font-style: italic;">
              ${esc(a.whyItMatters)}
            </div>
          </td>
        </tr>`
    })
    .join('')

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #111827;">
      <div style="background: #1e40af; color: white; padding: 20px 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px; font-weight: 700;">Academic Feed</h1>
        <p style="margin: 4px 0 0; font-size: 14px; opacity: 0.8;">${today} &middot; ${recent.length} picks for LinkedIn</p>
      </div>
      <div style="padding: 16px 24px; background: #f9fafb; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <table style="width: 100%; border-collapse: collapse;">
          ${articleRows}
        </table>
        <div style="text-align: center; margin-top: 20px;">
          <a href="https://jheller1212.github.io/academic-feed/" style="display: inline-block; padding: 10px 24px; background: #1e40af; color: white; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Open Academic Feed
          </a>
        </div>
        <p style="text-align: center; font-size: 12px; color: #9ca3af; margin-top: 16px;">
          Pick an article, draft a LinkedIn post, own the feed.
        </p>
      </div>
    </div>`

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: 'Academic Feed <onboarding@resend.dev>',
      to: [to],
      subject: `Academic Feed: ${recent.length} picks for LinkedIn — ${today}`,
      html,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    console.error(`Failed to send digest: ${response.status} ${error}`)
    process.exit(1)
  }

  const result = await response.json()
  console.log(`Digest sent to ${to} (${result.id})`)
}

main()
