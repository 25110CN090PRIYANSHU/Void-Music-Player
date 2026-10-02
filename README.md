# VOID Music Player 4.0

VOID 4.0 is a Discover-first YouTube music player with cloud-synced personal libraries and a redesigned music experience.

## Major update
- Discover-first home screen (no separate Hub)
- Cloud-synced favorites, playlists, queue, recent history and settings
- Multi-device account library
- VOID Radio mood stations that build a playable queue
- Personal listening statistics and top artists
- VOID Music Game with five-round song guessing
- Advanced queue, shuffle, repeat and player controls
- Lyrics lookup
- Voice search
- PWA install support and offline app shell
- Profile/public playlist features
- Responsive mobile layout
- Keyboard shortcuts and Ctrl/Cmd+K universal search
- Dynamic premium visual system

## Setup
1. Copy `.env.example` to `.env`.
2. Set `YOUTUBE_API_KEY`.
3. Optionally configure Google OAuth values.
4. Run `npm install`.
5. Run `npm start`.
6. Open the printed local URL and create/login to an account.

### Multi-device sync
Both devices must use the same deployed VOID server and the same account. The account library is stored by the server, not only in browser localStorage.

### Offline note
The PWA caches the application shell for offline startup. It does not download or cache YouTube audio.

## YouTube Search Cache

This build adds a shared MongoDB cache for YouTube Search results.

Flow:
1. User A searches a query.
2. If the normalized query is not cached, VOID makes one YouTube Search request.
3. The returned video IDs/results are stored in the `youtubeSearchCache` collection.
4. User B searching the same normalized query gets the cached results without another YouTube Search request.
5. Simultaneous identical searches are also coalesced so they do not create duplicate upstream requests.
6. Discover and Radio use the same cache helper.

### Environment variables

Copy `.env.example` to `.env` and set:

```env
YOUTUBE_API_KEY=...
MONGO_URI=...
MONGO_DB_NAME=VOID
YOUTUBE_SEARCH_CACHE_TTL_MS=21600000
```

`MONGO_DB_NAME` is optional if the database is already specified in `MONGO_URI`.

### Install

```bash
npm install
npm start
```

The cache is shared across all users of this server because it lives in MongoDB. If `MONGO_URI` is not configured or MongoDB is temporarily unavailable, VOID falls back to the normal YouTube API path rather than crashing.
