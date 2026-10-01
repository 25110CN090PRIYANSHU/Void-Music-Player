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
