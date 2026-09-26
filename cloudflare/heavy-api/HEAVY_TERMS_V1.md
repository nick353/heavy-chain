# Heavy Chain image generation terms — v1

Heavy Chain image generation runs through the configured Cloudflare Workers AI
provider and the Heavy Chain account's internal usage limits. It does not create
a checkout, purchase, subscription, or public publication.

Before generating, the signed-in user must confirm that they are authorised to
use the prompt and every uploaded or referenced input for this request. Inputs
must not contain third-party logos, protected brand identity, a person's
likeness, or another creator's distinctive work unless the user has the needed
permission. Heavy Chain records the acceptance version and a request-scoped
attestation; it does not make a legal rights determination for the user.

The user is responsible for reviewing generated results before download,
sharing, publication, or commercial use. Provider quota, safety checks,
authentication, brand membership, and server-side request binding remain
enforced. A failed, unknown, or revoked request is not retried automatically.

This version is an operational product notice, not a statement of legal
clearance or a substitute for counsel. Heavy Chain may require a new acceptance
when the wording or rights-attestation policy changes.
