# Academic Feed

My personal daily news feed for academic life — filtered for research culture, AI in academia, science policy, and the realities of PhD/postdoc life. Includes a LinkedIn post drafter so I can turn interesting articles into posts without starting from a blank page.

**Live:** [jheller1212.github.io/academic-feed](https://jheller1212.github.io/academic-feed/)

## How it works

1. A **GitHub Actions** workflow runs daily at 9 AM CET
2. It scrapes RSS feeds from Nature, Science, PNAS, top marketing journals (JM, JMR, JCR, JAMS, Marketing Science), arXiv, Inside Higher Ed, The Guardian, Wonkhe, Retraction Watch, and more
3. Articles are filtered by topic keywords and committed to `public/articles.json`
4. GitHub Pages serves the static site — the UI reads the JSON and displays the feed
5. Click **"Draft Post"** on any article to generate a LinkedIn post written in my voice

## Features

- **NEW / SEEN / USED** badges per article (tracked in localStorage)
- Filter by status, topic, or source
- Mobile-friendly — browse and draft from your phone
- API key stored locally in your browser only (never sent to my server)

## Tech stack

- React 18 + TypeScript + Vite + Tailwind CSS
- RSS parsing via `rss-parser`
- GitHub Actions for daily scraping
- GitHub Pages for hosting

## Running locally

```bash
npm install
npm run scrape   # manual scrape
npm run dev      # local dev server
npm run build    # production build
```

## Customizing the post style

Edit `src/style-examples.ts` with your own LinkedIn posts to train the draft generator on your writing voice.

## Built by

[Jonas Heller](https://jonasheller.info) — Assistant Professor of Marketing, Maastricht University.
