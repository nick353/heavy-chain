# Lightchain home visual parity r83

- Source: fresh current Lightchain production homepage readback from the current Profile 2 run, compared against the local Heavy `/lightchain` screenshot.
- Changed surface: `src/components/GenerateLightchainEntry.tsx`.
- Root structure now follows the production layout: `LIGHTCHAIN AI` hero with the inline apparel-workspace subtitle, prompt input, four category tabs, and a three-column non-video feature-card grid directly below the tabs.
- Removed from the root visual: the extra category heading/description between tabs and cards.
- Card order is the current non-video production order: design workspace, marketing workspace, AI fitting, wear design lab, model planning library, fashion studio, design agent.
- Card thumbnails are local deterministic SVG previews; no production image asset or external fetch is used.
- Video cards remain excluded by the existing beta catalog filter.
- Local evidence: `output/playwright/lightchain-all-feature-workflows-20260820T075813Z/desktop-index.png`.
- Verification: `npm run verify:lightchain-all-features`, `featureCount=31`, `failed=[]`, build `2608 modules transformed`.
- External generation, upload, save, publish, recording, and deployment were not performed.
