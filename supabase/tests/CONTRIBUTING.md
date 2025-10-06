# Contributing Tests

## Adding New Tests

### For New Edge Functions

Create `functions/new-function.test.ts`:

```typescript
import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import { createTestUser, deleteTestUser, callFunction } from '../helpers/test-utils.ts'

Deno.test("new-function: Does something", async () => {
  let user = null

  try {
    user = await createTestUser('testuser')
    const { response, data } = await callFunction('new-function', { ... }, user.token)
    assertEquals(data.success, true)
  } finally {
    if (user) await deleteTestUser(user.id)
  }
})
```

Add to `deno.json`:
```json
"test:new-function": "deno test --allow-net --allow-env functions/new-function.test.ts"
```

### For Database Changes

Add tests to `database.test.ts` for:
- New tables
- New constraints
- New triggers
- New functions

### For Shared Utilities

Add helpers to `helpers/test-utils.ts` if you need:
- Common test data creation
- Reusable test patterns
- Setup/teardown logic

## Test Patterns

Always use the try/finally pattern for cleanup:

```typescript
let user = null
try {
  user = await createTestUser('test')
  // test code
} finally {
  if (user) await deleteTestUser(user.id)
}
```

## Before Submitting

1. Run all tests: `deno task test`
2. Ensure cleanup works (no orphaned data)
3. Use descriptive test names
4. Test both success and error cases
