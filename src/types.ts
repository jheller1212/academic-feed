export interface Article {
  id: string
  title: string
  summary: string
  url: string
  source: string
  publishedAt: string
  scrapedAt: string
  topics: string[]
}

export interface ArticleState {
  seen: boolean
  used: boolean
  savedPost?: string
}
