import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config({ path: "/Users/amberbordewijk/Documents/Freelance/PodcastFlow 2/.env" });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function main() {
  try {
    const listResult = await ai.models.list();
    // In SDK, models.list might be paginated or an array
    for await (const m of listResult) {
      console.log(m.name);
    }
  } catch (error) {
    console.error("ERROR listing models:", error);
  }
}

main();
