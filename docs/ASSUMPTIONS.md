# Assumptions & Next Steps

## Assumptions

1. **Hits are self-reported.** Laser targets don't talk to the app, so you enter hits and misses. Mic detection only captures *timing*, never hit location.
2. **Multi-shot strings need a resetting trigger.** That means a laser training pistol (SIRT, Mantis Blackbeard-style reset, etc.) or a trigger-reset device. Drills with more than one shot list `reset-trigger` under equipment. With a striker gun and no reset device, rack between presses or stick to single-shot drills.
3. **Room distances are 2–7 yd.** If the profile's room is smaller than a drill's distance, the briefing tells you to use a smaller aim point instead of changing the pars.
4. **Pars are dry-fire pars.** They're calibrated for dry fire with no recoil at room distance. They run faster than typical live-fire standards and aren't directly comparable to them.
5. **Tier rules:**
   - A tier needs the drill's pass accuracy **and** an average string time at or under that tier's par.
   - Gold also needs 90% or better accuracy.
   - A benchmark's tier is its weakest component.
   - A level is complete when every drill in it that's available for your target is passed at Bronze or better.
6. **Units unlock by passing the previous unit's benchmark.** Concealed Carry needs the Presentation benchmark. Rifle is independent.
7. **The Long Card standards are placeholders.** The Short Card follows the standards you gave me. I don't have the official Achilles Heel Tactical Long Card, so its 14 iterations are modeled on the short card and are meant to be edited in `drills.json`.
8. **Cold start** means no drill run in the current session *and* none in the last 30 minutes (`manCard.coldStartMinutes`). The app can't detect off-app warmups, so that part is on your honor.
9. **A session** starts at the safety checklist and ends after 2 hours idle or when you tap End session. The streak counts calendar days with at least one logged run, in local time.
10. **Speech callouts** use the browser's `speechSynthesis`, which picks an on-device voice where available. Some Android builds route TTS through a Google service. Turn off *Spoken callouts* if that matters; the on-screen callout still works.
11. **Left-handed shooters** get a mirror note. Diagrams and steps are written right-handed.
12. **Storage** is IndexedDB with persistence requested. iOS can still evict data from sites not added to the Home Screen after 7 days unused, so install the app and export a backup now and then.

## Five features I'd build next

1. **Camera hit detection.** Point the phone's camera at the target and detect the laser flash with a simple bright-red blob detector on video frames, all on-device. That gives automatic hit/miss per square plus split times, and removes most manual entry. This is the biggest upgrade in accuracy and speed.
2. **Split-time analysis.** Mic detection already timestamps every click. Keep all of them and show first-shot time vs. splits vs. transitions per string. You'd see whether the draw or the transitions are what's slow, and the weak-spot report could use that.
3. **Programs and scheduling.** Add 4-week programs (for example "Concealed carry: 15 min/day, 4 days/week") that build each day's plan from weak spots and spaced repetition, so drills you haven't touched in a while come back before they fade. Add optional local notifications for the weekly goal.
4. **Encrypted sync or share without a server.** Sync between your devices with a QR code or an encrypted file, WebRTC or AirDrop style. Add an instructor mode that exports a student's report as a PDF. This fits the "teach them to fish" consulting model: students keep training data and instructors review it.
5. **Drill builder UI.** Build drills in the app with a form (target, mode, sequence picker on the grid, par tiers) and validation, instead of hand-editing JSON. Include sharing of drill packs as files or QR codes, so instructors can hand a class a custom unit.

Also worth considering: timer support for BLE shot timers and laser systems that expose hit events (for example ones with companion apps), a short dry-fire "safety quiz" gate for new users, and a live-fire log to compare dry-fire pars against range results.
