# DARAK — Operations Runbook

## Health & monitoring
- `GET /api/health` → DB ping + latency. Wire to UptimeRobot / Better Uptime (1-min interval, alert after 2 failures).
- Logs are JSON lines on stdout (`src/lib/logger.ts`). Ship with Vercel Log Drains, Datadog agent, or `docker compose logs`. Set `SENTRY_DSN` to forward errors.
- In-app: `/admin/health` (platform) and `/integrations` (per office) show integration status; `ERROR` states notify the account owners automatically via the engine.

## Scheduled jobs
`GET /api/cron/run` (every 15 min) runs for every non-suspended organization:
1. Contract statuses, renewal workflow (90/60/30 days), unit status sync.
2. Installment statuses, collection cases, priority scores, broken promises, escalation, tenant reminders.
3. Document expiry tasks, pending expense approvals, integration health.
4. Housekeeping: expired/revoked sessions > 30 d, throttle rows > 7 d, login codes > 1 d.
If cron stops, dashboards still recompute on load (engine runs on `/dashboard`), but reminders/escalations pause. Alert if the last `cron.run` log line is older than 30 min.

## Backups & restore
- Nightly `pg_dump -Fc` (docker `backup` service) or `pnpm backup` (S3 upload with `BACKUP_S3_BUCKET`). Managed Postgres PITR covers RPO ≤ 15 min.
- **Restore drill (monthly):**
  ```bash
  createdb darak_restore
  pg_restore --clean --if-exists -d "postgresql://.../darak_restore" backups/darak-YYYYMMDD-HHMM.dump
  DATABASE_URL="postgresql://.../darak_restore" pnpm smoke   # against a staging app pointed at it
  ```
- Uploaded files: object storage versioning on (R2/S3), or snapshot the `uploads` volume with the DB.

## Incident playbooks
| Symptom | Check | Fix |
|---|---|---|
| 503 from `/api/health` | DB reachable? `DATABASE_URL`, connection limit | Restart app; scale Postgres connections; check PITR |
| Users cannot log in, no error | `COOKIE_SECURE` on plain http | Set TLS or `COOKIE_SECURE=false` (LAN only) |
| Login code never arrives | SMS vendor keys wrong or sender not approved | Check IntegrationLog / vendor console; temporarily `OTP_ECHO=always` on staging |
| "تم تجاوز عدد المحاولات" for a real user | Throttle rows: per IP in `LoginAttempt` (keys `probe:<ip>`, `verify:<ip>`), per number in `OtpCode` (15-minute windows; they expire on their own) | Wait 15 minutes, or clear one number: `DELETE FROM "OtpCode" WHERE phone='9665XXXXXXXX' AND "consumedAt" IS NULL` and one IP: `DELETE FROM "LoginAttempt" WHERE key IN ('probe:<ip>','verify:<ip>')` |
| Reminders not sent | `/integrations?tab=logs` shows `[محاكاة]` | Provider keys missing → fill env, restart |
| Slow dashboard (>3 s) | DB indexes present (`prisma db push` applied), org size | Add read replica; move reports to background jobs |

## Security operations
- Rotate `AUTH_SECRET` to force global logout (all sessions invalid). Rotate `CRON_SECRET` and webhook secrets yearly.
- Support access to a customer org is only via `/admin` → "دخول دعم فني" (reason + duration, audited as `SUPPORT_ACCESS`).
- Offboarding an employee: Employees → deactivate (revokes sessions) — never delete (audit trail).
- PDPL requests arrive as tickets `[PDPL] …` (Settings → Security). SLA 30 days. Data export: Reports → CSV/Excel; erasure: archive + anonymize after legal retention.
- Review `/audit` weekly for `PERMISSION_CHANGE`, `EXPORT`, `SUPPORT_ACCESS`.

## Capacity
- Stateless app: scale horizontally. Postgres: start 2 vCPU / 4 GB; indexes are in `packages/db/prisma/schema/*.prisma`.
- Reports over ~50k installments: move `reports/queries.ts` to a nightly materialized summary table (planned).
