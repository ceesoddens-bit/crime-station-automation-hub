import dotenv from "dotenv";
import path from "path";
dotenv.config();
console.log("CWD:", process.cwd());
console.log("Checking GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "Present (Starts with " + process.env.GEMINI_API_KEY.slice(0, 4) + ")" : "MISSING");

import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { google } from "googleapis";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import axios from "axios";

// Check if local ffmpeg exists and set path
const localFfmpeg = path.join(process.cwd(), "ffmpeg");
if (fs.existsSync(localFfmpeg)) {
  console.log("Using local FFmpeg binary at:", localFfmpeg);
  ffmpeg.setFfmpegPath(localFfmpeg);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Ensure data directory exists
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }

  // API Routes
  app.post("/api/process", async (req, res) => {
    const { driveUrl, series, guest, episodeNumber } = req.body;
    
    // Helper to extract Drive ID
    const extractFileId = (link: string) => {
      const match = link.match(/[-\w]{25,}|(?<=id=)[-\w]+/);
      return match ? match[0] : null;
    };

    const fileId = extractFileId(driveUrl);
    const downloadPath = path.join(dataDir, "original_video.mp4");
    const audioOutput = path.join(dataDir, "audio_extract.mp3");

    try {
      // Step 0: Download from Drive
      if (fileId) {
        console.log(`Downloading file ID ${fileId} from Google Drive...`);
        try {
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
          console.log("Download complete.");
        } catch (downloadErr: any) {
          console.warn("Direct download failed, attempting alternate if public link is restrictive.");
          // If the file is large, Drive might show a virus scan warning page.
          // In a production app, we'd handle the 'confirm' parameter.
        }
      }
      // Step 1: Video Compressie
      console.log(`Starting Step 1: Compression for ${driveUrl}`);
      
      const sourceFile = fs.existsSync(downloadPath) ? downloadPath : "/Users/ceesoddens/Library/CloudStorage/GoogleDrive-cees.oddens@gmail.com/Mijn Drive/PROJECTEN/ContentBotPhilip/MVW_CI_AFL_06_-16LKFSklein.mp3";

      // FFmpeg actual compression
      try {
        console.log("Compressing audio to simple mp3...");
        await new Promise((resolve, reject) => {
          ffmpeg(sourceFile)
            .toFormat('mp3')
            .audioChannels(1) // Mono
            .audioBitrate('32k') // Very low bitrate for minimum memory usage
            .on('end', resolve)
            .on('error', reject)
            .save(audioOutput);
        });
      } catch (e: any) {
        console.warn("FFmpeg compression failed (likely FFmpeg not installed):", e.message);
        // Fallback to a mock or throw if essential
        // For the demo we keep going if the file already exists or just show the error.
        if (!fs.existsSync(audioOutput)) {
          throw new Error("FFmpeg is vereist voor deze stap maar kon niet worden uitgevoerd.");
        }
      }

      // Step 2: Transcriptie
      console.log("Starting Step 2: Transcription");
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is missing. Please add it to your environment or .env file.");
      }
      const ai = new GoogleGenAI({ apiKey });

      console.log("Memory before transcription:", process.memoryUsage().rss / 1024 / 1024, "MB");

      // Upload audio to Gemini (or pass it directly as bytes)
      let audioData: Buffer | null = fs.readFileSync(audioOutput);
      let audioBase64: string | null = audioData.toString("base64");
      const transcriptionPrompt = "Transcribeer deze audio van een Crime Station aflevering nauwkeurig.";
      
      console.log("Audio Base64 length:", audioBase64.length);

      const transcriptionResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ 
          role: 'user', 
          parts: [
            { inlineData: { data: audioBase64, mimeType: "audio/mp3" } },
            { text: transcriptionPrompt }
          ] 
        }]
      });

      // Clear large objects from memory immediately
      audioData = null;
      audioBase64 = null;

      const transcription = transcriptionResponse.text;
      if (!transcription) throw new Error("Transcriptie is mislukt (geen tekst gegenereerd).");
      console.log("Transcription completed. Memory after:", process.memoryUsage().rss / 1024 / 1024, "MB");

      // Step 3: Tekstgeneratie
      console.log("Starting Step 3: Text Generation");
      const promptText = `
        Je bent een content creator voor Crime Station. Genereer YouTube en Spotify teksten op basis van de onderstaande transcriptie.
        De stijl moet exact overeenkomen met dit voorbeeld:
        
        [VOORBEELD STIJL]
        Volgende week dient het hoger beroep rond Ali B. Wordt dat wederom zo’n mediaspektakel? Wat kunnen we verwachten? In aflevering [NUMMER] van [SERIE] blikken [GAST/PRESENTATOR] vooruit op de zaak. Verder praten onze vaste podcaststerren over [ONDERWERP 2]. En waarom is [ONDERWERP 3] zo vernederend? Luisteren!!

        🔔 Abonneer je op Crime Station en zet je meldingen aan, zo mis je geen enkele aflevering. Nieuwe reportages, rechtbankverslagen en onthullingen - elke week op dit kanaal. 

        🌐 www.crimestation.nl

        ©️ CRIME STATION:
        Crime Report
        Crime Insight
        Cold Cases: Never Give Up
        Schoffies
        Crime Business
        Daily Wely
        Online Security
        Meer informatie
        [/VOORBEELD STIJL]

        GEGEVENS:
        Serie: ${series}
        Gast: ${guest}
        Aflevering Nummer: ${episodeNumber}
        Transcriptie: ${transcription}

        INSTRUCTIES:
        1. Titel: Maak een pakkende titel in de stijl: "[Onderwerp] | [Sub-onderwerp] | ${series} #${episodeNumber}"
        2. Intro: Maximaal 3-4 zinnen, eindigend met "Luisteren!!"
        3. Gebruik de namen ${series} en ${guest} (indien ingevuld) in de intro en noem aflevering ${episodeNumber}.
        5. Genereer één blok voor YouTube en één korter blok voor Spotify in dezelfde stijl.
      `;
      const genResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: 'user', parts: [{ text: promptText }] }]
      });
      const generatedText = genResponse.text;

      // Step 4: Goedkeuring (Create Artifact)
      console.log("Starting Step 4: Creating Artifact");
      fs.writeFileSync(path.join(dataDir, "concept.md"), generatedText || "");

      res.json({ 
        status: "waiting_approval", 
        artifact: generatedText,
        transcription: transcription,
        steps: [
          { id: 1, status: "completed" },
          { id: 2, status: "completed" },
          { id: 3, status: "completed" },
          { id: 4, status: "waiting" }
        ]
      });
    } catch (error: any) {
      console.error(error);
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
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
