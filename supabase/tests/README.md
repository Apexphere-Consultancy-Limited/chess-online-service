# Backend Tests

Comprehensive test suite for the Chess Online Service backend, covering database schema, Edge Functions, and integration scenarios.

## Prerequisites

- Supabase CLI installed and running locally (`supabase start`)
- Edge Functions running (`supabase functions serve`)
- Deno installed (for running tests)

## Test Structure

```
tests/
├── helpers/
│   └── test-utils.ts             # Shared test utilities
├── functions/
│   ├── create-game.test.ts               # create-game function tests
│   ├── validate-move.test.ts             # validate-move function tests
│   ├── upsert-lobby-session.test.ts      # lobby heartbeat function tests
│   ├── create-challenge.test.ts          # challenge creation rule tests
│   ├── respond-to-challenge.test.ts      # challenge response lifecycle tests
│   ├── cleanup-lobby-sessions.test.ts    # cron cleanup behavior tests
│   └── mark-notification-read.test.ts    # notification read helper tests
├── database/
│   ├── profiles_games_moves.test.ts     # Core tables, defaults, triggers
│   ├── lobbies.test.ts                  # Lobby segmentation & sessions RLS
│   └── challenges_notifications.test.ts # Challenge + notification policies
├── integration/
│   └── lobby-challenge.test.ts          # End-to-end lobby challenge flow
├── deno.json                     # Deno test configuration
├── import_map.json               # Import mappings
└── README.md                     # This file
```

## Running Tests

### Run all tests
```bash
cd supabase/tests
deno task test
```

### Run all tests with verbose output
```bash
deno task test:all
```

### Run specific test suite
```bash
# Database tests only
deno task test:database

# All Edge Function tests
deno task test:functions

# Specific function tests
deno task test:create-game
deno task test:validate-move

# Integration tests
deno test --allow-net --allow-env integration/
```

### Watch mode (re-run on file changes)
```bash
deno task test:watch
```

### Code coverage
```bash
# Generate coverage
deno task test:coverage

# View coverage report
deno task coverage
```

## Test Coverage

### Database Tests
- `database/profiles_games_moves.test.ts`
  - ✅ Table existence (profiles, games, moves)
  - ✅ Profile and game defaults
  - ✅ Game completion trigger updates stats/ELO
  - ✅ Anonymous RLS enforcement on games
- `database/lobbies.test.ts`
  - ✅ Lobby & membership tables exist with seeded slices
  - ✅ Private lobby visibility gated by membership
  - ✅ `lobby_sessions` RLS blocks cross-lobby inserts
- `database/challenges_notifications.test.ts`
  - ✅ Challenge `lobby_id` constraint
  - ✅ Challenge RLS limits visibility to participants
  - ✅ Notifications readable only by recipients

### create-game Function Tests (`functions/create-game.test.ts`)
- ✅ Authentication required
- ✅ Successful game creation
- ✅ Reject self-play
- ✅ Reject non-existent opponent
- ✅ Random color assignment
- ✅ Correct player ID assignment

### validate-move Function Tests (`functions/validate-move.test.ts`)
- ✅ Authentication required
- ✅ Valid opening move
- ✅ Illegal move rejection
- ✅ Turn order enforcement
- ✅ Alternating moves
- ✅ Checkmate detection (Fool's Mate)
- ✅ Move metadata recording

### Additional Function Tests
- `functions/upsert-lobby-session.test.ts`
  - ✅ Auth enforcement for lobby heartbeat
  - ✅ Auto-placement by ELO & explicit slug handling
  - ✅ Private lobby membership checks
  - ✅ DELETE endpoint removes presence row
- `functions/create-challenge.test.ts`
  - ✅ Rejects challengers not in lobbies
  - ✅ Ensures opponents share lobby & are available
  - ✅ Creates challenge + notification payloads
  - ✅ Prevents duplicate pending invites
- `functions/cancel-challenge.test.ts`
  - ✅ Requires auth and challenger ownership
  - ✅ Cancels pending challenge and emits cancellation notification
  - ✅ Blocks cancellation by other players or after acceptance
- `functions/respond-to-challenge.test.ts`
  - ✅ Rejects unauthenticated responses
  - ✅ Decline flow updates status & notifies challenger
  - ✅ Accept flow creates game & toggles lobby sessions
  - ✅ Guards when challenger leaves lobby
- `functions/cleanup-lobby-sessions.test.ts`
  - ✅ Requires service-role authorization
  - ✅ Removes stale sessions & expires old challenges
- `functions/mark-notification-read.test.ts`
  - ✅ Rejects unauthenticated requests
  - ✅ Marks specific notifications as read
  - ✅ `markAll` clears all unread entries

### Integration Tests
- `integration/lobby-challenge.test.ts`
  - ✅ Two-player flow from lobby heartbeat → challenge → acceptance
  - ✅ Confirms game creation, notifications, and lobby session updates

## Environment Variables

Tests use default local Supabase credentials. Override if needed:

```bash
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding new tests.

## Debugging Tests

### View test output
```bash
deno test --allow-net --allow-env --reporter=pretty
```

### Run single test
```bash
deno test --allow-net --allow-env --filter "test name"
```

### Check Supabase logs
```bash
# View database logs
supabase logs db

# View function logs
supabase functions logs
```

## Troubleshooting

**Tests fail with "Connection refused"**
- Ensure Supabase is running: `supabase status`
- Start Supabase: `supabase start`

**Edge Function tests timeout**
- Ensure functions are served: `supabase functions serve`
- Check function logs for errors

**RLS policy tests fail**
- Reset database: `supabase db reset`
- Verify migrations applied: `supabase migration list`
