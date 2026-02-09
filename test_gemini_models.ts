
import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.VITE_GEMINI_API_KEY;

if (!apiKey) {
    console.error("No API Key found in env");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function listModels() {
    try {
        console.log("Fetching available models...");
        // The SDK doesn't always expose listModels directly on the client instance in some versions.
        // Let's try to infer or just test a few common ones.

        const modelsToTest = [
            "gemini-1.5-flash",
            "gemini-1.5-flash-latest",
            "gemini-1.5-flash-001",
            "gemini-1.5-pro",
            "gemini-1.0-pro"
        ];

        for (const model of modelsToTest) {
            console.log(`Testing model: ${model}...`);
            try {
                const response = await ai.models.generateContent({
                    model: model,
                    contents: "Test",
                });
                console.log(`✅ ${model} IS WORKING!`);
            } catch (e: any) {
                console.log(`❌ ${model} failed: ${e.message.split(' ')[0]}...`);
            }
        }

    } catch (error) {
        console.error("Error:", error);
    }
}

listModels();
