# Chrome Plugin/Profile 2 foreground capability readback — 2026-08-20 r1

- selector: `chrome_plugin` / Profile 2 / `signed_chrome_extension_profile2` / revision `6`
- fresh browser-client: `-4d88-4f63-a2e9-f4267acc60d4`
- fresh session boundary: `398a3d47-695e-40f7-bbb0-2b1419697b78`
- `openTabs()` handshake: PASS
- advertised capabilities: `viewport` only
- advertised foreground activation: absent
- advertised management capability: absent
- selected/claim/focus/foreground lease: not called

## Exact blocker

- `chrome_foreground_activation_capability_unavailable`
- Existing foreground operation blocker remains `chrome_selected_tab_readback_invalid`.

Target-scoped read-only remains available. Provider generation, rights confirmation, save/reuse, and other foreground operations remain fail-closed until a fresh official capability/owner proof is available.
