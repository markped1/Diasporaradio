
import { Type } from "@google/genai";
import { getAIClient, withRetry } from './geminiService';
import { dbService } from './dbService';
import { NewsItem } from '../types';

export interface WeatherData {
  condition: string;
  temp: string;
  location: string;
}

const NEWSDATA_API_KEY = "pub_d5f6ffb151d24f91b0df48a85ad55f2f";

async function fetchNewsDataIo(): Promise<NewsItem[]> {
  try {
    console.log("📡 Fetching from NewsData.io...");
    const response = await fetch(`https://newsdata.io/api/1/latest?country=ng&apikey=${NEWSDATA_API_KEY}`);
    const data = await response.json();

    if (data.status === "success" && data.results) {
      return data.results.slice(0, 10).map((item: any) => ({
        id: 'nd-' + Math.random().toString(36).substr(2, 9),
        title: item.title,
        content: item.description || item.content || "No description available.",
        category: (item.category?.[0] || 'General') as any,
        timestamp: Date.now()
      }));
    }
    return [];
  } catch (error) {
    console.error("❌ NewsData.io fetch failed:", error);
    return [];
  }
}

export async function scanNigerianNewspapers(locationLabel: string = "Global"): Promise<{ news: NewsItem[], weather?: WeatherData }> {
  // Quota Guard: Check if we already have very fresh news (less than 15 mins old)
  const lastSync = await dbService.getLastSyncTime();
  const refreshThreshold = 15 * 60 * 1000;

  await dbService.cleanupOldNews();
  const existingNews = await dbService.getNews();

  return withRetry(async () => {
    try {
      // 1. Fetch from NewsData.io FIRST (Reliable primary source)
      const newsDataNews = await fetchNewsDataIo();

      // 2. Fetch from Gemini in parallel (Enrichment source)
      const geminiNewsPromise = (async () => {
        try {
          const ai = getAIClient();
          const response = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: `Generate 5 relevant news items for the Nigerian Diaspora. Use current knowledge if tools fail.
            Return ONLY JSON with 'news' array (title, category, content).`,
            config: { tools: [{ googleSearch: {} }], responseMimeType: "application/json" }
          });
          const data = JSON.parse(response.text || "{}");
          return (data.news || []).map((item: any) => ({
            id: 'gen-' + Math.random().toString(36).substr(2, 9),
            ...item,
            timestamp: Date.now()
          }));
        } catch (e) {
          console.warn("Gemini fetch failed, using NewsData.io only:", e);
          return [];
        }
      })();

      const [geminiNews] = await Promise.all([geminiNewsPromise]);
      const combinedNews = [...newsDataNews, ...geminiNews];

      if (combinedNews.length > 0) {
        await dbService.saveNews(combinedNews);
      }

      return { news: combinedNews };
    } catch (error: any) {
      console.error("❌ News gathering failed:", error);
      return { news: existingNews };
    }
  });
}
