# Neutronium Leaderboard

Global Progress Journal leaderboard for **Neutronium Expansion** board game.

## Overview

A web application that digitizes the Progress Journal system - an arcade-style leaderboard where players record their Neutronium (Nn) scores across 13 universe levels.

### Core Features

- Scan QR code on game box to join session
- Real-time multiplayer session management
- Track best scores per universe level
- Global and per-level leaderboards
- Guest play with optional email registration

## Tech Stack

- **Frontend:** Static HTML/CSS/JS (PWA-ready)
- **Hosting:** Cloudflare Pages
- **Backend:** Cloudflare Functions
- **Database:** Supabase PostgreSQL
- **Auth:** Magic Link via Resend

## Getting Started

### Prerequisites

- Node.js 18+
- Cloudflare account
- Supabase account
- Resend account (for email)

### Setup

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Set up Supabase:**
   - Create a new Supabase project
   - Run the schema from `database/schema.sql` in the SQL editor
   - Copy your project URL and service role key

3. **Configure environment:**
   ```bash
   cp .dev.vars.example .dev.vars
   # Edit .dev.vars with your credentials
   ```

4. **Run locally:**
   ```bash
   npm run dev
   ```

5. **Deploy to Cloudflare:**
   ```bash
   # Set secrets first
   wrangler pages secret put SUPABASE_URL
   wrangler pages secret put SUPABASE_SERVICE_KEY
   wrangler pages secret put RESEND_API_KEY
   wrangler pages secret put JWT_SECRET

   # Deploy
   npm run deploy
   ```

## Project Structure

```
neutronium-leaderboard/
├── public/                 # Static frontend files
│   ├── index.html          # Landing / QR entry
│   ├── session.html        # Active game session
│   ├── leaderboard.html    # Global rankings
│   ├── profile.html        # Player profile
│   ├── css/
│   │   └── styles.css      # Tailwind CSS
│   └── js/
│       ├── app.js          # Main app logic
│       ├── auth.js         # Auth state management
│       ├── session.js      # Session management
│       └── leaderboard.js  # Leaderboard fetching
├── functions/              # Cloudflare Functions (API)
│   └── api/
│       ├── auth/           # Authentication endpoints
│       ├── box/            # Game box management
│       ├── session/        # Session management
│       ├── leaderboard/    # Leaderboard queries
│       └── player/         # Player profiles
├── database/
│   └── schema.sql          # Supabase schema
├── wrangler.toml           # Cloudflare config
└── package.json
```

## API Endpoints

### Authentication
- `POST /api/auth/magic-link` - Send magic link email
- `GET /api/auth/verify` - Verify magic link token
- `GET /api/auth/me` - Get current user

### Game Box
- `GET /api/box/[boxId]` - Get box info and active session
- `POST /api/box/[boxId]` - Register new box

### Session
- `POST /api/session/create` - Create new session
- `POST /api/session/join` - Join existing session
- `GET /api/session/[sessionId]` - Get session state
- `POST /api/session/submit-score` - Submit player score
- `POST /api/session/end` - Vote to end session

### Leaderboard
- `GET /api/leaderboard/global` - Global rankings
- `GET /api/leaderboard/level/[level]` - Per-level rankings

### Player
- `GET /api/player/[playerId]` - Player profile and history

## License

MIT