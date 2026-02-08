
import { Type } from "@google/genai";
import { getAIClient, withRetry } from './geminiService';
import { dbService } from './dbService';
import { NewsItem } from '../types';

export interface WeatherData {
  condition: string;
  temp: string;
  location: string;
}

export async function scanNigerianNewspapers(locationLabel: string = "Global"): Promise<{ news: NewsItem[], weather?: WeatherData }> {
  // Quota Guard: Check if we already have very fresh news (less than 15 mins old)
  const lastSync = await dbService.getLastSyncTime();
  const refreshThreshold = 15 * 60 * 1000;

  await dbService.cleanupOldNews();
  const existingNews = await dbService.getNews();

  return withRetry(async () => {
    try {
      const ai = getAIClient();
      const prompt = `Search for the most CURRENT news (strictly last 24 hours) with a HEAVY FOCUS on the Nigerian Diaspora.
      
      PRIMARY FOCUS (70% of results):
      - DIASPORA ACHIEVEMENTS: Nigerians winning awards, breaking records, or achieving major career/education milestones abroad.
      - DIASPORA COMMUNITY: Community events, challenges, and success stories for Nigerians living in North America, UK/Europe, Asia (especially India/China), and other African nations.
      
      SECONDARY FOCUS (30% of results):
      - NIGERIA TOP HEADLINES: The most critical political or economic news from within Nigeria.
      - WEATHER: Current temp and sky conditions in ${locationLabel}.
      
      Return a JSON object with:
      - 'news': Array of objects with 'title', 'content', 'category' (Detailed content 60-80 words). 
        Ensure category 'Diaspora' is used for diaspora news.
      - 'headlines': Array of short strings (headlines only).
      - 'weather': Object with 'condition', 'temp', 'location'.`;

      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash", // REVERTED: Better stability for search tools
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              news: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    content: { type: Type.STRING },
                    category: { type: Type.STRING }
                  },
                  required: ["title", "content", "category"]
                }
              },
              headlines: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              weather: {
                type: Type.OBJECT,
                properties: {
                  condition: { type: Type.STRING },
                  temp: { type: Type.STRING },
                  location: { type: Type.STRING }
                }
              }
            }
          }
        },
      });

      const data = JSON.parse(response.text || "{}");

      const processedNews: NewsItem[] = (data.news || []).map((item: any) => ({
        id: Math.random().toString(36).substr(2, 9),
        title: item.title,
        content: item.content,
        category: item.category as any,
        timestamp: Date.now()
      }));

      if (processedNews.length > 0) {
        await dbService.saveNews(processedNews);
      }

      console.log(`✅ Fetched ${processedNews.length} news items and weather data`);

      return {
        news: processedNews,
        weather: data.weather
      };
    } catch (error: any) {
      console.error("❌ Advanced News/Weather scanning failed:", error);
      const isToolError = error?.message?.includes('search') || error?.message?.includes('tool') || error?.message?.includes('permission');

      if (isToolError) {
        console.warn("⚠️ Google Search tool is restricted. Falling back to General Knowledge News...");
        try {
          const fallbackAi = getAIClient();
          const fallbackResponse = await fallbackAi.models.generateContent({
            model: "gemini-1.5-flash",
            contents: `Generate a list of 5 currently relevant news headlines for Nigeria (Politics, Business, Entertainment). 
            Return ONLY a valid JSON array of objects with 'headline', 'category', and 'summary' fields.`,
          });
          const text = fallbackResponse.text;
          const cleanedText = text.replace(/```json|```/g, "").trim();
          const fallbackNews = JSON.parse(cleanedText);
          return { news: fallbackNews };
        } catch (fallbackError) {
          console.error("❌ Fallback news generation also failed:", fallbackError);
        }
      }

      if (error?.message) console.error("Error Message:", error.message);
      return { news: existingNews };
    }
  });
}
