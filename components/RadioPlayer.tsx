
import React, { useState, useRef, useEffect } from 'react';
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
}

const RadioPlayer: React.FC<RadioPlayerProps> = ({
  onStateChange,
  activeTrackUrl,
  currentTrackName = 'Live Stream',
  forcePlaying = false,
  onTrackEnded,
  onPeakReached,
  isDucking = false,
  duckingType = null,
  onInteract,
  uiMode = 'full',
  activeFolder = null
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [status, setStatus] = useState<'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR'>('IDLE');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const isStreamRef = useRef<boolean>(false);
  const hasPeakTriggeredRef = useRef<boolean>(false);

  const onTrackEndedRef = useRef(onTrackEnded);
  const onPeakReachedRef = useRef(onPeakReached);
  const statusRef = useRef<'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR'>('IDLE');
  const volumeRef = useRef(volume);

  useEffect(() => {
    onTrackEndedRef.current = onTrackEnded;
    onPeakReachedRef.current = onPeakReached;
  }, [onTrackEnded, onPeakReached]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  const initAudioContext = () => {
    try {
      if (!audioRef.current) return;

      // Don't create audio context for live streams initially
      // Some streams have issues with MediaElementSource
      if (isStreamRef.current) return;

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(console.warn);
      }

      if (!gainNodeRef.current) {
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        gainNodeRef.current = gain;
      }

      if (!sourceRef.current) {
        try {
          sourceRef.current = ctx.createMediaElementSource(audioRef.current);
          const newAnalyser = ctx.createAnalyser();
          newAnalyser.fftSize = 256;

          sourceRef.current.connect(newAnalyser);
          newAnalyser.connect(gainNodeRef.current!);
          setAnalyser(newAnalyser);
        } catch (err) {
          console.warn("MediaElementSource creation failed:", err);
          // Continue without visualizer for streams
        }
      }
    } catch (e) {
      console.error("Audio Initialization Failure:", e);
    }
  };

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    const handlePlay = () => {
      setStatus('PLAYING');
      setIsPlaying(true);
      onStateChange(true);
      setErrorMessage('');
    };

    const handlePause = () => {
      setStatus('IDLE');
      setIsPlaying(false);
      onStateChange(false);
    };

    const handleError = (e: Event) => {
      const target = e.target as HTMLAudioElement;
      let message = 'Playback error';

      if (target.error) {
        switch (target.error.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            message = 'Playback aborted';
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            message = 'Network error - Check your connection';
            break;
          case MediaError.MEDIA_ERR_DECODE:
            message = 'Audio format not supported';
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            message = 'Stream URL not accessible or invalid';
            break;
        }
      }

      console.error("Audio Playback Error:", message, target.error);

      // CORS FALLBACK: If source not supported and we have crossOrigin enabled, try disabling it
      if (target.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && target.crossOrigin === 'anonymous') {
        console.warn("CORS/Source error detected - Attempting fallback without anonymous crossOrigin");
        target.removeAttribute('crossorigin');
        const currentSrc = target.src;
        target.src = ''; // Force reset
        target.load();
        target.src = currentSrc;
        target.play().catch(err => console.error("Fallback play failed:", err));
        return; // Don't set error state yet
      }

      setErrorMessage(message);
      setStatus('ERROR');
      setIsPlaying(false);
      onStateChange(false);
    };

    const handleCanPlay = () => {
      console.log("Stream ready to play");
      if (statusRef.current === 'LOADING') {
        setStatus('IDLE');
      }
    };

    const handleLoadStart = () => {
      console.log("Loading stream...");
      setStatus('LOADING');
      // Reset peak trigger for new track
      hasPeakTriggeredRef.current = false;
    };

    const handleTimeUpdate = () => {
      if (!audioRef.current) return;
      const cur = audioRef.current.currentTime;
      const dur = audioRef.current.duration;
      setCurrentTime(cur);

      // Peak Insertion Logic (Midway of song)
      if (dur > 30 && !hasPeakTriggeredRef.current && cur >= dur / 2) {
        hasPeakTriggeredRef.current = true;
        onPeakReachedRef.current?.();
      }
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);
    audio.addEventListener('waiting', () => setStatus('LOADING'));
    audio.addEventListener('playing', handlePlay);
    audio.addEventListener('ended', () => onTrackEndedRef.current?.());
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('loadstart', handleLoadStart);

    const targetSrc = activeTrackUrl;
    if (targetSrc) {
      isStreamRef.current = !targetSrc.startsWith('blob:') && !targetSrc.startsWith('data:');

      // Use 'anonymous' for cloud URLs to allow Web Audio API processing
      if (targetSrc.startsWith('blob:') || targetSrc.startsWith('data:')) {
        audio.crossOrigin = null;
      } else {
        audio.crossOrigin = 'anonymous';
      }

      audio.src = targetSrc;
      audio.preload = 'none';
    }

    return () => {
      audio.pause();
      audio.src = "";
      audio.removeAttribute('src');
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      const targetSrc = activeTrackUrl;
      if (targetSrc && audioRef.current.src !== targetSrc) {
        const isLocal = targetSrc.startsWith('blob:') || targetSrc.startsWith('data:');
        isStreamRef.current = !isLocal;

        // Use 'anonymous' for cloud URLs to allow Web Audio API processing
        if (isLocal) {
          audioRef.current.crossOrigin = null;
        } else {
          audioRef.current.crossOrigin = 'anonymous';
        }

        audioRef.current.src = targetSrc;
        audioRef.current.load();

        if (isPlaying || forcePlaying) {
          // ALWAYS attempt to init audio context to unblock browser audio and enable gain/analyzer
          initAudioContext();

          audioRef.current.play().catch(err => {
            console.warn("Autoplay blocked or stream error:", err);
            setStatus('IDLE');
          });
        }
      }
    }
  }, [activeTrackUrl]);

  useEffect(() => {
    if (audioRef.current) {
      if (forcePlaying && audioRef.current.paused) {
        if (!activeTrackUrl) {
          console.warn("Force playing requested but no URL - Resetting to IDLE");
          setStatus('IDLE');
          setIsPlaying(false); // Ensure state is synced
          return;
        }
        // ALWAYS attempt to init audio context to unblock browser audio and enable gain/analyzer
        initAudioContext();

        audioRef.current.play().catch((err) => {
          console.error("Audio Engine Play Failure:", err.message, err);
          setStatus('ERROR');
          setErrorMessage(`Playback Blocked: Tap to Unmute`);
        });
      } else if (!forcePlaying && !audioRef.current.paused) {
        audioRef.current.pause();
        setStatus('IDLE');
      }
    }
  }, [forcePlaying]);

  useEffect(() => {
    let watchDog: number;
    if (status === 'LOADING') {
      watchDog = window.setTimeout(() => {
        if (statusRef.current === 'LOADING') {
          console.warn("Loading watchdog triggered - Resetting player");
          setStatus('IDLE');
          setErrorMessage('Finding signal... Tap Play to retry');
        }
      }, 10000); // 10s timeout
    }
    return () => clearTimeout(watchDog);
  }, [status]);

  useEffect(() => {
    if (!audioRef.current) return;

    if (isDucking) {
      if (duckingType === 'jingle') {
        // JINGLE DUCKING: Reduce volume to 30% instead of full stop
        if (gainNodeRef.current && audioContextRef.current && audioContextRef.current.state !== 'closed') {
          gainNodeRef.current.gain.setTargetAtTime(volumeRef.current * 0.3, audioContextRef.current.currentTime, 0.4);
        } else {
          audioRef.current.volume = volumeRef.current * 0.3;
        }
        // If it was playing, keep it playing (just quieter)
        if (!isStreamRef.current && isPlaying && audioRef.current.paused) {
          audioRef.current.play().catch(console.warn);
        }
      } else {
        // BROADCAST/NEWS: MUTE for clarity (Don't pause, so we don't trigger 'pause' events and clear state)
        if (gainNodeRef.current && audioContextRef.current && audioContextRef.current.state !== 'closed') {
          gainNodeRef.current.gain.setTargetAtTime(0, audioContextRef.current.currentTime, 0.1);
        } else {
          audioRef.current.volume = 0;
        }
      }
    } else {
      // RESUME / RESTORE VOLUME
      const targetVolume = volumeRef.current;
      if (gainNodeRef.current && audioContextRef.current && audioContextRef.current.state !== 'closed') {
        gainNodeRef.current.gain.setTargetAtTime(targetVolume, audioContextRef.current.currentTime, 0.5);
      } else {
        audioRef.current.volume = targetVolume;
      }

      // If it's a paused local track that should be playing, resume it
      if (!isStreamRef.current && isPlaying && audioRef.current.paused) {
        audioRef.current.play().catch(err => console.warn("Auto-resume failed:", err));
      }
    }
  }, [isDucking, duckingType, volume, isPlaying]);

  // Removed local statusRef here as it's now at top level

  const handlePlayPause = async () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      // NUCLEAR RESET: Clear previous errors and force a fresh load
      setErrorMessage('');
      setStatus('LOADING');

      const targetSrc = activeTrackUrl;
      if (!targetSrc) {
        setStatus('IDLE');
        setErrorMessage('');
        return;
      }

      // Force refresh the source to break any "stuck" state
      audioRef.current.src = "";
      audioRef.current.load();
      audioRef.current.src = targetSrc;

      // Watchdog: Even shorter 4s reset
      const timeoutId = setTimeout(() => {
        if (statusRef.current === 'LOADING') {
          console.warn("Watchdog: Loading took too long. Resetting.");
          setStatus('IDLE');
          setErrorMessage('Connection slow. Try Reconnecting or Refreshing.');
        }
      }, 4000);

      try {
        if (!isStreamRef.current) {
          initAudioContext();
        } else if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
          audioContextRef.current.resume().catch(console.warn);
        }

        await audioRef.current.play();
        onInteract?.();
        clearTimeout(timeoutId);
      } catch (err: any) {
        clearTimeout(timeoutId);
        console.error("Play error:", err);
        setStatus('ERROR');
        // Vercel/Auth detection
        if (err.message?.includes('401') || err.message?.includes('authentication')) {
          setErrorMessage('Vercel Authentication is blocking player. Disable it in Vercel Settings.');
        } else {
          setErrorMessage('Tap to Play again');
        }
      }
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (uiMode === 'headless') return null;

  // 🎧 LISTENER CONSOLE UI (IMMERSIVE MODE)
  if (uiMode === 'listener') {
    return (
      <div className="w-full flex flex-col items-center space-y-6 animate-scale-in pb-4">
        {/* TOP STATION HEADER */}
        <div className="flex flex-col items-center space-y-1 mb-2">
          <div className="flex items-center space-x-3">
            <div className={`w-3 h-3 rounded-full ${isPlaying ? 'bg-red-500 animate-ping shadow-[0_0_10px_rgba(239,68,68,0.8)]' : 'bg-gray-700'}`}></div>
            <h2 className={`text-sm font-black uppercase tracking-[0.4em] ${isPlaying ? 'text-red-500' : 'text-gray-500'}`}>
              {isPlaying ? 'ON-AIR STUDIO' : 'STATION STANDBY'}
            </h2>
          </div>
          <span className="text-[7px] font-black text-green-900/40 uppercase tracking-widest">Digital Satellite Relay Hub</span>
        </div>

        {/* PROPER RADIO CHASSIS */}
        <div className="w-full bg-[#050505] rounded-[2.5rem] border-[4px] border-green-900/30 p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden ring-1 ring-white/10">
          {/* Signal Grid Background */}
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#008751 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>

          <div className="relative z-10 space-y-8">
            {/* Frequency & Signal Display */}
            <div className="flex justify-between items-end border-b border-green-500/10 pb-6">
              <div className="flex flex-col">
                <span className="text-[8px] font-black text-green-500/50 uppercase mb-2">Frequency Indicator</span>
                <div className="flex items-baseline space-x-1">
                  <span className="text-4xl font-black text-green-400 font-mono tracking-tighter">98.50</span>
                  <span className="text-lg font-black text-green-600 font-mono">MHz</span>
                </div>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[8px] font-black text-green-500/50 uppercase mb-2">Signal Strength</span>
                <div className="flex items-end space-x-1 h-8">
                  {[0.4, 0.6, 0.8, 0.5, 0.9, 0.7].map((h, i) => (
                    <div
                      key={i}
                      className={`w-1.5 rounded-t-sm transition-all duration-500 ${isPlaying ? 'bg-green-400' : 'bg-green-900/30'}`}
                      style={{ height: isPlaying ? `${h * 100}%` : '20%', opacity: 0.3 + (h * 0.7) }}
                    ></div>
                  ))}
                </div>
              </div>
            </div>

            {/* Main Visualizer & Info Area */}
            <div className="h-40 bg-black/40 rounded-3xl border border-white/5 relative flex flex-col items-center justify-center p-6 text-center overflow-hidden">
              {isPlaying && <div className="absolute inset-0 bg-green-500/5 blur-3xl rounded-full"></div>}

              <div className="relative z-20 space-y-4 w-full">
                <div className="flex flex-col space-y-1">
                  <span className="text-[7px] font-black text-green-500/40 uppercase tracking-[0.3em]">Currently Receiving</span>
                  <h3 className="text-sm font-black text-white/90 uppercase tracking-widest line-clamp-2 min-h-[1.5rem] leading-tight px-4">
                    {activeTrackUrl ? currentTrackName : 'SCANNING FOR BROADCAST...'}
                  </h3>
                </div>

                <div className="flex items-center justify-center space-x-4">
                  <span className="text-[9px] font-mono text-green-400">{formatTime(currentTime)}</span>
                  <div className="w-48 h-1 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" style={{ width: `${progress}%` }}></div>
                  </div>
                  <span className="text-[9px] font-mono text-green-500/50">{formatTime(duration)}</span>
                </div>
              </div>

              {/* Integrated Visualizer */}
              <div className="absolute inset-0 z-10 pointer-events-none opacity-40">
                <Logo size="lg" isPlaying={isPlaying} analyser={analyser} className="opacity-20 scale-150 rotate-12" />
              </div>
            </div>

            {/* Master Play / Control Section */}
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center space-x-6">
                <button
                  onClick={handlePlayPause}
                  className={`w-20 h-20 rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-all border-[6px] ${isPlaying
                    ? 'bg-red-600 border-red-500/20 text-white shadow-[0_0_30px_rgba(220,38,38,0.4)]'
                    : 'bg-green-600 border-green-500/20 text-white shadow-[0_0_30px_rgba(22,163,74,0.3)] hover:bg-green-500'
                    }`}
                >
                  {status === 'LOADING' ? <i className="fas fa-circle-notch fa-spin text-2xl"></i> :
                    isPlaying ? <i className="fas fa-pause text-3xl"></i> : <i className="fas fa-play text-3xl ml-1"></i>}
                </button>

                <div className="flex flex-col space-y-2">
                  <div className="flex items-center space-x-3">
                    <i className="fas fa-volume-high text-green-500/50 text-[10px]"></i>
                    <span className="text-[8px] font-black text-white/40 uppercase tracking-widest">Receiver Gain: {Math.round(volume * 100)}%</span>
                  </div>
                  <input
                    type="range" min="0" max="1" step="0.01" value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-40 h-1.5 bg-white/5 rounded-full appearance-none accent-green-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Engine Status Badge */}
              <div className="text-right flex flex-col items-end opacity-40">
                <span className="text-[6px] font-black text-white uppercase tracking-tighter">Receiver Protocol v4.0</span>
                <span className="text-[7px] font-mono text-green-500 uppercase mt-1">Status: {status}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Interaction Prompt (if not playing yet) */}
        {!isPlaying && forcePlaying && (
          <div className="px-6 py-3 bg-red-600/10 border border-red-500/30 rounded-2xl animate-bounce">
            <p className="text-[8px] font-black text-red-500 uppercase tracking-widest flex items-center">
              <i className="fas fa-satellite-dish mr-2"></i> Tap the Play Console to Tune in
            </p>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-950/50 border border-red-500/50 p-4 rounded-2xl w-full">
            <p className="text-[8px] font-black text-red-400 text-center uppercase leading-tight">{errorMessage}</p>
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
              {activeFolder ? `REELING: ${activeFolder}` : (activeTrackUrl ? currentTrackName : 'STATION STANDBY')}
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
            <div className="absolute inset-x-0 -top-16 flex justify-center z-50 animate-bounce">
              <button
                onClick={handlePlayPause}
                className="bg-red-500 text-white px-6 py-3 rounded-full font-black text-[9px] uppercase tracking-widest shadow-2xl border-2 border-white/20 flex items-center space-x-2"
              >
                <i className="fas fa-satellite-dish"></i>
                <span>Join Live Broadcast</span>
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
