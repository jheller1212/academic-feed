import type { Article } from './types'
import type { Tone } from './store'
import { STYLE_EXAMPLES } from './style-examples'

const TONE_INSTRUCTIONS: Record<Tone, string> = {
  'Reflective': 'Write in a thoughtful, introspective tone. Share a personal reflection or lesson learned.',
  'Hype Check': 'Separate the claim from the evidence. Say what the finding actually shows, what it does not, and what a sensible person should do with it. Neither cheerleading nor doom.',
  'Hot Take': 'Lead with a bold, contrarian opinion. Be provocative but substantive.',
  'Data-Driven': 'Lead with the key finding or statistic. Be analytical and precise.',
  'Question-Led': 'Open with a thought-provoking question. Build curiosity.',
  'Storytelling': 'Frame this as a short narrative. Use a scene or anecdote to draw the reader in.',
}

export async function generateLinkedInPost(
  article: Article,
  apiKey: string,
  tone: Tone = 'Reflective',
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5-5',
      // Sonnet 5.5 thinks by default; leave headroom so thinking can't starve the post
      max_tokens: 16000,
      output_config: { effort: 'low' },
      messages: [
        {
          role: 'user',
          content: `You are a LinkedIn ghostwriter for Jonas Heller, an Assistant Professor of Marketing at Maastricht University. Write a LinkedIn post about the following academic news article.

## Style Guide
- Conversational, approachable tone — not corporate or overly formal
- Start with a hook (a concrete observation, finding, or tension), not clickbait
- Short paragraphs (1-2 sentences max)
- Use line breaks generously for readability on mobile
- End with a genuine question or an open point, not a generic "What do you think?"
- Include 2-4 relevant hashtags at the end
- Keep it under 1300 characters (LinkedIn sweet spot)
- No emojis in every line — use sparingly if at all
- Show genuine curiosity and intellectual engagement
- Reference the source naturally

## Jonas's stance (always applies)
- Marketing scholar first: connect to consumers, brands, markets or how people decide whenever it fits
- AI-forward but reflected: he uses AI daily in research and teaching and thinks it is genuinely useful, but he does not repeat tech-industry talking points. Ask who benefits, what the evidence shows, and what gets lost
- Critical of the education system where it deserves it (assessment that rewards box-ticking, metrics over learning, students treated as customers), but constructive: suggest what could be done instead
- Never use hype language: no "game-changer", "revolutionize", "the future is here", "10x", "unlock", "in today's fast-paced world", "AI won't replace you, but..."
- Do not overstate the article. If it is one study, say so

## Tone / Angle
${TONE_INSTRUCTIONS[tone]}

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
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`API error (${response.status}): ${error}`)
  }

  const data = await response.json()
  if (data.stop_reason === 'refusal') throw new Error('The model declined to draft this post')
  // Thinking blocks come before the text, so content[0] is not the post
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')
    .trim()
  if (text) return text
  throw new Error(`Unexpected response format (stop_reason: ${data.stop_reason ?? 'unknown'})`)
}
