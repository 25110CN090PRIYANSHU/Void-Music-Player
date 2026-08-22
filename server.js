const express = require("express");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

app.get("/api/health",(req,res)=>res.json({ok:true,service:"VOID Music Player"}));

app.get("/api/search",async(req,res)=>{
    try{
        const query=String(req.query.q||"").trim();
        if(!query)return res.status(400).json({error:"Search query is required"});
        const apiKey=process.env.YOUTUBE_API_KEY;
        if(!apiKey)return res.status(500).json({error:"YouTube API key is missing. Add YOUTUBE_API_KEY to your .env file."});

        const url=new URL("https://www.googleapis.com/youtube/v3/search");
        url.searchParams.set("part","snippet");
        url.searchParams.set("type","video");
        url.searchParams.set("videoCategoryId","10");
        url.searchParams.set("maxResults","25");
        url.searchParams.set("q",query);
        url.searchParams.set("key",apiKey);

        const response=await fetch(url);
        const data=await response.json();

        if(!response.ok){
            console.error("YouTube API error:",data);
            return res.status(response.status).json({error:data?.error?.message||"YouTube API error"});
        }

        const results=(data.items||[])
            .filter(item=>item.id?.videoId)
            .map(item=>({
                id:item.id.videoId,
                title:item.snippet?.title||"Unknown title",
                channel:item.snippet?.channelTitle||"YouTube",
                thumbnail:item.snippet?.thumbnails?.high?.url||item.snippet?.thumbnails?.medium?.url||item.snippet?.thumbnails?.default?.url||`https://i.ytimg.com/vi/${item.id.videoId}/hqdefault.jpg`,
                publishedAt:item.snippet?.publishedAt||""
            }));

        res.json({results});
    }catch(error){
        console.error("Search error:",error);
        res.status(500).json({error:"Server error while searching YouTube"});
    }
});

app.listen(PORT,()=>{
    console.log("\n================================");
    console.log("       VOID MUSIC PLAYER");
    console.log("================================");
    console.log(`http://localhost:${PORT}`);
    console.log("================================\n");
});
