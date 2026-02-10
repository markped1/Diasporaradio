
import { useEffect } from 'react';
import { useBroadcast } from '../context/BroadcastContext';
import { radioEngine } from '../core/RadioEngine';

/**
 * useListenerAudio
 * Accepts listenerHasPressedPlay as an argument.
 * Drives the RadioEngine based on broadcast state and consent.
 */
export const useListenerAudio = (hasInteracted: boolean, role: string) => {
    const { broadcast } = useBroadcast();

    useEffect(() => {
        // RULE: Listeners MUST NOT use this hook to play raw URLs from the DB.
        // Listeners only use WebRTC via the RadioPlayer component.
        if (role !== 'ADMIN') {
            return;
        }

        if (!broadcast) {
            console.log("🎵 [useListenerAudio] Waiting for broadcast state...");
            return;
        }

        const isLive = broadcast.isPlaying;
        const streamUrl = broadcast.activeTrackUrl;

        console.log(`🎵 [useListenerAudio] ADMIN SYNC (Local Playback):
            - isLive: ${isLive}
            - hasInteracted: ${hasInteracted}
            - streamUrl: ${streamUrl ? 'PRESENT' : 'MISSING'}`);

        if (isLive && hasInteracted && streamUrl) {
            console.log(`🎵 [useListenerAudio] -> ADMIN EXECUTE PLAY: ${streamUrl}`);
            radioEngine.play(streamUrl);
        } else if (!isLive || !streamUrl) {
            console.log(`🎵 [useListenerAudio] -> ADMIN EXECUTE STOP`);
            radioEngine.stop();
        }
    }, [broadcast?.isPlaying, broadcast?.activeTrackUrl, hasInteracted, role]);
};
