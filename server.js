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



// ===================== VOID CLOUD / V3 API =====================
const publicPlaylistsFile = path.join(dataDir, "public-playlists.json");
if (!fs.existsSync(publicPlaylistsFile)) fs.writeFileSync(publicPlaylistsFile, "[]");
function readPublicPlaylists(){ try { const x=JSON.parse(fs.readFileSync(publicPlaylistsFile,"utf8")); return Array.isArray(x)?x:[]; } catch { return []; } }
function writePublicPlaylists(x){ const t=publicPlaylistsFile+".tmp"; fs.writeFileSync(t,JSON.stringify(x,null,2)); fs.renameSync(t,publicPlaylistsFile); }
function defaultLibrary(){ return {favorites:[],queue:[],recent:[],playlists:{},searchHistory:[],settings:{theme:"dark",autoplayQueue:true,rememberVolume:true,crossfade:0,sleepTimer:0},profile:{bio:"",avatar:"",publicProfile:false},lastPlayed:null}; }
function ensureUserLibrary(user){ user.library = Object.assign(defaultLibrary(), user.library || {}); user.library.favorites = Array.isArray(user.library.favorites)?user.library.favorites:[]; user.library.queue=Array.isArray(user.library.queue)?user.library.queue:[]; user.library.recent=Array.isArray(user.library.recent)?user.library.recent:[]; user.library.searchHistory=Array.isArray(user.library.searchHistory)?user.library.searchHistory:[]; user.library.playlists=user.library.playlists && typeof user.library.playlists==='object'?user.library.playlists:{}; user.library.settings=Object.assign(defaultLibrary().settings,user.library.settings||{}); user.library.profile=Object.assign(defaultLibrary().profile,user.library.profile||{}); return user.library; }
function findAuthedUser(req){ const users=readUsers(); const u=users.find(x=>x.id===req.user.id); return {users,u}; }

app.get("/api/library", requireAuth, (req,res)=>{ const {u}=findAuthedUser(req); if(!u) return res.status(404).json({error:"Account not found"}); const library=ensureUserLibrary(u); writeUsers(readUsers().map(x=>x.id===u.id?u:x)); res.json({library}); });
app.put("/api/library", requireAuth, (req,res)=>{ const {users,u}=findAuthedUser(req); if(!u) return res.status(404).json({error:"Account not found"}); const incoming=req.body?.library||{}; const library=ensureUserLibrary(u); for(const key of ["favorites","queue","recent","playlists","searchHistory","settings","profile","lastPlayed"]){ if(incoming[key]!==undefined) library[key]=incoming[key]; } u.library=library; u.updatedAt=new Date().toISOString(); writeUsers(users); res.json({ok:true,library}); });
app.patch("/api/profile", requireAuth, (req,res)=>{ const {users,u}=findAuthedUser(req); if(!u)return res.status(404).json({error:"Account not found"}); const l=ensureUserLibrary(u); l.profile=Object.assign(l.profile, {bio:String(req.body?.bio||"").slice(0,240),avatar:String(req.body?.avatar||"").slice(0,500000),publicProfile:Boolean(req.body?.publicProfile)}); writeUsers(users); res.json({profile:l.profile}); });
app.get("/api/profile/:id", (req,res)=>{ const u=readUsers().find(x=>x.id===req.params.id); if(!u)return res.status(404).json({error:"Profile not found"}); const l=ensureUserLibrary(u); res.json({id:u.id,name:u.name,email:u.email,bio:l.profile.bio,avatar:l.profile.avatar,publicProfile:l.profile.publicProfile,playlists:l.profile.publicProfile?Object.entries(l.playlists).map(([name,songs])=>({name,songs})):[]}); });
app.get("/api/stats", requireAuth, (req,res)=>{ const {u}=findAuthedUser(req); const l=ensureUserLibrary(u); const recent=l.recent||[]; const counts={}; recent.forEach(x=>{const k=x.channel||"Unknown";counts[k]=(counts[k]||0)+1;}); const topArtists=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([artist,plays])=>({artist,plays})); res.json({totalPlays:recent.length,totalFavorites:(l.favorites||[]).length,totalPlaylists:Object.keys(l.playlists||{}).length,topArtists,history:recent.slice(0,50)}); });
app.post("/api/devices", requireAuth, (req,res)=>{ const {users,u}=findAuthedUser(req); const device={id:String(req.body?.id||crypto.randomUUID()),name:String(req.body?.name||"VOID Device").slice(0,80),platform:String(req.body?.platform||"Web"),lastSeen:new Date().toISOString()}; u.devices=Array.isArray(u.devices)?u.devices:[]; u.devices=[device,...u.devices.filter(x=>x.id!==device.id)].slice(0,10); writeUsers(users); res.json({devices:u.devices}); });
app.get("/api/devices", requireAuth, (req,res)=>{ const {u}=findAuthedUser(req); res.json({devices:u?.devices||[]}); });
app.delete("/api/devices/:id", requireAuth, (req,res)=>{ const {users,u}=findAuthedUser(req); if(!u)return res.status(404).json({error:"Account not found"}); u.devices=(u.devices||[]).filter(x=>x.id!==req.params.id); writeUsers(users); res.json({devices:u.devices}); });
function buildDiscoverProfile(library) {
    const recent = Array.isArray(library?.recent) ? library.recent : [];
    const favorites = Array.isArray(library?.favorites) ? library.favorites : [];
    const history = Array.isArray(library?.searchHistory) ? library.searchHistory : [];

    // Learn taste from the account library. Favorites count more than recent plays,
    // while search history is a lighter signal. This keeps recommendations personal
    // without requiring a separate recommendation service.
    const weightedText = [
        ...recent.flatMap(x => [`${x?.title || ""} ${x?.channel || ""}`, `${x?.title || ""} ${x?.channel || ""}`]),
        ...favorites.flatMap(x => [`${x?.title || ""} ${x?.channel || ""}`, `${x?.title || ""} ${x?.channel || ""}`, `${x?.title || ""} ${x?.channel || ""}`]),
        ...history
    ].join(" ").toLowerCase();

    const categories = [
        ["Bollywood & Hindi", "Hindi Bollywood", /bollywood|hindi|arijit|shreya|atif|armaan|jubin|sonu nigam|darshan raval|neha kakkar|pritam|vishal mishra/i],
        ["Punjabi", "Punjabi", /punjabi|sidhu|karan aujla|diljit|shubh|ap dhillon|guru randhawa|harrdy sandhu|amrit maan/i],
        ["Romantic", "Hindi romantic", /romantic|love|ishq|pyaar|romance|heart|mohabbat|bekhayali/i],
        ["Hip-hop & Rap", "Indian hip hop rap", /hip.?hop|rap|badshah|raftaar|divine|emiway|krishna|seedhe maut|mc stan/i],
        ["Party & Dance", "Hindi party dance", /party|dance|dj|club|remix|desi party|nacho/i],
        ["Lo-fi & Chill", "Indian lofi chill", /lofi|lo-fi|chill|study|focus|relax|calm/i],
        ["Devotional", "Indian bhajan devotional", /bhajan|devotional|mantra|aarti|krishna|shiv|hanuman|spiritual|qawwali/i],
        ["South Indian", "South Indian songs", /telugu|tamil|malayalam|kannada|anirudh|thaman|alluarjun|vijay|rajinikanth|ilayaraja/i],
        ["Marathi", "Marathi songs", /marathi|marathi song|ajay-atul/i],
        ["Bengali", "Bengali songs", /bengali|bangla|bengali song/i]
    ];

    const ranked = categories.map(([label, query, pattern]) => ({
        label, query,
        score: (weightedText.match(new RegExp(pattern.source, "gi")) || []).length
    })).sort((a,b) => b.score - a.score);

    const learned = ranked.filter(x => x.score > 0).slice(0, 3);
    const learnedQueries = learned.map(x => x.query);
    const query = learned.length
        ? `${learnedQueries.join(" ")} latest Indian songs Hindi music`.replace(/\s+/g, " ").trim()
        : "latest Indian Hindi Bollywood Punjabi songs 2026";
    const reason = learned.length
        ? `Based on your listening: ${learned.map(x => x.label).join(" • ")}`
        : "Indian music first — VOID will learn your taste as you listen.";
    return {query, reason, interests: learned.map(x => x.label), learnedQueries};
}

app.get("/api/recommendations", requireAuth, (req,res)=>{
    const {u}=findAuthedUser(req); const l=ensureUserLibrary(u); const profile=buildDiscoverProfile(l);
    res.json({query:profile.query, reason:profile.reason, interests:profile.interests});
});

app.get("/api/discover", requireAuth, async (req,res)=>{
    try {
        const {u}=findAuthedUser(req);
        const library=ensureUserLibrary(u);
        const profile=buildDiscoverProfile(library);
        const apiKey=process.env.YOUTUBE_API_KEY;
        if(!apiKey) return res.status(500).json({error:"YouTube API key is missing"});
        const url=new URL("https://www.googleapis.com/youtube/v3/search");
        url.searchParams.set("part","snippet");
        url.searchParams.set("type","video");
        url.searchParams.set("videoCategoryId","10");
        url.searchParams.set("maxResults","24");
        url.searchParams.set("q",profile.query);
        url.searchParams.set("regionCode","IN");
        url.searchParams.set("relevanceLanguage","hi");
        url.searchParams.set("key",apiKey);
        const response=await fetch(url);
        const data=await response.json();
        if(!response.ok) return res.status(response.status).json({error:data?.error?.message||"YouTube API error"});
        const candidates=(data.items||[]).filter(item=>item.id?.videoId);
        let embeddableIds=new Set(candidates.map(item=>item.id.videoId));
        if(candidates.length){
            const statusUrl=new URL("https://www.googleapis.com/youtube/v3/videos");
            statusUrl.searchParams.set("part","status");
            statusUrl.searchParams.set("id",candidates.map(x=>x.id.videoId).join(","));
            statusUrl.searchParams.set("key",apiKey);
            const sr=await fetch(statusUrl); const sd=await sr.json();
            if(sr.ok) embeddableIds=new Set((sd.items||[]).filter(x=>x.status?.embeddable===true).map(x=>x.id));
        }
        const results=candidates.filter(x=>embeddableIds.has(x.id.videoId)).map(item=>({
            id:item.id.videoId,
            title:item.snippet?.title||"Unknown title",
            channel:item.snippet?.channelTitle||"YouTube",
            thumbnail:item.snippet?.thumbnails?.high?.url||item.snippet?.thumbnails?.medium?.url||item.snippet?.thumbnails?.default?.url||`https://i.ytimg.com/vi/${item.id.videoId}/hqdefault.jpg`,
            publishedAt:item.snippet?.publishedAt||""
        }));
        res.json({results,query:profile.query,reason:profile.reason,interests:profile.interests});
    } catch(error){
        console.error("Discover error:",error);
        res.status(500).json({error:"Server error while building your discover feed"});
    }
});

app.get("/api/radio", requireAuth, async (req,res)=>{
    try {
        const {u}=findAuthedUser(req);
        const library=ensureUserLibrary(u);
        const profile=buildDiscoverProfile(library);
        const station=String(req.query.station||"chill").slice(0,80);

        // Every station is intentionally India-first. The station changes the mood,
        // while the user's strongest listening categories are added as the taste layer.
        const stationMap={
          "late night chill":"Hindi Bollywood Indian romantic lofi late night songs",
          "focus study coding music":"Indian Hindi lofi instrumental study focus music",
          "high energy workout music":"Indian Punjabi Hindi Bollywood workout gym energetic songs",
          "bollywood hits party mix":"Hindi Bollywood Indian party dance hits",
          "indie alternative music mix":"Indian indie Hindi Punjabi alternative songs",
          "romantic love songs mix":"Hindi Bollywood Indian romantic love songs"
        };
        const stationQuery=stationMap[station]||`Indian Hindi ${station}`;
        const taste=(profile.learnedQueries||[]).join(" ");
        const query=`${stationQuery} ${taste} Indian Hindi songs`.replace(/\s+/g," ").trim();
        const apiKey=process.env.YOUTUBE_API_KEY;
        if(!apiKey)return res.status(500).json({error:"YouTube API key is missing"});
        const url=new URL("https://www.googleapis.com/youtube/v3/search");
        for(const [k,v] of Object.entries({part:"snippet",type:"video",videoCategoryId:"10",maxResults:"24",q:query,regionCode:"IN",relevanceLanguage:"hi",safeSearch:"moderate",key:apiKey})) url.searchParams.set(k,v);
        const response=await fetch(url); const data=await response.json();
        if(!response.ok)return res.status(response.status).json({error:data?.error?.message||"YouTube API error"});
        const candidates=(data.items||[]).filter(x=>x.id?.videoId);
        let embeddableIds=new Set(candidates.map(x=>x.id.videoId));
        if(candidates.length){
          const su=new URL("https://www.googleapis.com/youtube/v3/videos");
          su.searchParams.set("part","status"); su.searchParams.set("id",candidates.map(x=>x.id.videoId).join(",")); su.searchParams.set("key",apiKey);
          const sr=await fetch(su); const sd=await sr.json();
          if(sr.ok) embeddableIds=new Set((sd.items||[]).filter(x=>x.status?.embeddable===true).map(x=>x.id));
        }

        const indianSignal=/\b(indian|india|hindi|bollywood|punjabi|tamil|telugu|malayalam|kannada|marathi|bengali|bangla|bhajan|desi|sufi|qawwali)\b|[\u0900-\u097F]/i;
        const results=candidates
          .filter(x=>embeddableIds.has(x.id.videoId))
          .filter(item=>indianSignal.test(`${item.snippet?.title||""} ${item.snippet?.channelTitle||""}`) || profile.interests?.some(i=>new RegExp(i.split(" ")[0],"i").test(`${item.snippet?.title||""} ${item.snippet?.channelTitle||""}`)))
          .map(item=>({id:item.id.videoId,title:item.snippet?.title||"Unknown title",channel:item.snippet?.channelTitle||"YouTube",thumbnail:item.snippet?.thumbnails?.high?.url||item.snippet?.thumbnails?.medium?.url||`https://i.ytimg.com/vi/${item.id.videoId}/hqdefault.jpg`,publishedAt:item.snippet?.publishedAt||""}));
        res.json({results,query,reason:profile.reason,interests:profile.interests});
    } catch(e){ console.error("Radio error",e); res.status(500).json({error:"Could not build your personalized Indian radio station"}); }
});

app.get("/api/lyrics", requireAuth, async (req,res)=>{ try { const artist=String(req.query.artist||""); const title=String(req.query.title||""); if(!title)return res.status(400).json({error:"Song title required"}); const url=new URL("https://lrclib.net/api/get"); url.searchParams.set("artist_name",artist); url.searchParams.set("track_name",title); const r=await fetch(url); if(!r.ok)return res.status(404).json({error:"Lyrics not found"}); const d=await r.json(); res.json({lyrics:d.plainLyrics||d.syncedLyrics||"Lyrics unavailable",syncedLyrics:d.syncedLyrics||""}); } catch(e){ res.status(502).json({error:"Lyrics service unavailable"}); } });
app.get("/api/public-playlists", (req,res)=>res.json({playlists:readPublicPlaylists().map(x=>({id:x.id,name:x.name,owner:x.owner,updatedAt:x.updatedAt,songs:x.songs}))}));
app.post("/api/public-playlists", requireAuth, (req,res)=>{ const {u}=findAuthedUser(req); const list=readPublicPlaylists(); const item={id:crypto.randomUUID(),name:String(req.body?.name||"VOID Playlist").slice(0,80),owner:{id:u.id,name:u.name},songs:Array.isArray(req.body?.songs)?req.body.songs.slice(0,500):[],updatedAt:new Date().toISOString()}; list.unshift(item); writePublicPlaylists(list.slice(0,100)); res.json({playlist:item}); });

// Optional Google OAuth integration: set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET and add a provider.
app.get("/api/auth/providers", (req,res)=>res.json({google:Boolean(process.env.GOOGLE_CLIENT_ID),email:true}));
const googleStates = new Map();
app.get("/api/auth/google", (req,res)=>{
  if(!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(503).send("Google sign-in is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.");
  const state=crypto.randomBytes(24).toString("hex"); googleStates.set(state,Date.now()+300000);
  const redirect=process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
  const u=new URL("https://accounts.google.com/o/oauth2/v2/auth"); u.searchParams.set("client_id",process.env.GOOGLE_CLIENT_ID);u.searchParams.set("redirect_uri",redirect);u.searchParams.set("response_type","code");u.searchParams.set("scope","openid email profile");u.searchParams.set("state",state); res.redirect(u.toString());
});
app.get("/api/auth/google/callback", async (req,res)=>{
 try{
  const state=String(req.query.state||""); if(!googleStates.has(state)||googleStates.get(state)<Date.now()) return res.status(400).send("Google sign-in state expired."); googleStates.delete(state);
  const redirect=process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
  const body=new URLSearchParams({code:String(req.query.code||""),client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:redirect,grant_type:"authorization_code"});
  const tokenRes=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body}); const tokens=await tokenRes.json(); if(!tokenRes.ok) throw new Error(tokens.error_description||"Google token exchange failed");
  const infoRes=await fetch(`https://openidconnect.googleapis.com/v1/userinfo?access_token=${encodeURIComponent(tokens.access_token)}`); const info=await infoRes.json(); if(!infoRes.ok||!info.email) throw new Error("Google profile could not be read");
  const users=readUsers(); let user=users.find(x=>normalizeEmail(x.email)===normalizeEmail(info.email)); if(!user){user={id:crypto.randomUUID(),name:info.name||info.email.split("@")[0],email:normalizeEmail(info.email),salt:crypto.randomBytes(16).toString("hex"),hash:crypto.randomBytes(64).toString("hex"),createdAt:new Date().toISOString(),googleId:info.sub};users.push(user)} else {user.googleId=info.sub;user.name=info.name||user.name;}
  writeUsers(users); setSessionCookie(res,createSession(user)); res.redirect("/");
 }catch(e){console.error("Google OAuth error",e);res.status(500).send("Google sign-in failed. Check OAuth settings.");}
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

        const candidates = (data.items || [])
            .filter(item => item.id?.videoId);

        // Search results can contain videos that YouTube does not allow to be
        // embedded. Those videos produce IFrame API errors 101/150 and can
        // make a playlist appear to stop. Ask the Videos API for embed status
        // and remove them before sending results to the player.
        let embeddableIds = new Set();
        if (candidates.length) {
            const ids = candidates.map(item => item.id.videoId).join(",");
            const statusUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
            statusUrl.searchParams.set("part", "status");
            statusUrl.searchParams.set("id", ids);
            statusUrl.searchParams.set("key", apiKey);

            const statusResponse = await fetch(statusUrl);
            const statusData = await statusResponse.json();
            if (statusResponse.ok) {
                embeddableIds = new Set(
                    (statusData.items || [])
                        .filter(item => item.status?.embeddable === true)
                        .map(item => item.id)
                );
            } else {
                console.error("YouTube video-status API error:", statusData);
                // If status lookup fails, keep the search results rather than
                // breaking search completely. The client still handles 101/150.
                embeddableIds = new Set(candidates.map(item => item.id.videoId));
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