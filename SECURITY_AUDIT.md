# VOID Music Player — Security Audit

## Issues found and fixed

### High
- **Private profile disclosure:** `/api/profile/:id` returned email, bio, and avatar even when `publicProfile` was false. It now returns `403` for private profiles and never exposes email.
- **Authenticated HTML in service-worker cache:** the previous service worker cached `/` and `/index.html`, allowing the protected app shell to survive logout/browser navigation from cache. HTML/API responses are no longer cached.
- **Session cookie missing `Secure`:** sessions are now marked `Secure` (HTTPS deployment).
- **No brute-force protection:** login and registration now have IP/email-aware rate limits.
- **No CSRF origin check:** state-changing browser requests with a foreign `Origin` are rejected; the session cookie remains `SameSite=Lax`.

### Medium
- **Unbounded library growth:** library arrays/playlists were accepted without useful size limits. Server-side caps now limit favorites, queue, history, search history, playlists and playlist sizes.
- **Settings/profile type pollution:** settings and profile fields are now normalized to expected scalar types and bounds.
- **Profile image validation:** profile avatars are restricted to common image data URLs and size limits.
- **Missing baseline security headers:** `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and HTTPS HSTS are added.
- **Search/API abuse:** search and write endpoints have basic rate limits.

## Remaining deployment requirements

1. Use HTTPS in production (Render provides this when using its public HTTPS URL).
2. Keep `MONGO_URI` and `YOUTUBE_API_KEY` only in Render Environment Variables / `.env`, never in Git.
3. Restrict MongoDB network access to the deployment where practical.
4. For multiple server instances, replace the in-memory rate limiter/session store with a shared store such as Redis.
5. Run `npm audit` after `npm install` and update dependencies regularly.

## Important limitation

This is a source-code security audit, not a guarantee that the application is vulnerability-free. A full production assessment should also include authenticated dynamic testing, MongoDB/Render configuration review, dependency scanning, and monitoring.
