const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const fs = require("fs");
const crypto = require("crypto");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const usersFile = path.join(dataDir, "users.json");
const sessions = new Map();

app.use(express.json({ limit: "1mb" }));

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, "[]");

function readUsers() {
    try {
        const users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
        return Array.isArray(users) ? users : [];
    } catch {
        return [];
    }
}

function writeUsers(users) {
    const temporaryFile = `${usersFile}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(users, null, 2), "utf8");
    fs.renameSync(temporaryFile, usersFile);
}

function normalizeEmail(value) {
    return String(value || "").normalize("NFKC").trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return { salt, hash };
}

function passwordsMatch(password, user) {
    try {
        // Accept both the current fields and the older field names so accounts
        // created by an earlier build continue to work after an update.
        const salt = user?.salt || user?.passwordSalt;
        const storedHash = user?.hash || user?.passwordHash;
        if (!salt || !storedHash) return false;
        const hash = crypto.scryptSync(password, salt, 64).toString("hex");
        const expected = Buffer.from(storedHash, "hex");
        const actual = Buffer.from(hash, "hex");
        return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

function createSession(user) {
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { id: user.id, email: user.email, expires: Date.now() + 1000 * 60 * 60 * 24 * 7 });
    return token;
}

function setSessionCookie(res, token) {
    res.setHeader("Set-Cookie", `void_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function sessionFromRequest(req) {
    const cookies = Object.fromEntries(
        (req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
            const [key, ...value] = part.trim().split("=");
            return [key, value.join("=")];
        }),
    );
    const session = sessions.get(cookies.void_session);
    if (!session || session.expires < Date.now()) {
        if (cookies.void_session) sessions.delete(cookies.void_session);
        return null;
    }
    return session;
}

function requireAuth(req, res, next) {
    const session = sessionFromRequest(req);
    if (!session) return res.status(401).json({ error: "Please log in to continue." });
    req.user = session;
    next();
}

// Login assets and auth endpoints remain public.
app.get("/login.html", (req, res) => res.sendFile(path.join(publicDir, "login.html")));
app.get("/auth.css", (req, res) => res.sendFile(path.join(publicDir, "auth.css")));
app.get("/auth.js", (req, res) => res.sendFile(path.join(publicDir, "auth.js")));

app.post("/api/auth/register", (req, res) => {
    const email = normalizeEmail(req.body.email);
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "");
    if (name.length < 2 || name.length > 50)
        return res.status(400).json({ error: "Enter your name (2–50 characters)." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 6)
        return res.status(400).json({ error: "Password must be at least 6 characters." });
    const users = readUsers();
    if (users.some((user) => user.email === email))
        return res.status(409).json({ error: "An account with that email already exists." });
    const credentials = hashPassword(password);
    const user = { id: crypto.randomUUID(), name, email, ...credentials, createdAt: new Date().toISOString() };
    users.push(user);
    writeUsers(users);
    const token = createSession(user);
    setSessionCookie(res, token);
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

app.post("/api/auth/login", (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const users = readUsers();
    const user = users.find((candidate) => normalizeEmail(candidate.email) === email);
    if (!user || !passwordsMatch(password, user))
        return res.status(401).json({ error: "Email or password is incorrect." });
    // Upgrade an account created by a legacy build to the current hash fields.
    if (!user.salt || !user.hash) {
        const credentials = hashPassword(password);
        user.salt = credentials.salt;
        user.hash = credentials.hash;
        delete user.passwordSalt;
        delete user.passwordHash;
        writeUsers(users);
    }
    const token = createSession(user);
    setSessionCookie(res, token);
    res.json({ user: { id: user.id, name: user.name || user.email.split("@")[0], email: user.email } });
});

app.post("/api/auth/logout", (req, res) => {
    const token = (req.headers.cookie || "").match(/(?:^|;\s*)void_session=([^;]+)/)?.[1];
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", "void_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
    const session = sessionFromRequest(req);
    if (!session) return res.status(401).json({ error: "Not logged in." });
    const user = readUsers().find((candidate) => candidate.id === session.id);
    res.json({ user: { id: session.id, name: user?.name || session.email.split("@")[0], email: session.email } });
});

// Explicit homepage route
app.get("/", (req, res) => {
    if (!sessionFromRequest(req)) return res.redirect("/login.html");
    res.sendFile(path.join(publicDir, "index.html"));
});

// Health check
app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        service: "VOID Music Player"
    });
});

// YouTube search
app.get("/api/search", requireAuth, async (req, res) => {
    try {
        const query = String(req.query.q || "").trim();

        if (!query) {
            return res.status(400).json({
                error: "Search query is required"
            });
        }

        const apiKey = process.env.YOUTUBE_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: "YouTube API key is missing"
            });
        }

        const url = new URL(
            "https://www.googleapis.com/youtube/v3/search"
        );

        url.searchParams.set("part", "snippet");
        url.searchParams.set("type", "video");
        url.searchParams.set("videoCategoryId", "10");
        url.searchParams.set("maxResults", "25");
        url.searchParams.set("q", query);
        url.searchParams.set("key", apiKey);

        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            console.error("YouTube API error:", data);

            return res.status(response.status).json({
                error:
                    data?.error?.message ||
                    "YouTube API error"
            });
        }

        const results = (data.items || [])
            .filter(item => item.id?.videoId)
            .map(item => ({
                id: item.id.videoId,

                title:
                    item.snippet?.title ||
                    "Unknown title",

                channel:
                    item.snippet?.channelTitle ||
                    "YouTube",

                thumbnail:
                    item.snippet?.thumbnails?.high?.url ||
                    item.snippet?.thumbnails?.medium?.url ||
                    item.snippet?.thumbnails?.default?.url ||
                    `https://i.ytimg.com/vi/${item.id.videoId}/hqdefault.jpg`,

                publishedAt:
                    item.snippet?.publishedAt ||
                    ""
            }));

        res.json({ results });

    } catch (error) {
        console.error("Search error:", error);

        res.status(500).json({
            error: "Server error while searching YouTube"
        });
    }
});

// Serve the player only after authentication.
app.use(requireAuth, express.static(publicDir));

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log("\n================================");
    console.log("       VOID MUSIC PLAYER");
    console.log("================================");
    console.log(`Server running on port ${PORT}`);
    console.log("================================\n");
});