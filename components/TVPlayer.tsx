
import React, { useRef, useState, useEffect } from 'react';
import { MediaFile } from '../types';

interface TVPlayerProps {
    playlist: MediaFile[]; // All non-ad videos
    adverts: MediaFile[];  // Videos in "TV Adverts" folder
    currentVideo?: MediaFile;
    onVideoEnd?: () => void;
    onPlayVideo?: (video: MediaFile) => void;
    showPlaylist?: boolean;
}

const AD_INTERVAL_SECONDS = 600; // 10 Minutes

const TVPlayer: React.FC<TVPlayerProps> = ({ playlist, adverts, currentVideo, onVideoEnd, onPlayVideo, showPlaylist = true }) => {
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

    const togglePlay = () => {
        if (!videoRef.current) return;
        if (isPlaying) {
            videoRef.current.pause();
        } else {
            videoRef.current.play().catch(e => console.warn("Play failed", e));
        }
        setIsPlaying(!isPlaying);
    };

    // 2. Main Video Effect
    useEffect(() => {
        if (videoRef.current && currentVideo && !isAdBreak) {
            videoRef.current.src = currentVideo.url;
            videoRef.current.load(); // Ensure source is loaded
            videoRef.current.play().catch(e => {
                console.warn("Autoplay blocked or load failed", e);
                setIsPlaying(false);
            });
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
                    className="w-full h-full object-cover cursor-pointer"
                    onClick={togglePlay}
                    controls={false} // Use custom controls or allow overlay
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={onVideoEnd}
                    poster="https://via.placeholder.com/640x360.png?text=NDRTV+Signal+Offline"
                />

                {/* TV BRANDING OVERLAY */}
                <div className="absolute top-4 left-4 pointer-events-none flex flex-col space-y-1">
                    <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-[#008751] rounded flex items-center justify-center shadow-lg border border-white/20">
                            <span className="text-white font-black text-[10px]">NDR</span>
                        </div>
                        <span className="text-white font-black text-xs shadow-black drop-shadow-md">TV</span>
                    </div>
                    {isPlaying && (
                        <div className="flex items-center space-x-1.5 px-2 py-0.5 bg-red-600 rounded-full w-fit shadow-lg animate-pulse border border-white/10">
                            <div className="w-1 h-1 bg-white rounded-full"></div>
                            <span className="text-[6px] text-white font-bold uppercase tracking-widest">Live</span>
                        </div>
                    )}
                </div>

                {/* INITIAL PLAY OVERLAY (Only if not playing) */}
                {!isPlaying && !isAdBreak && (
                    <div
                        onClick={togglePlay}
                        className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 cursor-pointer backdrop-blur-[1px]"
                    >
                        {!currentVideo && (
                            <div className="flex flex-col items-center space-y-2 opacity-50">
                                <i className="fas fa-satellite-dish text-4xl mb-2 text-[#008751]"></i>
                                <span className="text-[10px] text-white font-black uppercase tracking-[4px]">NDRTV: Searching for Signal...</span>
                            </div>
                        )}
                        {currentVideo && !isPlaying && (
                            <div className="flex flex-col items-center space-y-4">
                                <div className="w-14 h-14 flex items-center justify-center rounded-full bg-white/10 border border-white/20 backdrop-blur-md">
                                    <i className="fas fa-play text-white/40"></i>
                                </div>
                                <span className="text-[10px] text-white/40 font-black uppercase tracking-[4px]">Click to Broadast</span>
                            </div>
                        )}
                    </div>
                )}

                {/* PREMIUM CONTROL BAR (Bottom Left) */}
                <div className={`absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black to-transparent flex items-end p-4 transition-all duration-500 ${isPlaying ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                    <div className="flex items-center space-x-4">
                        <button
                            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 text-white transition-all active:scale-90"
                        >
                            <i className={`fas ${isPlaying ? 'fa-pause text-xs' : 'fa-play text-xs ml-0.5'}`}></i>
                        </button>

                        {currentVideo && (
                            <div className="flex flex-col mb-1 select-none">
                                <span className="text-[10px] text-white/30 font-black uppercase tracking-widest leading-none mb-1">Live Channel</span>
                                <span className="text-xs text-white font-black truncate max-w-[250px] leading-none">{currentVideo.name}</span>
                            </div>
                        )}
                    </div>
                </div>

            </div>

            {/* CHANNEL FOOTER (PLAYLIST) - Only shown if enabled (e.g. for Admin) */}
            {showPlaylist && (
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
            )}

        </div>
    );
};

export default TVPlayer;
