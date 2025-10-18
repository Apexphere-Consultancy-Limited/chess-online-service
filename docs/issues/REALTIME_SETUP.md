# Supabase Realtime Setup for Lobby

## Issue
Online players list not updating in real-time when new players join the lobby.

## Required Configuration

### 1. Enable Realtime for lobby_sessions Table

In your Supabase dashboard:

1. Go to **Database** → **Replication**
2. Find the `lobby_sessions` table
3. Enable **Realtime** for this table
4. Click **Save**

### 2. Check Row Level Security (RLS) Policies

The realtime subscriptions respect RLS policies. Ensure you have proper SELECT policies on `lobby_sessions`:

```sql
-- Allow users to see all sessions in their current lobby
CREATE POLICY "Users can view lobby sessions"
ON lobby_sessions
FOR SELECT
USING (true);  -- or more restrictive based on your needs
```

### 3. Verify Realtime is Working

Open browser console when on the lobby page. You should see:
- "Lobby session realtime update:" messages when players join/leave
- No "CHANNEL_ERROR" or "CLOSED" warnings

### 4. Test

1. Open lobby page in two different browsers/incognito windows
2. Sign in with different accounts
3. Watch the "Players Online" section update automatically

## Troubleshooting

### If realtime still doesn't work:

1. **Check Supabase realtime logs**
   - Go to Supabase Dashboard → Logs → Realtime

2. **Verify channel subscription**
   - Console should show successful channel subscription
   - Check for "CHANNEL_ERROR" messages

3. **Check heartbeat**
   - Players send heartbeat every 20 seconds
   - Stale sessions (> 30 seconds) are automatically cleaned up

4. **Fallback: Manual refresh**
   - The hook will auto-retry if channel closes unexpectedly (lines 347-355 in useLobby.ts)

## Implementation Details

The realtime subscription is set up in `src/hooks/useLobby.ts`:

- **Line 296-307**: Postgres changes listener for `lobby_sessions` table
- **Line 342-357**: Channel status monitoring and auto-reconnect
- **Line 127-147**: Session refresh logic
