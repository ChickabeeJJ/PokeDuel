# Tech debt and known limitations

Priority: **P1** fix before a public launch · **P2** important · **P3** nice to have.

## P1

- **Leaderboards trust the client.** Scores are calculated in the browser and written to `/leaderboard/{uid}`. `firestore.rules` checks the shape and bounds of the data, but a determined player could still post fake numbers. Before a public launch, replay or validate daily battles server-side (for example, a Cloud Function that re-runs the deterministic daily seed with the submitted actions).
- **Firebase Console setup is still required:** Google provider, authorised domains, a Firestore database, and the rules in `firestore.rules` (they now cover `leaderboard/{uid}` too). Until the rules are published, leaderboards show an error state.
- **Account deletion is not implemented**, and leaderboard entries are not removed automatically. The privacy notice says so; it needs a deletion flow and operator contact details.
- **Old cached clients can overwrite cloud saves.** The v2 save uses a new localStorage key, so local v1 data is never touched. But a browser still running the old v1 build while signed in could write a v1 save over the cloud document. This is low risk once the deploy propagates.

## P2 — battle accuracy

- **81 of 851 moves are "simplified".** Their data-driven parts (damage, secondary effects, stat changes) run, but their custom script does not. Examples: Future Sight hits immediately, and Rollout and Ice Ball don't lock in. The full list is `moveSupport(id) === 'partial'` in `js/engine.js`, and the UI labels these moves "simplified".
- **164 of 318 abilities and 71 held items are simulated.** Pokémon with unsupported abilities show "not simulated" on their summary page.
- **Singles only.** There are no doubles, Mega Evolution, Z-Moves or Dynamax. Champions' Mega Evolution is a candidate for a future update.
- **Stats use the mainline IV/EV formula.** The Champions stat-point system is not used, because IVs and EVs are part of the collection game. Move numbers, the PP cap and the paralysis/sleep/freeze rules do follow Champions.
- **Approximations:** confusion and taunt durations are close to Showdown's but not exact in every edge case. Simultaneous end-of-turn replacements switch in the player's choice first. A double KO is scored as a player loss.
- **The AI is heuristic**: it scores expected damage and uses simple status/setup logic. It never switches voluntarily.

## P2 — game systems

- **Some evolution conditions are simplified**: "walk 1000 steps"-style methods become 20 battles, and party/location conditions become level 30. See `evolutionOptions()` in `js/game.js`.
- **Daily trainer levels scale with your highest party level**, so daily scores are not perfectly comparable between players. The species and RNG seed are shared for each date.
- **Held items are not used up between battles.** Berries and Focus Sash are consumed only for the rest of that battle.
- **Learnsets are level-up moves plus TMs from the latest generation that has the species.** There are no egg or tutor moves, and no regional or alternate forms.

## P3

- The Pokédex flavour text still comes live from PokéAPI. Everything else (species, moves, learnsets) is bundled in `/data`.
- Rebuild `/data` with `node tools/build-data.mjs <showdown-checkout> <pokeapi-csv-dir>` whenever Showdown updates the Champions mod.
- `tests/e2e.cjs` needs Playwright installed locally; it is not run in CI.
- Optional background art: see `ASSET_REQUESTS.md`.
