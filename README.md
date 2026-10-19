# WOPR — WarGames Control Room

A browser game inspired by the ending of *WarGames* (1983): tic-tac-toe inside a front-facing CRT monitor wall, with electronic computer speech, orchestral music and fictional strategic maps.

**[Play the game](https://wargames-control-room.pages.dev)**

The game interface and dialogue are in English. The frontend uses vanilla JavaScript, Canvas and Web Audio. Cloudflare Pages Functions and D1 provide shared anonymous player statistics.

## Screenshots

![Playing tic-tac-toe against Joshua in the CRT control room](docs/screenshots/03-human-game.png)

[View all nine gameplay screenshots](docs/screenshots/README.md), including the opening, self-play, nuclear simulation and both endings.

## Play locally

Use Node.js 22.13 or later. The game has no npm runtime dependencies; no `npm install` is needed.

```sh
npm start
```

Open <http://localhost:4173>. Press CONNECT to start the game and unlock audio. If the browser suspends sound, press ENABLE AUDIO. This static preview runs the whole game; shared statistics require Pages Functions and D1.

## Rules

- CONNECT starts a three-minute countdown. One launch-code character locks every 18 seconds. Winning, losing or drawing a round does not end or extend the countdown.
- Play as X using the board or keys 1–9. Complete three human rounds to unlock the 0-player option between rounds.
- Before actual missile release, tracking and in-flight counts stay at zero, and maps show no flying missiles.
- Losing a round invites another game. The Goodbye farewell occurs only after the countdown reaches 00:00 and finishes before launch narration.
- Selecting 0 players before time expires holds the countdown. Joshua plays itself, finds only draws, then tries increasingly fast nuclear scenarios across the surrounding monitors for 15 seconds before the peaceful ending.
- If time expires, the nuclear ending shows a 15-second global exchange, followed by interference and SYSTEM OFFLINE. Music continues until RESET.
- AUDIO controls music, sound effects and electronic speech. FX LOW and the operating system's reduced-motion preference reduce effects. RESET cancels the current game, dialogue and animation.
- Both endings include ABOUT THIS GAME, a popup about the film inspiration and how the game was made with Codex. Close it with CLOSE, Escape or a click outside the popup.

All military counts, launch sites, codes and trajectories are fictional entertainment data. The in-game launch code is a story prop, not a credential.

## Check and build

```sh
npm run check
npm test
npm run build
```

Tests cover game outcomes, optimal self-play, deadline rules, audio cancellation, browser audio compatibility, D1 statistics and the cinematic timeline. `dist/` is generated locally and excluded from Git.

Optional Playwright CLI flows are in `tests/*.pwcode`. Start a local Pages server on port 8788, open it with your Playwright CLI, create `output/playwright/`, then use `playwright-cli run-code --filename tests/browser-countdown.pwcode` or another flow. These flows use local test data; do not point gameplay automation at production statistics.

## Cloudflare Pages and D1

The repository includes **`wrangler.example.jsonc` only**. Its all-zero D1 ID is a placeholder. Real deployment configuration, environment files and Wrangler state are ignored by Git.

Use Wrangler through your own installation and sign in locally:

```sh
cp wrangler.example.jsonc wrangler.jsonc
wrangler login
wrangler d1 create wargames-control-room-stats
```

Copy the `database_id` returned by D1 into your local `wrangler.jsonc`. Keep the binding named `STATS_DB`. Do not commit your local configuration or credentials.

To run the complete application locally:

```sh
npm run build
wrangler d1 migrations apply wargames-control-room-stats --local
wrangler pages dev dist --port 8788
```

Use a Wrangler version that supports the compatibility date in the example configuration. An older local runtime may need its own supported `--compatibility-date` override for development.

To deploy to **your own** Pages project:

```sh
wrangler pages project create YOUR_PAGES_PROJECT --production-branch main
wrangler d1 migrations apply wargames-control-room-stats --remote
wrangler pages deploy dist --project-name YOUR_PAGES_PROJECT --branch main
```

For Git-integrated Pages builds, use build command `npm run build`, output directory `dist`, and the repository root as the root directory. Configure your own D1 binding `STATS_DB` in Cloudflare and apply the migration to that database. `functions/api/stats.js` must be included; uploading static files alone leaves shared statistics offline.

Authentication stays in your local Wrangler login or your deployment platform's secret store. No GitHub or Cloudflare tokens are required in the source tree.

## Shared statistics

PLAYER RECORDS counts distinct anonymous browser identities that connected, won or lost a round, launched missiles, or averted doomsday. Categories may overlap; RESET does not count a second player. A random browser identifier and pending events are stored locally. The API returns aggregate totals, never player records. The repository contains the schema and tests, not production database contents.

## Audio, maps and attribution

Music and Joshua dialogue are rendered assets included with the game. Optional regeneration tools are in `scripts/render-score.py` and `scripts/render-voice.py`; they require Python, numpy/soundfile and the native synthesis libraries described in those scripts. Ordinary builds do not need them.

- Maps and font: `assets/NOTICE.txt` and `assets/font-license.txt`.
- Original orchestral cues and soundfont attribution: `assets/music/credits.txt` and `assets/music/soundfont-license.txt`.
- Electronic formant speech: `assets/voice/credits.txt`.
- Two short film console sound-effect excerpts: `assets/sfx/NOTICE.txt` and `assets/sfx/source.json`.

This independent fan game is not affiliated with the filmmakers or rights holders. Asset notices retain their respective attribution and licensing terms.
