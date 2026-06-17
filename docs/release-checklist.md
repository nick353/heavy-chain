# Release Checklist

1. `npm run verify`
2. `npm run build`
3. `npm run supabase:verify`
4. Apply migrations to staging.
5. Deploy Edge Functions.
6. Run a staging smoke with mocked browser routes.
7. Confirm no generated image row stores a signed URL or data URL as canonical state.

Cut release only after staging usage events show `reserved` followed by `succeeded` or `failed`.
