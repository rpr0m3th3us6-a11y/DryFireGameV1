# Dry-Fire Trainer

An offline-first, installable PWA that turns dry-fire practice on a laser target into a Duolingo-style skill tree. Pick a target (single circle, 3×3 grid, or both) and a track (pistol, concealed carry, rifle). You work through units, levels and drills with a built-in shot timer, enter your hits, and the app scores the run, awards XP and unlocks the next level. The final boss is an adapted **Man Card** benchmark.

It has no backend, no accounts, no analytics and no network calls after the first load. All data stays on the device in IndexedDB.

> **Training aid only. Not legal advice.** Dry fire means unloaded firearms and no live ammunition in the room. Follow your local laws and the manufacturer's guidance for your firearm, holster and training device.

## What's in it

- **86 drills in 12 units.** Pistol has 8 units (Safety & Fundamentals through Integration). Concealed Carry has 2 units and unlocks after Presentation. Rifle has 2 units. Every drill has an objective, setup (distance, height, angle, where to stand), steps, Bronze/Silver/Gold par times, pass criteria, common errors and a coaching cue.
- **Drill runner.** Pressing a big arm button starts a random 1–4 s delay, then the start beep, then a live timer. An optional par beep sounds at the next tier's par, and there's a silent/visual mode with a screen flash. Random square callouts are shown on screen and spoken on-device. Shoot/no-shoot color and number calls are supported, as are fatigue prompts between strings, a dim red low-light mode, and optional mic click detection. Tapping anywhere always works too. The screen stays awake during drills.
- **Result entry per string.** The time is captured automatically and can be nudged ±0.05 s or typed in. Circle drills use a hits stepper; on grid drills you tap the squares you missed. Grip and sight-picture self-ratings (1–5) are optional.
- **Scoring.** The app reports accuracy %, average and best time, and hit factor (5 per hit, −10 per miss or no-shoot hit, divided by total time). Tiers come from par times; untimed drills use accuracy tiers.
- **Progression.** Levels unlock in order and each unit ends in a multi-drill benchmark whose tier is your weakest component.
  - **Adaptive help.** A Gold on your first attempt offers to skip the rest of the level. Three fails in a row suggests a review drill.
  - **Calibration baseline.** A one-time baseline can test you out of early units.
  - **Unlock-all.** A Settings toggle opens everything for experienced shooters.
- **Gamification.** XP and ranks from Recruit to Distinguished, a daily streak with freezes (earn one every 7 days, hold up to 2), a weekly goal ring, dated badges, personal bests, and a leaderboard against your own past runs.
- **History.** A session log, per-drill trend charts with par lines, and a grid miss heatmap. Weak-spot analysis produces lines like "Your weak-hand work is 40% slower than your strong-hand work", comparing time normalized to silver par. JSON backup export and import, plus a CSV export of attempts.
- **Safety gate.** You acknowledge a disclaimer and checklist on first run, then complete a checklist before every session (sessions end after 2 h idle). Ending a session shows a "dry fire is over" reminder.

## Man Card capstone

The Man Card is the final boss of *Integration / Benchmarks*. It unlocks when every prior pistol unit benchmark (and every rifle benchmark, if the rifle track is on) is Silver or better, or when Unlock-all is on.

- **Short Card:** pistol low ready 1.0 s, compressed ready 1.0 s, holster draw 1.5 s, rifle low ready 1.0 s, rifle high ready 1.0 s, and an optional rifle-to-pistol transition at 2.5 s.
- **Rules enforced by the app:**
  - **Cold start.** The card is blocked if any drill has run this session or in the last 30 min, and a confirmation screen comes first.
  - **One attempt per iteration.** There's no redo button and no time editing.
  - **Full fail.** The first miss or over-par iteration ends the card as a fail.
- **Long Card:** 14 iterations adding one-handed shooting, reloads, a tac reload and transitions. It unlocks after the Short Card. These standards are placeholders modeled on the short card. Edit `manCard.long.iterations` in `data/drills.json` to match the published standard you train to.
- **Carry variant:** holster iterations are drawn from concealment under a cover garment with par +0.5 s. They are tracked as separate badges.
- **Pistol-only:** if the rifle track is off, rifle iterations are skipped and the badge is recorded as *Pistol-only*.
- **Badges:** earned cards are stored permanently with their date. Resetting progress keeps them unless you untick that option.
- **Laser adaptation:** the original standards are live fire at 25 yards on a C-zone. Here a hit is a laser hit in your target's hit zone, with the same par times.

The Man Card is adapted from Achilles Heel Tactical. This project is not affiliated with or endorsed by them.

## Run it locally

Any static file server works. Service workers need `http://localhost` or HTTPS, so opening `index.html` from `file://` won't install offline support.

```bash
npx http-server -p 8080 -c-1 .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Host it and install it

Put the folder on any HTTPS static host (GitHub Pages, Netlify, Cloudflare Pages, or your own server). After the first load everything is cached and the app works in airplane mode.

**Android (Chrome):** open the URL, then use the ⋮ menu and choose **Install app** (or **Add to Home screen**). It launches full-screen and works offline. Vibration and wake-lock both work.

**iOS / iPadOS (Safari 16.4+):** open the URL, tap **Share**, then **Add to Home Screen**. Launch it from the icon.
- Flip the ring/silent switch off, or the beep will be muted (iOS silences Web Audio in silent mode).
- iOS does not support vibration.
- Screen wake-lock needs a recent iOS (Home Screen apps got reliable support later than Safari tabs). If the screen still dims, set Auto-Lock to Never while training.

**Mac:**
- **Safari 17+ (Sonoma):** File → **Add to Dock**.
- **Chrome or Edge:** click the install icon in the address bar.

**Windows (Chrome/Edge):** use the install icon in the address bar.

For a phone propped on a shelf, landscape and portrait both work. The arm button fills a third of the screen, and during a string the whole screen is the "done" button.

### Tips for accurate times

- Use the phone speaker, not Bluetooth. Bluetooth audio adds 100–300 ms of latency that shows up as slower times. Wired or built-in output latency is compensated where the browser reports it.
- **Mic detection** (Settings → Mic shot detection) listens for the trigger click and stops the timer on the last expected shot. Use *Test mic detection* to tune sensitivity. The start beep is masked so it can't count as a shot. Tap-to-stop always works as a fallback.

## Add your own drills

All content lives in **`data/drills.json`**, separate from the UI code. The full schema is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). A minimal drill:

```json
{
  "id": "my-drill",
  "title": "My Drill",
  "track": "pistol",
  "unit": "p3-presentation",
  "target": "any",
  "mode": "standard",
  "start": "holster",
  "equipment": ["holster"],
  "setup": { "distanceYd": 4, "height": "Chest height", "angle": "square", "position": "Square to the target." },
  "objective": "What this drill builds.",
  "steps": ["Step one.", "Step two."],
  "reps": 5,
  "shots": 1,
  "par": { "bronze": 1.8, "silver": 1.5, "gold": 1.2 },
  "pass": { "accuracy": 80 },
  "errors": ["Common error"],
  "cue": "Short coaching cue.",
  "remedial": null,
  "tags": ["draw", "freestyle"]
}
```

**Modes:**
- `standard`: beep, then shoot. Tap or the mic stops the timer.
- `sequence`: fixed grid squares, for example `"sequence": [1, 3, 9, 7]`.
- `callout`: random squares called at the beep, for example `"callout": { "count": 3, "unique": true, "voice": true }`.
- `decision`: shoot or no-shoot calls, for example `"decision": { "kind": "color", "shoot": ["green"], "noShoot": ["red"], "noShootRate": 0.3 }`.
- `untimed`: rep counting scored on accuracy. Set `"par": null` and add `"accuracyTiers"`.

**Grid numbering** follows a phone keypad: 1-2-3 is the top row, then 4-5-6, then 7-8-9. "Head" is 2 and "body" is 5.

**Targets:**
- `any`: works on either target.
- `circle` or `grid`: that target only.
- `both`: needs the mixed profile.

Keep at least one `any` or `circle` drill and one `any` or `grid` drill in every level so every profile can progress.

**Two ways to add drills:**

1. **Edit the source.** Add the drill to `drills`, reference its id from a unit's `levels[].drills`, then run the validator:
   ```bash
   node tools/validate-drills.mjs
   ```
   Bump `VERSION` in `sw.js` so installed copies pick up the change. `drills.json` is also refreshed in the background, so edits appear on the next launch anyway.
2. **Import a pack in-app** (no hosting needed). In Settings → Custom drills → Import pack, choose a JSON file shaped like `{ "drills": [], "units": [], "levels": [{ "unit": "p6-movement", "level": { … } }] }`.
   - A drill with an existing id overrides the built-in one.
   - A level added to a unit becomes part of that unit's path, so it must be passed before that unit's benchmark unlocks.
   - See [`data/custom-drills.example.json`](data/custom-drills.example.json), and validate a pack with `node tools/validate-drills.mjs path/to/pack.json`.

You can edit the Man Card standards, calibration placement rules and weak-spot comparison pairs in the same file (`manCard`, `calibration`, `analysis.pairs`).

## Project layout

```
index.html  manifest.webmanifest  sw.js
css/app.css
js/app.js        router + views          js/runner.js    drill runner / timer
js/content.js    content loader          js/mancard.js   Man Card flow
js/progress.js   unlocks, XP, streaks    js/stats.js     history, charts, export
js/scoring.js    accuracy, HF, tiers     js/audio.js     beeps, speech, mic
js/session.js    safety sessions         js/diagram.js   setup diagrams, grid
js/db.js         IndexedDB               js/ui.js        DOM helpers
data/drills.json                         tools/validate-drills.mjs
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data model and [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) for assumptions and the roadmap.
