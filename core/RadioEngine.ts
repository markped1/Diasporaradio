/**
 * RadioEngine.ts
 * Reconstructed Unified Mixer Engine
 * Enforces "Admin as Single Source" via a Web Audio Graph.
 */
class RadioEngine {
    private audio: HTMLAudioElement | null = null;
    private ctx: AudioContext | null = null;
    private musicNode: MediaElementAudioSourceNode | null = null;
    private mixerDestination: MediaStreamAudioDestinationNode | null = null;
    private gainNode: GainNode | null = null; // Main Volume
    private currentUrl: string | null = null;
    private onStatusChange: ((status: 'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR') => void) | null = null;

    private initContext() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.mixerDestination = this.ctx.createMediaStreamDestination();
            this.gainNode = this.ctx.createGain();
            this.gainNode.connect(this.ctx.destination);
            this.gainNode.connect(this.mixerDestination);
        }
        return this.ctx;
    }

    private getAudio() {
        if (!this.audio) {
            this.audio = new Audio();
            this.audio.crossOrigin = "anonymous";
            this.audio.preload = "auto";

            this.audio.addEventListener('playing', () => this.notifyStatus('PLAYING'));
            this.audio.addEventListener('pause', () => this.notifyStatus('IDLE'));
            this.audio.addEventListener('ended', () => this.notifyStatus('IDLE'));
            this.audio.addEventListener('error', () => this.notifyStatus('ERROR'));

            // MIXER ATTACHMENT
            const ctx = this.initContext();
            this.musicNode = ctx.createMediaElementSource(this.audio);
            this.musicNode.connect(this.gainNode!);
        }
        return this.audio;
    }

    private notifyStatus(status: 'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR') {
        if (this.onStatusChange) this.onStatusChange(status);
    }

    public setStatusCallback(callback: (status: 'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR') => void) {
        this.onStatusChange = callback;
    }

    public resume() {
        this.initContext();
        if (this.ctx?.state === 'suspended') this.ctx.resume();
        this.getAudio(); // Ensure init
    }

    /**
     * Admin: Play a raw URL (Music, News File)
     */
    public play(url: string) {
        const audio = this.getAudio();
        if (this.currentUrl !== url) {
            audio.srcObject = null;
            audio.src = url;
            this.currentUrl = url;
            audio.load();
        }
        audio.play().catch(e => console.warn("[RadioEngine] Play blocked:", e));
    }

    /**
     * Listener: Attach a WebRTC stream
     */
    public playStream(stream: MediaStream) {
        const audio = this.getAudio();
        audio.src = "";
        audio.srcObject = stream;
        this.currentUrl = "LIVE_STREAM";
        audio.play().catch(e => console.error("[RadioEngine] Stream Play failed:", e));
    }

    /**
     * Admin: Inject AI/TTS PCM data into the Master Mixer
     */
    public async playPCM(audioData: Uint8Array): Promise<void> {
        return new Promise(async (resolve) => {
            try {
                const ctx = this.initContext();
                if (ctx.state === 'suspended') await ctx.resume();

                const bufferSlice = audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength);
                const buffer = await ctx.decodeAudioData(bufferSlice as ArrayBuffer);
                const source = ctx.createBufferSource();
                source.buffer = buffer;

                // Route through the same mixer destination (WebRTC) and local speakers
                source.connect(this.gainNode!);

                source.onended = () => resolve();
                source.start();
            } catch (e) {
                console.error("[RadioEngine] PCM decode failed:", e);
                resolve();
            }
        });
    }

    public getBroadcastStream(): MediaStream | null {
        return this.mixerDestination ? this.mixerDestination.stream : null;
    }

    public stop() {
        if (!this.audio) return;
        this.audio.pause();
        this.audio.src = "";
        this.audio.srcObject = null;
        this.currentUrl = null;
        this.notifyStatus('IDLE');
    }

    public setVolume(v: number) {
        if (this.gainNode) this.gainNode.gain.value = v;
        if (this.audio) this.audio.volume = 1.0; // Keep element maxed, control via GainNode
    }

    public isPlaying(): boolean {
        return this.audio ? !this.audio.paused : false;
    }

    public getAudioElement(): HTMLAudioElement | null {
        return this.getAudio();
    }
}

export const radioEngine = new RadioEngine();
