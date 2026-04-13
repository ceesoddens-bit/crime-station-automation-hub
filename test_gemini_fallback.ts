import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config({ path: "/Users/amberbordewijk/Documents/Freelance/PodcastFlow 2/.env" });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function main() {
  const promptText = "Hello, tell me a quick fact.";
  try {
    const genResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      config: {
        temperature: 0.7,
        tools: [{ googleSearch: {} }]
      }
    });
    console.log("SUCCESS:", genResponse.text);
  } catch (error: any) {
    console.error("ERROR generating content:", error.message);
  }
}

main();
