# Example: a good pull request description

Title: `fix: retry failed webhook deliveries with backoff`

```markdown
Jira: SHOP-512 (part of SHOP-500, INC-17 remediation)

## Why

On 05-03 a 20-minute outage at a partner endpoint dropped 1,840 `order.created` webhooks. The ACME orders service sent each webhook once and logged the failure at debug level. Nobody saw the loss until the partner reported missing orders two days later.

## What

**Webhook sender:** a failed delivery goes to a retry queue. The action depends on the response:

| Response | Action | Replay of 05-03 |
|---|---|---|
| timeout, connection error, 5xx | retry with backoff, 30 s doubling to 1 h, 6 attempts max | 1,840 of 1,840 delivered, max delay 24 min |
| 429 | retry after the `Retry-After` value | not in the replay |
| other 4xx | no retry, log at error level | 0 |

The retry queue uses the existing `outbox` table in Postgres, not a new Redis queue. A pending delivery survives a pod restart, and no new infrastructure is necessary.

After 6 failed attempts, the sender stops and increments `webhook_delivery_failed_total{reason}`. There is no dead-letter UI in this PR.

**Database:** migration `0042_outbox_retry` adds `attempts` and `next_attempt_at` to `outbox`, with an index on `next_attempt_at`.

This replaces the manual replay script from #88 (merged). Its removal is in a separate PR.

## Checks

- `pytest tests/webhooks`: 42 passed.
- Replay of the 05-03 failure log against a stub endpoint that returns 503 for 20 min: all 1,840 webhooks delivered.
- `alembic upgrade head`, then `alembic downgrade -1` on a copy of the staging database: both succeed.
- Staging, stub endpoint returns 429 with `Retry-After: 60`: second attempt after 60 s.

## Notes for reviewers

- A partner that answers 200 but does not process the event still loses data. This needs a delivery acknowledgement. That is worth a separate ticket.
- Other errors in the sender still log at debug level. They are left as they are.
```
