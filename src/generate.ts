import Anthropic from '@anthropic-ai/sdk'
import type { Article } from './types'
import { STYLE_EXAMPLES } from './style-examples'

export async function generateLinkedInPost(
  article: Article,
  apiKey: string,
): Promise<string> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `You are a LinkedIn ghostwriter for Jonas Heller, an Assistant Professor of Marketing at Maastricht University. Write a LinkedIn post about the following academic news article.

## Style Guide
- Conversational, approachable tone — not corporate or overly formal
- Start with a hook (bold statement, question, or surprising fact)
- Short paragraphs (1-2 sentences max)
- Use line breaks generously for readability on mobile
- End with a question to drive engagement
- Include 3-5 relevant hashtags at the end
- Keep it under 1300 characters (LinkedIn sweet spot)
- No emojis in every line — use sparingly if at all
- Show genuine curiosity and intellectual engagement
- Reference the source naturally

## Example Posts by Jonas (match this voice):
${STYLE_EXAMPLES}

## Article to write about:
**Title:** ${article.title}
**Source:** ${article.source}
**Published:** ${article.publishedAt}
**Summary:** ${article.summary}
**URL:** ${article.url}

Write the LinkedIn post now. Output ONLY the post text, nothing else.`,
      },
    ],
  })

  const block = message.content[0]
  if (block.type === 'text') return block.text
  throw new Error('Unexpected response format')
}
