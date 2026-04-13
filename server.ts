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

    try {
      if (!uploadedFile) throw new Error("Geen bestand geüpload.");
      const sourceFile = uploadedFile.path;

      // Step 1: Compression
      console.log(`[${requestId}] Starting Step 1: Audio Extraction...`);
      await new Promise<void>((resolve, reject) => {
        ffmpeg(sourceFile)
          .noVideo()
          .audioCodec("libmp3lame")
          .audioBitrate("64k")
          .audioChannels(1)
          .on("end", () => resolve())
          .on("error", (err) => reject(err))
          .save(audioOutput);
      });

      // Step 2: Transcription
      console.log(`[${requestId}] Starting Step 2: Transcription`);
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");
      const ai = new GoogleGenAI({ apiKey });

      // Using Base64 (inlineData) as in the original working version
      const audioData = fs.readFileSync(audioOutput).toString("base64");
      
      const transcriptionResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [{ 
          role: 'user', 
          parts: [
            { inlineData: { data: audioData, mimeType: "audio/mp3" } },
            { text: "Transcribeer deze audio van een Crime Station aflevering nauwkeurig. Gebruik schone, leesbare tijdcodes in het formaat [HH:MM:SS] voor elk nieuw tekstblok. Behoud alle sprekers (Spreker 1, Spreker 2, etc.)." }
          ] 
        }]
      }));

      const transcription = transcriptionResponse.text;
      if (!transcription) throw new Error("Transcriptie mislukt.");
      console.log(`[${requestId}] Transcription completed.`);

      // Step 3: Tekstgeneratie
      console.log(`[${requestId}] Starting Step 3: Text Generation`);
      const guestLine = guest ? `Gast: ${guest}` : "Gast: (geen)";
            const promptText = `
Je bent de Crime Station Publicatie-agent. Je ontvangt een transcriptie van een aflevering en genereert daarvoor geoptimaliseerde content voor YouTube en Spotify. (Website teksten zijn tijdelijk op non-actief gezet).

De volgende informatie wordt automatisch meegegeven vanuit de Content Hub UI — je hoeft hier niet naar te vragen:
- **Serie**: ${series}
- **Afleveringsnummer**: ${episodeNumber}
- **Presentator 1**: ${host1}
- **Presentator 2**: ${host2}
- **Naam gast**: ${guestLine}

---
[TRANSCRIPTIE BEGIN]
${transcription}
[TRANSCRIPTIE EINDE]
---

## Stap 1: Analyseer de transcriptie

Stel het volgende vast (bewaar dit intern voor jezelf):
- De 3–5 sterkste zoektermen
- De rode draad en de meest indrukwekkende 'hook' of spoiler
- Alle belangrijke feiten, namen en theorieën

## Stap 2: Tekstgeneratie (YouTube & Spotify Strategie)

Genereer de titels, beschrijvingen en shownotes op basis van de transcriptie. Omdat YouTube en Spotify fundamenteel anders werken, moet je twee aparte, uniek geoptimaliseerde versies maken. Baseer je strikt op deze regels:

**Algemene Grammatica Regel (Zeer belangrijk)**:
- Gebruik voor beide platformen normale Nederlandse hoofdletterregels. Gebruik GEEN 'Title Case' in de titels (dus niet elk woord met een hoofdletter). Alleen het eerste woord en eigennamen krijgen een hoofdletter.

### Deel A: YouTube Optimalisatie (Focus: Click-Through Rate & Brand Safety)

- **Titel**: Schrijf een spannende titel (curiosity gap). Maximaal 60-65 tekens. Gebruik NOOIT de serienaam of gastnaam. Gebruik brand-safe synoniemen in plaats van woorden die demonetization veroorzaken (bijv. 'fatale afloop' i.p.v. moord).
- **Beschrijving (250 - 400 woorden)**:
  - **Hook & Body**: Begin met een dwingende samenvatting (150 tekens) en duik daarna dieper in de feiten met relevante zoektermen. Vermeld de gast kort in de lopende tekst.
  - **Tijdstempels (Cruciaal voor Chapters)**: Genereer minimaal 3 tijdstempels (minimaal 10 sec uit elkaar). Formatteer strikt als M:SS Beschrijving (GEEN opsommingstekens of haakjes). Start altijd exact op een nieuwe regel met 0:00 Introductie.
  - **Hashtags**: Zet helemaal onderaan maximaal 3 tot 5 relevante hashtags (incl. #CrimeStation).

### Deel B: Spotify Optimalisatie (Focus: Zoekbaarheid, Structuur & Audio)

- **Titel**: Hanteer deze strikte, feitelijke structuur: [Naam van de Serie]: [Het concrete onderwerp/de zaak].
- **Beschrijving / Shownotes (150 - 250 woorden)**:
  - Begin met een feitelijke, inhoudelijke samenvatting (absoluut geen clickbait).
  - Zet de naam en expertise van de gast (indien aanwezig) prominent in de tekst.
  - **Tijdstempels**: Neem de strikt geformatteerde tijdstempels exact over van de YouTube-versie.
  - **Geen Hashtags**: Gebruik geen hashtags in de Spotify tekst.

### Deel C: Dynamische Call to Action (Kies op basis van de Serie & Inhoud)

Je moet de juiste CTA kiezen afhankelijk van de serie en de inhoud. Kopieer en plak de exacte tekst.

Scenario A: Zaak-gedreven (Crime Report, Cold Cases, Daily Wely, Schoffies)

Voor YouTube:
Heb jij een tip over een zaak?
Meld het bij mick@crimestation.nl of anoniem via Meld Misdaad Anoniem: 0800-7000.

• Abonneer je en klik op de bel voor nieuwe afleveringen.
• Luister deze podcast op Spotify: [link naar aflevering]
• Meer misdaadnieuws: www.crimestation.nl

Voor Spotify:
Heb jij een tip over een zaak?
Meld het bij mick@crimestation.nl of anoniem via Meld Misdaad Anoniem: 0800-7000.

Volg deze podcast om geen aflevering te missen.
Meer misdaadnieuws: www.crimestation.nl

Scenario B: Crime Insight (Q&A / Discussie)
Voeg hierbij in de beschrijving áltijd "🎙️ Met Mick van Wely, Nancy Dekens & [Gastnaam]" toe.

Voor YouTube:
Heb je zelf een vraag voor Mick, Nancy of onze gasten? Mail naar mick@crimestation.nl.

• Abonneer je voor wekelijkse reportages en rechtbankverslagen.
• Luister deze podcast op Spotify: [link naar aflevering]
• Meer misdaadnieuws: www.crimestation.nl

Voor Spotify:
Heb je zelf een vraag voor Mick, Nancy of onze gasten? Mail naar mick@crimestation.nl.

Volg deze podcast op Spotify om geen aflevering te missen.
Meer misdaadnieuws: www.crimestation.nl

(Als de Crime Insight aflevering géén vragen beantwoordt, verander je de eerste zin van de CTA in beide kanalen naar: "Wat vind jij van deze discussie? Praat mee in de reacties of mail naar mick@crimestation.nl.")

### Deel D: Verborgen YouTube Tags
Genereer naast de beschrijving ook een aparte lijst met 10 zeer relevante steekwoorden voor het verborgen 'Tags'-veld in YouTube.
CRUCIAAL: Scheid de woorden uitsluitend met een komma en gebruik NOOIT hashtags (#). (Bijvoorbeeld: hoornse taartzaak, gifmoord, nancy dekkers, mick van wely, strafrecht).

### Deel E: Zichtbare YouTube Hashtags
Hashtags in Beschrijving: Genereer aan het eind van de YouTube-beschrijving, dus ónder de volledige Call to Action uit Deel C, exact drie relevante hashtags.
- Format: Gebruik hiervoor verplicht het # symbool (bijv. #CrimeStation #Zaaknaam #Misdaad).
- Locatie: Deze hashtags moeten als platte tekst in de beschrijving blijven staan, zodat ze zichtbaar zijn voor de kijker.
- Onderscheid: Verwar deze drie hashtags niet met de komma-gescheiden lijst voor de verborgen YouTube-tags uit Deel D; dit zijn twee aparte instructies.

## Stap 3: Goedkeuring (Artifact Generatie)

Belangrijke Systeeminformatie: De "Pauze" en de "Goedkeuring" worden veilig door de interface van de applicatie zelf afgehandeld! Het frontend systeem toont jouw output en wacht op expliciete goedkeuring om te publiceren.
Om ervoor te zorgen dat de Publish API jouw gegenereerde data herkent: Je output MOET een valid JSON frame zijn. Vul de data exact in dit format in!

**De output MAAK JE EXACT ALS DIT JSON FORMAT (Gebruik NOOIT markdown tabellen, geef puur het JSON object terug):**

\`\`\`json
{
  "youtube": {
    "titel": "...",
    "beschrijving": "...",
    "hashtags": ["#CrimeStation", "..."],
    "tags": ["hoornse taartzaak", "gifmoord", "strafrecht"]
  },
  "spotify": {
    "titel": "...",
    "beschrijving": "..."
  }
}
\`\`\`
(De website teksten laat je voor nu weg)
`;

      const genResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        config: {
          temperature: 0.7,
          tools: [{ googleSearch: {} }]
        }
      }));

      let generatedContent = genResponse.text;
      const jsonMatch = generatedContent.match(/\{[\s\S]*\}/);
      let artifactContent = jsonMatch ? jsonMatch[0] : generatedContent;

      console.log(`[${requestId}] Step 3: Text Generation completed.`);

      // Step 4: Creating Artifact
      fs.writeFileSync(path.join(dataDir, "concept.json"), artifactContent || "");
      fs.writeFileSync(path.join(dataDir, `meta_${requestId}.json`), JSON.stringify({ videoPath: sourceFile }));

      res.json({ 
        status: "waiting_approval", 
        data: {
          requestId: requestId,
          artifact: artifactContent,
          transcription: transcription
        }
      });
    } catch (error: any) {
      console.error(`[${requestId}] Error:`, error);
      res.status(500).json({ error: error.message || "Processing failed" });
    }
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
