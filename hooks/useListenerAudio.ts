
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
        if (!broadcast) return;

        const isLive = broadcast.isPlaying;
        const streamUrl = broadcast.activeTrackUrl;

        console.log(`🎵 [useListenerAudio] Sync: isLive=${isLive}, interacted=${hasInteracted}, url=${streamUrl}`);

        if (isLive && hasInteracted && streamUrl) {
            console.log(`🎵 [useListenerAudio] -> PLAY`);
            radioEngine.play(streamUrl);
        } else if (!isLive || !streamUrl) {
            console.log(`🎵 [useListenerAudio] -> STOP (Broadcast stopped)`);
            radioEngine.stop();
        } else {
            console.log(`🎵 [useListenerAudio] -> STANDBY (Awaiting interaction)`);
        }
    }, [broadcast?.isPlaying, broadcast?.activeTrackUrl, hasInteracted]);
};
