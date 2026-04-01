import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

async function run() {
  const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  try {
    const result = await model.generateContent("Hi");
    console.log("Success:", result.response.text());
  } catch (e: any) {
    console.log("Error:", e.message);
  }
}
run();
