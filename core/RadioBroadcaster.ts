
import { signalingService } from '../services/SignalingService';
import { radioEngine } from './RadioEngine';
import { SignalingMessage } from '../types';

class RadioBroadcaster {
    private peerConnections: Map<string, RTCPeerConnection> = new Map();
    private localStream: MediaStream | null = null;
    private config: RTCConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ]
    };

    public startBroadcasting() {
        // 🎙️ RECONSTRUCTION: Capture from the Unified Mixer, NOT just the audio element
        const stream = radioEngine.getBroadcastStream();

        if (!stream) {
            console.error("❌ [Broadcaster] No broadcast stream available from Mixer");
            return;
        }

        this.localStream = stream;
        console.log("🎙️ [Broadcaster] Captured Unified Mixer Stream ID:", stream.id);

        stream.getAudioTracks().forEach((track: MediaStreamTrack) => {
            console.log(`🎙️ [Broadcaster] Track: ${track.label}, State: ${track.readyState}`);
        });

        signalingService.initialize('ADMIN', (msg) => this.handleSignal(msg));
    }

    private async handleSignal(msg: SignalingMessage) {
        const { senderId, type, payload } = msg;

        if (type === 'REQUEST_STREAM') {
            console.log(`✨ [Broadcaster] New Listener Request: ${senderId}`);
            await this.createPeerConnection(senderId);
        } else if (type === 'ANSWER') {
            const pc = this.peerConnections.get(senderId);
            if (pc) {
                console.log(`✅ [Broadcaster] Received Answer from ${senderId}`);
                await pc.setRemoteDescription(new RTCSessionDescription(payload));
            }
        } else if (type === 'ICE_CANDIDATE') {
            const pc = this.peerConnections.get(senderId);
            if (pc && payload) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(payload));
                } catch (e) {
                    console.error("Error adding ICE:", e);
                }
            }
        }
    }

    private async createPeerConnection(listenerId: string) {
        if (this.peerConnections.has(listenerId)) {
            this.peerConnections.get(listenerId)?.close();
        }

        const pc = new RTCPeerConnection(this.config);
        this.peerConnections.set(listenerId, pc);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                signalingService.sendSignal(listenerId, 'ICE_CANDIDATE', event.candidate);
            }
        };

        pc.onconnectionstatechange = () => {
            console.log(`📡 [Broadcaster] Connection to ${listenerId}: ${pc.connectionState}`);
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                this.peerConnections.delete(listenerId);
            }
        };

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream!));
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        console.log(`📤 [Broadcaster] Sending Offer to ${listenerId}`);
        signalingService.sendSignal(listenerId, 'OFFER', offer);
    }

    public stopBroadcasting() {
        this.peerConnections.forEach(pc => pc.close());
        this.peerConnections.clear();
        this.localStream = null;
        signalingService.cleanup();
        console.log("🛑 [Broadcaster] Stopped");
    }

    public getListenerCount(): number {
        return this.peerConnections.size;
    }
}

export const radioBroadcaster = new RadioBroadcaster();
