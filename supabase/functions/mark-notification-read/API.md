# mark-notification-read

Mark one or more in-app notifications as read for the authenticated user.

## Endpoint

```
POST /functions/v1/mark-notification-read
```

## Authentication

Required headers:
- `Authorization: Bearer {jwt-token}`
- `Content-Type: application/json`

## Request

Two modes are supported:

### Mark specific notifications
```json
{
  "notificationIds": ["uuid", "uuid"]
}
```

### Mark all unread notifications
```json
{
  "markAll": true
}
```

> Providing both `notificationIds` and `markAll` marks specific IDs only. At least one of the fields is required.

## Response

### Success (200)

```json
{
  "success": true,
  "updatedCount": 2
}
```

**Fields**
- `updatedCount` (number) — Number of notifications whose `read_at` timestamp was set.

### Errors

- **400 Bad Request** – No identifiers provided.
- **401 Unauthorized** – Missing/invalid JWT.
- **500 Internal Server Error** – Failure updating notifications.

## Notes

- Only notifications belonging to the caller (`recipient_id`) are modified.
- Already-read notifications remain unchanged; the count reflects rows actually updated.

## Example

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/mark-notification-read \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"notificationIds":["4b62e3f4-5f32-4de1-a045-2f173b524a5d"]}'
```
