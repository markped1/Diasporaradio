
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
            this.audio.crossOrigin = "anonymous";
            this.audio.preload = "none";

            this.audio.addEventListener('waiting', () => this.notifyStatus('LOADING'));
            this.audio.addEventListener('playing', () => this.notifyStatus('PLAYING'));
            this.audio.addEventListener('pause', () => this.notifyStatus('IDLE'));
            this.audio.addEventListener('ended', () => this.notifyStatus('IDLE'));
            this.audio.addEventListener('error', () => this.notifyStatus('ERROR'));
        }
        return this.audio;
    }

    private notifyStatus(status: 'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR') {
        if (this.onStatusChange) {
            this.onStatusChange(status);
        }
    }

    public setStatusCallback(callback: (status: 'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR') => void) {
        this.onStatusChange = callback;
    }

    public play(url: string) {
        const audio = this.getAudio();
        if (this.currentUrl !== url) {
            console.log(`📡 [RadioEngine] Loading new URL: ${url}`);
            audio.src = url;
            this.currentUrl = url;
            audio.load();
        }

        if (audio.paused) {
            audio.play().catch(err => {
                console.warn("📡 [RadioEngine] Play blocked or failed:", err.message);
                this.notifyStatus('ERROR');
            });
        }
    }

    public stop() {
        if (!this.audio) return;
        this.audio.pause();
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
        return this.audio ? this.audio.duration : 0;
    }

    public getAudioElement(): HTMLAudioElement | null {
        return this.audio;
    }
}

export const radioEngine = new RadioEngine();
