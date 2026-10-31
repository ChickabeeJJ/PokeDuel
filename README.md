# PokeDuel

A browser-based daily Pokémon battle game: three seeded daily battles at fixed levels (Lv. 11, 36 and 70), unlimited practice, collecting, training, and leaderboards. It is a static site with no build step.

## Run locally

Serve the folder with any static server, for example `npx serve .` or `python3 -m http.server`. Opening `index.html` directly from disk won't work, because the game loads its data with `fetch`.

## What's in the game

- **Battles** run on a singles engine (`js/engine.js`) that follows Pokémon Showdown's Gen 9 mechanics. That includes the damage formula with 4096-based rounding, critical hits, stat stages, status conditions, weather, terrain, hazards, screens, switching, U-turn-style pivots and Terastallization.
- **Move numbers use the Pokémon Champions balance layer**: base power, accuracy, PP and secondary-effect changes, PP capped at 20, paralysis at 1/8, sleep for 2–3 turns, and freeze that thaws within 3 turns.
  - 770 of 851 moves are fully simulated; the rest are labelled "simplified" in the UI.
  - Battles also show a damage preview, type-effectiveness hints and a Tera toggle.
- **Journey** is a story mode from Kanto to Paldea. Each region has a trainer before every gym, then the Gym Leaders (or Alola's Kahunas), the Elite Four and the Champion, with species and levels from one reference game per region. Regions unlock in order. First clears pay coins; rematches give Exp. Points only.
- **Collection**: every Pokémon rolls a nature, IVs (shown with the Judge wording), ability (5% Hidden), gender, size and Tera Type. Pokémon can be **shiny** (1/8192, or 1/1024 in the daily Outbreak Box, with the Shiny Charm tripling either rate) and can carry **marks** with titles such as "the Peckish". The marks are rare, personality, time-of-day, daily-weather, Jumbo/Mini, Partner and Mightiest.
- **Training**:
  - EVs come from defeated Pokémon (with Power items and Macho Brace), vitamins and feathers. Mints, Bottle Caps (Hyper Training), Ability Capsules/Patches and Tera Shards are also available.
  - Experience uses each species' official growth curve, with Exp. Candies and Rare Candies.
  - Evolution works by level, stone, Linking Cord trade, friendship, time of day, held item or known move.
  - Moves can be relearned, and TMs can be bought.
- **Items**: about 170 items, including medicine, battle X items, 71 simulated held items and evolution items.
- **Boxes (loot boxes)** show their true odds, and every pool is checked in tests. Boxes only give base-form Pokémon. Paradox Pokémon are a 4% pull from the Paldea Box. The Master Box costs 10,000 coins. Box tiles cycle through Pokémon from their pool every 3 seconds.
- **Daily loop**:
  - three daily battles (Warm-Up, Rival Test, Ace Challenge) with the same species and RNG seed for everyone on a given date; Sundays add a legendary;
  - a 7-day check-in streak, three daily missions with a bonus, a daily mass outbreak, and daily weather;
  - a shareable emoji result and medals (achievements).
- **Social**: a Trainer Card with any Pokémon as the profile picture and a showcase of three Pokémon, and leaderboards for Trainer Score, today's gauntlet, shinies and Pokédex.
- **Home** is a single focused daily screen, in the style of daily web games such as PokeDoku. It shows the daily number, progress tiles, a reset countdown, today's three battles, your team, and one row of shortcuts.
- **Start-up**: there is no loading screen. Code and data are preloaded in parallel, and a service worker (`sw.js`) caches them, so repeat visits start in about 0.3 s and work offline.
- **Wandering Pokémon** cross the bottom of every screen except battles, sized by each species' real height. Flying types and Levitate users fly higher. They are hidden when animations are off or reduced motion is on.
- **Look and feel**: a greyscale (black-to-white, hint of blue) angular "arcade" design system with original SVG icons (`assets/icons.svg`) and logo (`assets/logo.svg`). No emoji are used. All visible text was measured at WCAG AA contrast.
- **Save protection (anti-cheat)**: see the section below.
- **Saves**:
  - **Local saves** live under `pokeduel-save-v2`. The old v1 save is migrated automatically and left untouched as a backup.
  - **Google sign-in** gives per-account cloud saves in Firestore, which win on a last-modified basis.
  - **Export and import** works from the Trainer Card, as a file or a copyable code. Exports are **password-encrypted**. Imports are decrypted, verified and audited, and the previous save is backed up.

## Save protection

PokeDuel runs in the browser, so no client-side check can stop a determined reverse-engineer. Cheating is made hard, it is detected generously, and the server caps what a cheater can gain:

- **Sealed saves.** Every local, cloud and exported save carries an HMAC-SHA256 seal over its canonical JSON. A save edited outside the game no longer matches its seal.
- **Signed Pokémon.** Each Pokémon's fixed traits (IVs, nature, shiny, gender, size, origin, met date, evolution line, starting EXP) are signed when it is created. Turning a Pokémon shiny, editing its IVs or swapping its species is detected.
- **Ledger and audit.** All coins, EXP and Pokémon gains go through a ledger. The audit checks:
  - coin balance against the ledger;
  - earnings per day against what the game can pay out;
  - total EXP and Pokémon count against what was granted;
  - the shiny rate, level against EXP, and duplicate Pokémon.
- **Practice coin cap.** Practice battles pay coins for at most 30 wins a day; EXP stays unlimited.
- **Encrypted transfer.** Exports are encrypted with a player password (PBKDF2-SHA256 with 250k iterations, then AES-256-GCM). A wrong password or a modified file is refused, and protected imports must also pass the seal and the audit. Older unprotected exports can still be imported, but they become unranked.
- **Fair outcome.** A save that fails a check is never deleted or blocked. It stays fully playable and is only marked **unranked** (no leaderboard), with the reasons shown on the Trainer Card. Honest play always passes.
- **Server backstop.** `firestore.rules` rate-limits leaderboard writes to one every 15 seconds and caps the gain per write (for example, +4000 score). Even a modified client can only climb slowly.

## Data and assets

- `data/*.json` is generated by `tools/build-data.mjs` from [Pokémon Showdown](https://github.com/smogon/pokemon-showdown) (MIT) Gen 9 data plus its `champions` mod, and from PokéAPI CSV exports (EV yields, base experience, growth rates). The script parses the Showdown files as data and never executes them.
- Sprites, artwork and item icons are loaded from the [PokéAPI sprites repository](https://github.com/PokeAPI/sprites). Pokédex flavour text is fetched live from PokéAPI, and the game shows a fallback message if that fails.
- Arena art lives in `assets/backgrounds/` and is registered in `assets/manifest.json`, together with the painted platform positions, so sprites stand on the platforms. Medium and hard battles use dusk and night lighting. Rocky, sea and snow arenas match the scenario: a Gym Leader's type in Journey, or the daily weather.
- Battles show your Pokémon from behind and the opponent from the front, like the main games.
- Moves are animated:
  - Physical moves wind up and dash at the target.
  - Special moves fire an orb in the move's type colour.
  - Status moves raise an aura.
  - Hits land with a type-coloured burst and knock the target back.
  - All of this is off when animations are off or motion is reduced. Both use animated Showdown sprites (falling back to static PokéAPI sprites for #1001+), scaled in half steps so the pixel art stays crisp. Each sprite is sized from its visible pixels and the species' height, so nothing spills off its platform or looks tiny.

## Tests

```bash
node --test tests/engine.test.mjs tests/game.test.mjs
```

- **Unit tests** (29) check:
  - stat and damage numbers against the formula;
  - immunities, priority and Trick Room, Protect odds, burn, and the Champions status and PP rules;
  - hazards, Tera, U-turn and faint replacement;
  - XP curves, evolution, save migration and import sanitising, box odds (including the Paldea Box's Paradox rate), and that every Journey trainer builds a valid team;
  - 600 fuzzed random battles;
  - SHA-256/HMAC against published test vectors, tamper detection, and encrypted export round-trips.
- **Browser test**: `tests/e2e.cjs` needs Playwright. Run it with the site served on port 8765. Its 23 checks cover onboarding, home, battles, Journey, shop, boxes, the Pokédex, tamper detection, encrypted export/import (wrong password, modified file, correct password) and no horizontal scroll at 390px.

## Firebase setup

1. Enable Google sign-in.
2. Add your domains under Authentication → Settings → Authorised domains.
3. Create a Firestore database.
4. Publish `firestore.rules`.

Firebase is loaded lazily: if it can't be reached, the game still works with local saves only.

## Legal

PokeDuel is an unofficial, non-commercial fan project and is not affiliated with or endorsed by Nintendo, The Pokémon Company or Game Freak. Pokémon names and related intellectual property belong to their owners. There are no real-money purchases.

See `CLAUDE.md` for contributor instructions and `TECH_DEBT.md` for known limitations.
