# VOID Music Player 3.0

A futuristic YouTube music player with account-based cloud library and multi-device sync.

## 3.0 features

1. Cloud sync — favorites, playlists, queue, recent plays, search history and settings sync per account.
2. Advanced player — shuffle, repeat, queue, Media Session support, lyrics, sleep timer and transition/crossfade setting.
3. Mobile-first responsive UI and PWA installation.
4. Smart home / mood mixes based on listening activity.
5. Dynamic personalization and theme support.
6. Playlist management and cloud persistence.
7. Search suggestions, history and voice search.
8. Account profiles with bio and public-profile switch.
9. Public playlist publishing/browsing.
10. Listening statistics and top-artist activity.
11. Device list for the current account.
12. Notifications/toasts and account actions.
13. Offline app-shell caching through the service worker. YouTube audio itself is not downloaded.
14. Email/password authentication plus optional Google OAuth.
15. Multi-device account sessions using the same server/database.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env`, then set `YOUTUBE_API_KEY`.

```bash
npm start
```

For Google sign-in, create a Google OAuth Web Application and set the three `GOOGLE_*` variables. The redirect URI must exactly match the one configured with Google.

### Deployment

Deploy the **same server/database** for all devices. Do not run separate local servers if you want the cloud library to be shared between phone and PC.

### Important

VOID uses YouTube's embedded player for playback. The PWA offline cache stores the application shell; it does not download or redistribute YouTube audio.


## VOID Hub
The Hub is an interactive command center for smart mixes, listening stats, connected devices, profiles, public playlists, PWA installation, sleep timer, and one-tap navigation. It uses the existing account/cloud APIs.
