import dotenv from "dotenv";
import path from "path";
dotenv.config();

import express from "express";
import session from "express-session";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { google } from "googleapis";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import net from "net";
import axios from "axios";
import multer from "multer";

// Session type uitbreiden
declare module "express-session" {
  interface SessionData { loggedIn: boolean; username: string; }
}

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
async function withRetry<T>(fn: () => Promise<T>, retries = 5, delayMs = 3000): Promise<T> {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      console.warn(`[Retry] Attempt ${attempt} failed: ${error.message || error}`);
      if (attempt >= retries) throw error;
      // Wait before retrying (exponential backoff, capped at 30s)
      const wait = Math.min(delayMs * Math.pow(2, attempt - 1), 30000);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  return fn(); // Fallback that should never be reached
}

// Try a Gemini call with the primary model; on persistent 503/UNAVAILABLE
// fall back to an alternative model so the pipeline doesn't die when one
// model is overloaded.
async function generateWithFallback<T>(
  call: (model: string) => Promise<T>,
  primary: string,
  fallback: string,
): Promise<T> {
  try {
    return await withRetry(() => call(primary));
  } catch (error: any) {
    const status = error?.status ?? error?.response?.status;
    const msg = String(error?.message || error);
    const overloaded = status === 503 || /UNAVAILABLE|high demand|overloaded/i.test(msg);
    if (!overloaded || primary === fallback) throw error;
    console.warn(`[Fallback] ${primary} unavailable, retrying with ${fallback}`);
    return await withRetry(() => call(fallback));
  }
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
  rawChapters: Array<{ segment_id?: string; block_id?: number; title: string }> | undefined,
  blocks: Block[],
  segments: Segment[] = []
): Chapter[] {
  if (!Array.isArray(rawChapters) || blocks.length === 0) {
    return [{ start: 0, title: "Introductie", block_id: 0 }];
  }

  const valid: Chapter[] = [];
  const seenIds = new Set<string>();

  for (const ch of rawChapters) {
    const title = (ch.title || "").toString().trim();
    if (!title) continue;

    let startTime: number | null = null;
    let blockId = 0;

    // Segment-gebaseerde timestamp (nauwkeurig)
    if (ch.segment_id && typeof ch.segment_id === 'string') {
      const segIdx = parseInt(ch.segment_id.replace('seg', ''), 10);
      if (Number.isFinite(segIdx) && segIdx >= 0 && segIdx < segments.length) {
        startTime = segments[segIdx].start;
        blockId = segIdx;
      }
    }

    // Fallback: block-gebaseerde timestamp
    if (startTime === null && ch.block_id !== undefined) {
      const bId = Number(ch.block_id);
      if (Number.isFinite(bId) && bId >= 0 && bId < blocks.length) {
        startTime = blocks[bId].start;
        blockId = bId;
      }
    }

    if (startTime === null) continue;
    const key = `${startTime}`;
    if (seenIds.has(key)) continue;
    seenIds.add(key);

    valid.push({ start: startTime, title, block_id: blockId });
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
  analysis: string; blocks: Block[]; segments: Segment[];
}): string {
  const isNoGuest = !opts.guest || opts.guest.trim().toLowerCase() === "geen gast";

  // Blokken van 30s voor contentbegrip
  const blocksText = opts.blocks
    .map(b => `[${b.id}] (${formatTimestamp(b.start)}) ${b.text.slice(0, 120)}`)
    .join("\n");

  // Segmenten voor nauwkeurige chapter-timestamps (elke 3-8s)
  const segmentsText = opts.segments
    .map((s, i) => `[seg${i}] (${formatTimestamp(s.start)}) ${(s.text || "").trim().slice(0, 80)}`)
    .join("\n");

  return `Je bent redacteur voor Crime Station, een Nederlandse journalistieke true-crime podcast. Je schrijft titel, beschrijving en hoofdstukindeling voor één aflevering.

CONTEXT
Serie: ${opts.series}
Afleveringsnummer: ${opts.episodeNumber}
Presentatoren: ${opts.host1}${opts.host2 ? `, ${opts.host2}` : ""}
${isNoGuest ? "Geen gast." : `Gast: ${opts.guest}`}

ANALYSE VAN DEZE AFLEVERING
${opts.analysis}

BLOKKEN UIT DE AFLEVERING (voor inhoudsbegrip — genummerd, met starttijd):
${blocksText}

SEGMENTEN VOOR HOOFDSTUK-TIMESTAMPS (gebruik deze voor exacte starttijden):
${segmentsText}

---

SCHRIJFSTIJL (zeer belangrijk)
- Journalistiek, integer, respectvol, menselijk. Nuchter Nederlands.
- Géén sensatiewoorden: vermijd "schokkend", "hartverscheurend", "onthullend", "mysterieus", "geheim", clickbait-constructies ("je gelooft niet wat…"), vraagtekens in titels.
- Géén Title Case. Alleen hoofdletter bij eerste woord en eigennamen. Gebruik géén emoji's.
- Brand safety: vervang "moord" door "fataal geweldsdelict", "fataal incident", of "het verlies".
- Titels zijn concreet en specifiek, niet abstract. Benoem waar het over gaat, niet hoe spannend het is.

TITEL-REGELS
- YouTube-titel: NOOIT de serienaam ("${opts.series}") erin. Alleen het onderwerp van deze aflevering.
- Spotify-titel: WEL de serienaam als prefix, formaat: "${opts.series}: [onderwerp]"

TITEL-VOORBEELDEN (juiste toon voor YouTube)
- "De onzichtbare strijd van nabestaanden"
- "Wat er misging in het onderzoek naar de zaak-Hoorn"
- "Waarom deze cold case na dertig jaar weer wordt heropend"

HOOFDSTUKKEN (chapters)
- Selecteer 5 tot 10 momenten waarop een nieuw inhoudelijk onderwerp begint.
- Gebruik de BLOKKEN lijst om de inhoud te begrijpen en te bepalen welke onderwerpen er zijn.
- Gebruik daarna de SEGMENTEN lijst om het exacte segment te vinden waar dat onderwerp begint — kies het segment waar de spreker het onderwerp voor het EERST introduceert.
- Geef het segment_id terug als "seg0", "seg12", etc.
- Eerste hoofdstuk is altijd "Introductie" met segment_id "seg0".
- Titels zijn kort (2-6 woorden), beschrijvend, journalistiek van toon.

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
    {"segment_id": "seg0", "title": "Introductie"},
    {"segment_id": "seg42", "title": "..."},
    {"segment_id": "seg87", "title": "..."}
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
  app.use(session({
    secret: process.env.SESSION_SECRET || "fallback-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 dagen
  }));

  // Auth middleware — beschermt alle /api routes behalve login/logout/status
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const publicPaths = ['/auth/login', '/auth/logout', '/auth/me', '/auth/youtube'];
    if (publicPaths.some(p => req.path.startsWith(p))) return next();
    if (req.session?.loggedIn) return next();
    res.status(401).json({ error: "Niet ingelogd" });
  };
  app.use('/api', requireAuth);

  // Login
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const accounts = [
      { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'crimestation2026' },
      { username: process.env.USER2_USERNAME || '', password: process.env.USER2_PASSWORD || '' },
    ];
    const match = accounts.find(a => a.username && username === a.username && password === a.password);
    if (match) {
      req.session.loggedIn = true;
      req.session.username = username;
      res.json({ status: 'ok', username });
    } else {
      res.status(401).json({ error: 'Gebruikersnaam of wachtwoord onjuist' });
    }
  });

  // Logout
  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ status: 'ok' }));
  });

  // Check sessiestatus
  app.get('/api/auth/me', (req, res) => {
    if (req.session?.loggedIn) {
      res.json({ loggedIn: true, username: req.session.username });
    } else {
      res.json({ loggedIn: false });
    }
  });

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

  // Hulpfunctie: verwijder bestand veilig (geen fout als het niet bestaat)
  const safeDelete = (filePath: string) => {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  };

  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    `${process.env.APP_URL}/oauth2callback`
  );

  // --- Profiles ---
  interface Profile {
    id: string;
    name: string;
    spotifyUrl: string;
    publishYoutube: boolean;
    publishSpotify: boolean;
  }
  const profilesPath = path.join(dataDir, 'profiles.json');
  const loadProfiles = (): Profile[] => {
    if (!fs.existsSync(profilesPath)) return [];
    try { return JSON.parse(fs.readFileSync(profilesPath, 'utf8')); } catch { return []; }
  };
  const saveProfiles = (profiles: Profile[]) => fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2));
  const getTokenPath = (profileId: string) => path.join(dataDir, `youtube_token_${profileId}.json`);

  app.get('/api/profiles', (_req, res) => {
    const profiles = loadProfiles();
    res.json(profiles.map(p => ({ ...p, youtubeLinked: fs.existsSync(getTokenPath(p.id)) })));
  });
  app.post('/api/profiles', (req, res) => {
    const { name, spotifyUrl, publishYoutube, publishSpotify } = req.body;
    if (!name) return res.status(400).json({ error: 'Naam is verplicht' });
    const profiles = loadProfiles();
    const p: Profile = { id: Date.now().toString(), name, spotifyUrl: spotifyUrl || '', publishYoutube: publishYoutube !== false, publishSpotify: !!publishSpotify };
    profiles.push(p);
    saveProfiles(profiles);
    res.json({ ...p, youtubeLinked: false });
  });
  app.put('/api/profiles/:id', (req, res) => {
    const profiles = loadProfiles();
    const idx = profiles.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Profiel niet gevonden' });
    const { name, spotifyUrl, publishYoutube, publishSpotify } = req.body;
    profiles[idx] = { ...profiles[idx], name, spotifyUrl, publishYoutube, publishSpotify };
    saveProfiles(profiles);
    res.json({ ...profiles[idx], youtubeLinked: fs.existsSync(getTokenPath(profiles[idx].id)) });
  });
  app.delete('/api/profiles/:id', (req, res) => {
    const profiles = loadProfiles().filter(p => p.id !== req.params.id);
    saveProfiles(profiles);
    safeDelete(getTokenPath(req.params.id));
    res.json({ status: 'ok' });
  });

  // --- YouTube OAuth (per profiel) ---
  app.get("/api/auth/youtube", (req, res) => {
    const profileId = (req.query.profileId as string) || 'default';
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl"],
      prompt: 'consent',
      state: profileId
    });
    res.redirect(url);
  });

  app.get("/api/auth/youtube/status", (req, res) => {
    const profileId = (req.query.profileId as string) || 'default';
    res.json({ linked: fs.existsSync(getTokenPath(profileId)) });
  });

  app.get("/oauth2callback", async (req, res) => {
    const code = req.query.code as string;
    const profileId = (req.query.state as string) || 'default';
    try {
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      fs.writeFileSync(getTokenPath(profileId), JSON.stringify(tokens));
      res.send(`<h1>Succesvol gekoppeld!</h1><p>YouTube account is gekoppeld aan profiel. Je kunt dit venster sluiten.</p><script>setTimeout(() => window.close(), 3000)</script>`);
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

      // Valideer bestandstype op basis van MIME type
      const allowedMimes = ['video/', 'audio/'];
      if (!allowedMimes.some(prefix => (uploadedFile.mimetype || '').startsWith(prefix))) {
        safeDelete(uploadedFile.path);
        throw new Error(`Ongeldig bestandstype: ${uploadedFile.mimetype}. Alleen video- en audiobestanden zijn toegestaan.`);
      }

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
          // Helpt Whisper om correcte interpunctie, hoofdletters en zinsgrenzen te gebruiken
          initial_prompt: "Dit is een Nederlandse journalistieke podcast. Gebruik correcte interpunctie: hoofdletters aan het begin van zinnen, punten aan het einde, komma's bij opsommingen en bijzinnen. Schrijf getallen voluit waar passend. Gebruik geen afkortingen.",
        }),
        signal: AbortSignal.timeout(4 * 60 * 60 * 1000), // 4 uur voor lange afleveringen
      });

      if (!whisperResp.ok) {
        const errBody = await whisperResp.json().catch(() => ({})) as any;
        throw new Error(`Whisper fout (${whisperResp.status}): ${errBody.detail || whisperResp.statusText}`);
      }

      const whisperData = await whisperResp.json() as any;

      // Audio bestand direct verwijderen na transcriptie — niet meer nodig
      safeDelete(audioOutput);
      console.log(`[${requestId}] Audio bestand verwijderd na transcriptie.`);

      if (whisperData.status !== "success") {
        throw new Error(`Whisper transcriptie mislukt: ${whisperData.detail || "onbekende fout"}`);
      }

      const rawTranscription = whisperData.transcription as string;
      // Strip embedded timestamps like [00:00:08] or [01:23] that Whisper sometimes embeds in the text
      const transcription = rawTranscription.replace(/\[\d{1,2}:\d{2}(:\d{2})?\]/g, '').replace(/\s{2,}/g, ' ').trim();
      const segments: any[] = whisperData.segments || [];
      if (!transcription || segments.length === 0) throw new Error("Transcriptie is leeg.");

      // Generate SRT from segments with Gemini punctuation + sentence-aligned timestamps
      const srtFmt = (s: number) => {
        const h = Math.floor(s / 3600).toString().padStart(2, "0");
        const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
        const sec = Math.floor(s % 60).toString().padStart(2, "0");
        const ms = Math.round((s % 1) * 1000).toString().padStart(3, "0");
        return `${h}:${m}:${sec},${ms}`;
      };

      const wrapSrtText = (text: string, maxChars = 42): string => {
        const words = text.trim().split(/\s+/);
        const lines: string[] = [];
        let current = "";
        for (const word of words) {
          if ((current + (current ? " " : "") + word).length > maxChars && current) {
            lines.push(current);
            current = word;
            if (lines.length === 2) { current = lines.pop() + " " + current; break; }
          } else {
            current = current ? `${current} ${word}` : word;
          }
        }
        if (current) lines.push(current);
        return lines.slice(0, 2).join("\n");
      };

      // Voeg interpunctie toe via Gemini — stuur segmentteksten als JSON-array.
      // Zo blijft segment N altijd segment N: nooit mapping-problemen of verloren woorden.
      const rawSegmentTexts: string[] = segments.map((seg: any) =>
        (seg.text || "").replace(/\[\d{1,2}:\d{2}(:\d{2})?\]/g, '').trim()
      );
      let punctuatedSegmentTexts: string[] = [...rawSegmentTexts]; // fallback = origineel

      try {
        const inputJson = JSON.stringify(rawSegmentTexts);
        const punctPrompt = `Je krijgt een JSON-array met segmenten van een Nederlandse gesproken transcriptie.

Taak: geef EXACT dezelfde array terug, met EXACT hetzelfde aantal elementen, in dezelfde volgorde. Verander de woorden NIET. Voeg alleen interpunctie toe (punt, komma, vraagteken, uitroepteken) op de juiste plekken binnen elk segment. Zet het eerste woord van een nieuwe zin met een hoofdletter. Geef ALLEEN de JSON-array terug, niets anders.

${inputJson}`;

        const punctResp = await generateWithFallback(
          (model) => ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: punctPrompt }] }],
            config: { temperature: 0.1, responseMimeType: "application/json" },
          }),
          "gemini-2.5-flash",
          "gemini-2.5-pro",
        );

        const candidate = (punctResp.text || "").trim();
        const parsed: string[] = JSON.parse(candidate);
        if (Array.isArray(parsed) && parsed.length === rawSegmentTexts.length) {
          punctuatedSegmentTexts = parsed.map(s => String(s));
          console.log(`[${requestId}] Gemini punctuation applied (${parsed.length} segmenten).`);
        } else {
          console.warn(`[${requestId}] Gemini punctuation rejected (verwacht ${rawSegmentTexts.length} segmenten, kreeg ${Array.isArray(parsed) ? parsed.length : '?'}), gebruik origineel.`);
        }
      } catch (e: any) {
        console.warn(`[${requestId}] Gemini punctuation mislukt, gebruik origineel: ${e.message}`);
      }

      // Bouw SRT op: segmenten samenvoegen aan zinsgrenzen, timing 100% van Whisper.
      interface SentenceEntry { text: string; start: number; end: number; }
      const sentenceEntries: SentenceEntry[] = [];
      let currentWords: string[] = [];
      let sentenceStart = segments[0]?.start ?? 0;
      let sentenceEndTime = 0;

      for (let si = 0; si < segments.length; si++) {
        const segText = punctuatedSegmentTexts[si] || rawSegmentTexts[si];
        const segWords = segText.trim().split(/\s+/).filter(Boolean);

        for (let wi = 0; wi < segWords.length; wi++) {
          const word = segWords[wi];
          currentWords.push(word);
          sentenceEndTime = segments[si]?.end ?? sentenceEndTime;

          const isSentenceEnd = /[.!?]$/.test(word);
          const isVeryLastWord = si === segments.length - 1 && wi === segWords.length - 1;

          if (isSentenceEnd || isVeryLastWord) {
            if (currentWords.length > 0) {
              sentenceEntries.push({
                text: currentWords.join(' '),
                start: sentenceStart,
                end: sentenceEndTime,
              });
              currentWords = [];
              // Volgende zin begint precies aan het begin van het volgende segment (of dit segment als er nog woorden volgen)
              sentenceStart = wi < segWords.length - 1 ? segments[si]?.start ?? sentenceEndTime : segments[si + 1]?.start ?? sentenceEndTime;
            }
          }
        }
      }

      // Eventuele resterende woorden toevoegen (geen afsluitend leesteken)
      if (currentWords.length > 0) {
        sentenceEntries.push({
          text: currentWords.join(' '),
          start: sentenceStart,
          end: segments[segments.length - 1]?.end ?? sentenceEndTime,
        });
      }

      const srtContent = sentenceEntries.map((entry, i) => {
        const text = wrapSrtText(entry.text);
        return `${i + 1}\n${srtFmt(entry.start)} --> ${srtFmt(entry.end)}\n${text}\n`;
      }).join("\n");

      // Leesbare tekst voor de UI
      const punctuatedText = punctuatedSegmentTexts.join(' ');

      console.log(`[${requestId}] Transcription completed (${segments.length} segmenten).`);

      // Step 3: Tekstgeneratie
      currentStep = 2;

      // Step 3a: Segmenten groeperen tot semantische blokken
      const blocks = buildBlocks(segments, 30, 2.0);
      console.log(`[${requestId}] ${blocks.length} blokken gebouwd.`);

      // Step 3b: Analyse-stap (flash) — begrijp de aflevering eerst
      const analysisPrompt = buildAnalysisPrompt({ series, host1, host2, guest, transcription });
      console.log(`[${requestId}] Running analysis stage...`);
      const analysisResp = await generateWithFallback(
        (model) => ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: analysisPrompt }] }],
          config: { temperature: 0.3 },
        }),
        "gemini-2.5-flash",
        "gemini-2.5-pro",
      );
      const analysis = (analysisResp.text || "").trim();
      console.log(`[${requestId}] Analysis done (${analysis.length} chars).`);

      // Step 3c: Copy + chapter block-ids (pro)
      const copyPrompt = buildCopyPrompt({
        series, host1, host2, guest, episodeNumber, analysis, blocks, segments,
      });
      console.log(`[${requestId}] Running copy stage...`);
      const copyResp = await generateWithFallback(
        (model) => ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: copyPrompt }] }],
          config: { temperature: 0.7, responseMimeType: "application/json" },
        }),
        "gemini-2.5-flash",
        "gemini-2.5-pro",
      );

      const rawCopy = (copyResp.text || "").trim();
      let parsedCopy: any;
      try {
        const m = rawCopy.match(/\{[\s\S]*\}/);
        parsedCopy = JSON.parse(m ? m[0] : rawCopy);
      } catch (e: any) {
        throw new Error(`Kon copy-output niet parsen: ${e.message}`);
      }

      // Step 3d: Chapters valideren + timestamps server-side bouwen
      const chapterList = buildChapterList(parsedCopy.chapters, blocks, segments);
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
      fs.writeFileSync(path.join(dataDir, `meta_${requestId}.json`), JSON.stringify({ videoPath: sourceFile, artifact }));

      // Bouw leesbare transcriptie op basis van zinsgrenzen met Gemini-interpunctie
      const readableTranscription = sentenceEntries.map((entry) => {
        const ts = `[${srtFmt(entry.start).replace(',', '.').slice(0, 8)}]`;
        return `${ts} ${entry.text}`;
      }).join('\n');

      res.json({
        status: "waiting_approval",
        data: {
          requestId: requestId,
          artifact: artifactContent,
          transcription: readableTranscription,
          hasSrt: true
        }
      });
    } catch (error: any) {
      // Ruim tijdelijke bestanden op bij fout
      safeDelete(audioOutput);
      if (uploadedFile?.path) safeDelete(uploadedFile.path);
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
      const { requestId, youtubeOverride, profileId } = req.body;
      if (!requestId) throw new Error("Geen requestId meegegeven.");

      const metaFile = path.join(dataDir, `meta_${requestId}.json`);
      if (!fs.existsSync(metaFile)) throw new Error("Video metadata niet gevonden. (Start het proces opnieuw)");

      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      const { videoPath, artifact } = meta;
      if (!fs.existsSync(videoPath)) throw new Error("Originele videobestand is niet meer beschikbaar.");

      // Laad het juiste YouTube token voor dit profiel
      const tokenPath = getTokenPath(profileId || 'default');
      if (!fs.existsSync(tokenPath)) throw new Error("YouTube account niet gekoppeld voor dit profiel.");
      const profileTokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      const profileOauth = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        `${process.env.APP_URL}/oauth2callback`
      );
      profileOauth.setCredentials(profileTokens);

      // Gebruik bewerkte versie van de frontend als die beschikbaar is, anders de opgeslagen versie
      const youtube = youtubeOverride ?? artifact?.youtube ?? {};
      const tags = Array.isArray(youtube.tags) ? youtube.tags : (typeof youtube.tags === 'string' ? youtube.tags.split(',').map((t: string) => t.trim()) : []);

      const youtubeApi = google.youtube('v3');

      const response = await youtubeApi.videos.insert({
        auth: profileOauth,
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: youtube.titel ? String(youtube.titel).slice(0, 100) : "Crime Station Aflevering",
            description: youtube.beschrijving || "",
            tags,
            categoryId: "25",
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

      const videoId = response.data.id!;

      // Upload SRT als ondertiteling
      const srtPath = path.join(dataDir, `srt_${requestId}.srt`);
      if (fs.existsSync(srtPath)) {
        try {
          await youtubeApi.captions.insert({
            auth: profileOauth,
            part: ['snippet'],
            requestBody: {
              snippet: {
                videoId,
                language: 'nl',
                name: 'Nederlands',
                isDraft: false,
              }
            },
            media: { body: fs.createReadStream(srtPath) }
          });
        } catch (captionErr: any) {
          console.warn("SRT upload mislukt (video wel geüpload):", captionErr.message);
        }
      }

      // Sla videoId op zodat we later de beschrijving kunnen updaten (bijv. Spotify link)
      fs.writeFileSync(metaFile, JSON.stringify({ ...meta, youtubeVideoId: videoId }));

      // Originele videobestand verwijderen na succesvolle upload — niet meer nodig
      safeDelete(videoPath);
      console.log(`[requestId] Originele video verwijderd na YouTube upload: ${videoPath}`);

      res.json({ status: "completed", links: { youtube: `https://youtube.com/watch?v=${videoId}` } });
    } catch (error: any) {
      console.error("Publish error:", error);
      res.status(500).json({ error: error.message || "Failed to publish" });
    }
  });

  // Update YouTube beschrijving met Spotify link zodra die beschikbaar is
  app.post("/api/publish/update-spotify-link", async (req, res) => {
    try {
      const { requestId, spotifyUrl, profileId } = req.body;
      if (!requestId || !spotifyUrl) throw new Error("requestId en spotifyUrl zijn verplicht.");

      const metaFile = path.join(dataDir, `meta_${requestId}.json`);
      if (!fs.existsSync(metaFile)) throw new Error("Metadata niet gevonden.");

      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (!meta.youtubeVideoId) throw new Error("Geen YouTube video ID gevonden — eerst publiceren naar YouTube.");

      const tokenPath = getTokenPath(profileId || 'default');
      if (!fs.existsSync(tokenPath)) throw new Error("YouTube token niet gevonden.");
      const profileTokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      const profileOauth = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        `${process.env.APP_URL}/oauth2callback`
      );
      profileOauth.setCredentials(profileTokens);

      const youtubeApi = google.youtube('v3');

      // Huidige video ophalen
      const current = await youtubeApi.videos.list({
        auth: profileOauth,
        part: ['snippet'],
        id: [meta.youtubeVideoId],
      });

      const snippet = current.data.items?.[0]?.snippet;
      if (!snippet) throw new Error("YouTube video niet gevonden.");

      const updatedDescription = (snippet.description || "").replace("[link]", spotifyUrl);

      await youtubeApi.videos.update({
        auth: profileOauth,
        part: ['snippet'],
        requestBody: {
          id: meta.youtubeVideoId,
          snippet: { ...snippet, description: updatedDescription },
        },
      });

      // Sla Spotify URL op in meta
      fs.writeFileSync(metaFile, JSON.stringify({ ...meta, spotifyUrl }));

      res.json({ status: "completed" });
    } catch (error: any) {
      console.error("Update Spotify link error:", error);
      res.status(500).json({ error: error.message || "Failed to update description" });
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
