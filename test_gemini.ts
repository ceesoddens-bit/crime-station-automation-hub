import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config({ path: "/Users/amberbordewijk/Documents/Freelance/PodcastFlow 2/.env" });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testModel(modelName: string) {
  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: "hello",
    });
    console.log(`SUCCESS: ${modelName} -> ${response.text}`);
  } catch (e: any) {
    if (e.status === 429) {
      console.log(`FAILED: ${modelName} -> 429 Quota Exceeded (Free tier limit?)`);
    } else if (e.status === 404) {
      console.log(`FAILED: ${modelName} -> 404 Not Found`);
    } else {
      console.log(`FAILED: ${modelName} -> ${e.message}`);
    }
  }
}

async function main() {
  const modelsToTest = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-flash-latest",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro-latest"
  ];
  for (const m of modelsToTest) {
    await testModel(m);
  }
}

main();
