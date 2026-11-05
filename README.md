# FootyScope – Arun ⚽

Live football scores, fixtures, results, match events, stats and league tables for **75+ competitions** worldwide: Premier League, LaLiga, Bundesliga, Serie A, Ligue 1, Champions League, Europa League, MLS, Liga MX, Brasileirão, Saudi Pro League, World Cup qualifiers and many more.

## Features
- Live scores that auto-refresh every 30 seconds while matches are in play
- Every competition on one page, grouped by league, with live leagues first
- **Live** filter, team/league search, and a date picker for past results and upcoming fixtures
- Click any match for the goals, cards and substitutions timeline, plus stats such as possession and shots
- League tables with qualification and relegation zones
- Pin your favourite leagues (★) to the top; this is saved in your browser
- Works on phones and in light or dark mode

## Data source
FootyScope uses ESPN's **free, public, keyless** soccer JSON endpoints:

| Data | Endpoint |
|---|---|
| Scores / fixtures | `https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard?dates=YYYYMMDD` |
| Match details | `https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/summary?event={id}` |
| Tables | `https://site.api.espn.com/apis/v2/sports/soccer/{league}/standings` |

On Netlify, the browser calls `/api/espn/...`, which `netlify.toml` proxies to ESPN, so there are no CORS problems. When run locally, the app calls ESPN directly.

To add or remove competitions, edit `public/leagues.js`. A league slug that doesn't exist, or a league with no games that day, is simply hidden.

> Note: [rezarahiminia/livescoreFootball](https://github.com/rezarahiminia/livescoreFootball) was evaluated first. It's a Node/MongoDB backend that needs its own separately-run data listener, and its hosted feed only covers England and Spain, so ESPN's feed was used instead for much wider coverage with zero setup.

## Run locally
No build step and no dependencies.

```bash
npx serve public
```

## Deploy to Netlify
1. In Netlify, choose **Add new site → Import an existing project → GitHub** and pick this repo.
2. Branch: `main`. Leave the build command empty. The publish directory is `public` (already set in `netlify.toml`).
3. Click **Deploy**.

Or deploy with the CLI:

```bash
npx netlify-cli deploy --prod --dir=public
```

Note that the `/api/espn` proxy only works with a Git or CLI deploy that reads `netlify.toml`. A drag-and-drop deploy of the `public` folder still works, because the app falls back to calling ESPN directly.
