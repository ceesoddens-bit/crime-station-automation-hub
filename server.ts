import dotenv from "dotenv";
import path from "path";
dotenv.config();

import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { google } from "googleapis";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import net from "net";
import axios from "axios";
import multer from "multer";

// Configure multer for file uploads - 10GB limit
const upload = multer({ 
  dest: "data/", 
  limits: { fileSize: 10 * 1024 * 1024 * 1024 } 
});

// Check if local ffmpeg exists and set path
const localFfmpeg = path.join(process.cwd(), "ffmpeg");
if (fs.existsSync(localFfmpeg)) {
  ffmpeg.setFfmpegPath(localFfmpeg);
}

// Utility to retry promises with exponential backoff on transient errors
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 2000): Promise<T> {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      console.warn(`[Retry] Attempt ${attempt} failed: ${error.message || error}`);
      if (attempt >= retries) throw error;
      // Wait before retrying (exponential backoff)
      await new Promise((res) => setTimeout(res, delayMs * Math.pow(2, attempt - 1)));
    }
  }
  return fn(); // Fallback that should never be reached
}

// ---------------------------------------------------------------------------
// Transcript blokken & hoofdstukken
// ---------------------------------------------------------------------------

type Segment = { start: number; end: number; text: string; speaker?: string };
type Block = { id: number; start: number; end: number; text: string };
type Chapter = { start: number; title: string; block_id: number };

/**
 * Groepeert segmenten tot blokken van ~targetBlockSecs seconden, en forceert
 * een break bij pauzes langer dan gapSecs. Elk blok krijgt een id zodat
 * Gemini naar exacte tijdstippen kan verwijzen zonder te hallucineren.
 */
function buildBlocks(segments: Segment[], targetBlockSecs = 60, gapSecs = 3.0): Block[] {
  const blocks: Block[] = [];
  let cur: { start: number; end: number; texts: string[] } | null = null;

  const flush = () => {
    if (!cur) return;
    blocks.push({
      id: blocks.length,
      start: cur.start,
      end: cur.end,
      text: cur.texts.join(" ").replace(/\s+/g, " ").trim(),
    });
    cur = null;
  };

  for (const seg of segments) {
    const text = (seg.text || "").trim();
    if (!text) continue;

    if (!cur) {
      cur = { start: seg.start, end: seg.end, texts: [text] };
      continue;
    }

    const gap = seg.start - cur.end;
    const duration = cur.end - cur.start;

    if (gap > gapSecs || duration >= targetBlockSecs) {
      flush();
      cur = { start: seg.start, end: seg.end, texts: [text] };
    } else {
      cur.end = seg.end;
      cur.texts.push(text);
    }
  }
  flush();
  return blocks;
}

function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Valideert Gemini's chapter-voorstel: altijd 0:00 Introductie forceren,
 * min. 60s tussen hoofdstukken, max 12 hoofdstukken, tijdstempels uit blokken.
 */
function buildChapterList(
  rawChapters: Array<{ block_id: number; title: string }> | undefined,
  blocks: Block[]
): Chapter[] {
  if (!Array.isArray(rawChapters) || blocks.length === 0) {
    return [{ start: 0, title: "Introductie", block_id: 0 }];
  }

  const valid: Chapter[] = [];
  const seenBlocks = new Set<number>();

  for (const ch of rawChapters) {
    const blockId = Number(ch.block_id);
    const title = (ch.title || "").toString().trim();
    if (!title) continue;
    if (!Number.isFinite(blockId) || blockId < 0 || blockId >= blocks.length) continue;
    if (seenBlocks.has(blockId)) continue;

    seenBlocks.add(blockId);
    valid.push({
      start: blocks[blockId].start,
      title,
      block_id: blockId,
    });
  }

  valid.sort((a, b) => a.start - b.start);

  // Forceer eerste chapter op 0:00 Introductie
  if (valid.length === 0 || valid[0].start > 5) {
    valid.unshift({ start: 0, title: "Introductie", block_id: 0 });
  } else {
    valid[0] = { ...valid[0], start: 0 };
  }

  // Verwijder chapters die te dicht op elkaar zitten (< 60s)
  const spaced: Chapter[] = [];
  for (const ch of valid) {
    if (spaced.length === 0 || ch.start - spaced[spaced.length - 1].start >= 60) {
      spaced.push(ch);
    }
  }

  return spaced.slice(0, 12);
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildAnalysisPrompt(opts: {
  series: string; host1: string; host2: string; guest: string; transcription: string;
}): string {
  const isNoGuest = !opts.guest || opts.guest.trim().toLowerCase() === "geen gast";
  const guestLine = isNoGuest
    ? "Geen gast — alleen presentatoren aanwezig."
    : `Gast: ${opts.guest}`;

  return `Je bent een content-analist voor Crime Station, een Nederlandse journalistieke true-crime podcast. Lees het onderstaande transcript grondig en geef een gestructureerde analyse.

Serie: ${opts.series}
Presentatoren: ${opts.host1}${opts.host2 ? `, ${opts.host2}` : ""}
${guestLine}

---
${opts.transcription}
---

Geef de analyse als gewone tekst (geen JSON, geen markdown headers) met deze onderdelen:

1. KERNCASUS (1 zin): waar gaat deze aflevering écht over?
2. BETROKKENEN: welke personen, plaatsen, instanties worden genoemd?
3. NARRATIEVE BOOG (3-5 punten): hoe loopt het gesprek? Van inleiding via opbouw naar climax of reflectie.
4. INHOUDELIJKE HAAKJES (3-5): concrete, specifieke momenten of onthullingen die een kijker zouden interesseren. Geen clichés — citeer concrete details uit het gesprek.
5. TOON: serieus/reflectief/onthullend/menselijk? Wat overheerst?

Houd het bondig maar inhoudelijk. Geen sensatietaal.`;
}

function buildCopyPrompt(opts: {
  series: string; host1: string; host2: string; guest: string; episodeNumber: string;
  analysis: string; blocks: Block[];
}): string {
  const isNoGuest = !opts.guest || opts.guest.trim().toLowerCase() === "geen gast";

  const blocksText = opts.blocks
    .map(b => `[${b.id}] (${formatTimestamp(b.start)}) ${b.text.slice(0, 350)}`)
    .join("\n");

  return `Je bent redacteur voor Crime Station, een Nederlandse journalistieke true-crime podcast. Je schrijft titel, beschrijving en hoofdstukindeling voor één aflevering.

CONTEXT
Serie: ${opts.series}
Afleveringsnummer: ${opts.episodeNumber}
Presentatoren: ${opts.host1}${opts.host2 ? `, ${opts.host2}` : ""}
${isNoGuest ? "Geen gast." : `Gast: ${opts.guest}`}

ANALYSE VAN DEZE AFLEVERING
${opts.analysis}

BLOKKEN UIT DE AFLEVERING (genummerd, met starttijd en eerste woorden):
${blocksText}

---

SCHRIJFSTIJL (zeer belangrijk)
- Journalistiek, integer, respectvol, menselijk. Nuchter Nederlands.
- Géén sensatiewoorden: vermijd "schokkend", "hartverscheurend", "onthullend", "mysterieus", "geheim", clickbait-constructies ("je gelooft niet wat…"), vraagtekens in titels.
- Géén Title Case. Alleen hoofdletter bij eerste woord en eigennamen. Gebruik géén emoji's.
- Brand safety: vervang "moord" door "fataal geweldsdelict", "fataal incident", of "het verlies".
- Titels zijn concreet en specifiek, niet abstract. Benoem waar het over gaat, niet hoe spannend het is.

TITEL-VOORBEELDEN (juiste toon)
- "De onzichtbare strijd van nabestaanden"
- "Wat er misging in het onderzoek naar de zaak-Hoorn"
- "Waarom deze cold case na dertig jaar weer wordt heropend"

HOOFDSTUKKEN (chapters)
- Selecteer 5 tot 10 blokken uit de lijst die een nieuw inhoudelijk onderwerp markeren.
- Gebruik het exacte block_id uit de lijst hierboven — verzin géén tijdstempels.
- Eerste hoofdstuk is altijd "Introductie" (block_id 0).
- Titels zijn kort (2-6 woorden), beschrijvend, journalistiek van toon.
- Hoofdstuktitels volgen de inhoud van dat blok, niet een samenvatting van de hele aflevering.

OUTPUT
Geef alléén valid JSON terug, exact in dit format:

{
  "youtube": {
    "titel": "...",
    "intro": "Korte openingsalinea van 2-4 zinnen die het onderwerp introduceert — komt bovenaan de beschrijving, vóór de hoofdstukken.",
    "outro": "Optioneel 1-2 zinnen slot na de hoofdstukken, vóór de CTA.",
    "hashtags": ["#CrimeStation", "#...", "#..."],
    "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10"]
  },
  "spotify": {
    "titel": "${opts.series}: onderwerp",
    "beschrijving": "Zelfstandige beschrijving voor Spotify-luisteraars (5-8 zinnen). Geen hoofdstukken — die voegen we later toe. Focus op wat je leert of ervaart tijdens het luisteren."
  },
  "chapters": [
    {"block_id": 0, "title": "Introductie"},
    {"block_id": 7, "title": "..."},
    {"block_id": 14, "title": "..."}
  ]
}

BELANGRIJK: exact 3 hashtags. Exact 10 tags. Hashtags beginnen met #, tags niet.`;
}

function composeYoutubeDescription(youtube: any, chapterText: string, guest: string): string {
  const intro = (youtube?.intro || "").trim();
  const outro = (youtube?.outro || "").trim();
  const hashtags = Array.isArray(youtube?.hashtags)
    ? youtube.hashtags.slice(0, 3).join(" ")
    : "";

  const cta = `Heb je zelf een vraag voor Mick, Nancy of onze gasten? Mail naar mick@crimestation.nl of laat een reactie achter.

• Abonneer je voor wekelijkse reportages en rechtbankverslagen.

• Luister deze podcast op Spotify: [link]

• Meer misdaadnieuws: www.crimestation.nl`;

  return [intro, chapterText, outro, cta, hashtags]
    .filter(Boolean)
    .join("\n\n");
}

function composeSpotifyDescription(spotify: any, chapterText: string, guest: string): string {
  const body = (spotify?.beschrijving || "").trim();

  const cta = `Heb je zelf een vraag voor Mick, Nancy of onze gasten? Mail naar mick@crimestation.nl.

Waardeer je deze aflevering? Geef ons 5 sterren en klik op 'Volgen' om niets te missen.

Meer misdaadnieuws: www.crimestation.nl`;

  return [body, chapterText, cta].filter(Boolean).join("\n\n");
}


async function startServer() {
  const app = express();
  const HOST = "0.0.0.0";
  const desiredPort = 3001;
  const desiredHmrPort = 24678;

  app.use(express.json());

  const findAvailablePort = async (startPort: number, host: string) => {
    for (let port = startPort; port < startPort + 50; port += 1) {
      const available = await new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.once("error", (err: any) => {
          server.close();
          if (err?.code === "EADDRINUSE") resolve(false);
          else resolve(true);
        });
        server.once("listening", () => {
          server.close(() => resolve(true));
        });
        server.listen(port, host);
      });
      if (available) return port;
    }
    return startPort;
  };

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    `${process.env.APP_URL}/oauth2callback`
  );

  const tokensPath = path.join(dataDir, "youtube_token.json");
  if (fs.existsSync(tokensPath)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
      oauth2Client.setCredentials(tokens);
    } catch(e) {}
  }

  app.get("/api/auth/youtube", (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/youtube.upload"],
      prompt: 'consent'
    });
    res.redirect(url);
  });

  app.get("/api/auth/youtube/status", (req, res) => {
    res.json({ linked: fs.existsSync(tokensPath) });
  });

  app.get("/oauth2callback", async (req, res) => {
    const code = req.query.code;
    try {
      const { tokens } = await oauth2Client.getToken(code as string);
      oauth2Client.setCredentials(tokens);
      fs.writeFileSync(tokensPath, JSON.stringify(tokens));
      res.send("<h1>Succesvol gekoppeld!</h1><p>Je kunt dit venster sluiten en teruggaan naar de Crime Station Hub.</p><script>setTimeout(() => window.close(), 3000)</script>");
    } catch (e: any) {
      res.status(500).send("Fout tijdens koppeling: " + e.message);
    }
  });

  app.post("/api/process", upload.single('videoFile'), async (req, res) => {
    const { series, host1, host2, guest, episodeNumber } = req.body;
    const uploadedFile = req.file;
    const requestId = Date.now().toString();
    const audioOutput = path.join(dataDir, `audio_${requestId}.mp3`);
    let currentStep = 0; // 0=compressie, 1=transcriptie, 2=tekstgeneratie

    try {
      if (!uploadedFile) throw new Error("Geen bestand geüpload.");
      const sourceFile = uploadedFile.path;

      // Step 1: Audio extractie — altijd naar 16kHz mono MP3 (matches WhisperX input)
      console.log(`[${requestId}] Starting Step 1: Audio Extraction... (source: ${sourceFile}, size: ${(uploadedFile.size / 1024 / 1024).toFixed(1)}MB)`);
      currentStep = 0;

      await new Promise<void>((resolve, reject) => {
        ffmpeg(sourceFile)
          .audioCodec("libmp3lame")
          .audioBitrate("64k")
          .audioChannels(1)
          .audioFrequency(16000)
          .outputOptions(['-vn'])
          .on("end", () => { console.log(`[${requestId}] FFmpeg done.`); resolve(); })
          .on("error", (err: any) => {
            console.error(`[${requestId}] FFmpeg error:`, err.message);
            reject(new Error(`Audio extractie mislukt: ${err.message}`));
          })
          .save(audioOutput);
      });

      // Step 2: Transcription via Whisper agent (path-based, geen upload nodig)
      console.log(`[${requestId}] Starting Step 2: Transcription via Whisper...`);
      currentStep = 1;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");
      const ai = new GoogleGenAI({ apiKey });

      try {
        const health = await fetch("http://localhost:8001/health", { signal: AbortSignal.timeout(5000) });
        if (!health.ok) throw new Error("niet ok");
      } catch {
        throw new Error("Whisper agent is niet bereikbaar op localhost:8001. Start de Whisper server eerst.");
      }

      const whisperResp = await fetch("http://localhost:8001/transcribe_path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: path.resolve(audioOutput),
          language: "nl",
          diarize: true,
          host1: host1 || undefined,
          host2: host2 || undefined,
          guest: guest || undefined,
        }),
        signal: AbortSignal.timeout(4 * 60 * 60 * 1000), // 4 uur voor lange afleveringen
      });

      if (!whisperResp.ok) {
        const errBody = await whisperResp.json().catch(() => ({})) as any;
        throw new Error(`Whisper fout (${whisperResp.status}): ${errBody.detail || whisperResp.statusText}`);
      }

      const whisperData = await whisperResp.json() as any;
      if (whisperData.status !== "success") {
        throw new Error(`Whisper transcriptie mislukt: ${whisperData.detail || "onbekende fout"}`);
      }

      const transcription = whisperData.transcription as string;
      const segments: any[] = whisperData.segments || [];
      if (!transcription || segments.length === 0) throw new Error("Transcriptie is leeg.");

      // Generate SRT from segments
      const srtFmt = (s: number) => {
        const h = Math.floor(s / 3600).toString().padStart(2, "0");
        const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
        const sec = Math.floor(s % 60).toString().padStart(2, "0");
        const ms = Math.round((s % 1) * 1000).toString().padStart(3, "0");
        return `${h}:${m}:${sec},${ms}`;
      };
      // SRT zonder sprekernamen — die horen niet in YouTube/Spotify ondertiteling.
      // Sprekerlabels blijven wel in segments[] voor de DOCX-export.
      const srtContent = segments.map((seg: any, i: number) => {
        return `${i + 1}\n${srtFmt(seg.start)} --> ${srtFmt(seg.end)}\n${seg.text?.trim()}\n`;
      }).join("\n");

      console.log(`[${requestId}] Transcription completed (${segments.length} segmenten).`);

      // Step 3: Tekstgeneratie
      currentStep = 2;

      // Step 3a: Segmenten groeperen tot semantische blokken
      const blocks = buildBlocks(segments, 60, 3.0);
      console.log(`[${requestId}] ${blocks.length} blokken gebouwd.`);

      // Step 3b: Analyse-stap (flash) — begrijp de aflevering eerst
      const analysisPrompt = buildAnalysisPrompt({ series, host1, host2, guest, transcription });
      console.log(`[${requestId}] Running analysis stage...`);
      const analysisResp = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: analysisPrompt }] }],
        config: { temperature: 0.3 },
      }));
      const analysis = (analysisResp.text || "").trim();
      console.log(`[${requestId}] Analysis done (${analysis.length} chars).`);

      // Step 3c: Copy + chapter block-ids (pro)
      const copyPrompt = buildCopyPrompt({
        series, host1, host2, guest, episodeNumber, analysis, blocks,
      });
      console.log(`[${requestId}] Running copy stage...`);
      const copyResp = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: copyPrompt }] }],
        config: { temperature: 0.7, responseMimeType: "application/json" },
      }));

      const rawCopy = (copyResp.text || "").trim();
      let parsedCopy: any;
      try {
        const m = rawCopy.match(/\{[\s\S]*\}/);
        parsedCopy = JSON.parse(m ? m[0] : rawCopy);
      } catch (e: any) {
        throw new Error(`Kon copy-output niet parsen: ${e.message}`);
      }

      // Step 3d: Chapters valideren + timestamps server-side bouwen
      const chapterList = buildChapterList(parsedCopy.chapters, blocks);
      const chapterText = chapterList.map(c => `${formatTimestamp(c.start)} ${c.title}`).join("\n");

      // Beschrijving samenstellen: intro + chapters + rest
      const youtubeDescription = composeYoutubeDescription(parsedCopy.youtube, chapterText, guest);
      const spotifyDescription = composeSpotifyDescription(parsedCopy.spotify, chapterText, guest);

      const artifact = {
        youtube: {
          titel: parsedCopy.youtube?.titel || "",
          beschrijving: youtubeDescription,
          hashtags: parsedCopy.youtube?.hashtags || [],
          tags: parsedCopy.youtube?.tags || [],
        },
        spotify: {
          titel: parsedCopy.spotify?.titel || "",
          beschrijving: spotifyDescription,
        },
        chapters: chapterList,
      };

      console.log(`[${requestId}] Step 3: Text Generation completed.`);

      // Step 4: Creating Artifact
      const srtPath = path.join(dataDir, `srt_${requestId}.srt`);
      fs.writeFileSync(srtPath, srtContent);
      const artifactContent = JSON.stringify(artifact, null, 2);
      fs.writeFileSync(path.join(dataDir, "concept.json"), artifactContent);
      fs.writeFileSync(path.join(dataDir, `meta_${requestId}.json`), JSON.stringify({ videoPath: sourceFile }));

      res.json({
        status: "waiting_approval",
        data: {
          requestId: requestId,
          artifact: artifactContent,
          transcription: transcription,
          hasSrt: true
        }
      });
    } catch (error: any) {
      console.error(`[${requestId}] Error at step ${currentStep}:`, error);
      res.status(500).json({
        error: error.message || "Processing failed",
        step: currentStep,
      });
    }
  });

  app.get("/api/download/srt/:requestId", (_req, res) => {
    const srtPath = path.join(dataDir, `srt_${_req.params.requestId}.srt`);
    if (!fs.existsSync(srtPath)) {
      res.status(404).json({ error: "SRT bestand niet gevonden." });
      return;
    }
    res.setHeader("Content-Disposition", `attachment; filename="transcriptie_${_req.params.requestId}.srt"`);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.sendFile(srtPath);
  });

  app.post("/api/publish/youtube", async (req, res) => {
    try {
      const { requestId, youtube } = req.body;
      if (!requestId) throw new Error("Geen requestId meegegeven.");
      
      const metaFile = path.join(dataDir, `meta_${requestId}.json`);
      if (!fs.existsSync(metaFile)) throw new Error("Video metadata niet gevonden. (Start het proces opnieuw)");
      
      const { videoPath } = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (!fs.existsSync(videoPath)) throw new Error("Originele videobestand is niet meer beschikbaar.");
      
      const youtubeApi = google.youtube('v3');
      const tags = typeof youtube?.tags === 'string' ? youtube.tags.split(',').map((t: string) => t.trim()) : (Array.isArray(youtube?.tags) ? youtube.tags : []);
      
      const response = await youtubeApi.videos.insert({
        auth: oauth2Client,
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: youtube?.titel ? youtube.titel.slice(0, 100) : "Crime Station Aflevering",
            description: youtube?.beschrijving || "",
            tags: tags,
            categoryId: "25", // 25 = News & Politics
            defaultLanguage: 'nl',
            defaultAudioLanguage: 'nl'
          },
          status: { 
            privacyStatus: 'private',
            selfDeclaredMadeForKids: false
          }
        },
        media: { body: fs.createReadStream(videoPath) }
      });
      
      res.json({ status: "completed", links: { youtube: `https://youtube.com/watch?v=${response.data.id}` } });
    } catch (error: any) {
      console.error("Publish error:", error);
      res.status(500).json({ error: error.message || "Failed to publish" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const PORT = await findAvailablePort(desiredPort, HOST);
    const hmrPort = await findAvailablePort(desiredHmrPort, HOST);

    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { port: hmrPort } },
      appType: "spa",
    });
    app.use(vite.middlewares);

    const server = app.listen(PORT, HOST, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
    server.timeout = 30 * 60 * 1000; // 30 minutes
  } else {
    const PORT = desiredPort;
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    const server = app.listen(PORT, HOST, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
    server.timeout = 30 * 60 * 1000;
  }
}

startServer();
