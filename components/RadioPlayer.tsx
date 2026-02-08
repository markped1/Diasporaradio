
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
  onInteract
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

      // CRITICAL FIX: Don't set crossOrigin for live streams
      if (targetSrc.startsWith('blob:') || targetSrc.startsWith('data:')) {
        audio.crossOrigin = null;
      } else {
        audio.removeAttribute('crossorigin');
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

        // CRITICAL FIX: Handle crossOrigin properly
        if (isLocal) {
          audioRef.current.crossOrigin = null;
        } else {
          audioRef.current.removeAttribute('crossorigin');
        }

        audioRef.current.src = targetSrc;
        audioRef.current.load();

        if (isPlaying || forcePlaying) {
          // Only init audio context for local files
          if (!isStreamRef.current) {
            initAudioContext();
          }

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
        // Only init audio context for local files
        if (!isStreamRef.current) {
          initAudioContext();
        }

        audioRef.current.play().catch((err) => {
          console.error("Play failed:", err);
          setStatus('ERROR');
          setErrorMessage('Failed to play - Try clicking play again');
        });
      } else if (!forcePlaying && !audioRef.current.paused) {
        audioRef.current.pause();
      }
    }
  }, [forcePlaying]);

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
        // BROADCAST/NEWS: FULL STOP/PAUSE for clarity
        if (isStreamRef.current) {
          if (gainNodeRef.current && audioContextRef.current && audioContextRef.current.state !== 'closed') {
            gainNodeRef.current.gain.setTargetAtTime(0, audioContextRef.current.currentTime, 0.1);
          } else {
            audioRef.current.volume = 0;
          }
        } else {
          audioRef.current.pause();
        }
      }
    } else {
      // RESUME / RESTORE VOLUME
      if (gainNodeRef.current && audioContextRef.current && audioContextRef.current.state !== 'closed') {
        gainNodeRef.current.gain.setTargetAtTime(volumeRef.current, audioContextRef.current.currentTime, 0.5);
      } else {
        audioRef.current.volume = volumeRef.current;
      }

      // If it was a paused local track that should be playing, resume it
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
        setErrorMessage(forcePlaying ? 'Live Syncing... Tap again in 5s' : 'Awaiting Admin Broadcast...');
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

  return (
    <div className="flex flex-col items-center justify-center space-y-2 w-full">
      <Logo size="lg" analyser={analyser} isPlaying={isPlaying} />

      <div className="w-full px-8 -mt-8 relative z-20">
        <div className="h-1 w-full bg-green-100 rounded-full overflow-hidden">
          <div className="h-full bg-[#008751] transition-all duration-300" style={{ width: `${progress}%` }}></div>
        </div>
        {duration > 0 && isFinite(duration) && (
          <div className="flex justify-between mt-1 px-1">
            <span className="text-[6px] font-bold text-green-700">{formatTime(currentTime)}</span>
            <span className="text-[6px] font-bold text-green-700">{formatTime(duration)}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center space-y-3 relative z-20 w-full px-12">
        {/* Track Info Display */}
        <div className="bg-[#008751]/10 px-4 py-2 rounded-full border border-green-200/50 w-full overflow-hidden shadow-inner flex items-center justify-center text-center">
          <span className="text-[7px] font-black uppercase text-green-800 tracking-widest line-clamp-1">
            {(activeTrackUrl || forcePlaying) ? `NOW PLAYING: ${currentTrackName}` : 'AWAITING ADMIN BROADCAST...'}
          </span>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="bg-red-50 px-3 py-1.5 rounded-lg border border-red-200 w-full">
            <p className="text-[8px] font-semibold text-red-600 text-center">{errorMessage}</p>
          </div>
        )}

        <button
          onClick={handlePlayPause}
          className={`w-16 h-16 rounded-full flex items-center justify-center shadow-2xl active:scale-95 transition-all bg-white text-[#008751] border-4 border-[#008751]/10`}
        // REMOVED DISABLED: User can always interrupt a stuck load
        >
          {status === 'LOADING' ? <i className="fas fa-circle-notch fa-spin text-xl"></i> :
            status === 'ERROR' ? <i className="fas fa-redo-alt text-red-500"></i> :
              isPlaying ? <i className="fas fa-pause text-2xl"></i> : <i className="fas fa-play text-2xl ml-1"></i>}
        </button>

        {status === 'LOADING' && (
          <button
            onClick={() => window.location.reload()}
            className="text-[6px] font-black uppercase text-green-900/50 hover:text-green-950 underline underline-offset-2 animate-pulse"
          >
            Stuck? Refresh App
          </button>
        )}

        <div className="w-32 flex items-center space-x-2">
          <i className="fas fa-volume-down text-green-600 text-[8px]"></i>
          <input
            type="range" min="0" max="1" step="0.01" value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="flex-grow h-0.5 bg-green-100 rounded-lg appearance-none accent-[#008751]"
          />
          <i className="fas fa-volume-up text-green-600 text-[8px]"></i>
        </div>
      </div>
    </div>
  );
};

export default RadioPlayer;
