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
  console.log("Using local FFmpeg binary at:", localFfmpeg);
  ffmpeg.setFfmpegPath(localFfmpeg);
}

async function startServer() {
  const app = express();
  const HOST = "0.0.0.0";
  const desiredPort = Number(process.env.PORT ?? 3000);
  const desiredHmrPort = Number(process.env.VITE_HMR_PORT ?? 24678);

  app.use(express.json());

  const findAvailablePort = async (startPort: number, host: string) => {
    for (let port = startPort; port < startPort + 50; port += 1) {
      const available = await new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.once("error", (err: any) => {
          server.close();
          if (err?.code === "EADDRINUSE") resolve(false);
          else resolve(false);
        });
        server.once("listening", () => {
          server.close(() => resolve(true));
        });
        server.listen(port, host);
      });

      if (available) return port;
    }

    throw new Error(`No available port found starting from ${startPort}`);
  };

  // Ensure data directory exists
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }

  // API Routes
  app.post("/api/process", upload.single('videoFile'), async (req, res) => {
    const { driveUrl, series, host1, host2, guest, episodeNumber } = req.body;
    const uploadedFile = req.file;
    
    // Helper to extract Drive ID
    const extractFileId = (link: string) => {
      const match = link.match(/[-\w]{25,}|(?<=id=)[-\w]+/);
      return match ? match[0] : null;
    };

    const requestId = Date.now().toString() + Math.random().toString(36).substring(7);
    const audioOutput = path.join(dataDir, `audio_${requestId}.mp3`);
    const downloadPath = path.join(dataDir, `video_${requestId}.mp4`);

    try {
      let sourceFile = "";
      if (uploadedFile) {
        sourceFile = uploadedFile.path;
        console.log(`[${requestId}] Using uploaded file: ${uploadedFile.originalname}`);
      } else if (driveUrl) {
        const fileId = extractFileId(driveUrl);
        if (!fileId) throw new Error("Ongeldige Google Drive link.");
        console.log(`[${requestId}] Downloading file ID ${fileId} from Google Drive...`);
        
        const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
        const writer = fs.createWriteStream(downloadPath);
        const response = await axios({
          url: downloadUrl,
          method: 'GET',
          responseType: 'stream'
        });
        response.data.pipe(writer);
        await new Promise<void>((resolve, reject) => {
          writer.on('finish', () => resolve());
          writer.on('error', (err) => reject(err));
        });
        sourceFile = downloadPath;
        console.log(`[${requestId}] Download complete.`);
      } else {
        throw new Error("Geen video bron opgegeven (link of bestand).");
      }

      // Step 1: Video Compressie (Audio Extractie)
      console.log(`[${requestId}] Starting Step 1: Audio Extraction...`);
      
      try {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(sourceFile)
            .noVideo()
            .audioCodec("libmp3lame")
            .audioBitrate("128k")
            .audioChannels(2)
            .audioFrequency(44100)
            .on("start", (cmd) => console.log(`[${requestId}] FFmpeg command: ${cmd}`))
            .on("progress", (progress) => {
              if (progress.percent) process.stdout.write(`\r[${requestId}] Progress: ${Math.round(progress.percent)}%`);
            })
            .on("end", () => {
              console.log(`\n[${requestId}] Audio extraction finished: ${audioOutput}`);
              resolve();
            })
            .on("error", (err) => {
              console.error(`\n[${requestId}] FFmpeg error:`, err);
              reject(err);
            })
            .save(audioOutput);
        });
      } catch (e: any) {
        console.error(`[${requestId}] Step 1 failed:`, e.message);
        throw new Error(`Stap 1 (Audio Extractie) is mislukt: ${e.message}`);
      }

      // Step 2: Transcriptie
      console.log(`[${requestId}] Starting Step 2: Transcription`);
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");
      const ai = new GoogleGenAI({ apiKey });

      // Upload audio to Gemini (or pass it directly as bytes)
      // Upload audio to Google File API for large files (> 20MB audio)
      console.log("Uploading audio to Google File API...");
      let uploadResult = await ai.files.upload({
        file: audioOutput,
        config: {
          mimeType: "audio/mp3",
          displayName: "Podcast Audio",
        }
      });

      // Wait for the file to be ACTIVE (processing takes time for large files)
      console.log(`File uploaded: ${uploadResult.name}. Waiting for state: ACTIVE...`);
      let file = await ai.files.get({ name: uploadResult.name });
      let waitAttempts = 0;
      while (file.state === "PROCESSING" && waitAttempts < 60) {
        process.stdout.write(".");
        await new Promise(resolve => setTimeout(resolve, 5000));
        file = await ai.files.get({ name: uploadResult.name });
        waitAttempts++;
      }
      console.log(`\nFile status: ${file.state}`);

      if (file.state === "FAILED") {
        throw new Error("Google File API processing failed. Probeer een kleiner bestand of check de audio.");
      }

      const transcriptionPrompt = `
        **Rol:** Je bent een expert in transcriptie-editing voor YouTube. Je taak is om een ruwe transcriptie om te zetten in een "Clean Verbatim" tekst die perfect is voor YouTube's Auto-sync.
        
        **Instructies:**
        
        1. **Opschonen (Clean Verbatim):**
           - Verwijder alle opvulwoorden zoals "uhm", "eh", "ah", en "ooh".
           - Verwijder overbodige herhalingen (bijv. "Ik ik denk dat...") en stotteringen.
           - Corrigeer de interpunctie en hoofdletters voor maximale leesbaarheid, maar behoud de exacte woorden en de professionele toon van de sprekers.
        
        2. **Structuur Bewaken (Cruciaal voor sync):**
           - **BEHOUD** alle aanwezige tijdcodes (bijv. [00:12:30]). Deze zijn essentieel als ankerpunten voor de synchronisatie van deze lange video.
           - Houd de aanduidingen van de sprekers (**Spreker 1**, **Spreker 2**, etc.) duidelijk boven de betreffende tekstblokken staan.
        
        3. **Output Formaat:**
           - Geef ALLEEN de volledig opgeschoonde transcriptie terug in een overzichtelijke lay-out met behoud van sprekers en tijdcodes. Geen titels, geen inleiding, geen metadata.
      `;
      
      let transcriptionText = "";
      let retries = 5; // Verhoogd naar 5
      
      while (retries > 0 && !transcriptionText) {
        try {
          const transcriptionResponse = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: [
              { 
                role: 'user', 
                parts: [
                  { fileData: { fileUri: uploadResult.uri, mimeType: "audio/mp3" } },
                  { text: transcriptionPrompt }
                ] 
              }
            ],
            config: {
              temperature: 0.1,
            }
          });
          transcriptionText = transcriptionResponse.text;
          if (!transcriptionText) throw new Error("Lege respons van Gemini.");
        } catch (e: any) {
          const isRetryable = e.status === 503 || e.status === 429 || e.message?.includes('503') || e.message?.includes('429');
          if (isRetryable && retries > 0) {
            const delay = (6 - retries) * 10000; // Exponentiële vertraging: 10s, 20s, 30s...
            console.warn(`Step 2: API error (${e.status}), retrying in ${delay/1000}s... (${retries} left)`);
            retries--;
            await new Promise(r => setTimeout(r, delay));
          } else {
            console.error("Step 2: Unrecoverable error:", e);
            throw new Error(`Step 2: Transcriptie mislukt. Error: ${e.message}`);
          }
        }
      }

      const transcription = transcriptionText;
      if (!transcription) throw new Error("Step 2: Transcriptie is mislukt na meerdere pogingen.");
      console.log("Transcription completed.");

      // Step 3: Tekstgeneratie
      console.log("Starting Step 3: Text Generation");
      const guestName = typeof guest === "string" ? guest.trim() : "";
      const guestLine = guestName ? `Gast: ${guestName}` : "Gast: (geen)";
      
      const promptText = `
        Je bent de Crime Station Publicatie-agent. Je ontvangt een transcriptie van een aflevering en genereert daarvoor een titel en beschrijvingen voor YouTube, Spotify en crimestation.nl.

        GEGEVENS VANUIT UI:
        - Serie: ${series}
        - Afleveringsnummer: ${episodeNumber}
        - Presentator 1: ${host1}
        - Presentator 2: ${host2}
        - Naam gast: ${guestLine}

        DE TRANSCRIPTIE:
        ${transcription}

        ---

        ## Stap 1: Analyseer de transcriptie
        Lees de transcriptie en stel het volgende vast:
        - De hoofdonderwerpen (in volgorde van bespreking)
        - Namen van personen, zaken, misdaadtypes en actuele thema's
        - De rode draad: wat is de kern van deze aflevering?
        - De 3–5 sterkste zoektermen op basis van de inhoud
        - Geschatte tijdsduur per onderwerp

        ## Stap 2: YouTube SEO-analyse
        Analyseer welke titelformules en hashtags goed scoren voor dit onderwerp in de Nederlandse true crime niche op YouTube. Gebruik deze inzichten voor de output.

        ## Stap 3: Genereer de output

        ### A. TITEL (Identiek voor YouTube en Spotify)
        Volg de titelstructuur per serie:
        - Crime Insight: [onderwerp of prikkelende stelling]
        - Crime Report: [onderwerp] (noem NOOIT "met [gast]")
        - Cold Cases: Never Give Up: [naam slachtoffer of zaaknaam]
        - Schoffies: [concreet onderwerp jeugdcriminaliteit]
        - Crime Business: [onderwerp]
        - Daily Wely: [onderwerp of nieuwsitem]
        - Online Security: [onderwerp]

        Regels: Title case, scheidingsteken ":", 50-80 tekens, geen datum/nummer/emoji, minimaal 1 zoekwoord, gastnamen voluit.

        ### B. SPOTIFY-BESCHRIJVING
        150-250 woorden. VASTE STRUCTUUR: [Haak] (1 pakkende zin), [Samenvatting] (2-4 zinnen), [Gastinfo] (indien gast), [CTA]. 
        GEEN tijdstempels, GEEN copyright, GEEN emoji, GEEN URL's halverwege.

        ### C. YOUTUBE-BESCHRIJVING
        200-400 woorden. VASTE STRUCTUUR: [Haak] (1-2 zinnen), [Samenvatting] (3-5 zinnen), [Tijdstempels] (MOET 0:00 Introductie bevatten), [Gastinfo] (indien gast), [Links], [CTA], [Hashtags] (3-5 stuks).
        GEEN copyright, GEEN emoji.

        ### D. WEBSITE-BESCHRIJVING (crimestation.nl)
        300-500 woorden. VASTE STRUCTUUR: [Lead], [Context], [Gastinfo], [CTA].
        EXTRA: SEO-titel (max 60), URL-slug, Meta description (max 155).

        ---

        ## Stap 4: Presenteer de output in JSON
        Geef de output ALTIJD in dit JSON-formaat:
        \`\`\`json
        {
          "youtube": {
            "titel": "[Titel]",
            "beschrijving": "[Volledige beschrijving met tijdstempels]",
            "hashtags": ["#tag1", "#tag2"]
          },
          "spotify": {
            "titel": "[Titel]",
            "beschrijving": "[Volledige beschrijving]",
            "hashtags": ["#tag1", "#tag2"]
          },
          "website": {
            "titel": "[Titel]",
            "beschrijving": "[Volledige beschrijving]",
            "seo_titel": "[Titel] | Crime Station",
            "url_slug": "crimestation.nl/[slug]",
            "meta_description": "[Max 155 tekens]"
          }
        }
        \`\`\`
      `;

      const genResponse = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: promptText }] }]
      });

      let generatedContent = genResponse.text;
      
      // Extract JSON if it's wrapped in a code block
      const jsonMatch = generatedContent.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        generatedContent = jsonMatch[1].trim();
      }

      console.log("Step 3: Text Generation completed.");

      // Step 4: Goedkeuring
      console.log("Starting Step 4: Creating Artifact");
      fs.writeFileSync(path.join(dataDir, "concept.json"), generatedContent || "");

      res.json({ 
        status: "waiting_approval", 
        data: {
          concept: generatedContent
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Processing failed" });
    }
  });

  app.post("/api/approve", async (req, res) => {
    const { approved } = req.body;
    if (approved) {
      // Step 5: Uploaden & Publiceren
      console.log("Starting Step 5: Uploading");
      // Implement YouTube/Spotify upload logic here
      res.json({ 
        status: "completed",
        links: {
          youtube: "https://youtube.com/watch?v=mock",
          spotify: "https://open.spotify.com/episode/mock"
        }
      });
    } else {
      res.json({ status: "cancelled" });
    }
  });

  // Vite middleware for development
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
    server.timeout = 30 * 60 * 1000;
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
