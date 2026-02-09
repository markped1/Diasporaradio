import React, { useState, useEffect } from 'react';
import { speechService } from '../services/speechService';

interface Anchor {
    id: string;
    name: string;
    role: string;
    image: string;
    voiceName?: string;
}

const ANCHORS: Anchor[] = [
    {
        id: 'amaka',
        name: 'Amaka',
        role: 'Chief Correspondent',
        image: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=400&h=500',
    },
    {
        id: 'tunde',
        name: 'Tunde',
        role: 'Prime Time Anchor',
        image: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=400&h=500',
    },
    {
        id: 'chinwe',
        name: 'Chinwe',
        role: 'Political Analyst',
        image: 'https://images.unsplash.com/photo-1589156280159-27698a70f29e?auto=format&fit=crop&q=80&w=400&h=500',
    },
    {
        id: 'bola',
        name: 'Bola',
        role: 'Tech & Business',
        image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=400&h=500',
    }
];

interface NewsroomProps {
    newsContent?: string;
    onBroadcastEnd?: () => void;
    isActive?: boolean;
}

const Newsroom: React.FC<NewsroomProps> = ({ newsContent, onBroadcastEnd, isActive = false }) => {
    const [activeAnchorIdx, setActiveAnchorIdx] = useState(0);
    const [isSpeaking, setIsSpeaking] = useState(false);

    useEffect(() => {
        if (isActive && newsContent && !isSpeaking) {
            startBroadcast();
        }
    }, [isActive, newsContent]);

    const startBroadcast = () => {
        if (!newsContent) return;

        // Randomly pick an anchor for this bulletin
        const idx = Math.floor(Math.random() * ANCHORS.length);
        setActiveAnchorIdx(idx);

        speechService.speak({
            text: newsContent,
            onStart: () => setIsSpeaking(true),
            onEnd: () => {
                setIsSpeaking(false);
                onBroadcastEnd?.();
            },
            onError: (err) => {
                console.error("Newsroom Speech Error:", err);
                setIsSpeaking(false);
                onBroadcastEnd?.();
            }
        });
    };

    return (
        <div className="w-full bg-gradient-to-br from-gray-900 via-green-950 to-black p-6 rounded-3xl border-4 border-gray-800 shadow-2xl overflow-hidden relative">
            {/* News Ticker Overlay */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-red-600 animate-pulse z-20"></div>

            <div className="flex flex-col space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-red-500 uppercase tracking-[4px] animate-pulse">Live Newsroom</span>
                        <h2 className="text-xl font-black text-white italic tracking-tighter">NDRTV BROADCAST CENTRE</h2>
                    </div>
                    <div className="flex items-center space-x-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/10">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-ping"></span>
                        <span className="text-[8px] font-black text-white uppercase tracking-widest">Signal: Stable</span>
                    </div>
                </div>

                {/* Anchors Grid */}
                <div className="grid grid-cols-4 gap-4">
                    {ANCHORS.map((anchor, idx) => {
                        const isCurrent = activeAnchorIdx === idx && isSpeaking;
                        return (
                            <div
                                key={anchor.id}
                                className={`relative group transition-all duration-500 ${isCurrent ? 'scale-105 z-10' : 'opacity-40 grayscale blur-[1px]'}`}
                            >
                                {/* Avatar Container */}
                                <div className={`aspect-[4/5] rounded-2xl overflow-hidden border-2 transition-all duration-500 ${isCurrent ? 'border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.3)]' : 'border-white/10 group-hover:border-white/20'}`}>
                                    <img
                                        src={anchor.image}
                                        alt={anchor.name}
                                        className={`w-full h-full object-cover transition-transform duration-700 ${isCurrent ? 'scale-110' : 'scale-100'}`}
                                    />

                                    {/* Speaking Indicator */}
                                    {isCurrent && (
                                        <div className="absolute top-2 left-2 bg-red-600 text-white text-[7px] font-black px-2 py-0.5 rounded uppercase flex items-center shadow-lg">
                                            <span className="mr-1.5 w-1 h-1 bg-white rounded-full animate-ping"></span>
                                            On Air
                                        </div>
                                    )}
                                </div>

                                {/* Info Box */}
                                <div className={`mt-3 p-2 rounded-xl transition-all duration-500 ${isCurrent ? 'bg-red-600/10 border border-red-500/20' : 'bg-white/5'}`}>
                                    <p className={`text-[10px] font-black uppercase tracking-tight leading-none ${isCurrent ? 'text-white' : 'text-white/40'}`}>{anchor.name}</p>
                                    <p className={`text-[7px] font-bold uppercase tracking-widest mt-1 ${isCurrent ? 'text-red-400' : 'text-white/20'}`}>{anchor.role}</p>
                                </div>

                                {/* Audio Waveform Animation */}
                                {isCurrent && (
                                    <div className="absolute -bottom-1 -left-1 -right-1 flex justify-around items-end h-4 px-4 overflow-hidden">
                                        {[...Array(8)].map((_, i) => (
                                            <div
                                                key={i}
                                                className="w-1 bg-red-500 rounded-full animate-bounce"
                                                style={{ height: `${Math.random() * 100}%`, animationDelay: `${i * 0.1}s` }}
                                            ></div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* News Script Preview */}
                <div className="bg-black/60 backdrop-blur-md rounded-2xl border border-white/5 p-4 relative group">
                    <div className="absolute top-0 left-0 w-1 h-full bg-red-600 rounded-l-2xl shadow-[0_0_15px_rgba(220,38,38,0.5)]"></div>
                    <div className="flex flex-col space-y-2">
                        <div className="flex items-center space-x-2">
                            <i className="fas fa-scroll text-red-500 text-[10px]"></i>
                            <span className="text-[8px] font-black text-white/40 uppercase tracking-[2px]">Teleprompter Feed</span>
                        </div>
                        <p className={`text-[11px] font-medium leading-relaxed italic ${isSpeaking ? 'text-white' : 'text-white/20'}`}>
                            {newsContent || "Awaiting news bulletin sequence initiation..."}
                        </p>
                    </div>
                </div>
            </div>

            {/* Background Texture Overlay */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>
        </div>
    );
};

export default Newsroom;
