/**
 * MediaEngine.ts
 * RECONSTRUCTION V3: Unified Media Broadcast Engine
 * Handles both Audio (Radio) and Video (TV) mixing/capture.
 * Enforces "Admin as Single Source" rule.
 */

class MediaEngine {
    private audio: HTMLAudioElement | null = null;
    private video: HTMLVideoElement | null = null;
    private ctx: AudioContext | null = null;
    private sourceNode: MediaElementAudioSourceNode | null = null;
    private videoSourceNode: MediaElementAudioSourceNode | null = null;
    private mixerDestination: MediaStreamAudioDestinationNode | null = null;
    private gainNode: GainNode | null = null;

    private currentUrl: string | null = null;
    private isTvMode: boolean = false;
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

            this.audio.onplaying = () => this.notifyStatus('PLAYING');
            this.audio.onpause = () => this.notifyStatus('IDLE');
            this.audio.onended = () => this.notifyStatus('IDLE');
            this.audio.onerror = () => this.notifyStatus('ERROR');

            const ctx = this.initContext();
            this.sourceNode = ctx.createMediaElementSource(this.audio);
            this.sourceNode.connect(this.gainNode!);
        }
        return this.audio;
    }

    private getVideo() {
        if (!this.video) {
            this.video = document.createElement('video');
            this.video.crossOrigin = "anonymous";
            this.video.preload = "auto";
            this.video.autoplay = false;
            this.video.playsInline = true;
            this.video.muted = true; // Admin views video, but audio comes from Mixer

            this.video.onplaying = () => this.notifyStatus('PLAYING');
            this.video.onpause = () => this.notifyStatus('IDLE');
            this.video.onended = () => this.notifyStatus('IDLE');
            this.video.onerror = () => this.notifyStatus('ERROR');

            // Attach video audio to mixer
            const ctx = this.initContext();
            this.videoSourceNode = ctx.createMediaElementSource(this.video);
            this.videoSourceNode.connect(this.gainNode!);
        }
        return this.video;
    }

    private notifyStatus(status: 'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR') {
        if (this.onStatusChange) this.onStatusChange(status);
    }

    public setStatusCallback(callback: (status: 'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR') => void) {
        this.onStatusChange = callback;
    }

    public setMode(mode: 'RADIO' | 'TV') {
        this.isTvMode = mode === 'TV';
        this.stop();
    }

    public resume() {
        this.initContext();
        if (this.ctx?.state === 'suspended') this.ctx.resume();
        this.getAudio();
        if (this.isTvMode) this.getVideo();
    }

    public play(url: string) {
        if (this.isTvMode) {
            const video = this.getVideo();
            if (this.currentUrl !== url) {
                video.srcObject = null;
                video.src = url;
                this.currentUrl = url;
                video.load();
            }
            video.play().catch(e => console.warn("[MediaEngine] Video play blocked:", e));
        } else {
            const audio = this.getAudio();
            if (this.currentUrl !== url) {
                audio.srcObject = null;
                audio.src = url;
                this.currentUrl = url;
                audio.load();
            }
            audio.play().catch(e => console.warn("[MediaEngine] Audio play blocked:", e));
        }
    }

    /**
     * Listener: Attach a WebRTC stream
     */
    public playStream(stream: MediaStream) {
        const audio = this.getAudio();
        audio.src = "";
        audio.srcObject = stream;
        this.currentUrl = "LIVE_STREAM";
        audio.play().catch(e => console.error("[MediaEngine] Stream Play failed:", e));
    }

    public playPCM(audioData: Uint8Array): Promise<void> {
        return new Promise(async (resolve) => {
            try {
                const ctx = this.initContext();
                if (ctx.state === 'suspended') await ctx.resume();

                const bufferSlice = audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength);
                const buffer = await ctx.decodeAudioData(bufferSlice as ArrayBuffer);
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(this.gainNode!);
                source.onended = () => resolve();
                source.start();
            } catch (e) {
                console.error("[MediaEngine] PCM decode failed:", e);
                resolve();
            }
        });
    }

    public getBroadcastStream(): MediaStream | null {
        if (!this.mixerDestination) return null;

        const stream = new MediaStream();

        // Always add Audio tracks from the mixer
        this.mixerDestination.stream.getAudioTracks().forEach(t => stream.addTrack(t));

        // Add Video track if in TV mode
        if (this.isTvMode && this.video) {
            // @ts-ignore - captureStream is valid on HTMLVideoElement
            const videoStream = this.video.captureStream?.() || (this.video as any).mozCaptureStream?.();
            if (videoStream) {
                videoStream.getVideoTracks().forEach((t: MediaStreamTrack) => stream.addTrack(t));
            }
        }

        return stream;
    }

    public stop() {
        if (this.audio) {
            this.audio.pause();
            this.audio.src = "";
            this.audio.srcObject = null;
        }
        if (this.video) {
            this.video.pause();
            this.video.src = "";
            this.video.srcObject = null;
        }
        this.currentUrl = null;
        this.notifyStatus('IDLE');
    }

    public setVolume(v: number) {
        if (this.gainNode) this.gainNode.gain.value = v;
    }

    public isPlaying(): boolean {
        if (this.isTvMode) return this.video ? !this.video.paused : false;
        return this.audio ? !this.audio.paused : false;
    }

    public getAudioElement(): HTMLAudioElement | null {
        return this.getAudio();
    }

    public getVideoElement(): HTMLVideoElement | null {
        return this.getVideo();
    }
}

export const mediaEngine = new MediaEngine();
export const radioEngine = mediaEngine; // Backward compatibility for imports
