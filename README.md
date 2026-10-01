# VOID Music Player 4.0.6 — Personalized Indian Discover + Working VOID Radio

## What's fixed
- Discover now learns from the account's play counts, recent plays, favorites and search history.
- Indian music is enforced in Discover and Radio results instead of relying only on YouTube's language relevance.
- Discover ranks candidates by the user's strongest categories, artists and repeatedly played songs.
- Every VOID Radio station combines its station mood with the user's dominant taste.
- Clicking a station immediately loads the personalized Indian queue and starts playback.
- Play counts are stored in the cloud library, so personalization follows the same account across devices.
- Embeddability is checked before tracks are returned, reducing autoplay failures from restricted videos.

## Deploy
1. `npm install`
2. Set `YOUTUBE_API_KEY` in Render/environment variables.
3. Start with `npm start`.
4. Keep the same persistent Mongo/database setup if you use the cloud version of your existing deployment; this build's local `data/users.json` is the fallback account store.

YouTube search uses `regionCode=IN`, Hindi relevance, music category filtering and additional Indian-content ranking. YouTube can still return highly relevant results outside a requested language, so VOID applies a second application-level Indian-content filter.
