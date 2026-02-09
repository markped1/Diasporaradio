import axios from 'axios';

const HEYGEN_API_BASE = 'https://api.heygen.com/v2';

interface HeyGenAvatarStyle {
    avatarId: string;
    outfitStyle: 'professional' | 'casual' | 'african_print';
}

interface HeyGenVideoRequest {
    video_inputs: Array<{
        character: {
            type: string;
            avatar_id: string;
            avatar_style?: string;
        };
        voice: {
            type: string;
            voice_id: string;
            input_text: string;
        };
        background?: {
            type: string;
            url?: string;
        };
    }>;
    dimension?: {
        width: number;
        height: number;
    };
    aspect_ratio?: string;
}

const AVATAR_STYLES = [
    {
        id: 'josh_lite3_20230714',
        name: 'Professional News Anchor',
        outfitStyle: 'professional' as const
    },
    {
        id: 'Angela_public_3_20240108',
        name: 'Business Casual',
        outfitStyle: 'casual' as const
    },
    {
        id: 'Anna_public_3_20240108',
        name: 'Evening News',
        outfitStyle: 'professional' as const
    }
];

// Nigerian/African voices
const NIGERIAN_VOICES = [
    'en-NG-AbeolaNeural', // Nigerian Female
    'en-KE-AsiliaNeural', // Kenyan Female (alternative)
    'en-ZA-LeahNeural'    // South African Female (alternative)
];

/**
 * Get avatar style based on time of day
 */
function getAvatarForTimeOfDay(): HeyGenAvatarStyle {
    const hour = new Date().getHours();
    const index = Math.floor(hour / 8) % AVATAR_STYLES.length;
    const style = AVATAR_STYLES[index];

    return {
        avatarId: style.id,
        outfitStyle: style.outfitStyle
    };
}

/**
 * Generate a news video using HeyGen API
 * @param script - The news script to be read by the AI host
 * @param customStyle - Optional custom avatar style
 * @returns Video ID to poll for completion
 */
export async function generateNewsVideo(
    script: string,
    customStyle?: HeyGenAvatarStyle
): Promise<string> {
    // Support both Vite (import.meta.env) and Node.js (process.env)
    const apiKey = typeof import.meta !== 'undefined' && import.meta.env
        ? import.meta.env.VITE_HEYGEN_API_KEY
        : process.env.VITE_HEYGEN_API_KEY;

    if (!apiKey) {
        throw new Error('VITE_HEYGEN_API_KEY not configured in .env');
    }

    const style = customStyle || getAvatarForTimeOfDay();

    console.log(`🎥 Generating news video with avatar: ${style.avatarId}`);

    const requestBody: HeyGenVideoRequest = {
        video_inputs: [
            {
                character: {
                    type: 'avatar',
                    avatar_id: style.avatarId
                },
                voice: {
                    type: 'text',
                    voice_id: NIGERIAN_VOICES[0], // Default to Nigerian voice
                    input_text: script.substring(0, 5000) // HeyGen limit
                },
                background: {
                    type: 'color',
                    url: '#1a1a2e' // Dark newsroom color
                }
            }
        ],
        aspect_ratio: '16:9'
    };

    try {
        const response = await axios.post(
            `${HEYGEN_API_BASE}/video/generate`,
            requestBody,
            {
                headers: {
                    'X-Api-Key': apiKey,
                    'Content-Type': 'application/json'
                }
            }
        );

        const videoId = response.data.data.video_id;
        console.log(`✅ Video generation started. ID: ${videoId}`);

        return videoId;
    } catch (error: any) {
        console.error('❌ HeyGen API Error:', error.response?.data || error.message);
        throw new Error(`Failed to generate video: ${error.response?.data?.message || error.message}`);
    }
}

/**
 * Check video generation status
 * @param videoId - The video ID from generateNewsVideo
 * @returns Video status and URL when completed
 */
export async function checkVideoStatus(videoId: string): Promise<{
    status: 'pending' | 'processing' | 'completed' | 'failed';
    videoUrl?: string;
    error?: string;
}> {
    const apiKey = typeof import.meta !== 'undefined' && import.meta.env
        ? import.meta.env.VITE_HEYGEN_API_KEY
        : process.env.VITE_HEYGEN_API_KEY;

    try {
        const response = await axios.get(
            `${HEYGEN_API_BASE}/video_status.get?video_id=${videoId}`,
            {
                headers: {
                    'X-Api-Key': apiKey
                }
            }
        );

        const data = response.data.data;

        return {
            status: data.status,
            videoUrl: data.video_url,
            error: data.error
        };
    } catch (error: any) {
        console.error('❌ Status check failed:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Generate video and poll until completion
 * @param script - News script
 * @param maxWaitMinutes - Maximum time to wait (default: 5 minutes)
 * @returns Final video URL
 */
export async function generateAndWaitForVideo(
    script: string,
    maxWaitMinutes: number = 5
): Promise<string> {
    const videoId = await generateNewsVideo(script);

    console.log('⏳ Waiting for video generation to complete...');

    const startTime = Date.now();
    const maxWaitMs = maxWaitMinutes * 60 * 1000;

    while (Date.now() - startTime < maxWaitMs) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // Check every 10 seconds

        const status = await checkVideoStatus(videoId);

        if (status.status === 'completed' && status.videoUrl) {
            console.log('✅ Video ready:', status.videoUrl);
            return status.videoUrl;
        }

        if (status.status === 'failed') {
            throw new Error(`Video generation failed: ${status.error}`);
        }

        console.log(`⏳ Status: ${status.status}...`);
    }

    throw new Error('Video generation timed out');
}

/**
 * Get list of available avatars
 */
export async function listAvailableAvatars(): Promise<any[]> {
    const apiKey = typeof import.meta !== 'undefined' && import.meta.env
        ? import.meta.env.VITE_HEYGEN_API_KEY
        : process.env.VITE_HEYGEN_API_KEY;

    try {
        const response = await axios.get(
            `${HEYGEN_API_BASE}/avatars`,
            {
                headers: {
                    'X-Api-Key': apiKey
                }
            }
        );

        return response.data.data.avatars;
    } catch (error: any) {
        console.error('❌ Failed to fetch avatars:', error.response?.data || error.message);
        throw error;
    }
}
/**
 * Get list of available voices
 */
export async function listAvailableVoices(): Promise<any[]> {
    const apiKey = typeof import.meta !== 'undefined' && import.meta.env
        ? import.meta.env.VITE_HEYGEN_API_KEY
        : process.env.VITE_HEYGEN_API_KEY;

    try {
        const response = await axios.get(
            `${HEYGEN_API_BASE}/voices`,
            {
                headers: {
                    'X-Api-Key': apiKey
                }
            }
        );

        return response.data.data.voices;
    } catch (error: any) {
        console.error('❌ Failed to fetch voices:', error.response?.data || error.message);
        throw error;
    }
}
