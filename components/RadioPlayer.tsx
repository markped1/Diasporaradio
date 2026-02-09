
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { radioEngine } from '../core/RadioEngine';
import { useBroadcast } from '../context/BroadcastContext';
import { DEFAULT_STREAM_URL } from '../constants';
import Logo from './Logo';

interface RadioPlayerProps {
  onStateChange: (isPlaying: boolean) => void;
  activeTrackUrl?: string | null;
  currentTrackName?: string;
  forcePlaying?: boolean;
  onTrackEnded?: () => void;
  onPeakReached?: () => void;
  isAdmin?: boolean;
  isDucking?: boolean;
  duckingType?: 'news' | 'jingle' | null;
  onInteract?: () => void;
  uiMode?: 'full' | 'headless' | 'listener';
  activeFolder?: string | null;
  isExpanded?: boolean;
  onExpandToggle?: (isExpanded: boolean) => void;
}

const RadioPlayer: React.FC<RadioPlayerProps> = ({
  onStateChange,
  activeTrackUrl: propTrackUrl,
  currentTrackName: propTrackName = 'Live Stream',
  forcePlaying = false,
  onTrackEnded,
  onPeakReached,
  isDucking = false,
  duckingType = null,
  onInteract,
  uiMode = 'full',
  activeFolder = null,
  isExpanded = false,
  onExpandToggle
}) => {
  const { broadcast } = useBroadcast();
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [status, setStatus] = useState<'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR'>('IDLE');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const isStreamRef = useRef<boolean>(false);
  const hasPeakTriggeredRef = useRef<boolean>(false);

  const onTrackEndedRef = useRef(onTrackEnded);
  const onPeakReachedRef = useRef(onPeakReached);
  const statusRef = useRef<'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR'>('IDLE');

  useEffect(() => {
    onTrackEndedRef.current = onTrackEnded;
    onPeakReachedRef.current = onPeakReached;
  }, [onTrackEnded, onPeakReached]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Sync state from BroadcastContext
  const activeTrackUrl = broadcast?.activeTrackUrl || null;
  const currentTrackName = broadcast?.activeTrackName || propTrackName;

  // Initialize Audio Engine Callbacks
  useEffect(() => {
    radioEngine.setStatusCallback((newStatus) => {
      setStatus(newStatus);
      if (newStatus === 'PLAYING') setIsPlaying(true);
      if (newStatus === 'IDLE' || newStatus === 'ERROR') setIsPlaying(false);
      if (newStatus === 'ERROR') setErrorMessage('Tap to Retry');
    });

    const timer = setInterval(() => {
      setCurrentTime(radioEngine.getCurrentTime());
      setDuration(radioEngine.getDuration());
    }, 1000);

    return () => {
      clearInterval(timer);
      radioEngine.setStatusCallback(() => { });
    };
  }, []);

  // Sync Volume
  useEffect(() => {
    radioEngine.setVolume(volume);
  }, [volume]);

  // Handle Ducking
  useEffect(() => {
    if (isDucking) {
      radioEngine.setVolume(volume * 0.3);
    } else {
      radioEngine.setVolume(volume);
    }
  }, [isDucking, volume]);

  // Visualizer Setup
  useEffect(() => {
    const audio = radioEngine.getAudioElement();
    if (!audio || analyser) return;

    const initAnalyser = () => {
      try {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioContextRef.current;

        if (!sourceRef.current) {
          sourceRef.current = ctx.createMediaElementSource(audio);
          const newAnalyser = ctx.createAnalyser();
          newAnalyser.fftSize = 256;

          if (!gainNodeRef.current) {
            gainNodeRef.current = ctx.createGain();
            gainNodeRef.current.connect(ctx.destination);
          }

          sourceRef.current.connect(newAnalyser);
          newAnalyser.connect(gainNodeRef.current);
          setAnalyser(newAnalyser);
        }
      } catch (err) {
        console.warn("Visualizer init failed (common for streams):", err);
      }
    };

    if (isPlaying) initAnalyser();
  }, [isPlaying, analyser]);

  const handlePlayPause = async () => {
    if (uiMode === 'listener') {
      onInteract?.();
      // Proactive play attempt to satisfy browser policies via direct user gesture
      if (!isPlaying && broadcast?.activeTrackUrl) {
        radioEngine.play(broadcast.activeTrackUrl);
      } else if (isPlaying) {
        radioEngine.stop();
      }
    } else {
      const nextState = !broadcast?.isPlaying;
      onStateChange(nextState);

      // For Admin: Local immediate feedback
      if (nextState && broadcast?.activeTrackUrl) {
        radioEngine.play(broadcast.activeTrackUrl);
      } else if (!nextState) {
        radioEngine.stop();
      }
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleExpand = () => onExpandToggle?.(!isExpanded);

  if (uiMode === 'headless') return null;

  // 🎧 LISTENER CONSOLE UI (REFINED LOGO + DISPLAY)
  if (uiMode === 'listener') {
    return (
      <div className={`w-full flex flex-col items-center space-y-4 animate-scale-in pb-2 ${isExpanded ? 'fixed inset-0 z-[60] bg-[#f0fff4] p-6 lg:relative lg:inset-auto lg:p-0' : ''}`}>
        {/* EXPAND/CLOSE BUTTONS (MOBILE ONLY) */}
        {!isExpanded ? (
          <div className="w-full flex justify-end px-2 translate-y-2">
            <button onClick={toggleExpand} className="bg-green-100/80 backdrop-blur-sm text-green-800 px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border border-green-200 shadow-sm transition-all hover:bg-green-200 active:scale-95">
              <i className="fas fa-expand-alt mr-1"></i> Full Console
            </button>
          </div>
        ) : (
          <div className="w-full flex justify-end px-2 mb-4">
            <button onClick={toggleExpand} className="bg-white text-green-800 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border border-green-200 shadow-md">
              <i className="fas fa-compress-alt mr-2"></i> Minimal Screen
            </button>
          </div>
        )}

        {/* REFINED LOGO DISPLAY SECTION */}
        <div className="relative flex flex-col items-center justify-center space-y-4 w-full pt-2">
          {/* Animated Glow behind Logo when playing */}
          {isPlaying && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-green-500/20 rounded-full blur-3xl animate-pulse"></div>
          )}

          <div className="relative z-10 scale-90 transition-transform duration-500">
            <Logo size="lg" analyser={analyser} isPlaying={isPlaying} />
          </div>

          {/* STATUS RIBBON */}
          <div className="flex items-center space-x-2 bg-white/40 backdrop-blur-md px-3 py-1 rounded-full border border-green-100 shadow-sm z-20">
            <div className={`w-1.5 h-1.5 rounded-full ${isPlaying ? 'bg-red-500 animate-pulse' : 'bg-gray-400'}`}></div>
            <span className={`text-[7px] font-black uppercase tracking-[0.2em] ${isPlaying ? 'text-red-600' : 'text-gray-500'}`}>
              {isPlaying ? 'Live on Air' : 'Radio Standby'}
            </span>
          </div>
        </div>

        {/* TRACK DISPLAY (MATCHES ADMIN STYLE) */}
        <div className="w-full max-w-sm bg-white p-3 rounded-2xl border-2 border-green-100 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-2 opacity-10">
            <i className="fas fa-tower-broadcast text-xl text-green-800"></i>
          </div>

          <div className="flex flex-col items-center space-y-2 text-center relative z-10">
            <span className="text-[7px] font-black text-green-800/40 uppercase tracking-[0.3em]">Direct Studio Feed</span>

            <div className="bg-green-50/50 py-2.5 px-6 rounded-xl border border-green-100/50 shadow-inner w-full">
              <span className="text-[9px] font-black text-green-950 uppercase block tracking-[0.05em] truncate">
                {activeTrackUrl ? currentTrackName : 'AWAITING BROADCAST...'}
              </span>
            </div>

            {/* Micro Progress Line */}
            <div className="w-full flex items-center space-x-3 mt-1">
              <span className="text-[7px] font-mono text-green-600/40">{formatTime(currentTime)}</span>
              <div className="flex-grow h-1 bg-green-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#008751] transition-all duration-300 shadow-[0_0_5px_rgba(0,135,81,0.5)]" style={{ width: `${progress}%` }}></div>
              </div>
              <span className="text-[7px] font-mono text-green-600/40">{formatTime(duration)}</span>
            </div>
          </div>
        </div>

        {/* REFINED CONTROLS (OPTIMIZED HEIGHT) */}
        <div className="flex items-center space-x-6 w-full justify-center pt-1">
          <button
            onClick={handlePlayPause}
            className={`w-16 h-16 rounded-full flex items-center justify-center shadow-xl active:scale-90 transition-all border-4 ${isPlaying
              ? 'bg-red-600 border-red-500/20 text-white shadow-red-900/10'
              : 'bg-[#008751] border-green-500/20 text-white shadow-green-900/10 hover:bg-green-700'
              }`}
          >
            {status === 'LOADING' ? <i className="fas fa-circle-notch fa-spin text-xl"></i> :
              isPlaying ? <i className="fas fa-pause text-2xl"></i> : <i className="fas fa-play text-2xl ml-1"></i>}
          </button>

          <div className="flex flex-col space-y-2">
            <div className="flex items-center space-x-2">
              <i className="fas fa-volume-up text-green-600/40 text-[9px]"></i>
              <span className="text-[7px] font-black text-green-900/40 uppercase tracking-widest">Gain: {Math.round(volume * 100)}%</span>
            </div>
            <input
              type="range" min="0" max="1" step="0.01" value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-28 h-1 bg-green-100 rounded-full appearance-none accent-[#008751] cursor-pointer"
            />
          </div>
        </div>

        {/* Errors & Prompts */}
        {!isPlaying && forcePlaying && status !== 'LOADING' && (
          <div className="px-4 py-2 bg-red-600/10 border border-red-500/20 rounded-xl animate-bounce">
            <p className="text-[7px] font-black text-red-500 uppercase tracking-widest flex items-center">
              <i className="fas fa-satellite-dish mr-2"></i> Tap to join live broadcast
            </p>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border border-red-100 px-4 py-2 rounded-xl">
            <p className="text-[7px] font-black text-red-600 text-center uppercase tracking-wide">{errorMessage}</p>
          </div>
        )}
      </div>
    );
  }

  if (uiMode === 'headless') return null;

  return (
    <div className="flex flex-col items-center justify-center space-y-2 w-full">
      <Logo size="lg" analyser={analyser} isPlaying={isPlaying} />

      <div className="w-full px-8 -mt-10 relative z-20 opacity-0 pointer-events-none">
        {/* Hidden internal progress bar, replaced by premium display */}
        <div className="h-1 w-full bg-green-100 rounded-full overflow-hidden">
          <div className="h-full bg-[#008751] transition-all duration-300" style={{ width: `${progress}%` }}></div>
        </div>
      </div>

      <div className="flex flex-col items-center space-y-3 relative z-20 w-full px-8">
        {/* 🔥 PREMIUM RADIO DISPLAY */}
        <div className="w-full bg-green-950/90 backdrop-blur-md rounded-2xl border-2 border-green-500/30 p-4 shadow-2xl relative overflow-hidden group">
          {/* Signal Pulse Background */}
          {isPlaying && (
            <div className="absolute top-0 right-0 w-32 h-32 bg-red-600/10 rounded-full -mr-16 -mt-16 animate-ping pointer-events-none"></div>
          )}

          <div className="flex justify-between items-start mb-2">
            <div className="flex flex-col">
              <div className="flex items-center space-x-2">
                <span className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-red-500 animate-pulse' : 'bg-gray-600'}`}></span>
                <span className={`text-[8px] font-black uppercase tracking-[0.2em] ${isPlaying ? 'text-red-400' : 'text-gray-400'}`}>
                  {isPlaying ? 'ON AIR' : 'OFF AIR'}
                </span>
              </div>
              <span className="text-[6px] font-bold text-green-300/50 uppercase tracking-widest mt-1">98.5 MHZ | DIASPORA RELAY</span>
            </div>
            {status === 'LOADING' && <i className="fas fa-circle-notch fa-spin text-green-400 text-[10px]"></i>}
          </div>

          <div className="space-y-1">
            <h4 className="text-[10px] font-black text-white uppercase tracking-wider line-clamp-1 min-h-[1.2rem]">
              {activeFolder ? `REELING: ${activeFolder}` : (currentTrackName || 'NDR RADIO')}
            </h4>
            <div className="flex items-center space-x-2">
              <span className="text-[7px] font-mono text-green-400/80">{formatTime(currentTime)}</span>
              <div className="flex-grow h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-green-400 transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
              <span className="text-[7px] font-mono text-green-400/80">{formatTime(duration)}</span>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <button
            onClick={() => { setErrorMessage(''); handlePlayPause(); }}
            className="bg-red-500/20 px-4 py-2 rounded-xl border border-red-500/40 w-full animate-bounce hover:bg-red-500/30 transition-all"
          >
            <p className="text-[8px] font-black text-red-500 text-center uppercase tracking-wide">
              {errorMessage} <i className="fas fa-play ml-2"></i>
            </p>
          </button>
        )}

        {/* Controls Grid */}
        <div className="flex items-center justify-between w-full px-2 relative">
          {/* JOIN BROADCAST OVERLAY (FOR LISTENERS) */}
          {forcePlaying && !isPlaying && status !== 'LOADING' && (
            <div className="absolute inset-x-0 -top-20 flex flex-col items-center space-y-2 z-50 animate-bounce">
              <span className="text-[7px] font-black text-red-500 bg-white px-3 py-1 rounded-full shadow-sm border border-red-100 uppercase tracking-widest">Signal Detected!</span>
              <button
                onClick={() => { handlePlayPause(); if (!isExpanded) onExpandToggle?.(true); }}
                className="bg-red-500 text-white px-6 py-3 rounded-full font-black text-[9px] uppercase tracking-widest shadow-2xl border-2 border-white/20 flex items-center space-x-2 active:scale-95 transition-all"
              >
                <i className="fas fa-satellite-dish"></i>
                <span>Tap to Tune In Live</span>
              </button>
            </div>
          )}

          <div className="flex items-center space-x-4">
            <button
              onClick={handlePlayPause}
              className={`w-14 h-14 rounded-full flex items-center justify-center shadow-xl active:scale-90 transition-all ${isPlaying ? 'bg-red-500 text-white border-4 border-red-400/20' : 'bg-green-600 text-white border-4 border-green-500/20'
                }`}
            >
              {status === 'LOADING' ? <i className="fas fa-circle-notch fa-spin text-lg"></i> :
                isPlaying ? <i className="fas fa-pause text-xl"></i> : <i className="fas fa-play text-xl ml-1"></i>}
            </button>

            {/* Local Volume for Listeners */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <i className="fas fa-volume-up text-green-600 text-[8px]"></i>
                <span className="text-[6px] font-black text-green-700 uppercase">{Math.round(volume * 100)}%</span>
              </div>
              <input
                type="range" min="0" max="1" step="0.01" value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-24 h-1 bg-green-100 rounded-lg appearance-none accent-green-600 cursor-pointer"
              />
            </div>
          </div>

          {/* Sync Status Badge */}
          <div className="flex flex-col items-end">
            <span className="text-[6px] font-black text-green-900/40 uppercase tracking-tighter">Sync Engine V3.5</span>
            <div className="flex items-center space-x-1 mt-1">
              <div className="flex space-x-0.5">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className={`w-0.5 h-1.5 rounded-full ${isPlaying ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} style={{ animationDelay: `${i * 0.1}s` }}></div>
                ))}
              </div>
              <span className="text-[7px] font-black text-green-700 uppercase">Live Relay</span>
            </div>
          </div>
        </div>

        {status === 'LOADING' && (
          <button
            onClick={() => window.location.reload()}
            className="text-[6px] font-black uppercase text-green-900/50 hover:text-green-950 underline underline-offset-2 animate-pulse"
          >
            Connection hanging? Refresh
          </button>
        )}
      </div>
    </div>
  );
};

export default RadioPlayer;
