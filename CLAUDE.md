# PokeDuel — Claude Code Project Bible

> Read this before editing. This file is the implementation guide for the existing repository, not permission to rewrite the app from scratch.

## 1. Goal and division of work

PokeDuel is a browser-based daily Pokémon battle simulator. The long-term direction is a polished, cohesive game with clear, friendly UI inspired by the readability, colour and sense of adventure of Pokémon Scarlet/Violet. Do not copy exact proprietary UI, screenshots, artwork, sounds, or game assets.

**Current-stage instruction:** the owner explicitly asked to remove the previous bespoke styling and leave a neutral, functional skeleton. The current UI is intentionally plain. Do not reintroduce elaborate CSS art direction, custom display fonts, cinematic battle backgrounds, excessive animations, decorative gradients, or a bespoke shop design unless the owner asks for that phase. The next task is authentication setup, managed by the owner. Do not implement or configure Firebase/Google sign-in unless directly instructed.

**Graphic asset workflow:** ChatGPT is the designated graphic designer for original game backgrounds and visual assets. When finished artwork is needed, write a specific request to `ASSET_REQUESTS.md` (purpose, exact dimensions/aspect ratio, composition, palette, file format, transparency, and target file path). Do not fill the gap with random web images, copied screenshots, emoji, elaborate CSS illustrations, or external Pinterest/Google images. Wait for the user to provide the approved asset, then integrate it with sensible fallback behaviour.

## 2. Repository and technical constraints

Repository: `ChickabeeJJ/PokeDuel`  
Production: `https://pokeduel-henna.vercel.app/`

This is a **static vanilla HTML/CSS/JavaScript project**, not React, Next.js, Vite, or a build-tool project.

- `index.html` — screen markup and page regions.
- `styles.css` — intentionally neutral structural styling.
- `app.js` — state, PokéAPI calls, navigation, shop handlers, battle logic and rendering.
- `privacy.html` — current starter privacy notice.
- `vercel.json` — deployment headers and clean URLs.
- `README.md` — setup and known limitations.

Preserve the static deployment model unless the owner approves an architectural change. Avoid new dependencies and build steps by default. Do not rewrite all three core files in one pass. Inspect how a feature currently works before changing it.

## 3. Working rules

1. Begin each substantial task by inspecting the relevant functions, selectors, data structures, and existing behaviour.
2. Use a Git checkpoint or feature branch before risky changes. Never overwrite a newer version based on stale file contents; fetch the current file and its latest SHA immediately before updates.
3. Make one coherent change at a time. Keep commits small and messages specific.
4. Preserve IDs, classes used as hooks, `data-*` attributes, function contracts, and local-save compatibility unless intentionally migrating them.
5. No fake completion claims. Distinguish syntax/static checks from real browser tests. If browser automation is unavailable, say which behaviours remain unverified.
6. No inert controls. Every visible button must work, be deliberately disabled, or be labelled as not implemented.
7. Provide loading, error, retry, empty, and success states for network-dependent actions.
8. Do not silently discard user saves. Changes to the save schema must be versioned and migrated safely.
9. Avoid destructive local-save tests against the owner's actual profile. Use a separate browser profile or test data.
10. Do not deploy to production as a side effect of unrelated work without the owner's approval.

## 4. Current functional foundation

Treat these as prototype capabilities to preserve and test, not as proof of full production correctness:

- First-join starter selection with 27 canonical starter species (three from each of Generations I–IX), initially level 10.
- Main home screen and three daily challenge tiers: Easy, Medium, Hard.
- Unlimited practice battles with smaller rewards.
- Party management with a maximum of six Pokémon.
- Local browser persistence via `localStorage`.
- XP, levels, coins, three shop items, Starter/Basic/Rare/Master boxes and generation-specific boxes.
- PokéAPI-backed Pokémon details, sprites, types, stats and move lookups.
- Pokédex browsing/search and a privacy policy page.
- A basic turn-based battle prototype.

Known limitations that must not be misrepresented: Google sign-in and cloud saves are not enabled; progress is browser-local; the move-data integration is not a verified complete Serebii dataset; alternate forms and all edge cases are not comprehensively implemented; battle rules and balance still need validation; the privacy notice needs review and accurate operator/contact details before launch.

## 5. UI rules for the current skeleton

The current UI should remain a low-styling wireframe until the owner starts the next design phase.

- Use system fonts and normal type hierarchy.
- Use simple, flat surfaces and straightforward borders.
- Use restrained spacing, simple grids, and readable labels.
- No imported custom fonts, oversized brand treatments, scanlines, glow effects, decorative particles, floating coins, CSS-generated scenic environments, or elaborate card art.
- Keep semantic markup, responsive behaviour, focus states, keyboard access, and readable contrast.
- Do not remove useful real Pokémon/item sprites that are part of functional content. Do not confuse actual game assets with decorative CSS treatment.
- Keep the battle arena as a neutral placeholder. Preserve HP bars, sprites, battle text, moves and actions; remove invented background scenery until approved art is ready.
- Keep the shop as a functional list/grid of items and packs. Avoid bespoke art treatment until the owner requests a designed shop.

**Future visual direction, when explicitly requested:** coherent Scarlet/Violet-inspired clarity and warmth, structured menus, confident type hierarchy, soft colour, intuitive item cards, atmospheric original art made by ChatGPT, and subtle purposeful animation. Inspiration is not a request to clone copyrighted UI or assets.

## 6. Functional rules

### Starter onboarding
- Must appear for a save with no starter chosen.
- Generation tabs must show the correct three starters from each generation.
- Selection must update the card and summary.
- Confirm must be disabled until a valid choice is selected.
- Confirming adds exactly one level-10 starter, selects it as active, persists progress, then opens Home.
- Ignore stale responses from prior generation requests. Handle API failure with a retry path.
- Starter choice belongs in first-join onboarding, not inside My Team.

### Daily battles and practice
- Daily completion must be keyed to the local calendar date and must not reset repeatedly in the same day.
- Each daily tier can be completed at most once per day.
- Practice does not consume a daily attempt and has lower rewards.
- Wins, losses, rewards, XP, coins, inventory, and completion flags must match the visible result screen.
- Do not show “real Pokémon battle accuracy” unless damage, priority, stats, type multipliers, accuracy, abilities, status, switching and other implemented mechanics have been tested.

### Team, shop, packs and Pokédex
- Validate coin balance and party capacity before purchases.
- Deduct coins only when an operation succeeds; refund cleanly on failed network-dependent purchases.
- Show pack odds truthfully and ensure the stated odds match the actual selector.
- Do not claim a ball captures Pokémon until capture mechanics exist.
- Search by species name or ID and support form variants where the API offers them.
- Display network errors and loading states; avoid leaving permanent spinners on failures.

### Local save
- Local browser save is the current source of truth.
- Do not add Firebase, OAuth, secrets, cloud sync, or account-related schema while the owner is preparing the sign-in step.
- Never commit API secrets, OAuth client secrets, private keys, service-account JSON, or tokens.
- When authentication work is authorised later, plan how an existing local save will be migrated into the signed-in account rather than overwritten.

## 7. Testing checklist

Before declaring a relevant change complete, test or explicitly note that each applicable item remains unverified:

- Clean first launch shows starter selection.
- All nine generation tabs load the correct three species.
- Select a starter, change generation, return to the selected generation, and confirm the choice.
- Reload after confirming; chosen starter and coins persist.
- Existing saves skip onboarding without losing progress.
- Main navigation, shop tabs, all item purchases and all pack buttons work.
- Insufficient coins and full-party restrictions are correct.
- Daily battles can be cleared once each, practice can be repeated, and date rollover is correct.
- Battle win/loss rewards are correct and the battle can be exited/re-entered.
- Pokédex search, load-more, and detail panels handle network failures.
- Mobile width, keyboard operation, focus visibility and readable text remain usable.
- No browser console errors or missing selectors introduced by the change.
- `app.js` passes a syntax check and CSS braces are balanced. These are static checks, not substitutes for browser interaction tests.

## 8. Recommended project workflow

For each phase:
1. Inspect and report current state.
2. Identify the smallest useful change.
3. List affected files and likely regressions.
4. Implement incrementally.
5. Test the changed flow and related regressions.
6. Update `README.md`, `TECH_DEBT.md`, or `ASSET_REQUESTS.md` only where useful.
7. Report what changed, what was tested, and what still needs a browser check.

Suggested technical priorities after the owner's authentication work is ready:
1. Audit save and daily-reset correctness.
2. Add a repeatable test checklist and address basic battle bugs.
3. Improve Pokémon/forms/moveset coverage using documented, responsibly sourced data.
4. Validate battle rules, switching, item use, and damage calculations.
5. Balance rewards, pack pools, and progression.
6. Plan the art direction and asset integration phase with explicit image requests.
7. Add cloud save/auth only when configured and approved by the owner.

## 9. Initial instruction to Claude Code

Start by auditing the repository and describing the current architecture, data flow, save format, key event handlers, known bugs and test gaps. Do not redesign the interface or implement Firebase during that audit. Create or update `TECH_DEBT.md` with prioritised findings and `ASSET_REQUESTS.md` only for assets that are genuinely needed later. Report the smallest safe next step and wait before making major rewrites.
