

import { generateText, withRetry } from './geminiService';
import { dbService } from './dbService';
import { DjScript, NewsItem } from '../types';
import { NEWSCASTER_NAME, APP_NAME } from '../constants';
import { WeatherData } from './newsAIService';

export async function generateDjSegment(): Promise<DjScript> {
  return withRetry(async () => {
    const prompt = `Write a 15-second radio bridge for ${APP_NAME}. 
    Host: ${NEWSCASTER_NAME}. 
    Mention the diaspora community and our voice abroad. Keep it high energy and warm.`;

    const systemInstruction = `You are ${NEWSCASTER_NAME}, the voice of ${APP_NAME}. Your tone is professional, sophisticated, and distinctively Nigerian.`;

    const scriptText = await generateText(prompt, systemInstruction);
    const djScript: DjScript = {
      id: Math.random().toString(36).substr(2, 9),
      script: scriptText,
      timestamp: Date.now()
    };
    await dbService.addScript(djScript);
    return djScript;
  });
}

// Speechify Configuration
// Puter TTS Configuration
async function generatePuterAudio(text: string, options: any = {}): Promise<Uint8Array | null> {
  if (!window.puter || !window.puter.ai || !window.puter.ai.txt2speech) {
    console.warn("Puter.js not loaded or unavailable");
    return null;
  }

  try {
    // Puter's txt2speech can take a string for voice OR an options object for advanced providers.
    // If we pass an object that Puter doesn't like, it might fail.
    // We'll try the provided options first, then fallback to a simple call.
    let audio;
    try {
      audio = await window.puter.ai.txt2speech(text, options);
    } catch (e) {
      console.warn("Puter TTS with options failed, trying simple call...", e);
      audio = await window.puter.ai.txt2speech(text);
    }

    if (audio && audio.src) {
      const response = await fetch(audio.src);
      if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
      const arrayBuffer = await response.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    }
    return null;
  } catch (error) {
    console.error("Puter TTS generation failed", error);
    return null;
  }
}

export function getDetailedBulletinScript(params: {
  location: string;
  localTime: string;
  newsItems: NewsItem[];
  hostName: string;
  weather?: WeatherData;
  isBrief?: boolean;
}): string {
  const { location, localTime, newsItems, weather, isBrief, hostName } = params;
  let fullScript = "";

  if (isBrief) {
    // Half-hour Headline Update (Thompson Obosa)
    fullScript = `This is a 60-second Headline Update on Nigeria Diaspora Radio. I am ${hostName}. `;
    if (weather) {
      fullScript += `In ${weather.location}, the weather is currently ${weather.condition} at ${weather.temp}. `;
    }
    fullScript += `Here are the latest global headlines: `;
    newsItems.forEach((n, i) => {
      fullScript += `${i + 1}: ${n.title}. `;
    });
    fullScript += `Stay with us on NDR for more music and stories from Nigerians abroad. This is ${APP_NAME}.`;
  } else {
    // Top of the Hour Detailed Bulletin (Sara Obosa)
    fullScript = `This is ${hostName} with the ${APP_NAME} Detailed News Bulletin. The time is ${localTime} in ${location}. `;

    if (weather) {
      fullScript += `Looking at the weather, in ${weather.location} we have ${weather.condition} with a temperature of ${weather.temp}. `;
    }

    fullScript += `Our top stories this hour focusing on our diaspora community: `;
    newsItems.forEach((n, i) => {
      if (i > 0) {
        const transitions = [
          `Our next story is about ${n.category || 'the community'}. `,
          `Moving on to ${n.category || 'more news'}. `,
          `In other news, `,
          `Now, taking a look at ${n.category || 'our diaspora'}. `
        ];
        const transition = transitions[i % transitions.length];
        fullScript += transition;
      }
      fullScript += `${n.title}. ${n.content} `;
    });

    fullScript += `That is the detailed bulletin. I am ${hostName}. Keep it locked to the voice of Nigerians abroad, right here on NDR.`;
  }
  return fullScript;
}

export async function getDetailedBulletinAudio(params: {
  location: string;
  localTime: string;
  newsItems: NewsItem[];
  hostName: string;
  weather?: WeatherData;
  isBrief?: boolean;
}): Promise<Uint8Array | null> {
  return withRetry(async () => {
    const fullScript = getDetailedBulletinScript(params);

    try {
      // Use a consistent male voice for Tommy/Thompson news bulletins
      let audioData = await generatePuterAudio(fullScript, { provider: 'openai', voice: 'onyx' });

      if (!audioData) {
        audioData = await generatePuterAudio(fullScript, { provider: 'elevenlabs', voice: 'gsyHQ9kWCDIipR26RqQ1' });
      }

      if (audioData) return audioData;
      console.warn("Puter audio generation returned null for bulletin");
      return null;
    } catch (error) {
      console.error("Bulletin TTS failed", error);
      return null;
    }
  });
}

export async function getDiscussionAudio(text: string): Promise<Uint8Array | null> {
  // Tommy Bossman personality: Upbeat, cooler, distinctively Nigerian phrasing
  const script = `Wetin dey happen, my people! Tommy Bossman here on Nigeria Diaspora Radio. I get small word for us today, listen up. ${text}. God bless Nigeria, and thanks for listening.`;

  console.log("Generating Tommy Bossman Discussion Audio...");

  return withRetry(async () => {
    // Attempt 1: ElevenLabs Nigerian Male (GSY... is NZ The African Man)
    let audioData = await generatePuterAudio(script, { provider: 'elevenlabs', voice: 'gsyHQ9kWCDIipR26RqQ1' });

    if (!audioData) {
      console.warn("ElevenLabs Nigerian choice failed, falling back to OpenAI Onyx (Male Deep)...");
      audioData = await generatePuterAudio(script, { provider: 'openai', voice: 'onyx' });
    }

    if (audioData) {
      console.log("Discussion Audio generated successfully, size:", audioData.byteLength);
      return audioData;
    }

    console.warn("Discussion Audio generation FAILED (returned null)");
    return null;
  });
}


export async function getNewsAudio(newsContent: string): Promise<Uint8Array | null> {
  return withRetry(async () => {
    // Use Puter instead of Speechify
    const audioData = await generatePuterAudio(newsContent);
    if (audioData) return audioData;

    return null;
  });
}


export async function getJingleAudio(jingleText: string): Promise<Uint8Array | null> {
  console.log("Generating/Fetching Jingle for:", jingleText);
  const cacheKey = `jingle_${btoa(jingleText)}`;
  const cached = await dbService.getCachedAudio(cacheKey);
  if (cached) {
    console.log("Using cached jingle");
    return cached;
  }

  return withRetry(async () => {
    console.log("Requesting Puter TTS for jingle (Male)...");
    const audioData = await generatePuterAudio(jingleText, { provider: 'openai', voice: 'onyx' });

    if (audioData) {
      console.log("Jingle generated successfully, caching...");
      await dbService.setCachedAudio(cacheKey, audioData);
      return audioData;
    }
    console.error("Jingle generation returned null");
    return null;
  });
}

function decode(base64: string) {
  try {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    console.error("Base64 decode failed", e);
    return new Uint8Array(0);
  }
}
