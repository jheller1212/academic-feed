# Academic Feed

Personal daily feed of academic news, filtered for PhD life, postdoc life, research culture, AI in academia, and science policy. Includes a LinkedIn post generator powered by Claude.

## Live

**https://jheller1212.github.io/academic-feed/**

## How it works

1. **GitHub Actions** runs daily at 9 AM CET, scraping RSS feeds from Nature, Science, arXiv, MIT News, Stanford HAI, Retraction Watch, Times Higher Education, The Conversation, and Inside Higher Ed
2. Relevant articles are filtered by topic keywords and committed to `public/articles.json`
3. **Netlify** auto-deploys on push — the web UI reads the JSON and displays articles
4. Click **"Draft Post"** on any article to generate a LinkedIn post via the Claude API in your writing style

## Features

- NEW / SEEN / USED badges per article (stored in localStorage)
- Filter by status, topic, or source
- Mobile-friendly — browse and draft posts from your phone
- Claude API key stored locally in your browser only

## Setup

```bash
npm install
npm run scrape   # manual scrape
npm run dev      # local dev server
npm run build    # production build
```

## Style customization

Edit `src/style-examples.ts` with your own LinkedIn posts to train the post generator on your voice.
