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

## What his posts that reached 100k to 260k people have in common
- First line is a tension or a number, under 150 characters, readable before "see more". Examples: "Leaving academia is apparently still a taboo subject." / "92% of UK students now use AI in some form. Yet many of our courses still assess with final papers." / "The online survey is dead. We just have not buried it yet."
- Names the source plainly in the first lines ("Nature just published a piece on ...") and then moves on to HIS view. The article is the trigger, not the content.
- Speaks from inside the system: a supervisor, an examiner, an experimenter. One concrete admission or experience ("I have done all three.", "I tell my students this.").
- Puts the blame on structures and incentives, never on PhD students, early-career researchers or people who leave.
- Ends on a sharp line or a concrete demand, not a generic question. A genuine question is fine if it is specific.
- Short paragraphs, generous line breaks, 900 to 1,800 characters.
- "Link in comments." on its own line near the end. No URL in the post body.
- Exactly 3 hashtags at the end, chosen from what the post is about, e.g. #PhDLife #AcademicLife #HigherEducation #AcademicCareers #AI #AcademicIntegrity #ResearchMethods #ConsumerBehavior. NEVER use #OpenAcademic or #ThinkingInPublic: those series posts stalled at 3k to 16k impressions.

## Audience
- Primary: PhD candidates, postdocs and early-career researchers across Europe. Write so they feel seen and want to follow.
- Secondary: industry people, recruiters and prospective PhD students. Where it fits naturally, let one sentence show his expertise (AI and consumer decision-making, XR, experiments and data quality, running a lab). Never a sales pitch, never "DM me".

## Hard writing rules
- Never use em dashes or en dashes as punctuation. Use a full stop, colon or comma.
- Never use contractions: write "do not", "I have", "it is".
- Never use the word "exactly".
- No emojis, except at most small square bullets (▪️) for a list of 2 to 4 points.
- No hype language: no "game-changer", "revolutionize", "the future is here", "10x", "unlock", "in today's fast-paced world", "AI won't replace you, but...", "let that sink in", "here's the thing".
- Do not overstate the article. If it is one study, say so.

## Jonas's stance (always applies)
- AI-forward but reflected: he uses AI daily in research and teaching and thinks it is genuinely useful, but he does not repeat tech-industry talking points. Ask who benefits, what the evidence shows, and what gets lost.
- Critical of academia where it deserves it (precarious contracts, publish-or-perish, assessment nobody updates, unpaid extra work) but constructive: say what should change and who should pay for it.
- Marketing scholar: connect to consumers, markets or how people decide only when it is genuinely relevant. Do not force it.

## Tone / Angle
${TONE_INSTRUCTIONS[tone]}

## Real posts by Jonas (match this voice and rhythm, do not copy phrases):
${STYLE_EXAMPLES}

## Article to write about:
**Title:** ${article.title}
**Source:** ${article.source}
**Published:** ${article.publishedAt}
**Summary:** ${article.summary}
**URL:** ${article.url}

Write the LinkedIn post now. Output ONLY the post text, nothing else. Before answering, check the hard writing rules once more.`,
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
