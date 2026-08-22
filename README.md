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
