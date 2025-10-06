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
│   ├── create-game.test.ts       # create-game function tests
│   └── validate-move.test.ts     # validate-move function tests
├── database.test.ts              # Database schema, RLS, triggers
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

### Database Tests (`database.test.ts`)
- ✅ Table existence (profiles, games, moves)
- ✅ Default values (ELO rating, game state)
- ✅ Auto-profile creation trigger
- ✅ RLS policies enforcement
- ✅ `increment_player_stats` function

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
