# VOID Music Player

VOID is a YouTube-based music player with account authentication.

## Important authentication fix

The original version stored users in `data/users.json` and sessions in server memory. That is not reliable for a deployed app because a deployment/restart can recreate the filesystem and clear in-memory sessions.

This version stores **users and login sessions in MongoDB Atlas**, so accounts persist across restarts and redeployments.

Passwords are still protected with Node.js `crypto.scryptSync()` and a unique salt for each account.

## Local setup

1. Install Node.js 18+.
2. Run:

```bash
npm install
```

3. Create a `.env` file using `.env.example` as a template.
4. Add your MongoDB Atlas connection string and YouTube API key.
5. Start:

```bash
npm start
```

6. Open `http://localhost:3000`.

## Render deployment

Use:

- **Build Command:** `npm install`
- **Start Command:** `npm start`

Add these Render Environment Variables:

- `MONGODB_URI` = your MongoDB Atlas connection string
- `MONGODB_DB` = `void_music_player`
- `YOUTUBE_API_KEY` = your YouTube Data API key
- `NODE_ENV` = `production`

Do not upload `.env` or put secrets directly into the source code.

### MongoDB Atlas network access

Your Atlas cluster must allow connections from the deployed service. For a simple student deployment, Atlas Network Access can allow `0.0.0.0/0`; protect the database with a strong database user password and never expose the URI publicly.

## Authentication behavior

- Signup creates a MongoDB user document.
- Login checks the email and scrypt password hash from MongoDB.
- A secure random session token is stored as a hash in MongoDB.
- Sessions expire after 7 days.
- MongoDB's TTL index automatically removes expired sessions.
- Existing `data/users.json` files are migrated automatically when present.
