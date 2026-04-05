import type { ArticleState } from './types'

const STORAGE_KEY = 'academic-feed-state'

function getAll(): Record<string, ArticleState> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveAll(state: Record<string, ArticleState>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function getArticleState(id: string): ArticleState {
  const all = getAll()
  return all[id] || { seen: false, used: false }
}

export function markSeen(id: string) {
  const all = getAll()
  all[id] = { ...getArticleState(id), seen: true }
  saveAll(all)
}

export function markUsed(id: string, post?: string) {
  const all = getAll()
  all[id] = { ...getArticleState(id), used: true, savedPost: post }
  saveAll(all)
}

export function getAllStates(): Record<string, ArticleState> {
  return getAll()
}

const API_KEY_STORAGE = 'academic-feed-claude-key'

export function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE)
}

export function setApiKey(key: string) {
  localStorage.setItem(API_KEY_STORAGE, key)
}
