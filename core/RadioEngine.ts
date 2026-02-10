
/**
 * RadioEngine.ts
 * Singleton audio engine for the entire application.
 * Ensures only one audio source is active.
 */
class RadioEngine {
    private audio: HTMLAudioElement | null = null;
    private currentUrl: string | null = null;
    private lastError: string | null = null;
    private onStatusChange: ((status: 'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR') => void) | null = null;

    private getAudio() {
        if (!this.audio) {
            this.audio = new Audio();
            // Try anonymous first, if it fails for some streams we might need to toggle it
            this.audio.crossOrigin = "anonymous";
            this.audio.preload = "auto";

            // Native Listeners for high-fidelity status
            this.audio.addEventListener('loadstart', () => this.notifyStatus('LOADING'));
            this.audio.addEventListener('waiting', () => this.notifyStatus('LOADING'));
            this.audio.addEventListener('playing', () => this.notifyStatus('PLAYING'));
            this.audio.addEventListener('pause', () => this.notifyStatus('IDLE'));
            this.audio.addEventListener('ended', () => this.notifyStatus('IDLE'));
            this.audio.addEventListener('error', (e) => {
                const err = this.audio?.error;
                let msg = "Unknown Audio Error";
                if (err) {
                    if (err.code === 1) msg = "Playback Aborted";
                    if (err.code === 2) msg = "Network Error";
                    if (err.code === 3) msg = "Decoding Error";
                    if (err.code === 4) msg = "Format Not Supported / CORS";
                }
                console.error(`📡 [RadioEngine] Audio Error: ${msg}`, e);
                this.lastError = msg;
                this.notifyStatus('ERROR');
            });

            // Stalled/Suspend logic
            this.audio.addEventListener('stalled', () => {
                this.lastError = "Stream Stalled";
                console.warn("📡 [RadioEngine] Stream stalled");
            });
            this.audio.addEventListener('suspend', () => console.log("📡 [RadioEngine] Stream suspended"));
        }
        return this.audio;
    }

    public getLastError(): string | null {
        return this.lastError;
    }

    private notifyStatus(status: 'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR') {
        if (status !== 'ERROR') this.lastError = null;
        console.log(`📡 [RadioEngine] Status: ${status}`);
        if (this.onStatusChange) {
            this.onStatusChange(status);
        }
    }

    public setStatusCallback(callback: (status: 'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR') => void) {
        this.onStatusChange = callback;
    }

    public play(url: string) {
        if (!url) {
            this.stop();
            return;
        }

        const audio = this.getAudio();

        if (this.currentUrl !== url) {
            console.log(`📡 [RadioEngine] Loading new URL: ${url}`);
            audio.srcObject = null; // Clear any stream
            audio.src = url;
            this.currentUrl = url;
            audio.load();
        }

        audio.play().catch(err => {
            if (err.name === 'NotAllowedError') {
                console.warn("📡 [RadioEngine] Play blocked: User interaction required.");
            } else {
                console.error("📡 [RadioEngine] Play failed:", err);
            }
            this.notifyStatus('ERROR');
        });
    }

    public playStream(stream: MediaStream) {
        const audio = this.getAudio();
        console.log("📡 [RadioEngine] Switching to Live WebRTC Stream");

        // DIAGNOSTIC: Check Stream Tracks
        stream.getAudioTracks().forEach(track => {
            console.log(`🔍 [RadioEngine] Track: ${track.label}, Enabled: ${track.enabled}, Muted: ${track.muted}, State: ${track.readyState}`);
            // Force enable just in case
            track.enabled = true;
        });

        audio.src = "";
        audio.srcObject = stream;
        this.currentUrl = "LIVE_STREAM";
        audio.autoplay = true; // Ensure autoplay is triggered

        // Sometimes strictly setting volume helps wake it up
        audio.volume = 1.0;

        audio.play().then(() => {
            console.log("✅ [RadioEngine] Stream Play Promise Resolved");
        }).catch(err => {
            console.error("📡 [RadioEngine] Stream Play failed:", err);
            this.notifyStatus('ERROR');
        });
    }

    public stop() {
        if (!this.audio) return;
        this.audio.pause();
        this.audio.src = ""; // Clear source to stop buffer
        this.audio.srcObject = null; // Clear stream
        this.currentUrl = null;
        this.notifyStatus('IDLE');
    }

    public setVolume(v: number) {
        const audio = this.getAudio();
        audio.volume = Math.max(0, Math.min(1, v));
    }

    public getVolume(): number {
        return this.audio ? this.audio.volume : 1.0;
    }

    public isPlaying(): boolean {
        return this.audio ? !this.audio.paused : false;
    }

    public getCurrentTime(): number {
        return this.audio ? this.audio.currentTime : 0;
    }

    public getDuration(): number {
        return this.audio ? (isNaN(this.audio.duration) ? 0 : this.audio.duration) : 0;
    }

    public getAudioElement(): HTMLAudioElement | null {
        return this.getAudio();
    }
}

export const radioEngine = new RadioEngine();
