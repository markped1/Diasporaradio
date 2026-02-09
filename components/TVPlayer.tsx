
import React, { useRef, useState, useEffect } from 'react';
import { MediaFile } from '../types';

interface TVPlayerProps {
    playlist: MediaFile[]; // All non-ad videos
    adverts: MediaFile[];  // Videos in "TV Adverts" folder
    currentVideo?: MediaFile;
    onVideoEnd?: () => void;
    onPlayVideo?: (video: MediaFile) => void;
}

const AD_INTERVAL_SECONDS = 600; // 10 Minutes

const TVPlayer: React.FC<TVPlayerProps> = ({ playlist, adverts, currentVideo, onVideoEnd, onPlayVideo }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackTime, setPlaybackTime] = useState(0); // Tracks time since last ad
    const [isAdBreak, setIsAdBreak] = useState(false);
    const [activeAd, setActiveAd] = useState<MediaFile | null>(null);

    // 1. Handle Playback & Ad Timer
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isPlaying && !isAdBreak) {
            interval = setInterval(() => {
                setPlaybackTime(prev => {
                    if (prev >= AD_INTERVAL_SECONDS) {
                        triggerAdBreak();
                        return 0;
                    }
                    return prev + 1;
                });
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [isPlaying, isAdBreak]);

    const triggerAdBreak = () => {
        if (adverts.length === 0) return; // No ads? Skip.
        console.log("📺 TV AD BREAK STARTED!");
        const randomAd = adverts[Math.floor(Math.random() * adverts.length)];
        setIsAdBreak(true);
        setActiveAd(randomAd);

        if (videoRef.current) videoRef.current.pause(); // Pause main content
    };

    const handleAdEnd = () => {
        console.log("📺 TV AD BREAK ENDED - Resuming Content");
        setIsAdBreak(false);
        setActiveAd(null);
        if (videoRef.current) videoRef.current.play(); // Resume content
    };

    // 2. Main Video Effect
    useEffect(() => {
        if (videoRef.current && currentVideo && !isAdBreak) {
            videoRef.current.src = currentVideo.url;
            videoRef.current.play().catch(e => console.warn("Autoplay blocked", e));
            setIsPlaying(true);
        }
    }, [currentVideo, isAdBreak]);

    return (
        <div className="flex flex-col w-full space-y-4 animate-scale-in">

            {/* MAIN TV SCREEN */}
            <div className="relative w-full aspect-video bg-black rounded-3xl overflow-hidden shadow-2xl border-4 border-gray-900 group">

                {/* AD OVERLAY PLAYER */}
                {isAdBreak && activeAd && (
                    <div className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center">
                        <video
                            src={activeAd.url}
                            autoPlay
                            className="w-full h-full object-contain"
                            onEnded={handleAdEnd}
                        />
                        <div className="absolute top-4 right-4 bg-yellow-500 text-black font-black text-xs px-2 py-1 uppercase tracking-widest animate-pulse">
                            Ad Break
                        </div>
                    </div>
                )}

                {/* REGULAR CONTENT PLAYER */}
                <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    controls={!isAdBreak}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={onVideoEnd}
                    poster="https://via.placeholder.com/640x360.png?text=NDRTV+Signal+Offline"
                />

                {/* TV BRANDING OVERLAY */}
                <div className="absolute top-4 left-4 pointer-events-none">
                    <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-green-600 rounded flex items-center justify-center">
                            <span className="text-white font-black text-[10px]">NDR</span>
                        </div>
                        <span className="text-white/50 font-black text-xs shadow-black drop-shadow-md">TV</span>
                    </div>
                </div>

            </div>

            {/* CHANNEL FOOTER (PLAYLIST) */}
            <div className="bg-gray-900/50 p-4 rounded-xl border border-white/5">
                <h3 className="text-xs font-black text-white/40 uppercase tracking-widest mb-3">Up Next on NDRTV</h3>
                <div className="flex space-x-3 overflow-x-auto pb-2 no-scrollbar scroll-smooth">
                    {playlist.map((vid) => (
                        <button
                            key={vid.id}
                            onClick={() => onPlayVideo?.(vid)}
                            className={`flex-shrink-0 w-32 group relative aspect-video rounded-lg overflow-hidden border-2 transition-all ${currentVideo?.id === vid.id ? 'border-green-500 scale-105' : 'border-transparent hover:border-white/30'}`}
                        >
                            <div className="absolute inset-0 bg-black/60 group-hover:bg-transparent transition-all"></div>
                            <video src={vid.url} className="w-full h-full object-cover pointer-events-none" />
                            <div className="absolute bottom-0 left-0 right-0 p-1 bg-gradient-to-t from-black to-transparent">
                                <p className="text-[8px] text-white font-bold truncate">{vid.name}</p>
                            </div>
                            {currentVideo?.id === vid.id && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <i className="fas fa-play text-white drop-shadow-md"></i>
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            </div>

        </div>
    );
};

export default TVPlayer;
