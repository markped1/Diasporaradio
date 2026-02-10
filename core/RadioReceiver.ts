
import { signalingService } from '../services/SignalingService';
import { SignalingMessage } from '../types';

class RadioReceiver {
    private pc: RTCPeerConnection | null = null;
    private config: RTCConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };
    private onStreamCallback: ((stream: MediaStream) => void) | null = null;

    public setOnStream(callback: (stream: MediaStream) => void) {
        this.onStreamCallback = callback;
    }

    public connect() {
        console.log("🎧 [Receiver] Connecting to Radio Network...");

        signalingService.initialize('LISTENER', async (msg) => {
            if (msg.type === 'OFFER') {
                console.log("✅ [Receiver] Received Offer from Admin");
                await this.handleOffer(msg.payload);
            } else if (msg.type === 'ICE_CANDIDATE') {
                if (this.pc && msg.payload) {
                    try {
                        await this.pc.addIceCandidate(new RTCIceCandidate(msg.payload));
                    } catch (e) {
                        console.error("Error adding ICE:", e);
                    }
                }
            } else if (msg.type === 'ADMIN_ACTIVE') {
                console.log("📡 [Receiver] Admin is Active, requesting stream...");
                this.requestStream(); // Auto-reconnect if needed
            }
        });

        // Initial Request
        this.requestStream();
    }

    private requestStream() {
        console.log("📤 [Receiver] Sending Request Stream Signal");
        signalingService.sendSignal('ADMIN', 'REQUEST_STREAM', {});
    }

    private async handleOffer(offer: RTCSessionDescriptionInit) {
        if (this.pc) {
            this.pc.close();
        }

        this.pc = new RTCPeerConnection(this.config);

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                // Send candidate to Admin
                signalingService.sendSignal('ADMIN', 'ICE_CANDIDATE', event.candidate);
            }
        };

        this.pc.ontrack = (event) => {
            console.log("🎵 [Receiver] Received Remote Track", event.streams[0]);
            if (this.onStreamCallback && event.streams[0]) {
                this.onStreamCallback(event.streams[0]);
            }
        };

        this.pc.addTransceiver('audio', { direction: 'recvonly' });

        await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);

        console.log("📤 [Receiver] Sending Answer");
        signalingService.sendSignal('ADMIN', 'ANSWER', answer);
    }

    public disconnect() {
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        signalingService.cleanup();
        console.log("🛑 [Receiver] Disconnected");
    }
}

export const radioReceiver = new RadioReceiver();
