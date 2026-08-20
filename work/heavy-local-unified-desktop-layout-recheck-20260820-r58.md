# Heavy local unified desktop layout recheck r58

- Command: `npm run verify:unified-desktop-layout`
- Contract: 31 non-video features, 57 target routes, 4 desktop viewports (1280, 1440, 1920, 2560px), 228 checks.
- Result: `228/228` completed, `failed=0`, `globalTimedOut=false`, `cleanupLeftovers=0`.
- The previous r57 local run had one transient `operation_timeout` at `1280px / alias-model-library-models`. The focused full recheck passed that route and all other cells; no product source change was needed.
- This is local layout/readiness evidence only. It does not replace fresh Chrome/Profile 2 production provider generation, save/reuse/reload, Mac/Windows real-Chrome acceptance, or G619/H601/operator gates.
