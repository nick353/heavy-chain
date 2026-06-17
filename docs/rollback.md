# Rollback

If Edge Function deployment fails, redeploy the last known good function bundle:

```bash
supabase functions deploy generate-image
```

If usage quota logic blocks valid traffic, pause traffic at the app layer and inspect:

```sql
select * from public.usage_events order by created_at desc limit 50;
select * from public.edge_function_runs order by created_at desc limit 50;
```

Database rollback should be handled by a forward migration. Do not delete usage or audit rows unless legal retention policy explicitly allows it.
