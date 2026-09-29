# Architecture & Data Model

## Principles

- **Static files only.** No backend, no accounts, no analytics, no network calls after install. Every asset is same-origin and precached by the service worker.
- **Content is data.** Units, levels, drills, par times, bosses and the Man Card standards live in `data/drills.json`. UI code never hard-codes a drill.
- **Vanilla ES modules.** No build step and no framework. Views are small functions that return HTML strings and wire their own events, so the code stays easy to read and fork.
- **Local persistence.** IndexedDB holds progress, attempts and sessions. The app requests persistent storage so the browser doesn't evict it. JSON/CSV export/import covers backups.

## File layout

```
index.html              App shell (single page)
manifest.webmanifest    PWA manifest
sw.js                   Service worker: versioned precache, cache-first
css/app.css             Dark, high-contrast, large-tap-target styles
js/app.js               Boot, router, top-level views
js/db.js                Tiny IndexedDB wrapper (kv, attempts, sessions)
js/content.js           Loads drills.json + custom packs, indexes, filters by profile
js/progress.js          Unlock rules, tiers, XP, streaks, badges, adaptive logic
js/scoring.js           Accuracy, hit factor, tier evaluation
js/audio.js             WebAudio beeps, speech callouts, mic shot detection
js/runner.js            Drill runner state machine (briefing, standby, beep, entry, summary)
js/mancard.js           Man Card capstone flow (cold start, single attempt, no redo)
js/stats.js             History, charts (canvas), weak-spot analysis, export/import
js/diagram.js           SVG setup diagrams and the 3x3 grid component
js/ui.js                DOM helpers, icons, toasts, modals, wake lock, haptics
data/drills.json        All training content
tools/validate-drills.mjs  Content validator (run with node)
```

## Runtime flow

```
first launch ─► Disclaimer ─► Safety checklist (first run) ─► Setup wizard ─► Calibration (skippable) ─► Home
every session ─► Safety checklist gate before any drill (session = 2h idle window)
Home ─► Skill tree ─► Unit ─► Drill briefing ─► Runner (per string: standby ► random beep ► timer ► Done ► result entry) ─► Summary (score, tier, XP, unlocks, adaptive offers)
```

## Data model: `data/drills.json`

```jsonc
{
  "schemaVersion": 1,
  "contentVersion": "1.0.0",
  "tracks": [{ "id": "pistol", "name": "Pistol" }, { "id": "ccw", "name": "Concealed Carry", "parent": "pistol" }, { "id": "rifle", "name": "Rifle" }],
  "units": [Unit],
  "drills": [Drill],
  "manCard": ManCard,
  "analysis": { "pairs": [{ "a": "weak-hand", "b": "strong-hand", "label": "weak-hand work" }] }
}
```

### Unit

| field | type | notes |
|---|---|---|
| `id` | string | e.g. `p1-fundamentals` |
| `track` | `pistol` \| `ccw` \| `rifle` | |
| `order` | number | position in its track |
| `title`, `summary` | string | |
| `requires` | string[] (optional) | unit ids whose boss must be passed. Default: the previous unit in the same track |
| `levels` | `{ id, title, drills: string[] }[]` | 3–4 levels of 2–3 drills each |
| `boss` | `{ id, title, summary, components: [{ drill, reps }] }` or `{ id, type: "mancard" }` | unit benchmark |

### Drill

| field | type | notes |
|---|---|---|
| `id` | string | kebab-case, unique |
| `title` | string | |
| `track`, `unit` | string | |
| `target` | `any` \| `circle` \| `grid` \| `both` | `any` works on either target. `both` needs the mixed profile |
| `mode` | `standard` \| `sequence` \| `callout` \| `decision` \| `untimed` | how the runner behaves |
| `start` | string | `holster`, `concealed`, `low-ready`, `compressed-ready`, `high-ready`, `extended`, `table`, `pocket`, `bag`, `seated`, `sling`, `retention` |
| `equipment` | string[] | `holster`, `cover-garment`, `training-mag`, `dummy-rounds`, `chair`, `bag`, `barricade`, `reset-trigger`, `sling` |
| `setup` | `{ distanceYd, height, angle, position, notes? }` | `angle`: `square`, `left-45`, `right-45`, `left-90`, `right-90`, `barricade-left`, `barricade-right` |
| `objective` | string | |
| `steps` | string[] | |
| `reps` | number | strings per attempt |
| `shots` | number | shots per string (default 1) |
| `sequence` | number[] | `sequence` mode: grid squares in order (1–9, keypad layout) |
| `callout` | `{ count, pool?, unique?, voice? }` | `callout` mode: squares called at the beep |
| `decision` | `{ kind: "color" \| "number", shoot, noShoot, noShootRate, shots }` | `decision` mode |
| `par` | `{ bronze, silver, gold }` seconds per string, or `null` | tighten across levels |
| `scoring` | `time` \| `accuracy` | `accuracy` drills use `accuracyTiers` |
| `accuracyTiers` | `{ bronze, silver, gold }` % | untimed drills |
| `pass` | `{ accuracy }` % | pass = accuracy ≥ this AND avg time ≤ bronze par |
| `preRep` | string (optional) | shown before every string (fatigue drills) |
| `lowLight` | bool (optional) | runner uses a dim red screen |
| `safety` | string (optional) | drill-specific safety note |
| `errors` | string[] | common errors |
| `cue` | string | coaching cue |
| `remedial` | string \| null | easier drill offered on failure |
| `tags` | string[] | feeds weak-spot analysis (`draw`, `weak-hand`, `strong-hand`, `concealed`, `seated`, `reload`, `transition`, …) |

**Grid numbering (keypad):**

```
1 2 3
4 5 6
7 8 9
```

"Head" = 2, "body/box" = 5.

### Man Card

```jsonc
"manCard": {
  "unlock": { "bossTier": "silver", "units": ["p1-…", …], "ifTrack": { "rifle": ["r1-…"] } },
  "coldStartMinutes": 30,
  "carryVariant": { "parAdd": 0.5 },
  "short": { "id": "mancard-short", "iterations": [Iteration] },
  "long":  { "id": "mancard-long", "requires": "mancard-short", "iterations": [Iteration] }
}
Iteration = { id, title, weapon, start, shots, par, optional?, carryEligible?, instructions }
```

## Local storage (IndexedDB `dryfire`)

| store | key | contents |
|---|---|---|
| `kv` | string | `profile`, `settings`, `progress`, `safety`, `session`, `customPack` |
| `attempts` | auto id | `{ drillId, kind: drill\|boss\|mancard\|calibration, date, sessionId, variant?, strings: [{ time, hits, misses, noShoot, called, missed, grip, sight }], summary: { accuracy, avgTime, bestTime, hitFactor, tier, passed }, xp }` |
| `sessions` | auto id | `{ start, end, safetyAck, drills }` |

`progress` = `{ xp, drills: { [id]: { attempts, passed, bestTier, failStreak, pb: { avgTime, hitFactor, accuracy } } }, levels: { [id]: { complete, skipped } }, bosses: { [id]: { tier, date } }, badges: { [id]: isoDate }, streak: { current, best, lastDay, freezes }, weeklyGoal, manCard: { … } }`

## Scoring

- **Accuracy** = hits ÷ (hits + misses). A no-shoot hit counts as a miss plus a penalty.
- **Hit factor** = max(0, 5·hits − 10·misses − 10·noShootHits) ÷ total time.
- **Tier (timed drills):** the best tier whose par ≥ average string time, provided accuracy ≥ `pass.accuracy`. Gold also needs accuracy ≥ max(pass, 90).
- **Tier (untimed drills):** from `accuracyTiers`.
- **XP** = 10 base + tier bonus (Bronze 10 / Silver 20 / Gold 35) + 25 for a first pass + 10 for a personal best, doubled for bosses. The Man Card is worth 500.
