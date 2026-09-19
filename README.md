# VOID Music Player — MAX Edition

## What was upgraded
- Favorites library with persistent storage
- Queue with add/remove/reorder/clear
- Recently Played history
- Playlists with create/delete/add-song
- Search suggestions from local history/favorites
- Search result actions and context menu
- Shuffle + Repeat Off/All/One
- Full Now Playing modal
- Queue drawer
- Keyboard shortcuts
- Theme settings
- Persistent volume
- Responsive mobile layout
- Toast notifications and polished empty/loading states
- YouTube IFrame playback remains the playback mechanism

## Run
1. Keep your existing `.env` file in the project root, or copy `.env.example` to `.env`.
2. Put your YouTube Data API key in:
   `YOUTUBE_API_KEY=YOUR_KEY_HERE`
3. Run:
   `npm install`
4. Start:
   `npm start`
5. Open:
   `http://localhost:3000`

Do not commit your real `.env` or API key to GitHub.

## Notes
Lyrics are intentionally a UI entry point only in this build; automatic lyrics require a separate licensed/authorized lyrics provider.
The visualizer is a playback animation and does not attempt to capture audio from the cross-origin YouTube iframe.


## Playback updates
- Autoplay continues to the next track automatically when a song ends.
- Queue playback continues to the next queued song before returning to the current collection.
- Media Session API support provides play/pause, previous/next and seek controls on supported mobile browsers and lock screens.
- The page does not intentionally pause playback when it becomes hidden/minimized.

### Important mobile background-playback limitation
VOID currently uses the YouTube IFrame Player API as its audio source. Whether audio continues after a mobile browser is minimized or the screen is locked is controlled by the browser/YouTube and cannot be guaranteed by JavaScript. True reliable background audio requires using an audio source that the browser allows to continue in the background (for example, an `<audio>` stream served by the application) rather than a YouTube iframe.
