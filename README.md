# FootyScope – Arun ⚽

Live club football scores, fixtures, results, match events, stats and league tables for 40+ competitions. The home page leads with the **Champions League, Europa League and Conference League** and **Europe's top 5 leagues**, followed by everything else playing that day (Championship, Eredivisie, Primeira Liga, MLS, Liga MX, Brasileirão, Saudi Pro League and more).

## Features
- Live scores that auto-refresh every 30 seconds while matches are in play
- **Home page:** a *Live now* strip, then the European cups and the top 5 leagues. These are always shown: if a competition has no games on the chosen day, its card shows its next matchday or latest results instead
- Matches load progressively, and each request falls back to ESPN directly if the Netlify proxy fails
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

## Theme: Isoline Bloom
The background is a WebGL2 "isoline bloom" (`public/isoline-bloom.js`): a slowly morphing lobed shape drawn only by glowing contour lines. The lines are violet, magenta and ember red, around a deep indigo core.

- On desktop, the mouse acts as a lens: the lines bulge and brighten under it, and moving fast speeds up the outward flow.
- Clicking or tapping sends a shock pulse through the rings.
- With no mouse on it, the lens wanders on its own.

It's a plain-JavaScript port of a React `<IsolineBloom>` component, since this site has no React or build step.

You can change the look on the script tag in `public/index.html`:

```html
<script src="isoline-bloom.js" data-preset="ultraviolet"></script>
<!-- presets: ultraviolet, solar-flare, abyss, aurora, ghost -->
<!-- fine-tune with JSON: data-params='{"rings":14,"scale":0.6,"flow":0.3}' -->
```

It pauses when the tab is hidden and runs at about 30fps with lower resolution on phones. Visitors who have reduced motion turned on see a single still frame. If WebGL2 isn't available, it falls back to a static gradient of rings.
