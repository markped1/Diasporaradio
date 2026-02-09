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
                // Fall through to native fallback
            }
        }

        if (!this.synth) {
            onError?.("Speech Synthesis not supported in this browser.");
            return;
        }

        // Cancel any current speech
        this.stop();

        const utterance = new SpeechSynthesisUtterance(text);

        // Attempt to find a suitable voice
        const voices = this.getVoices();
        if (voiceName) {
            const selectedVoice = voices.find(v => v.name === voiceName);
            if (selectedVoice) utterance.voice = selectedVoice;
        } else {
            // Default: try to find an English voice (preferably Nigerian if available, though rare in defaults)
            const enVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) ||
                voices.find(v => v.lang.startsWith('en'));
            if (enVoice) utterance.voice = enVoice;
        }

        utterance.pitch = 1.0;
        utterance.rate = 0.95; // Slightly slower for better clarity
        utterance.volume = 1.0;

        utterance.onstart = () => onStart?.();
        utterance.onend = () => {
            this.currentUtterance = null;
            onEnd?.();
        };
        utterance.onerror = (e) => {
            this.currentUtterance = null;
            onError?.(e);
        };

        this.currentUtterance = utterance;
        this.synth.speak(utterance);
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
