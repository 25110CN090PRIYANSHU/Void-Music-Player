const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");
const fs = require("fs");
const crypto = require("crypto");

dotenv.config();
// ===================== YOUTUBE SEARCH CACHE =====================
// Search results are cached in MongoDB so repeated searches can be served
// without calling YouTube Search again. Set MONGO_URI in .env.
const SEARCH_CACHE_TTL_MS = Number(process.env.YOUTUBE_SEARCH_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
let mongoReady = false;
let mongoConnectPromise = null;

const youtubeSearchCacheSchema = new mongoose.Schema({
    queryKey: { type: String, unique: true, index: true },
    query: { type: String, required: true },
    results: { type: Array, default: [] },
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now }
}, { collection: "youtubeSearchCache" });

const YouTubeSearchCache = mongoose.models.YouTubeSearchCache ||
    mongoose.model("YouTubeSearchCache", youtubeSearchCacheSchema);

function normalizeSearchQuery(value = "") {
    return String(value)
        .toLowerCase()
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim();
}

async function connectMongoForCache() {
    if (mongoReady && mongoose.connection.readyState === 1) return true;
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) return false;
    if (!mongoConnectPromise) {
        mongoConnectPromise = mongoose.connect(mongoUri, {
            dbName: process.env.MONGO_DB_NAME || undefined,
            serverSelectionTimeoutMS: 5000
        }).then(() => {
            mongoReady = true;
            console.log("YouTube search cache: MongoDB connected");
            return true;
        }).catch((error) => {
            console.warn("YouTube search cache: MongoDB unavailable:", error.message);
            mongoConnectPromise = null;
            return false;
        });
    }
    return mongoConnectPromise;
}

async function getCachedYouTubeSearch(query) {
    if (!(await connectMongoForCache())) return null;
    try {
        const key = normalizeSearchQuery(query);
        const cached = await YouTubeSearchCache.findOne({ queryKey: key }).lean();
        if (!cached) return null;
        const age = Date.now() - new Date(cached.updatedAt || cached.createdAt).getTime();
        if (age > SEARCH_CACHE_TTL_MS) return null;
        return Array.isArray(cached.results) ? cached.results : [];
    } catch (error) {
        console.warn("YouTube search cache read failed:", error.message);
        return null;
    }
}

async function saveCachedYouTubeSearch(query, results) {
    if (!(await connectMongoForCache())) return;
    try {
        const key = normalizeSearchQuery(query);
        await YouTubeSearchCache.findOneAndUpdate(
            { queryKey: key },
            {
                $set: {
                    queryKey: key,
                    query: String(query).trim(),
                    results: Array.isArray(results) ? results : [],
                    updatedAt: new Date()
                },
                $setOnInsert: { createdAt: new Date() }
            },
            { upsert: true, new: true }
        );
    } catch (error) {
        console.warn("YouTube search cache write failed:", error.message);
    }
}

// Prevent two simultaneous users searching the same uncached query from
// both consuming a YouTube Search quota call.
const inFlightYouTubeSearches = new Map();

async function youtubeSearchWithCache(query, apiKey, options = {}) {
    const cleanQuery = String(query || "").trim();
    if (!cleanQuery) throw new Error("Search query is required");

    const cacheKey = normalizeSearchQuery(cleanQuery);
    const cached = await getCachedYouTubeSearch(cleanQuery);
    if (cached !== null) {
        return { results: cached, cached: true };
    }

    if (inFlightYouTubeSearches.has(cacheKey)) {
        return inFlightYouTubeSearches.get(cacheKey);
    }

    const work = (async () => {
        // Re-check after another request may have populated the cache.
        const secondCheck = await getCachedYouTubeSearch(cleanQuery);
        if (secondCheck !== null) {
            return { results: secondCheck, cached: true };
        }

        if (!apiKey) throw new Error("YouTube API key is missing");

        const url = new URL("https://www.googleapis.com/youtube/v3/search");
        url.searchParams.set("part", "snippet");
        url.searchParams.set("type", "video");
        url.searchParams.set("videoCategoryId", "10");
        url.searchParams.set("maxResults", String(options.maxResults || 25));
        url.searchParams.set("q", cleanQuery);
        if (options.regionCode) url.searchParams.set("regionCode", options.regionCode);
        if (options.relevanceLanguage) url.searchParams.set("relevanceLanguage", options.relevanceLanguage);
        url.searchParams.set("key", apiKey);

        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) {
            const err = new Error(data?.error?.message || "YouTube API error");
            err.status = response.status;
            throw err;
        }

        const candidates = (data.items || []).filter(item => item.id?.videoId);
        let embeddableIds = new Set(candidates.map(item => item.id.videoId));

        if (candidates.length) {
            const statusUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
            statusUrl.searchParams.set("part", "status");
            statusUrl.searchParams.set("id", candidates.map(x => x.id.videoId).join(","));
            statusUrl.searchParams.set("key", apiKey);
            const statusResponse = await fetch(statusUrl);
            const statusData = await statusResponse.json();
            if (statusResponse.ok) {
                embeddableIds = new Set(
                    (statusData.items || [])
                        .filter(item => item.status?.embeddable === true)
                        .map(item => item.id)
                );
            }
        }

        const results = candidates
            .filter(item => embeddableIds.has(item.id.videoId))
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

        await saveCachedYouTubeSearch(cleanQuery, results);
        return { results, cached: false };
    })();

    inFlightYouTubeSearches.set(cacheKey, work);
    try {
        return await work;
    } finally {
        inFlightYouTubeSearches.delete(cacheKey);
    }
}


const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const usersFile = path.join(dataDir, "users.json");
const sessions = new Map();

// ===================== AUTH HELPERS =====================
// Keep password handling server-side. New passwords use PBKDF2-SHA512 with
// 210,000 iterations. The verifier also accepts the common legacy variants
// used by earlier VOID builds and transparently upgrades them after login.
const PASSWORD_ITERATIONS = 210000;

function normalizeEmail(value = "") {
    return String(value).trim().toLowerCase();
}

function hashPassword(password, saltHex = crypto.randomBytes(16).toString("hex")) {
    const salt = Buffer.from(saltHex, "hex");
    const hash = crypto.pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, 64, "sha512");
    return { salt: saltHex, hash: hash.toString("hex"), algorithm: `pbkdf2-sha512-${PASSWORD_ITERATIONS}` };
}

function safeEqualHex(a, b) {
    try {
        const left = Buffer.from(String(a || ""), "hex");
        const right = Buffer.from(String(b || ""), "hex");
        return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
    } catch {
        return false;
    }
}

function passwordsMatch(password, user) {
    if (!user?.salt || !user?.hash) return false;
    const salt = Buffer.from(String(user.salt), "hex");
    const expected = String(user.hash).toLowerCase();
    const algorithms = [];

    // Current format.
    algorithms.push(() => crypto.pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, 64, "sha512"));

    // Legacy VOID builds commonly used these PBKDF2 settings. Trying these
    // only against the stored hash lets existing accounts continue to work.
    for (const iterations of [100000, 120000, 150000]) {
        algorithms.push(() => crypto.pbkdf2Sync(String(password), salt, iterations, 64, "sha512"));
    }
    algorithms.push(() => crypto.pbkdf2Sync(String(password), salt, 100000, 64, "sha256"));

    for (const derive of algorithms) {
        if (safeEqualHex(derive().toString("hex"), expected)) return true;
    }

    // A few older builds used scrypt with the same 16-byte hex salt.
    try {
        const derived = crypto.scryptSync(String(password), salt, 64);
        if (safeEqualHex(derived.toString("hex"), expected)) return true;
    } catch {}

    return false;
}

app.use(express.json({ limit: "1mb" }));


// ===================== MONGODB PERSISTENCE =====================
// MongoDB is the source of truth for accounts and all user-specific music data.
// The old JSON files are read ONLY once during migration and are never used at
// runtime after that migration completes.

const defaultSettings = {
    theme: "dark",
    autoplayQueue: true,
    rememberVolume: true,
    volume: 80,
    crossfade: 0,
    sleepTimer: 0
};

const UserSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    salt: { type: String, required: true },
    hash: { type: String, required: true },
    hashAlgorithm: { type: String, default: `pbkdf2-sha512-${PASSWORD_ITERATIONS}` },
    googleId: { type: String, index: true, sparse: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    devices: { type: Array, default: [] }
}, { collection: "users" });

const UserLibrarySchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    favorites: { type: Array, default: [] },
    queue: { type: Array, default: [] },
    recent: { type: Array, default: [] },
    playlists: { type: mongoose.Schema.Types.Mixed, default: {} },
    searchHistory: { type: Array, default: [] },
    settings: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...defaultSettings }) },
    profile: {
        bio: { type: String, default: "" },
        avatar: { type: String, default: "" },
        publicProfile: { type: Boolean, default: false }
    },
    lastPlayed: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedAt: { type: Date, default: Date.now }
}, { collection: "userLibraries", minimize: false });

const PublicPlaylistSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, maxlength: 80 },
    owner: { type: Object, required: true },
    songs: { type: Array, default: [] },
    updatedAt: { type: Date, default: Date.now }
}, { collection: "publicPlaylists" });

const User = mongoose.models.VoidUser || mongoose.model("VoidUser", UserSchema);
const UserLibrary = mongoose.models.VoidUserLibrary || mongoose.model("VoidUserLibrary", UserLibrarySchema);
const PublicPlaylist = mongoose.models.VoidPublicPlaylist || mongoose.model("VoidPublicPlaylist", PublicPlaylistSchema);

function defaultLibrary() {
    return {
        favorites: [],
        queue: [],
        recent: [],
        playlists: {},
        searchHistory: [],
        settings: { ...defaultSettings },
        profile: { bio: "", avatar: "", publicProfile: false },
        lastPlayed: null
    };
}

function normalizeLibrary(value = {}) {
    const base = defaultLibrary();
    return {
        favorites: Array.isArray(value.favorites) ? value.favorites : base.favorites,
        queue: Array.isArray(value.queue) ? value.queue : base.queue,
        recent: Array.isArray(value.recent) ? value.recent : base.recent,
        playlists: value.playlists && typeof value.playlists === "object" && !Array.isArray(value.playlists) ? value.playlists : base.playlists,
        searchHistory: Array.isArray(value.searchHistory) ? value.searchHistory : base.searchHistory,
        settings: { ...base.settings, ...(value.settings || {}) },
        profile: { ...base.profile, ...(value.profile || {}) },
        lastPlayed: value.lastPlayed ?? null
    };
}

async function getUserById(id) {
    return User.findOne({ id }).lean();
}

async function getUserLibrary(userId, create = true) {
    let doc = await UserLibrary.findOne({ userId });
    if (!doc && create) {
        doc = await UserLibrary.create({ userId, ...defaultLibrary() });
    }
    return doc;
}

function publicUser(user) {
    return user ? { id: user.id, name: user.name || user.email?.split("@")[0], email: user.email } : null;
}

async function migrateLegacyJsonToMongo() {
    const oldUsersFile = path.join(dataDir, "users.json");
    const oldPublicFile = path.join(dataDir, "public-playlists.json");

    if (fs.existsSync(oldUsersFile)) {
        try {
            const legacyUsers = JSON.parse(fs.readFileSync(oldUsersFile, "utf8"));
            if (Array.isArray(legacyUsers)) {
                for (const old of legacyUsers) {
                    if (!old?.email || !old?.id) continue;

                    let user = await User.findOne({
                        $or: [{ id: old.id }, { email: normalizeEmail(old.email) }]
                    });

                    if (!user) {
                        user = await User.create({
                            id: old.id,
                            name: String(old.name || old.email.split("@")[0]).slice(0, 50),
                            email: normalizeEmail(old.email),
                            salt: old.salt || old.passwordSalt || crypto.randomBytes(16).toString("hex"),
                            hash: old.hash || old.passwordHash || crypto.randomBytes(64).toString("hex"),
                            googleId: old.googleId,
                            createdAt: old.createdAt ? new Date(old.createdAt) : new Date(),
                            devices: Array.isArray(old.devices) ? old.devices : []
                        });
                    }

                    const legacyLibrary = old.library || {};
                    const existingLibrary = await UserLibrary.findOne({ userId: user.id });
                    if (!existingLibrary) {
                        await UserLibrary.create({
                            userId: user.id,
                            ...normalizeLibrary(legacyLibrary)
                        });
                    } else if (Object.keys(legacyLibrary).length) {
                        await UserLibrary.updateOne(
                            { userId: user.id },
                            { $set: normalizeLibrary(legacyLibrary) }
                        );
                    }
                }
                console.log(`MongoDB: migrated ${legacyUsers.length} legacy user record(s)`);
                try { fs.unlinkSync(oldUsersFile); } catch {}
            }
        } catch (error) {
            console.warn("MongoDB legacy users migration skipped:", error.message);
        }
    }

    if (fs.existsSync(oldPublicFile)) {
        try {
            const legacyLists = JSON.parse(fs.readFileSync(oldPublicFile, "utf8"));
            if (Array.isArray(legacyLists)) {
                for (const item of legacyLists) {
                    if (!item?.id) continue;
                    await PublicPlaylist.updateOne(
                        { id: item.id },
                        {
                            $setOnInsert: {
                                id: item.id,
                                name: String(item.name || "VOID Playlist").slice(0, 80),
                                owner: item.owner || {},
                                songs: Array.isArray(item.songs) ? item.songs.slice(0, 500) : [],
                                updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date()
                            }
                        },
                        { upsert: true }
                    );
                }
                console.log(`MongoDB: migrated ${legacyLists.length} public playlist record(s)`);
                try { fs.unlinkSync(oldPublicFile); } catch {}
            }
        } catch (error) {
            console.warn("MongoDB legacy public playlists migration skipped:", error.message);
        }
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

app.post("/api/auth/register", async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const name = String(req.body.name || "").trim();
        const password = String(req.body.password || "");
        if (name.length < 2 || name.length > 50)
            return res.status(400).json({ error: "Enter your name (2–50 characters)." });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return res.status(400).json({ error: "Enter a valid email address." });
        if (password.length < 6)
            return res.status(400).json({ error: "Password must be at least 6 characters." });
        if (await User.exists({ email }))
            return res.status(409).json({ error: "An account with that email already exists." });

        const credentials = hashPassword(password);
        const user = await User.create({
            id: crypto.randomUUID(), name, email, ...credentials, hashAlgorithm: credentials.algorithm, createdAt: new Date()
        });
        await getUserLibrary(user.id, true);

        const token = createSession(user);
        setSessionCookie(res, token);
        res.json({ user: publicUser(user) });
    } catch (error) {
        console.error("Register error:", error);
        res.status(500).json({ error: "Could not create your account." });
    }
});

app.post("/api/auth/login", async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const password = String(req.body.password || "");
        const user = await User.findOne({ email });
        if (!user || !passwordsMatch(password, user))
            return res.status(401).json({ error: "Email or password is incorrect." });

        if (user.hashAlgorithm !== `pbkdf2-sha512-${PASSWORD_ITERATIONS}`) {
            const credentials = hashPassword(password);
            user.salt = credentials.salt;
            user.hash = credentials.hash;
            user.hashAlgorithm = credentials.algorithm;
            user.updatedAt = new Date();
            await user.save();
        }

        const token = createSession(user);
        setSessionCookie(res, token);
        res.json({ user: publicUser(user) });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Could not log in right now." });
    }
});

app.post("/api/auth/logout", (req, res) => {
    const token = (req.headers.cookie || "").match(/(?:^|;\s*)void_session=([^;]+)/)?.[1];
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", "void_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
    const session = sessionFromRequest(req);
    if (!session) return res.status(401).json({ error: "Not logged in." });
    const user = await getUserById(session.id);
    if (!user) return res.status(401).json({ error: "Account not found." });
    res.json({ user: publicUser(user) });
});

// Explicit homepage route
app.get("/", (req, res) => {
    if (!sessionFromRequest(req)) return res.redirect("/login.html");
    res.sendFile(path.join(publicDir, "index.html"));
});

// Health check
app.get("/api/health", (req, res) => {
    res.json({
        ok: mongoReady && mongoose.connection.readyState === 1,
        mongo: mongoReady && mongoose.connection.readyState === 1,
        service: "VOID Music Player"
    });
});



// ===================== VOID MONGO LIBRARY API =====================
// No user library data is stored in localStorage or users.json at runtime.

app.get("/api/library", requireAuth, async (req, res) => {
    try {
        const doc = await getUserLibrary(req.user.id, true);
        const library = normalizeLibrary(doc.toObject ? doc.toObject() : doc);
        res.json({ library });
    } catch (error) {
        console.error("Library read error:", error);
        res.status(500).json({ error: "Could not load your library." });
    }
});

app.put("/api/library", requireAuth, async (req, res) => {
    try {
        const incoming = req.body?.library || {};
        const library = normalizeLibrary(incoming);
        await UserLibrary.findOneAndUpdate(
            { userId: req.user.id },
            { $set: { ...library, updatedAt: new Date() } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        res.json({ ok: true, library });
    } catch (error) {
        console.error("Library write error:", error);
        res.status(500).json({ error: "Could not save your library." });
    }
});

app.post("/api/library/reset", requireAuth, async (req, res) => {
    try {
        const library = defaultLibrary();
        await UserLibrary.findOneAndUpdate(
            { userId: req.user.id },
            { $set: { ...library, updatedAt: new Date() } },
            { upsert: true }
        );
        res.json({ ok: true, library });
    } catch (error) {
        console.error("Library reset error:", error);
        res.status(500).json({ error: "Could not reset your library." });
    }
});

app.patch("/api/profile", requireAuth, async (req, res) => {
    try {
        const doc = await getUserLibrary(req.user.id, true);
        const profile = {
            ...doc.profile?.toObject?.() || doc.profile || {},
            bio: String(req.body?.bio || "").slice(0, 240),
            avatar: String(req.body?.avatar || "").slice(0, 500000),
            publicProfile: Boolean(req.body?.publicProfile)
        };
        await UserLibrary.updateOne({ userId: req.user.id }, { $set: { profile, updatedAt: new Date() } });
        res.json({ profile });
    } catch (error) {
        console.error("Profile write error:", error);
        res.status(500).json({ error: "Could not update your profile." });
    }
});

app.get("/api/profile/:id", async (req, res) => {
    try {
        const user = await User.findOne({ id: req.params.id }).lean();
        if (!user) return res.status(404).json({ error: "Profile not found" });
        const doc = await getUserLibrary(user.id, true);
        const library = normalizeLibrary(doc.toObject ? doc.toObject() : doc);
        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            bio: library.profile.bio,
            avatar: library.profile.avatar,
            publicProfile: library.profile.publicProfile,
            playlists: library.profile.publicProfile
                ? Object.entries(library.playlists).map(([name, songs]) => ({ name, songs }))
                : []
        });
    } catch (error) {
        console.error("Profile read error:", error);
        res.status(500).json({ error: "Could not load profile." });
    }
});

app.get("/api/stats", requireAuth, async (req, res) => {
    try {
        const doc = await getUserLibrary(req.user.id, true);
        const l = normalizeLibrary(doc.toObject ? doc.toObject() : doc);
        const recent = l.recent || [];
        const counts = {};
        recent.forEach(x => {
            const k = x.channel || "Unknown";
            counts[k] = (counts[k] || 0) + 1;
        });
        const topArtists = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([artist, plays]) => ({ artist, plays }));
        res.json({
            totalPlays: recent.length,
            totalFavorites: (l.favorites || []).length,
            totalPlaylists: Object.keys(l.playlists || {}).length,
            topArtists,
            history: recent.slice(0, 50)
        });
    } catch (error) {
        console.error("Stats error:", error);
        res.status(500).json({ error: "Could not load stats." });
    }
});

app.post("/api/devices", requireAuth, async (req, res) => {
    try {
        const device = {
            id: String(req.body?.id || crypto.randomUUID()),
            name: String(req.body?.name || "VOID Device").slice(0, 80),
            platform: String(req.body?.platform || "Web"),
            lastSeen: new Date().toISOString()
        };
        const user = await User.findOne({ id: req.user.id });
        if (!user) return res.status(404).json({ error: "Account not found" });
        user.devices = [device, ...(Array.isArray(user.devices) ? user.devices : []).filter(x => x.id !== device.id)].slice(0, 10);
        user.updatedAt = new Date();
        await user.save();
        res.json({ devices: user.devices });
    } catch (error) {
        console.error("Device write error:", error);
        res.status(500).json({ error: "Could not save device." });
    }
});

app.get("/api/devices", requireAuth, async (req, res) => {
    const user = await User.findOne({ id: req.user.id }).lean();
    res.json({ devices: user?.devices || [] });
});

app.delete("/api/devices/:id", requireAuth, async (req, res) => {
    try {
        const user = await User.findOne({ id: req.user.id });
        if (!user) return res.status(404).json({ error: "Account not found" });
        user.devices = (user.devices || []).filter(x => x.id !== req.params.id);
        await user.save();
        res.json({ devices: user.devices });
    } catch (error) {
        console.error("Device delete error:", error);
        res.status(500).json({ error: "Could not delete device." });
    }
});

function buildDiscoverProfile(library) {
    const recent = Array.isArray(library?.recent) ? library.recent : [];
    const favorites = Array.isArray(library?.favorites) ? library.favorites : [];
    const history = Array.isArray(library?.searchHistory) ? library.searchHistory : [];
    const text = [...recent, ...favorites].map(x => `${x.title || ""} ${x.channel || ""}`).concat(history).join(" ").toLowerCase();
    const categories = [
        ["Bollywood & Hindi", "bollywood hindi", /bollywood|hindi|arijit|shreya|atif|armaan|jubin|sonu nigam|darshan raval|neha kakkar/],
        ["Punjabi", "punjabi", /punjabi|sidhu|karan aujla|diljit|shubh|ap dhillon|guru randhawa/],
        ["Romantic", "romantic love", /romantic|love|ishq|pyaar|romance|heart/],
        ["Hip-hop & Rap", "indian hip hop rap", /hip.?hop|rap|rap song|badshah|raftaar|divine|emiway|krishna|seedhe maut/],
        ["Party & Dance", "bollywood party dance", /party|dance|dj|club|remix|desi party/],
        ["Lo-fi & Chill", "indian lofi chill", /lofi|lo-fi|chill|study|focus|relax/],
        ["Devotional", "bhajan devotional indian", /bhajan|devotional|mantra|aarti|krishna|shiv|hanuman|spiritual|qawwali/],
        ["South Indian", "telugu tamil malayalam kannada songs", /telugu|tamil|malayalam|kannada|anirudh|thaman|alluarjun|vijay|rajinikanth/],
    ];
    const ranked = categories.map(([label, query, pattern]) => ({label, query, score:(text.match(pattern)||[]).length})).sort((a,b)=>b.score-a.score);
    const learned = ranked.filter(x=>x.score>0).slice(0,3);
    const IndianDefault = "latest Hindi Bollywood Punjabi Indian songs";
    const query = learned.length
        ? `${learned.map(x=>x.query).join(" ")} latest Indian songs`
        : `${IndianDefault} 2026`;
    const reason = learned.length
        ? `Based on your listening: ${learned.map(x=>x.label).join(" • ")}`
        : "Indian music first — VOID will learn your taste as you listen.";
    return {query, reason, interests: learned.map(x=>x.label)};
}

app.get("/api/recommendations", requireAuth, async (req,res)=>{
    const doc=await getUserLibrary(req.user.id, true); const l=normalizeLibrary(doc.toObject ? doc.toObject() : doc); const profile=buildDiscoverProfile(l);
    res.json({query:profile.query, reason:profile.reason, interests:profile.interests});
});

app.get("/api/discover", requireAuth, async (req,res)=>{
    try {
        const doc=await getUserLibrary(req.user.id, true);
        const library=normalizeLibrary(doc.toObject ? doc.toObject() : doc);
        const profile=buildDiscoverProfile(library);
        const apiKey=process.env.YOUTUBE_API_KEY;
        const cachedSearch = await youtubeSearchWithCache(profile.query, apiKey, {
            maxResults: 24, regionCode: "IN", relevanceLanguage: "hi"
        });
        res.json({
            results: cachedSearch.results,
            query: profile.query,
            reason: profile.reason,
            interests: profile.interests,
            cached: cachedSearch.cached
        });
    } catch(error){
        console.error("Discover error:",error);
        res.status(error.status || 500).json({error:error.message||"Server error while building your discover feed"});
    }
});

app.get("/api/radio", requireAuth, async (req,res)=>{
    try {
        const doc=await getUserLibrary(req.user.id, true); const library=normalizeLibrary(doc.toObject ? doc.toObject() : doc); const profile=buildDiscoverProfile(library);
        const station=String(req.query.station||"chill").slice(0,80);
        const stationMap={
          "late night chill":"late night Hindi Indian Bollywood lofi romantic chill songs",
          "focus study coding music":"Indian Hindi lofi study focus instrumental Bollywood chill",
          "high energy workout music":"Indian Punjabi Hindi Bollywood workout gym party energetic songs",
          "bollywood hits party mix":"latest Hindi Bollywood Indian party dance hits",
          "indie alternative music mix":"Indian indie Hindi Punjabi alternative songs",
          "romantic love songs mix":"Hindi Bollywood Indian romantic love songs",
        };
        const stationQuery=stationMap[station]||`Indian Hindi Bollywood ${station}`;
        const learned=(profile.interests||[]).join(" ");
        const query=`Indian Hindi Bollywood ${learned} ${stationQuery}`.replace(/\s+/g," ").trim();
        const apiKey=process.env.YOUTUBE_API_KEY;
        const cachedSearch = await youtubeSearchWithCache(query, apiKey, {
            maxResults: 24, regionCode: "IN", relevanceLanguage: "hi"
        });
        res.json({
            results: cachedSearch.results,
            query,
            reason: profile.reason,
            interests: profile.interests,
            cached: cachedSearch.cached
        });
    } catch(e){
        console.error("Radio error",e);
        res.status(e.status || 500).json({error:e.message||"Could not build your Indian radio station"});
    }
});

app.get("/api/lyrics", requireAuth, async (req,res)=>{ try { const artist=String(req.query.artist||""); const title=String(req.query.title||""); if(!title)return res.status(400).json({error:"Song title required"}); const url=new URL("https://lrclib.net/api/get"); url.searchParams.set("artist_name",artist); url.searchParams.set("track_name",title); const r=await fetch(url); if(!r.ok)return res.status(404).json({error:"Lyrics not found"}); const d=await r.json(); res.json({lyrics:d.plainLyrics||d.syncedLyrics||"Lyrics unavailable",syncedLyrics:d.syncedLyrics||""}); } catch(e){ res.status(502).json({error:"Lyrics service unavailable"}); } });
app.get("/api/public-playlists", async (req,res)=>{
    const playlists = await PublicPlaylist.find({}).sort({ updatedAt: -1 }).limit(100).lean();
    res.json({ playlists: playlists.map(x => ({ id:x.id,name:x.name,owner:x.owner,updatedAt:x.updatedAt,songs:x.songs })) });
});
app.post("/api/public-playlists", requireAuth, async (req,res)=>{
    const user = await User.findOne({ id: req.user.id }).lean();
    if (!user) return res.status(404).json({error:"Account not found"});
    const item={
        id:crypto.randomUUID(),
        name:String(req.body?.name||"VOID Playlist").slice(0,80),
        owner:{id:user.id,name:user.name},
        songs:Array.isArray(req.body?.songs)?req.body.songs.slice(0,500):[],
        updatedAt:new Date()
    };
    await PublicPlaylist.create(item);
    res.json({playlist:item});
});

// Google OAuth disabled: authentication uses email/password only.

// YouTube search
app.get("/api/search", requireAuth, async (req, res) => {
    try {
        const query = String(req.query.q || "").trim();
        if (!query) return res.status(400).json({ error: "Search query is required" });

        const apiKey = process.env.YOUTUBE_API_KEY;
        const cachedSearch = await youtubeSearchWithCache(query, apiKey, { maxResults: 25 });

        res.json({
            results: cachedSearch.results,
            cached: cachedSearch.cached,
            query: normalizeSearchQuery(query)
        });
    } catch (error) {
        console.error("Search error:", error);
        res.status(error.status || 500).json({
            error: error.message || "Server error while searching YouTube"
        });
    }
});

// ===================== END YOUTUBE SEARCH CACHE =====================

// Serve the player only after authentication.
app.use(requireAuth, express.static(publicDir));

// Start server
async function startServer() {
    const connected = await connectMongoForCache();
    if (!connected) {
        console.error("MONGODB is required. Set MONGO_URI (or MONGODB_URI) in your environment.");
        process.exit(1);
    }

    await migrateLegacyJsonToMongo();

    app.listen(PORT, "0.0.0.0", () => {
        console.log("\n================================");
        console.log("       VOID MUSIC PLAYER");
        console.log("================================");
        console.log(`Server running on port ${PORT}`);
        console.log("MongoDB persistence: ENABLED");
        console.log("================================\n");
    });
}

startServer().catch((error) => {
    console.error("Startup failed:", error);
    process.exit(1);
});