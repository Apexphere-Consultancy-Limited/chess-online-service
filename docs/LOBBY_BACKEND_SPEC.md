# Stage 1 Lobby & Notification Backend Notes

## Schema & RLS
- Added `lobbies` and `lobby_members` to define slices (Starter, Main, Advanced) and support private rooms later; seeded broad public bands keyed by ELO.
- `lobby_sessions` now carries `lobby_id` with unique ownership per player; RLS only exposes sessions inside lobbies the viewer can access (public or membership).
- `challenges` reference the originating lobby so invites stay in-segment; shared trigger keeps `updated_at` fresh for timeline sorts.
- `notifications` unchanged aside from richer payloads (lobby slug, usernames) to help the UI render without extra fetches.

## Edge Functions
- `upsert-lobby-session` now resolves the lobby slice (explicit `lobbySlug` or auto-pick from ELO), verifies private membership, and upserts the session with the proper lobby metadata.
- `cleanup-lobby-sessions` still runs with the service key to prune stale presence and expire pending challenges; no slice-specific changes required.
- `create-challenge` requires both players to be “available” in the same lobby before inserting the invite and emits `challenge_received` with the lobby slug.
- `cancel-challenge` lets challengers revoke pending invites; updates status to `cancelled` and emits `challenge_cancelled` notifications.
- `respond-to-challenge` re-checks lobby membership/availability before accepting, upgrades both sessions to `in_game`, spins up the game, and fans out acceptance/game-ready notifications including lobby context.
- `mark-notification-read` lets clients mark specific notifications or bulk clear unread items.

## Integration Notes
- Heartbeat: POST/PATCH `upsert-lobby-session` with `{ status, lobbySlug? }`; omit `lobbySlug` to auto-place by ELO, or provide one when switching slices. DELETE removes presence.
- Challenges: POST `create-challenge` with `{ challengedId }` or `{ challengedUsername }` plus optional `message`; both players must already be `available` in the same lobby.
- Responses: POST `respond-to-challenge` with `{ challengeId, action: "accept" | "decline" }`; acceptance keeps players in the lobby (status → `in_game`) and returns the new `game`.
- Notifications: POST `mark-notification-read` with `{ notificationIds: [...] }` or `{ markAll: true }`; payloads include `lobbySlug` when relevant.
- Schedule `cleanup-lobby-sessions` using the service-role bearer token so the authorization check passes.
- For production, provision a Supabase Scheduled Function job: deploy `cleanup-lobby-sessions`, then in the Supabase dashboard create a cron (e.g., `*/5 * * * *` for every 5 minutes) targeting `cleanup-lobby-sessions` with no payload. Supabase automatically signs the request with the service key, so no additional configuration is needed in the codebase.

## Tests Executed
- `deno check supabase/functions/upsert-lobby-session/index.ts`
- `deno check supabase/functions/cleanup-lobby-sessions/index.ts`
- `deno check supabase/functions/create-challenge/index.ts`
- `deno check supabase/functions/respond-to-challenge/index.ts`
- `deno check supabase/functions/mark-notification-read/index.ts`

## Discussion Starters
- Do we want a background job to archive expired challenges/notifications per lobby after a retention window?
- Should lobby selection auto-enroll newcomers into “Starter” until they complete placement games, or should we expose the slice picker immediately?
- Any extra metadata needed in `notifications.payload` (e.g., avatars, ELO snapshots) so the lobby UI never needs additional fetches?
# Stage 1 Lobby & Notification Implementation Spec

## Overview
Deliver lobby presence, challenge management, and in-app notifications for the Stage 1 Supabase-backed chess MVP. The scope assumes we already ship real-time gameplay and focuses on social flows that move players from the lobby into games.

## Objectives
- Expose segmented lobby presence so players only see relevant opponents (Starter, Main, Advanced).
- Support direct challenges with availability checks, automatic game creation on acceptance, and real-time notifications.
- Maintain system health with periodic cleanup of stale sessions and expired challenges.

## Functional Requirements

### Lobby Segmentation
- Players are auto-assigned to a lobby based on their ELO, unless an explicit `lobbySlug` is provided.
- Allow explicit lobby switching when the frontend supplies `lobbySlug`.
- Enforce visibility: public lobbies are readable by all authenticated users; private lobbies require membership in `lobby_members`.

### Presence Management
- Clients call `upsert-lobby-session` (POST/PATCH) with `{ status: "available" | "in_game", lobbySlug? }`.
- `upsert-lobby-session` resolves target lobby, verifies membership (for private lobbies), then upserts (`player_id`, `lobby_id`, `status`, `last_seen`).
- DELETE requests remove the player’s lobby session.

### Challenges & Notifications
- `create-challenge`:
  - Validates challenger is `available` in a lobby.
  - Validates opponent is `available` in the same lobby.
  - Rejects duplicate pending challenges.
  - Emits `challenge_received` notification with `challengeId`, `lobbySlug`, `challengerId`, `challengerUsername`.
- `respond-to-challenge`:
  - Decline flow updates status to `declined`, sends `challenge_declined` notification.
  - Accept flow revalidates lobby membership/availability, creates `game`, updates sessions to `in_game`, and emits `challenge_accepted` + `game_ready` notifications (payload includes `gameId`, `lobbySlug`, opponent info).
- `mark-notification-read` updates `read_at` for provided IDs or all unread records.

### Cleanup
- `cleanup-lobby-sessions` deletes `lobby_sessions` with `last_seen` older than 60 seconds and expires `challenges` past `expires_at`.
- Schedule a cron job (every 5 minutes) calling `cleanup-lobby-sessions` with service-role credentials.

## Data Model Updates
- `lobbies` table with seeded rows for Starter (<1200 ELO), Main (1200–1499), Advanced (1500+).
- `lobby_members` table for private lobby access control.
- `lobby_sessions` includes `lobby_id`, unique constraint on `(lobby_id, player_id)`, RLS restricting visibility to accessible lobbies.
- `challenges` gains `lobby_id`; `notifications` payloads enriched to include lobby context.

## API & Implementation Details
| Function | Method(s) | Request | Response | Notes |
|----------|-----------|---------|----------|-------|
| `upsert-lobby-session` | POST/PATCH/DELETE | `{ status?, lobbySlug? }` | `{ success, session }` | Auto-placement by ELO when `lobbySlug` omitted; DELETE removes presence. |
| `cleanup-lobby-sessions` | POST (cron) | none | `{ success, lobbySessionsRemoved, challengesExpired }` | Authenticate with service key. |
| `create-challenge` | POST | `{ challengedId?, challengedUsername?, message? }` | `{ success, challenge }` | Requires both players available in same lobby; dedup pending challenges. |
| `cancel-challenge` | POST | `{ challengeId }` | `{ success, status }` | Challenger-only; sets status to `cancelled`, emits cancellation notification. |
| `respond-to-challenge` | POST | `{ challengeId, action: "accept" | "decline" }` | `{ success, status, game? }` | Accept creates game, toggles lobby sessions, emits notifications. |
| `mark-notification-read` | POST | `{ notificationIds?: string[], markAll?: boolean }` | `{ success, updatedCount }` | Marks specified notifications or all unread. |

## Deployment & Scheduling
Run `./scripts/deploy-supabase.sh <project-ref>` to:
1. Deploy all edge functions.
2. Create/update cron schedule `cleanup-lobby-cron` calling `cleanup-lobby-sessions` every 5 minutes (`*/5 * * * *`).
The Supabase CLI must be authenticated (`supabase login`) prior to running the script.

## Testing Strategy
- Unit-ish Deno tests cover database RLS/constraints, edge function behavior (auth, lobby mismatch, notifications), and integration flows (lobby → challenge → acceptance, game completion/ELO).
- New tests include:
  - `database/lobbies.test.ts`, `database/challenges_notifications.test.ts`.
  - Edge function suites for lobby session heartbeat, challenges, responses, cleanup, notification read.
  - Integration tests validating end-to-end flows and ELO triggers.

## Outstanding Questions
- Should we archive expired challenges/notifications after a retention window?
- Do we auto-enroll newcomers into Starter until placement games finish or expose a lobby picker immediately?
- Do we need richer notification payload data (avatars, current ELO) to make frontend rendering zero-fetch?

---

# Extension: Challenge Cancellation

## Goal
Allow challengers to revoke a pending invite before it is accepted or declined, and ensure the challenged player sees the invite disappear via a `challenge_cancelled` notification.

## Functional Requirements
- Challenger can cancel only when `status = 'pending'`.
- Cancellation updates the challenge row to `status = 'cancelled'` and refreshes `updated_at`.
- Emit a `challenge_cancelled` notification to the challenged player with payload:
  ```json
  {
    "challengeId": "uuid",
    "lobbySlug": "main",
    "challengerId": "uuid",
    "challengerUsername": "player1"
  }
  ```
- Subsequent cancel attempts should fail with `409 Conflict` (already handled).
- Regular cleanup continues to expire pending challenges; no change to cron cadence.

## Schema Changes
- Update `challenges.status` check constraint to include `'cancelled'`.
- No new tables required; existing RLS permitting challenge participants to view rows covers this status.

## Edge Function: `cancel-challenge`
- **Endpoint:** `POST /functions/v1/cancel-challenge`
- **Auth:** JWT (challenger only).
- **Request Body:**
  ```json
  { "challengeId": "uuid" }
  ```
- **Responses:**
  - `200 OK` → `{ "success": true, "status": "cancelled" }`
  - `400 Bad Request` → Missing/invalid payload.
  - `401 Unauthorized` → Missing/invalid JWT.
  - `403 Forbidden` → Caller is not the original challenger.
  - `404 Not Found` → Challenge does not exist.
  - `409 Conflict` → Challenge already accepted/declined/expired/cancelled.
  - `500` → Unexpected failure.
- **Side Effects:** Insert `challenge_cancelled` notification, no game creation.

## Deployment Updates
- Add `cancel-challenge` to `scripts/deploy-supabase.sh` deployment list.
- Provide `API.md` documenting request/response structure (patterned after existing docs).

## Testing Plan
- **Database tests:** Verify updated status constraint accepts `'cancelled'`.
- **Function tests (`functions/cancel-challenge.test.ts`):**
  - Requires auth.
  - Challenger cancels pending challenge → status update + notification inserted.
  - Reject cancellation by non-challenger.
  - Reject when challenge already accepted/declined/expired/cancelled.
- **Integration (optional):** Flow covering create → cancel → ensure notification emitted and challenge no longer visible to challenged player.

## Frontend Considerations
- Add “Cancel” UI for outgoing challenges.
- Listen for `challenge_cancelled` notifications to remove invites in real time.
