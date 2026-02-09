import 'dotenv/config';
import { listAvailableAvatars, listAvailableVoices } from './services/heygenService';
import axios from 'axios';

const HEYGEN_API_BASE = 'https://api.heygen.com/v2';

/**
 * Simplified HeyGen test - just generate ONE video using basic settings
 */

const SAMPLE_NEWS = `Good evening, I'm Sandra Obosa with Nigerian Diaspora Radio TV. Nigeria's tech sector shows growth in Lagos and Abuja. Thank you for watching NDRTV.`;

async function quickTest() {
    console.log('🎬 HeyGen Quick Test\n');

    const apiKey = process.env.VITE_HEYGEN_API_KEY;

    if (!apiKey) {
        console.error('❌ No API key found');
        return;
    }

    try {
        // STEP 1: Get a simple female avatar
        console.log('📋 Finding a female avatar...');
        const avatars = await listAvailableAvatars();

        // Look for any public female avatar
        const femaleAvatar = avatars.find(a =>
            a.avatar_name?.toLowerCase().includes('public') &&
            (a.gender === 'female' || a.avatar_name?.toLowerCase().includes('female'))
        ) || avatars[0]; // Fallback to first avatar

        console.log(`✅ Using avatar: ${femaleAvatar.avatar_name} (${femaleAvatar.avatar_id})\n`);

        // STEP 2: Get a valid female voice
        console.log('📋 Finding a female voice...');
        const voices = await listAvailableVoices();

        // Look for any Nigerian female voice first, then any female voice
        const femaleVoice = voices.find(v =>
            v.language?.toLowerCase().includes('english') &&
            v.name?.toLowerCase().includes('nigeria') &&
            (v.gender?.toLowerCase() === 'female' || v.name?.toLowerCase().includes('female'))
        ) || voices.find(v =>
            v.language?.toLowerCase().includes('english') &&
            (v.gender?.toLowerCase() === 'female' || v.name?.toLowerCase().includes('female'))
        ) || voices[0];

        console.log(`✅ Using voice: ${femaleVoice.name} (${femaleVoice.voice_id})\n`);

        // STEP 3: Generate video
        console.log('🎥 Generating video...');

        const response = await axios.post(
            `${HEYGEN_API_BASE}/video/generate`,
            {
                video_inputs: [{
                    character: {
                        type: 'avatar',
                        avatar_id: femaleAvatar.avatar_id
                    },
                    voice: {
                        type: 'text',
                        voice_id: femaleVoice.voice_id,
                        input_text: SAMPLE_NEWS
                    }
                }],
                dimension: {
                    width: 1280,
                    height: 720
                },
                aspect_ratio: '16:9'
            },
            {
                headers: {
                    'X-Api-Key': apiKey,
                    'Content-Type': 'application/json'
                }
            }
        );

        const videoId = response.data.data.video_id;
        console.log(`✅ Video started! ID: ${videoId}`);
        console.log('\n⏳ Waiting for generation (2-3 minutes)...\n');

        // STEP 4: Poll for completion
        let attempts = 0;
        while (attempts < 30) {
            await new Promise(r => setTimeout(r, 10000));

            const status = await axios.get(
                `https://api.heygen.com/v1/video_status.get?video_id=${videoId}`,
                { headers: { 'X-Api-Key': apiKey } }
            );

            const state = status.data.data.status;
            console.log(`Status: ${state}`);

            if (state === 'completed') {
                const videoUrl = status.data.data.video_url;
                console.log('\n🎉 SUCCESS!\n');
                console.log('Video URL:', videoUrl);
                console.log('\n📺 Open this URL in your browser to watch your AI newsroom host!');
                return;
            }

            if (state === 'failed') {
                console.error('❌ Generation failed:', status.data.data.error);
                return;
            }

            attempts++;
        }

        console.log('⏱️ Timeout - check HeyGen dashboard');

    } catch (error: any) {
        console.error('\n❌ Error:', error.response?.data || error.message);
    }
}

quickTest();
