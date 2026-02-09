
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.VITE_GEMINI_API_KEY;

if (!apiKey) {
    console.error("No API Key found in env");
    process.exit(1);
}

console.log(`API Key Prefix: ${apiKey.substring(0, 4)}...`);

async function listModels() {
    try {
        console.log("Fetching available models via REST API...");
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (resp.status !== 200) {
            console.error(`❌ API Error ${resp.status}:`, data);
            return;
        }

        if (data.models) {
            console.log("✅ Models found:", data.models.map(m => m.name));
            // Check specifically for flash
            const flash = data.models.find(m => m.name.includes('flash'));
            if (flash) {
                console.log(`✨ Recommended Flash Model: ${flash.name}`);
            }
        } else {
            console.error("❌ No models returned:", data);
        }

    } catch (error) {
        console.error("List Models Error:", error);
    }
}

listModels();
