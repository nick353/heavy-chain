# Edge Function Test Matrix

| Function | Guard | External API mocked in smoke | Durable image source |
| --- | --- | --- | --- |
| generate-image | usage + observability | yes | `storage_path` |
| remove-background | usage + observability | yes | `storage_path` |
| upscale | usage + observability | yes | `storage_path` |
| colorize | usage + observability | yes | `storage_path` |
| generate-variations | usage + observability | yes | `storage_path` |
| design-gacha | usage + observability | yes | `storage_path` |
| product-shots | usage + observability | yes | `storage_path` |
| model-matrix | usage + observability | yes | `storage_path` |
| multilingual-banner | usage + observability | yes | `storage_path` |
| optimize-prompt | usage + observability | yes | no image output |
| bulk-download | usage + observability | yes | reads `storage_path` |
| share-link | observability | yes | references image record |

`npm run smoke:edge` is intentionally static and does not call Gemini, OpenAI, or Supabase.
