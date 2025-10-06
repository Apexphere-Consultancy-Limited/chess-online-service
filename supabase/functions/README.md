# Edge Functions

Backend API for Chess Online Service.

## Available Functions

- [create-game](create-game/API.md) - Create a new chess game
- [validate-move](validate-move/API.md) - Validate and execute a move

## Base URL

- **Local**: `http://127.0.0.1:54321/functions/v1`
- **Production**: `https://{project-ref}.supabase.co/functions/v1`

## Authentication

All functions require JWT authentication via `Authorization: Bearer {token}` header.

Get token from Supabase Auth:
```javascript
const { data: { session } } = await supabase.auth.getSession()
const token = session.access_token
```
