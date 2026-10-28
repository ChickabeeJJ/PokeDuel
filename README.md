# PokeDuel

A browser-based daily Pokémon battle simulator prototype. The current UI is intentionally a neutral functional skeleton for the next development phase.

## Run locally

Open `index.html` in a modern browser, or serve the folder with any static HTTP server (for example, `npx serve .`). Using a local server is recommended because browsers may restrict requests in file mode.

## Included in this prototype

- First-join onboarding with 27 starter choices across Generations I–IX, at level 10.
- Three daily encounters (easy, medium, hard), tracked by the visitor's local calendar date.
- Unlimited practice encounters with lower rewards.
- Level and XP progression, coins, an item shop, generation-era pack tiers, a party roster, and Pokédex search.
- A full-screen first-join starter journey and a deliberately plain, responsive wireframe UI to support future redesign work.
- Classic pixel battle sprites where available, preferring Pokémon Emerald sprites and falling back to Pokémon Black & White / PokéAPI sprites.
- Local browser saves, Google sign-in through Firebase Authentication, and per-account cloud saves through Firestore. Local progress remains available when signed out.
- Cloud sync compares local and cloud modification times before choosing which copy to load; this is a last-modified strategy, not real-time conflict resolution.

## Pokémon data and assets

This prototype requests sprites, Pokémon base stats, types, and learnset/move metadata from [PokéAPI](https://pokeapi.co/) at runtime. It does **not** yet contain a verified, exhaustive offline Serebii moveset dataset. Data and images loaded from PokéAPI require an internet connection. For forms, PokéAPI's Pokémon endpoint can serve form-specific entries when the corresponding name or ID is available.

The battle arena is currently a neutral placeholder. No bespoke battle background or final art direction is included; the designated graphic-design workflow is to request original artwork separately and integrate approved assets later. Please only add external background art if you have permission to use and redistribute it; images found through Google or Pinterest are not automatically free to reuse.

## Claude Code instructions\n\nRead `CLAUDE.md` before making changes. The current styling is intentionally neutral; preserve the functional skeleton and avoid reintroducing decorative art direction until the owner requests it.\n\n## Save and account status

When signed out, progression is saved in localStorage. When signed in, the app syncs the game save to the signed-in user document at /users/{uid} in Firebase Cloud Firestore. Each account must be restricted to its own UID in Firestore Security Rules. Signing out leaves the local save in place. This prototype does not yet provide self-service cloud-account deletion. Review the privacy policy and deletion process before a public launch.

## Deployment

This is a static site and can be hosted on Vercel with no build step: the repository root contains `index.html`, `styles.css`, and `app.js`.

## Legal notice

PokeDuel is an unofficial fan project and is not affiliated with or endorsed by Nintendo, The Pokémon Company, or Game Freak. Pokémon names and related intellectual property belong to their respective owners. A public launch may require legal review, and this prototype is not presented as a commercial-use-cleared product.


## Firebase setup required

The app uses the Firebase 13.1.0 browser modules directly; no build step is required. In Firebase Console, enable Google under Authentication → Sign-in method, add pokeduel-henna.vercel.app (and localhost if testing locally) under Authentication → Settings → Authorized domains, create a Cloud Firestore database, and publish restrictive rules so a signed-in user can access only /users/{their UID}. Never use public read/write rules. The client configuration is in app.js; it is not a service-account credential. Cloud sync will report an error until the Console setup and rules are complete.
