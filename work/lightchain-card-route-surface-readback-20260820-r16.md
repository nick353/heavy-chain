# Lightchain card route surface readback r16

日時: 2026-08-20 JST

## result

The current Lightchain homepage category panels were read in a fresh official
Chrome Plugin / Profile 2 target-scoped run after the r15 category ledger.

- selector: `backend=chrome_plugin`, revision `6`
- browser-client: `-ada4-4997-8241-a6447bcb922e`
- owner turn: `01a01bfe-5116-7610-a513-a9fc5618c4a2`
- target tab: `1980903829`
- URL/title: `https://jp.linkaigc.com/` / `Lightchain AI`
- categories read: all four current category panels
- cleanup: `cleanup_verified=true`, closed only `1980903829`, no close failures

## route surface

For the visible card paragraphs in all four panels, the nearest card ancestor
was a clickable `div` with a `cursor-pointer` class. The inspected visible DOM
did not expose any of the following on the card or its first ancestors:

- `href`
- `data-route`
- `data-tool-id`
- `onclick`
- an explicit ARIA route/action attribute

Therefore exact href/route mapping cannot be established from the current
visible card DOM without opening a card or using an unsupported hidden
framework/API inspection path.

## changed / verification

- Category tabs were selected only to expose each visible panel.
- Card elements were not opened.
- No navigation, upload, login, generation, rights confirmation, save, reuse,
  download, recording, AOS change, or external effect occurred.
- The r15 card names/counts remain the current information-architecture
  baseline; this r16 artifact records why route mapping remains pending.

## remaining blocker

`lightchain_card_route_mapping_not_exposed_in_visible_dom`

This is a readback limitation, not a claim that the routes do not exist. The
Lightchain live per-feature operation and Heavy production provider gate are
separate unresolved requirements. Heavy provider work remains blocked by
`chrome_foreground_activation_capability_unavailable`.

## next action

Use an approved route-bearing Lightchain surface or a future fresh readback
that visibly exposes the card destination. Do not infer routes from the old
revision-30 ledger. Continue Heavy local parity and provider-independent work
while the official foreground capability is unavailable.
