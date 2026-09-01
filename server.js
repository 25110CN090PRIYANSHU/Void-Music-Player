const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const fs = require("fs");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const usersFile = path.join(dataDir, "users.json");

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "void_music_player";

if (!MONGODB_URI) {
    console.error("ERROR: MONGODB_URI is not set.");
    console.error("Add MONGODB_URI to your local .env or Render Environment Variables.");
    process.exit(1);
}

const mongoClient = new MongoClient(MONGODB_URI);
let db;
let usersCollection;
let sessionsCollection;

app.use(express.json({ limit: "1mb" }));

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return { salt, hash };
}

function passwordsMatch(password, user) {
    try {
        if (!user?.salt || !user?.hash) return false;

        const hash = crypto.scryptSync(password, user.salt, 64).toString("hex");
        const expected = Buffer.from(user.hash, "hex");
        const actual = Buffer.from(hash, "hex");

        return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

function hashSessionToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

async function createSession(user) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

    await sessionsCollection.insertOne({
        tokenHash: hashSessionToken(token),
        userId: user.id,
        expiresAt,
        createdAt: new Date()
    });

    return token;
}

function setSessionCookie(res, token) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader(
        "Set-Cookie",
        `void_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`
    );
}

function clearSessionCookie(res) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader(
        "Set-Cookie",
        `void_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
    );
}

function getSessionToken(req) {
    const cookies = Object.fromEntries(
        (req.headers.cookie || "")
            .split(";")
            .filter(Boolean)
            .map((part) => {
                const [key, ...value] = part.trim().split("=");
                return [key, value.join("=")];
            })
    );

    return cookies.void_session || null;
}

async function sessionFromRequest(req) {
    const token = getSessionToken(req);
    if (!token) return null;

    const tokenHash = hashSessionToken(token);
    const session = await sessionsCollection.findOne({ tokenHash });

    if (!session || session.expiresAt <= new Date()) {
        if (session) await sessionsCollection.deleteOne({ _id: session._id });
        return null;
    }

    const user = await usersCollection.findOne({ id: session.userId });
    if (!user) {
        await sessionsCollection.deleteOne({ _id: session._id });
        return null;
    }

    return { session, user };
}

async function requireAuth(req, res, next) {
    try {
        const auth = await sessionFromRequest(req);
        if (!auth) return res.status(401).json({ error: "Please log in to continue." });

        req.user = auth.user;
        req.session = auth.session;
        next();
    } catch (error) {
        console.error("Authentication lookup error:", error);
        res.status(500).json({ error: "Authentication service error." });
    }
}

// Login assets and auth endpoints remain public.
app.get("/login.html", (req, res) => res.sendFile(path.join(publicDir, "login.html")));
app.get("/auth.css", (req, res) => res.sendFile(path.join(publicDir, "auth.css")));
app.get("/auth.js", (req, res) => res.sendFile(path.join(publicDir, "auth.js")));

app.post("/api/auth/register", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const name = String(req.body.name || "").trim();
        const password = String(req.body.password || "");

        if (name.length < 2 || name.length > 50)
            return res.status(400).json({ error: "Enter your name (2–50 characters)." });

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return res.status(400).json({ error: "Enter a valid email address." });

        if (password.length < 6)
            return res.status(400).json({ error: "Password must be at least 6 characters." });

        const existingUser = await usersCollection.findOne({ email });
        if (existingUser)
            return res.status(409).json({ error: "An account with that email already exists." });

        const credentials = hashPassword(password);
        const user = {
            id: crypto.randomUUID(),
            name,
            email,
            ...credentials,
            createdAt: new Date()
        };

        await usersCollection.insertOne(user);

        const token = await createSession(user);
        setSessionCookie(res, token);

        res.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        console.error("Registration error:", error);

        if (error?.code === 11000) {
            return res.status(409).json({ error: "An account with that email already exists." });
        }

        res.status(500).json({ error: "Unable to create your account." });
    }
});

app.post("/api/auth/login", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        const user = await usersCollection.findOne({ email });

        if (!user || !passwordsMatch(password, user)) {
            return res.status(401).json({ error: "Email or password is incorrect." });
        }

        const token = await createSession(user);
        setSessionCookie(res, token);

        res.json({
            user: {
                id: user.id,
                name: user.name || user.email.split("@")[0],
                email: user.email
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Unable to log in right now." });
    }
});

app.post("/api/auth/logout", async (req, res) => {
    try {
        const token = getSessionToken(req);
        if (token) {
            await sessionsCollection.deleteOne({ tokenHash: hashSessionToken(token) });
        }

        clearSessionCookie(res);
        res.json({ ok: true });
    } catch (error) {
        console.error("Logout error:", error);
        clearSessionCookie(res);
        res.json({ ok: true });
    }
});

app.get("/api/auth/me", async (req, res) => {
    try {
        const auth = await sessionFromRequest(req);
        if (!auth) return res.status(401).json({ error: "Not logged in." });

        const { user } = auth;
        res.json({
            user: {
                id: user.id,
                name: user.name || user.email.split("@")[0],
                email: user.email
            }
        });
    } catch (error) {
        console.error("Session check error:", error);
        res.status(500).json({ error: "Unable to check your session." });
    }
});

// Explicit homepage route
app.get("/", async (req, res) => {
    try {
        if (!await sessionFromRequest(req)) return res.redirect("/login.html");
        res.sendFile(path.join(publicDir, "index.html"));
    } catch (error) {
        console.error("Homepage auth error:", error);
        res.redirect("/login.html");
    }
});

// Health check
app.get("/api/health", async (req, res) => {
    try {
        await db.command({ ping: 1 });
        res.json({ ok: true, service: "VOID Music Player", database: "connected" });
    } catch {
        res.status(503).json({ ok: false, service: "VOID Music Player", database: "disconnected" });
    }
});

// YouTube search
app.get("/api/search", requireAuth, async (req, res) => {
    try {
        const query = String(req.query.q || "").trim();

        if (!query) {
            return res.status(400).json({ error: "Search query is required" });
        }

        const apiKey = process.env.YOUTUBE_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ error: "YouTube API key is missing" });
        }

        const url = new URL("https://www.googleapis.com/youtube/v3/search");
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
                error: data?.error?.message || "YouTube API error"
            });
        }

        const results = (data.items || [])
            .filter(item => item.id?.videoId)
            .map(item => ({
                id: item.id.videoId,
                title: item.snippet?.title || "Unknown title",
                channel: item.snippet?.channelTitle || "YouTube",
                thumbnail:
                    item.snippet?.thumbnails?.high?.url ||
                    item.snippet?.thumbnails?.medium?.url ||
                    item.snippet?.thumbnails?.default?.url ||
                    `https://i.ytimg.com/vi/${item.id.videoId}/hqdefault.jpg`,
                publishedAt: item.snippet?.publishedAt || ""
            }));

        res.json({ results });
    } catch (error) {
        console.error("Search error:", error);
        res.status(500).json({ error: "Server error while searching YouTube" });
    }
});

// Serve the player only after authentication.
app.use(requireAuth, express.static(publicDir));

async function startServer() {
    try {
        await mongoClient.connect();
        db = mongoClient.db(MONGODB_DB);
        usersCollection = db.collection("users");
        sessionsCollection = db.collection("sessions");

        await usersCollection.createIndex({ email: 1 }, { unique: true });
        await sessionsCollection.createIndex({ tokenHash: 1 }, { unique: true });
        await sessionsCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

        // Optional one-time migration from the old local users.json file.
        // This preserves old accounts if a local data/users.json exists.
        if (fs.existsSync(usersFile)) {
            try {
                const oldUsers = JSON.parse(fs.readFileSync(usersFile, "utf8"));
                if (Array.isArray(oldUsers) && oldUsers.length) {
                    let migrated = 0;
                    for (const oldUser of oldUsers) {
                        if (!oldUser?.email || !oldUser?.hash || !oldUser?.salt) continue;
                        const existing = await usersCollection.findOne({ email: oldUser.email });
                        if (!existing) {
                            await usersCollection.insertOne({
                                id: oldUser.id || crypto.randomUUID(),
                                name: oldUser.name || oldUser.email.split("@")[0],
                                email: String(oldUser.email).toLowerCase(),
                                salt: oldUser.salt,
                                hash: oldUser.hash,
                                createdAt: oldUser.createdAt ? new Date(oldUser.createdAt) : new Date()
                            });
                            migrated++;
                        }
                    }
                    if (migrated) console.log(`Migrated ${migrated} old VOID account(s) to MongoDB.`);
                }
            } catch (migrationError) {
                console.warn("Old users.json migration skipped:", migrationError.message);
            }
        }

        await db.command({ ping: 1 });

        app.listen(PORT, "0.0.0.0", () => {
            console.log("\n================================");
            console.log("       VOID MUSIC PLAYER");
            console.log("================================");
            console.log(`Server running on port ${PORT}`);
            console.log(`MongoDB database: ${MONGODB_DB}`);
            console.log("================================\n");
        });
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        console.error("Check MONGODB_URI and make sure your MongoDB Atlas IP access allows your deployment.");
        process.exit(1);
    }
}

startServer();
