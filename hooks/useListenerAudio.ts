
import { useEffect } from 'react';
import { useBroadcast } from '../context/BroadcastContext';
import { radioEngine } from '../core/RadioEngine';

/**
 * useListenerAudio
 * Accepts listenerHasPressedPlay as an argument.
 * Drives the RadioEngine based on broadcast state and consent.
 */
export const useListenerAudio = (listenerHasPressedPlay: boolean) => {
    const { broadcast } = useBroadcast();

    useEffect(() => {
        if (!broadcast) return;

        const isLive = broadcast.isPlaying;
        const streamUrl = broadcast.activeTrackUrl;

        if (isLive && listenerHasPressedPlay && streamUrl) {
            console.log(`🎵 [useListenerAudio] Triggering Play: ${streamUrl}`);
            radioEngine.play(streamUrl);
        } else {
            console.log(`🎵 [useListenerAudio] Triggering Stop (isLive: ${isLive}, consent: ${listenerHasPressedPlay})`);
            radioEngine.stop();
        }
    }, [broadcast?.isPlaying, broadcast?.activeTrackUrl, listenerHasPressedPlay]);
};
