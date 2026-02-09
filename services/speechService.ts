/**
 * Speech Service
 * Uses browser-native window.speechSynthesis for free, real-time TTS.
 */

export interface SpeechRequest {
    text: string;
    voiceName?: string;
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (err: any) => void;
}

class SpeechService {
    private synth: SpeechSynthesis | null = typeof window !== 'undefined' ? window.speechSynthesis : null;
    private currentUtterance: SpeechSynthesisUtterance | null = null;

    getVoices(): SpeechSynthesisVoice[] {
        if (!this.synth) return [];
        return this.synth.getVoices();
    }

    async speak({ text, voiceName, onStart, onEnd, onError }: SpeechRequest) {
        // Preference 1: Puter.js AI TTS (Higher Quality)
        if (typeof window !== 'undefined' && (window as any).puter?.ai?.txt2speech) {
            try {
                console.log("Using Puter AI TTS...");
                const audio = await (window as any).puter.ai.txt2speech(text);
                if (audio && audio.src) {
                    onStart?.();
                    const audioObj = new Audio(audio.src);
                    audioObj.onended = () => onEnd?.();
                    audioObj.onerror = (e) => onError?.(e);
                    await audioObj.play();
                } else {
                    throw new Error("Puter TTS returned no audio source");
                }
                return;
            } catch (err) {
                console.warn("Puter AI TTS failed, falling back to Browser Native:", err);
            }
        }

        if (!this.synth) {
            onError?.("Speech Synthesis not supported in this browser.");
            return;
        }

        this.stop();
        onStart?.();

        // CHUNKING LOGIC: Split text into smaller segments for better stability in native TTS
        const chunks = text.match(/[^.!?]+[.!?]+|[^.!?]+/g) || [text];
        let currentIdx = 0;

        const speakNextChunk = () => {
            if (currentIdx >= chunks.length) {
                onEnd?.();
                return;
            }

            const utterance = new SpeechSynthesisUtterance(chunks[currentIdx].trim());
            const voices = this.getVoices();

            if (voiceName) {
                const selectedVoice = voices.find(v => v.name === voiceName);
                if (selectedVoice) utterance.voice = selectedVoice;
            } else {
                const enVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Premium'))) ||
                    voices.find(v => v.lang.startsWith('en'));
                if (enVoice) utterance.voice = enVoice;
            }

            utterance.pitch = 1.0;
            utterance.rate = 0.95;
            utterance.volume = 1.0;

            utterance.onend = () => {
                currentIdx++;
                speakNextChunk();
            };

            utterance.onerror = (e) => {
                console.error("Native TTS Chunk Error:", e);
                currentIdx++;
                speakNextChunk();
            };

            this.currentUtterance = utterance;
            this.synth!.speak(utterance);
        };

        speakNextChunk();
    }

    stop() {
        if (this.synth) {
            this.synth.cancel();
            this.currentUtterance = null;
        }
    }

    isSpeaking(): boolean {
        return !!this.synth?.speaking;
    }
}

export const speechService = new SpeechService();
