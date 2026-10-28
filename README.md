# PokeDuel

A browser-based daily Pokémon battle simulator prototype designed around a compact, pixel-inspired interface and classic handheld-style battles.

## Run locally

Open `index.html` in a modern browser, or serve the folder with any static HTTP server (for example, `npx serve .`). Using a local server is recommended because browsers may restrict requests in file mode.

## Included in this prototype

- First-join onboarding with 27 starter choices across Generations I–IX, at level 10.
- Three daily encounters (easy, medium, hard), tracked by the visitor's local calendar date.
- Unlimited practice encounters with lower rewards.
- Level and XP progression, coins, an item shop, generation-era pack tiers, a party roster, and Pokédex search.
- A softer illustrated coastal visual direction, animated backgrounds and controls, and a full-screen starter journey.
- Classic pixel battle sprites where available, preferring Pokémon Emerald sprites and falling back to Pokémon Black & White / PokéAPI sprites.
- Local browser save data and a starter privacy-policy page.
- Google sign-in is intentionally not wired up yet.

## Pokémon data and assets

This prototype requests sprites, Pokémon base stats, types, and learnset/move metadata from [PokéAPI](https://pokeapi.co/) at runtime. It does **not** yet contain a verified, exhaustive offline Serebii moveset dataset. Data and images loaded from PokéAPI require an internet connection. For forms, PokéAPI's Pokémon endpoint can serve form-specific entries when the corresponding name or ID is available.

The battle presentation uses a newly authored CSS battlefield and conventional turn-based handheld battle framing. It does not bundle or reproduce Gamma Emerald's exact proprietary assets, battle backgrounds, or implementation. Please only add external background art if you have permission to use and redistribute it; images found through Google or Pinterest are not automatically free to reuse.

## Save and account status

Current progression is saved to localStorage in the current browser. It does not sync between devices or browsers. Clearing browser site data removes this local save. Google authentication, cloud saves, account deletion, and cross-device syncing are not active.

## Deployment

This is a static site and can be hosted on Vercel with no build step: the repository root contains `index.html`, `styles.css`, and `app.js`.

## Legal notice

PokeDuel is an unofficial fan project and is not affiliated with or endorsed by Nintendo, The Pokémon Company, or Game Freak. Pokémon names and related intellectual property belong to their respective owners. A public launch may require legal review, and this prototype is not presented as a commercial-use-cleared product.
