
/**
 * RadioEngine.ts
 * Singleton audio engine for the entire application.
 * Ensures only one audio source is active.
 */
class RadioEngine {
    private audio: HTMLAudioElement | null = null;
    private currentUrl: string | null = null;
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
                console.error("📡 [RadioEngine] Audio Error:", e);
                this.notifyStatus('ERROR');
            });

            // Stalled/Suspend logic
            this.audio.addEventListener('stalled', () => console.warn("📡 [RadioEngine] Stream stalled"));
            this.audio.addEventListener('suspend', () => console.log("📡 [RadioEngine] Stream suspended"));
        }
        return this.audio;
    }

    private notifyStatus(status: 'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR') {
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

    public stop() {
        if (!this.audio) return;
        this.audio.pause();
        this.audio.src = ""; // Clear source to stop buffer
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
