# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
npm run dev      # Start local dev server on http://localhost:8788
npm run deploy   # Deploy to Cloudflare Pages
npm run db:push  # Copy database schema to clipboard for Supabase SQL editor
```

## Architecture Overview

**Neutronium Leaderboard** is a PWA for tracking board game sessions and leaderboards.

### Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS served as static files via Cloudflare Pages
- **Backend**: Cloudflare Functions (serverless, ES modules)
- **Database**: Supabase PostgreSQL
- **Auth**: Magic link email (Resend) + JWT tokens in HttpOnly cookies

### Project Structure
```
public/           # Static frontend files
  ├── css/        # Design system (dark space theme, Orbitron + Inter fonts)
  └── js/         # Page-specific modules (app.js, auth.js, session.js, etc.)
functions/        # Cloudflare Functions backend
  ├── api/        # API routes (maps to /api/{path})
  └── _shared/    # Utilities (supabase.js, auth.js, response.js)
database/         # PostgreSQL schema with triggers
```

### Data Flow
1. **Box Entry**: User scans QR/enters box ID → checks for active session → start or join
2. **Sessions**: Players join → submit scores → poll for updates (5s) → vote to end
3. **Progress Tracking**: DB trigger auto-updates `progress_journal` with best scores on session completion
4. **Auth**: Guest play (localStorage UUID) or email registration (magic link → JWT cookie)

### Database Tables
- `players` - User accounts (supports guest and registered)
- `game_boxes` - Physical game copies with unique box_id
- `sessions` - Game sessions tied to boxes, with universe_level 1-13
- `session_players` - Join table with race, scores, vote_end status
- `progress_journal` - Best scores per player per level (auto-updated via trigger)
- `magic_tokens` - Email auth tokens

### API Route Convention
Files in `functions/api/` map to routes: `functions/api/auth/me.js` → `GET /api/auth/me`

Currently implemented: `/api/auth/me` only. Other endpoints (box, session, leaderboard, player) are planned but not yet built.

## Environment Variables

Required in `.dev.vars` (local) or Cloudflare secrets (production):
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` - Database connection
- `RESEND_API_KEY`, `FROM_EMAIL` - Email service
- `JWT_SECRET` - Token signing
- `APP_URL`, `COOKIE_DOMAIN` - Environment-specific URLs