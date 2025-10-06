# CodeKids AI Game Center

A multiplayer chess platform with real-time gameplay, built with React and Supabase.

## Features

- **Authentication**
  - Email/Password signup and login
  - Magic link authentication
  - Google OAuth integration

- **Game Modes**
  - Real-time chess (live gameplay)
  - Turn-based chess (play at your own pace)

- **Player Features**
  - Player profiles with ratings
  - Game history and statistics
  - Active game management
  - Game lobby to find opponents

- **Real-time Updates**
  - Live move synchronization
  - Game state updates
  - Opponent notifications

## Tech Stack

- **Frontend**: React + Vite
- **Backend**: Supabase (PostgreSQL + Real-time subscriptions)
- **Authentication**: Supabase Auth
- **Database**: PostgreSQL with Row Level Security

## Setup Instructions

### Option A: Local Development (Recommended)

#### 1. Install Dependencies

```bash
npm install
```

#### 2. Start Local Supabase

The project is already configured for local Supabase. Simply run:

```bash
supabase start
```

This will:
- Start all Supabase services in Docker containers
- Apply the database schema automatically
- Create the storage bucket for avatars
- Set up authentication providers

The local instance will be available at:
- **API**: http://127.0.0.1:54321
- **Studio (Dashboard)**: http://127.0.0.1:54323
- **DB**: postgresql://postgres:postgres@127.0.0.1:54322/postgres

#### 3. Environment Variables

The `.env` file is already configured with local Supabase credentials. No changes needed!

#### 4. Run the Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

#### 5. Access Supabase Studio

Open http://127.0.0.1:54323 to access the local Supabase dashboard where you can:
- View tables and data
- Run SQL queries
- Manage authentication
- Monitor real-time subscriptions

#### 6. Stop Local Supabase

When done developing:

```bash
supabase stop
```

### Option B: Production Setup (Supabase Cloud)

#### 1. Install Dependencies

```bash
npm install
```

#### 2. Set Up Supabase Project

1. Go to [Supabase](https://supabase.com) and create a new project
2. Wait for the database to be provisioned

#### 3. Configure Database Schema

1. In your Supabase project, go to the SQL Editor
2. Copy the contents of `supabase/migrations/20240101000000_initial_schema.sql`
3. Run the SQL to create all tables, policies, and triggers

#### 4. Configure Authentication Providers

In your Supabase project dashboard:

1. Go to Authentication > Providers
2. Enable Email provider (enabled by default)
3. For Google OAuth:
   - Enable Google provider
   - Add your Google OAuth credentials
   - Configure redirect URLs

#### 5. Create Storage Bucket

For avatar uploads:

1. Go to Storage in Supabase dashboard
2. Create a new bucket named `avatars`
3. Make it public

#### 6. Set Environment Variables

Update `.env` with your production Supabase credentials:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

You can find these values in your Supabase project settings under API.

#### 7. Run the Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

## Database Schema

### Tables

- **profiles**: User profiles with ratings and statistics
- **games**: Chess game states and metadata
- **moves**: Move history for each game
- **game_invitations**: Game invitation system

### Key Features

- **Row Level Security (RLS)**: All tables have RLS policies to ensure users can only access their own data
- **Real-time subscriptions**: Games and moves update in real-time
- **Automatic stats tracking**: Player statistics update automatically when games complete
- **Profile auto-creation**: User profiles are created automatically on signup

## Project Structure

```
src/
├── contexts/
│   └── AuthContext.jsx       # Authentication context and hooks
├── lib/
│   └── supabase.js           # Supabase client initialization
├── pages/
│   ├── Login.jsx             # Login/signup page
│   ├── Dashboard.jsx         # Main dashboard
│   └── ChessGame.jsx         # Chess game interface
├── services/
│   ├── gameService.js        # Game-related database operations
│   └── profileService.js     # Profile-related database operations
├── App.jsx                   # Main app component with routing
├── main.jsx                  # App entry point
└── index.css                 # Global styles
```

## Usage

### Creating a Game

1. Log in or sign up
2. Click "Create Real-time Game" or "Create Turn-based Game"
3. Wait for an opponent to join, or share the game link

### Joining a Game

1. Go to the dashboard
2. Browse available games in the "Available Games" section
3. Click "Join Game" on any waiting game

### Playing Chess

1. Click on a piece to select it (must be your color and your turn)
2. Click on a destination square to move
3. The move will be validated and synchronized in real-time

### Game Actions

- **Resign**: Give up the current game
- **View History**: See all moves played in the game

## Future Enhancements

- Chess move validation using chess.js library
- Timer/clock for timed games
- Draw offers and acceptance
- Game chat
- Spectator mode
- Tournament system
- Opening book and analysis
- Mobile responsive design
- Drag and drop pieces
- Move hints and legal move highlighting
- Game import/export (PGN format)

## Notes

- The current chess implementation is simplified and doesn't include full chess rules validation
- For production use, integrate a chess library like `chess.js` for proper move validation
- Consider adding rate limiting and abuse prevention
- Implement proper error boundaries and loading states
- Add comprehensive testing

## License

MIT
