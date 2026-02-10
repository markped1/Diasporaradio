
import { supabase } from './supabaseClient';
import { SignalingMessage } from '../types';

const SIGNALING_CHANNEL = 'radio_signaling';

class SignalingService {
    private channel: any = null;
    private userId: string;
    private onSignal?: (msg: SignalingMessage) => void;

    constructor() {
        this.userId = crypto.randomUUID();
    }

    public getUserId(): string {
        return this.userId;
    }

    public initialize(role: 'ADMIN' | 'LISTENER', onSignal: (msg: SignalingMessage) => void) {
        this.onSignal = onSignal;

        // If Admin, use fixed ID 'ADMIN' to make it easy for listeners to find
        if (role === 'ADMIN') {
            this.userId = 'ADMIN';
        }

        console.log(`📡 [Signaling] Initializing as ${role} (${this.userId})`);

        this.channel = supabase.channel(SIGNALING_CHANNEL, {
            config: {
                broadcast: { self: false } // Don't receive own messages
            }
        });

        this.channel
            .on('broadcast', { event: 'signal' }, (payload: { payload: SignalingMessage }) => {
                const msg = payload.payload;
                // Filter messages meant for us
                if (msg.targetId === this.userId || msg.targetId === 'ALL') {
                    // console.log(`📡 [Signaling] Received ${msg.type} from ${msg.senderId}`);
                    this.onSignal?.(msg);
                }
            })
            .subscribe((status: string) => {
                if (status === 'SUBSCRIBED') {
                    console.log("📡 [Signaling] Connected to Signal Channel");
                    if (role === 'ADMIN') {
                        this.sendSignal('ALL', 'ADMIN_ACTIVE', {});
                    } else {
                        // Listener just waits or could announce presence, but mostly waits to request
                    }
                }
            });
    }

    public sendSignal(targetId: string, type: SignalingMessage['type'], payload: any) {
        if (!this.channel) return;

        const msg: SignalingMessage = {
            type,
            senderId: this.userId,
            targetId,
            payload
        };

        this.channel.send({
            type: 'broadcast',
            event: 'signal',
            payload: msg
        });
    }

    public cleanup() {
        if (this.channel) {
            supabase.removeChannel(this.channel);
            this.channel = null;
        }
    }
}

export const signalingService = new SignalingService();
