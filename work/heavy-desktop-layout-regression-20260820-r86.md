# Heavy desktop layout regression r86

更新日: 2026-08-20

## Verification

`npm run verify:unified-desktop-layout` passed:

- scheduled: 228
- completed: 228
- failed: 0
- global timeout: false
- cleanup leftovers: 0
- preview/context cleanup: passed
- tested widths: 1280px, 1440px, 1920px, 2560px
- covered launcher, fabric, printing, AI fitting, Gallery, History, Jobs,
  all non-video canonical routes, and their route aliases

## Boundary

This is local desktop-width/layout evidence. It does not prove separate
Windows/macOS runtime acceptance, current Chrome extension capability, provider
generation, persistence, or internal beta acceptance.
