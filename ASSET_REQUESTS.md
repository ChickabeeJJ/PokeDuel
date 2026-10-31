# Asset requests

The UI now uses official sprites/artwork from the PokéAPI sprite repository for Pokémon, items and types, and plain gradient fallbacks for scenery. These backgrounds are the only artwork still wanted. They are **optional**: the game works without them.

## How to add an approved asset

1. Save the file in `assets/backgrounds/`.
2. Put its filename in `assets/manifest.json`, e.g. `"battle-hard": "battle-hard.jpg"`.
3. Reload. Only files listed in the manifest are requested, so a missing file never causes errors.

Please keep everything original (no screenshots or traced game art), with no Pokémon, people or text in the image.

## 1. Home / menu background — `home`

- **Purpose:** sits behind the Home screen and the Shop/Bag panels. The UI draws dark navy translucent panels on top of it.
- **Size:** 2400 × 1350 px (16:9). JPG or WebP, under 400 KB.
- **Composition:** a calm outdoor town or harbour plaza at dusk, viewed from about head height. Keep the left third and right quarter visually quiet, because the party list and main menu cover those areas. No strong focal point in the centre.
- **Palette:** deep blues and teals with warm window/lamp highlights (around `#1b2b55`, `#0f6c7c`, and amber `#f6c14a`). Slightly desaturated so white text stays readable.
- **Transparency:** none.

## 2–5. Battle backgrounds — `battle-easy`, `battle-medium`, `battle-hard`, `battle-practice`

- **Purpose:** the battle arena. The game draws two soft elliptical platforms, the Pokémon sprites and the HP panels on top of it.
- **Size:** 1920 × 1080 px (16:9). JPG or WebP, under 350 KB each. The arena is cropped with `background-size: cover`, so keep important detail away from the outer 10%.
- **Composition (all four):** low camera, open ground. The horizon sits **46% from the top**. The opponent stands about 30% from the top at the right, and the player's Pokémon at the bottom left, so keep those areas uncluttered. No platforms, because the game draws its own.
- **Themes:**
  - `battle-easy` — sunny meadow, soft blue sky and green grass (`#8fd3ff` → `#6eb85e`).
  - `battle-medium` — rocky canyon at golden hour, warm oranges and sand (`#f7b267` → `#9b8a5e`).
  - `battle-hard` — night stadium or plateau under stars, deep violet with cool rim light (`#1b1640` → `#22263f`).
  - `battle-practice` — tidy training ground by the water, mint and teal (`#7ec6e8` → `#58a88d`).
- **Transparency:** none.
