
import { useEffect } from 'react';
import { useBroadcast } from '../context/BroadcastContext';
import { radioEngine } from '../core/RadioEngine';

/**
 * useListenerAudio
 * Accepts listenerHasPressedPlay as an argument.
 * Drives the RadioEngine based on broadcast state and consent.
 */
export const useListenerAudio = (hasInteracted: boolean) => {
    const { broadcast } = useBroadcast();

    useEffect(() => {
        if (!broadcast) {
            console.log("🎵 [useListenerAudio] Waiting for broadcast state...");
            return;
        }

        const isLive = broadcast.isPlaying;
        const streamUrl = broadcast.activeTrackUrl;

        console.log(`🎵 [useListenerAudio] STATE SYNC:
            - isLive: ${isLive}
            - hasInteracted: ${hasInteracted}
            - streamUrl: ${streamUrl ? 'PRESENT' : 'MISSING'}
            - syncStatus: ${broadcast.activeTrackName || 'N/A'}`);

        if (isLive && hasInteracted && streamUrl) {
            console.log(`🎵 [useListenerAudio] -> EXECUTE PLAY: ${streamUrl}`);
            radioEngine.play(streamUrl);
        } else if (!isLive || !streamUrl) {
            console.log(`🎵 [useListenerAudio] -> EXECUTE STOP (Reason: ${!isLive ? 'Stopped' : 'Missing URL'})`);
            radioEngine.stop();
        } else if (isLive && !hasInteracted) {
            console.warn(`🎵 [useListenerAudio] -> BLOCK (Awaiting interaction to comply with browser policy)`);
        }
    }, [broadcast?.isPlaying, broadcast?.activeTrackUrl, hasInteracted]);
};
