# Bot Animations

Bot animations are served from Supabase Storage with CDN caching.

---

## URL Format

```
{SUPABASE_URL}/storage/v1/object/public/bot-animations/{bot-difficulty}/{bot-difficulty}-{animation}.gif
```

**Example:**
```
https://abcdef.supabase.co/storage/v1/object/public/bot-animations/easy-bot/easy-bot-idle-1.gif
```

---

## Available Animations

### Easy Bot
- `idle-1` - Primary idle animation
- `idle-2` - Secondary idle animation
- `thinking` - Bot is thinking
- `capture-piece` - Bot captured opponent's piece
- `lost-piece` - Bot lost a piece
- `celebrate` - Bot won the game
- `scared` - Bot is in trouble
- `check` - Bot delivered check

### Medium Bot
- `idle` - Idle animation
- `thinking` - Bot is thinking
- `capture-piece` - Bot captured a piece
- `lost-piece` - Bot lost a piece
- `check` - Bot delivered check
- `scared` - Bot is scared
- `win` - Bot won the game
- `lost-game` - Bot lost the game

### Hard Bot
- `idle-1` - Primary idle animation
- `thinking` - Bot is thinking
- `capture-piece` - Bot captured a piece
- `lost-piece` - Bot lost a piece
- `celebrate` - Bot won the game
- `check` - Bot delivered check

---

## Frontend Integration

### Environment Variable

Set in your `.env`:
```bash
VITE_SUPABASE_URL=https://your-project-id.supabase.co
```

### Helper Function

```typescript
// lib/storage.ts
const STORAGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/bot-animations`

export function getBotAnimationUrl(
  difficulty: 'easy' | 'medium' | 'hard',
  animation: string
): string {
  return `${STORAGE_URL}/${difficulty}-bot/${difficulty}-bot-${animation}.gif`
}
```

### Usage in Components

```tsx
import { getBotAnimationUrl } from '@/lib/storage'

function BotAvatar({ difficulty }: { difficulty: 'easy' | 'medium' | 'hard' }) {
  const idleUrl = getBotAnimationUrl(difficulty, 'idle-1')

  return (
    <img
      src={idleUrl}
      alt={`${difficulty} bot`}
      loading="lazy"
    />
  )
}
```

### All URLs Registry (Optional)

```typescript
// constants/botAnimations.ts
import { getBotAnimationUrl } from '@/lib/storage'

export const BOT_ANIMATIONS = {
  easy: {
    idle: getBotAnimationUrl('easy', 'idle-1'),
    idle2: getBotAnimationUrl('easy', 'idle-2'),
    thinking: getBotAnimationUrl('easy', 'thinking'),
    capturePiece: getBotAnimationUrl('easy', 'capture-piece'),
    lostPiece: getBotAnimationUrl('easy', 'lost-piece'),
    celebrate: getBotAnimationUrl('easy', 'celebrate'),
    scared: getBotAnimationUrl('easy', 'scared'),
    check: getBotAnimationUrl('easy', 'check'),
  },
  medium: {
    idle: getBotAnimationUrl('medium', 'idle'),
    thinking: getBotAnimationUrl('medium', 'thinking'),
    capturePiece: getBotAnimationUrl('medium', 'capture-piece'),
    lostPiece: getBotAnimationUrl('medium', 'lost-piece'),
    check: getBotAnimationUrl('medium', 'check'),
    scared: getBotAnimationUrl('medium', 'scared'),
    win: getBotAnimationUrl('medium', 'win'),
    lostGame: getBotAnimationUrl('medium', 'lost-game'),
  },
  hard: {
    idle: getBotAnimationUrl('hard', 'idle-1'),
    thinking: getBotAnimationUrl('hard', 'thinking'),
    capturePiece: getBotAnimationUrl('hard', 'capture-piece'),
    lostPiece: getBotAnimationUrl('hard', 'lost-piece'),
    celebrate: getBotAnimationUrl('hard', 'celebrate'),
    check: getBotAnimationUrl('hard', 'check'),
  },
} as const
```

---

## Performance

**Caching:**
- CDN cache: 1 year (`max-age=31536000`)
- First load: ~200-500ms
- Cached: ~20-50ms

**Best Practices:**
- Use `loading="lazy"` for off-screen images
- Preload critical animations (idle, thinking)
- Add error fallback images

**Example with error handling:**
```tsx
<img
  src={getBotAnimationUrl('easy', 'idle-1')}
  alt="Easy bot"
  loading="lazy"
  onError={(e) => {
    e.currentTarget.src = '/fallback-bot.png'
  }}
/>
```
