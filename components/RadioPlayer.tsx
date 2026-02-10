
import React, { useState, useRef, useEffect } from 'react';
import { mediaEngine } from '../core/MediaEngine';
import { useBroadcast } from '../context/BroadcastContext';
import Logo from './Logo';

interface RadioPlayerProps {
  onStateChange: (isPlaying: boolean) => void;
  uiMode?: 'full' | 'headless' | 'listener';
  onInteract?: () => void;
  isExpanded?: boolean;
  onExpandToggle?: (isExpanded: boolean) => void;
}

const RadioPlayer: React.FC<RadioPlayerProps> = ({
  onStateChange,
  onInteract,
  uiMode = 'full',
  isExpanded = false,
  onExpandToggle
}) => {
  const { broadcast } = useBroadcast();
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [status, setStatus] = useState<'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR'>('IDLE');

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // Sync Broadcast Status from Server
  const isLive = broadcast?.broadcastStatus === 'LIVE';
  const isTv = broadcast?.broadcastMode === 'TV';

  useEffect(() => {
    mediaEngine.setStatusCallback((newStatus) => {
      setStatus(newStatus);
      if (newStatus === 'PLAYING') setIsPlaying(true);
      if (newStatus === 'IDLE' || newStatus === 'ERROR') {
        if (uiMode !== 'admin') setIsPlaying(false);
      }
    });
    return () => mediaEngine.setStatusCallback(() => { });
  }, [uiMode]);

  useEffect(() => {
    mediaEngine.setVolume(volume);
  }, [volume]);

  const handlePlayPause = async () => {
    console.log("🖱️ [RadioPlayer] Play/Pause clicked. Live:", isLive, "Playing:", isPlaying);
    onInteract?.();

    if (uiMode === 'listener') {
      if (!isPlaying) {
        // RECONSTRUCTION: Interaction triggers audio context and signaling immediately
        mediaEngine.resume();

        // Start Receiver
        import('../core/RadioReceiver').then(m => {
          m.radioReceiver.setOnStream((stream) => {
            console.log("🔥 [Receiver] Stream acquired. Tracks:", stream.getTracks().length);

            // Attach to Video if available and we are in TV mode
            if (isTv && videoRef.current) {
              videoRef.current.srcObject = stream;
              videoRef.current.play().catch(e => console.warn("Video play blocked:", e));
            }

            // Attach to MediaEngine for Audio
            mediaEngine.playStream(stream);
            setIsPlaying(true);
          });
          m.radioReceiver.connect();
        });

        // V3 SPEC: Always progress to PLAYING state visually on click if LIVE
        setIsPlaying(true);
        setStatus('LOADING');
      } else {
        import('../core/RadioReceiver').then(m => m.radioReceiver.disconnect());
        mediaEngine.stop();
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
        setIsPlaying(false);
        setStatus('IDLE');
      }
    } else {
      // ADMIN MODE
      const nextState = !isPlaying;
      setIsPlaying(nextState);
      onStateChange(nextState);
    }
  };

  if (uiMode === 'headless') return null;

  return (
    <div className={`w-full flex flex-col items-center space-y-4 ${isExpanded ? 'fixed inset-0 z-[60] bg-black/95 p-6' : ''}`}>
      {/* TV Viewport (Only visible in Full/Expanded mode or when TV is active) */}
      {(isTv || isExpanded) && (
        <div className={`relative w-full aspect-video bg-black rounded-2xl overflow-hidden border-2 border-white/10 shadow-2xl transition-all ${isExpanded ? 'max-w-4xl' : 'max-w-sm'}`}>
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            playsInline
            muted={false}
          />
          {!isPlaying && isLive && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <button
                onClick={handlePlayPause}
                className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center text-white text-3xl shadow-red-600/50 shadow-2xl hover:scale-110 transition-transform"
              >
                <i className="fas fa-play ml-1"></i>
              </button>
            </div>
          )}
          {isLive && isPlaying && (
            <div className="absolute top-4 left-4 bg-red-600 px-3 py-1 rounded-md flex items-center space-x-2 animate-pulse">
              <div className="w-2 h-2 bg-white rounded-full"></div>
              <span className="text-[10px] font-black text-white uppercase tracking-widest">LIVE TV</span>
            </div>
          )}
        </div>
      )}

      {/* Radio Logo & Visualizer */}
      {!isTv && (
        <div className="relative pt-4">
          <Logo size={isExpanded ? "lg" : "md"} analyser={analyser} isPlaying={isPlaying} />
          {isLive && (
            <div className="absolute -bottom-2 translate-x-1/2 right-1/2 bg-white/10 backdrop-blur-md px-3 py-0.5 rounded-full border border-white/20">
              <span className="text-[8px] font-black text-green-400 uppercase tracking-widest">Signal Ready</span>
            </div>
          )}
        </div>
      )}

      {/* Unified Control Bar */}
      <div className="flex flex-col items-center space-y-4 w-full max-w-sm">
        <div className="flex items-center space-x-8">
          <button
            onClick={handlePlayPause}
            disabled={!isLive && !isPlaying}
            className={`w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-all border-4 ${!isLive && !isPlaying
                ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
                : isPlaying
                  ? 'bg-red-600 border-red-500/20 text-white hover:bg-red-700'
                  : 'bg-green-600 border-green-500/20 text-white hover:bg-green-700'
              }`}
          >
            {status === 'LOADING' ? <i className="fas fa-circle-notch fa-spin text-2xl"></i> :
              isPlaying ? <i className="fas fa-pause text-3xl"></i> : <i className="fas fa-play text-3xl ml-1"></i>}
          </button>

          <div className="flex flex-col space-y-2">
            <div className="flex items-center space-x-2">
              <i className="fas fa-volume-up text-white/40 text-[10px]"></i>
              <span className="text-[8px] font-black text-white/60 uppercase tracking-widest">Output Level</span>
            </div>
            <input
              type="range" min="0" max="1" step="0.01" value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-32 h-1.5 bg-white/10 rounded-full appearance-none accent-green-500 cursor-pointer"
            />
          </div>
        </div>

        {/* Global Status Text */}
        <div className="text-center">
          <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${isLive ? 'text-green-400' : 'text-gray-500'}`}>
            {isLive ? (isTv ? 'NDR Global TV Broadcast' : 'NDR International Radio') : 'Station Offline'}
          </p>
          {isLive && isPlaying && (
            <p className="text-[8px] text-white/40 uppercase tracking-widest mt-1">
              {status === 'LOADING' ? 'Decrypting Stream...' : 'Stable Connection • HQ Clear'}
            </p>
          )}
        </div>
      </div>

      {/* Expand/Close Toggle (Optional) */}
      {onExpandToggle && (
        <button
          onClick={() => onExpandToggle(!isExpanded)}
          className="bg-white/5 hover:bg-white/10 text-white/40 px-6 py-2 rounded-full text-[9px] font-black uppercase tracking-widest border border-white/10 transition-all mt-4"
        >
          {isExpanded ? 'Minimize View' : 'Theater Mode'}
        </button>
      )}
    </div>
  );
};

export default RadioPlayer;
