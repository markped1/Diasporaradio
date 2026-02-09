import React, { useRef, useState, useEffect } from 'react';
import { MediaFile } from '../types';
import Newsroom from './Newsroom';

interface TVPlayerProps {
    playlist: MediaFile[]; // All non-ad videos
    adverts: MediaFile[];  // Videos in "TV Adverts" folder
    currentVideo?: MediaFile;
    onVideoEnd?: () => void;
    onPlayVideo?: (video: MediaFile) => void;
    showPlaylist?: boolean;
    isNewsroomActive?: boolean;
    newsroomContent?: string;
    onNewsroomEnd?: () => void;
    isExpanded?: boolean;
    onExpandToggle?: (isExpanded: boolean) => void;
}

const AD_INTERVAL_SECONDS = 600; // 10 Minutes

const TVPlayer: React.FC<TVPlayerProps> = ({
    playlist,
    adverts,
    currentVideo,
    onVideoEnd,
    onPlayVideo,
    showPlaylist = true,
    isNewsroomActive,
    newsroomContent,
    onNewsroomEnd,
    isExpanded = false,
    onExpandToggle
}) => {
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
            if (!isExpanded) onExpandToggle?.(true);
        }
        setIsPlaying(!isPlaying);
    };

    const toggleNativeFullscreen = () => {
        if (videoRef.current) {
            if (videoRef.current.requestFullscreen) {
                videoRef.current.requestFullscreen();
            } else if ((videoRef.current as any).webkitRequestFullscreen) {
                (videoRef.current as any).webkitRequestFullscreen();
            }
        }
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
        <div className={`flex flex-col space-y-4 ${isExpanded ? 'fixed inset-0 z-[60] bg-black p-0' : ''}`}>
            {/* EXPAND/CLOSE BUTTONS (MOBILE ONLY) - Visible only when NOT in native full screen but in app expanded state */}
            {isExpanded && (
                <div className="absolute top-4 right-4 z-[70] flex space-x-2">
                    <button onClick={() => onExpandToggle?.(false)} className="bg-white/20 backdrop-blur-md text-white px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border border-white/20">
                        <i className="fas fa-compress-alt mr-2"></i> Minimal
                    </button>
                </div>
            )}
            {/* MAIN TV SCREEN */}
            <div className={`relative w-full bg-black overflow-hidden shadow-2xl border-gray-900 group ${isExpanded ? 'h-full border-0 rounded-0' : 'aspect-video rounded-3xl border-4'}`}>

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
                    controls={false}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={onVideoEnd}
                    poster="https://via.placeholder.com/640x360.png?text=NDRTV+Signal+Offline"
                    playsInline
                    webkit-playsinline="true"
                    muted={!isPlaying}
                />

                {/* TV BRANDING OVERLAY */}
                <div className="absolute top-4 left-4 pointer-events-none flex flex-col space-y-1">
                    <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-[#008751] rounded flex items-center justify-center shadow-lg border border-white/20">
                            <span className="text-white font-black text-[10px]">NDR</span>
                        </div>
                        <span className="text-white font-black text-xs shadow-black drop-shadow-md">TV</span>
                    </div>
                </div>

                {/* LIVE INDICATOR (TOP RIGHT) */}
                {isPlaying && (
                    <div className="absolute top-4 right-4 pointer-events-none flex items-center space-x-1.5 px-3 py-1 bg-red-600 rounded-full w-fit shadow-2xl animate-pulse border border-white/20 z-20">
                        <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                        <span className="text-[7px] text-white font-black uppercase tracking-widest text shadow-sm">Live</span>
                    </div>
                )}

                {/* VIRTUAL NEWSROOM OVERLAY */}
                {isNewsroomActive && (
                    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-scale-in">
                        <div className="w-full max-w-4xl">
                            <Newsroom
                                isActive={isNewsroomActive}
                                newsContent={newsroomContent}
                                onBroadcastEnd={onNewsroomEnd}
                            />
                        </div>
                    </div>
                )}

                {/* INITIAL PLAY OVERLAY */}
                {!isPlaying && !isAdBreak && !isNewsroomActive && (
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
                                <span className="text-[10px] text-white/40 font-black uppercase tracking-[4px]">Click to Broadcast</span>
                            </div>
                        )}
                    </div>
                )}

                {/* PREMIUM CONTROL BAR */}
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
                                <span className="text-xs text-white font-black truncate max-w-[150px] leading-none">{currentVideo.name}</span>
                            </div>
                        )}

                        <div className="flex-grow"></div>

                        <div className="flex items-center space-x-2 mr-2">
                            <button
                                onClick={(e) => { e.stopPropagation(); toggleNativeFullscreen(); }}
                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-white/60"
                                title="Native Fullscreen"
                            >
                                <i className="fas fa-expand"></i>
                            </button>
                            {!isExpanded && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onExpandToggle?.(true); }}
                                    className="px-3 h-8 flex items-center justify-center rounded-lg bg-[#008751]/80 hover:bg-[#008751] text-white text-[8px] font-black uppercase tracking-widest"
                                >
                                    Pop Screen
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* UP NEXT QUEUE */}
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
