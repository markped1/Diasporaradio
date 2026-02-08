
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ListenerView from './components/ListenerView';
import AdminView from './components/AdminView';
import PasswordModal from './components/PasswordModal';
import RadioPlayer from './components/RadioPlayer';
import { dbService } from './services/dbService';
import { app as firebaseApp } from './services/firebaseConfig'; // Initialize Firebase
import { scanNigerianNewspapers } from './services/newsAIService';
import { checkApiKey } from './services/geminiService';
import { getDetailedBulletinAudio, getNewsAudio, getJingleAudio, getDiscussionAudio } from './services/aiDjService';
import { UserRole, MediaFile, AdminMessage, AdminLog, NewsItem, ListenerReport, MidwayState } from './types';
import { DESIGNER_NAME, APP_NAME, JINGLE_1, JINGLE_2, DEFAULT_STREAM_URL, CHANNEL_INTRO } from './constants';

const App: React.FC = () => {
  const [role, setRole] = useState<UserRole>(UserRole.LISTENER);
  const [showAuth, setShowAuth] = useState(false);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [sponsoredMedia, setSponsoredMedia] = useState<MediaFile[]>([]);
  const [audioPlaylist, setAudioPlaylist] = useState<MediaFile[]>([]);
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([]);
  const [reports, setReports] = useState<ListenerReport[]>([]);
  const [initError, setInitError] = useState<string | null>(null);

  const [isRadioPlaying, setIsRadioPlaying] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [activeTrackUrl, setActiveTrackUrl] = useState<string | null>(null);
  const [currentTrackName, setCurrentTrackName] = useState<string>('Live Stream');
  const [isShuffle, setIsShuffle] = useState(true);
  const [isDucking, setIsDucking] = useState(false);
  const [duckingType, setDuckingType] = useState<'news' | 'jingle' | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<string>("Global");

  const aiAudioContextRef = useRef<AudioContext | null>(null);
  const isSyncingRef = useRef(false);
  const pendingAudioRef = useRef<Uint8Array | null>(null);
  const lastBroadcastMarkerRef = useRef<string>("");
  const lastBroadcastIdRef = useRef<string>("");
  const lastProcessedPulseRef = useRef<number>(0);
  const mediaUrlCache = useRef<Map<string, string>>(new Map());
  const playlistRef = useRef<MediaFile[]>([]);

  useEffect(() => {
    playlistRef.current = audioPlaylist;
    // Try to get precise location for weather
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        // We'll use coordinates for weather search grounding
        setCurrentLocation(`${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`);
      });
    }
  }, [audioPlaylist]);

  const cleanTrackName = (name: string) => {
    return name.replace(/\.(mp3|wav|m4a|aac|ogg|flac|webm|wma)$/i, '');
  };

  const fetchData = useCallback(async () => {
    try {
      const [n, l, m, msg, rep] = await Promise.all([
        dbService.getNews(), dbService.getLogs(), dbService.getMedia(), dbService.getAdminMessages(), dbService.getReports()
      ]);

      const mediaItems = m || [];
      const processedMedia = mediaItems.map(item => {
        if (item.file) {
          let url = mediaUrlCache.current.get(item.id);
          if (!url) {
            url = URL.createObjectURL(item.file);
            mediaUrlCache.current.set(item.id, url);
          }
          return { ...item, url };
        }
        return item;
      });

      setNews(n || []);
      setLogs(l || []);
      setSponsoredMedia(processedMedia.filter(item => item.type === 'video' || item.type === 'image'));
      setAudioPlaylist(processedMedia.filter(item => item.type === 'audio'));
      setAdminMessages(msg || []);
      setReports(rep || []);

      if (activeTrackId) {
        const activeTrack = processedMedia.find(t => t.id === activeTrackId);
        if (activeTrack) setActiveTrackUrl(activeTrack.url);
      }
    } catch (err: any) {
      console.error("Data fetch error", err);
      setInitError(err.message || "Failed to connect to the radio server. Check your connection or credentials.");
    }
  }, [activeTrackId]);

  const playRawPcm = useCallback(async (audioData: Uint8Array, type: 'news' | 'jingle' = 'news'): Promise<void> => {
    if (!audioData || audioData.byteLength < 100) return Promise.resolve();

    if (!hasInteracted) {
      console.log("Audio skipped: No user interaction yet");
      pendingAudioRef.current = audioData;
      return Promise.resolve();
    }

    return new Promise(async (resolve) => {
      try {
        if (!aiAudioContextRef.current || aiAudioContextRef.current.state === 'closed') {
          aiAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          (window as any).aiAudioContext = aiAudioContextRef.current;
        }
        const ctx = aiAudioContextRef.current;
        (window as any).aiAudioContext = ctx;

        if (ctx.state === 'suspended') {
          console.log("AudioContext is suspended. Attempting resume...");
          await ctx.resume().catch(e => console.error("Resume failed:", e));
          // Wait a tiny bit for state change
          await new Promise(r => setTimeout(r, 100));
        }

        console.log("Current AI AudioContext state:", ctx.state);
        if (ctx.state !== 'running') {
          console.warn("AudioContext NOT running. Sound may be blocked. State:", ctx.state);
        }

        setIsDucking(true);
        setDuckingType(type);
        console.log(`Attempting to play ${type} audio, length: ${audioData.byteLength}`);

        let decodedBuffer: AudioBuffer;

        try {
          // First attempt: Standard Decoding (handles MP3, WAV, etc.)
          // We need a clone because decodeAudioData consumes the buffer
          const bufferToDecode = audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength);
          decodedBuffer = await ctx.decodeAudioData(bufferToDecode);
          console.log(`Audio decoded successfully. Duration: ${decodedBuffer.duration.toFixed(2)}s`);
        } catch (decodeErr) {
          console.warn("Standard decoding failed, falling back to raw PCM 24k mono logic", decodeErr);
          // Fallback: Raw Int16 PCM 24000Hz Mono
          const alignedBuffer = audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength);
          const dataInt16 = new Int16Array(alignedBuffer);
          const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
          const channelData = buffer.getChannelData(0);
          for (let i = 0; i < dataInt16.length; i++) {
            channelData[i] = dataInt16[i] / 32768.0;
          }
          decodedBuffer = buffer;
        }

        const source = ctx.createBufferSource();
        source.buffer = decodedBuffer;
        source.connect(ctx.destination);
        source.onended = () => {
          setIsDucking(false);
          setDuckingType(null);
          resolve();
        };
        source.start();
      } catch (err) {
        console.error("AI Audio Playback Error:", err);
        setIsDucking(false);
        setDuckingType(null);
        resolve();
      }
    });
  }, [hasInteracted, role]);

  const runScheduledBroadcast = useCallback(async (isBrief: boolean) => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    try {
      console.log(`Starting ${isBrief ? 'Headline' : 'Detailed'} News & Weather Broadcast...`);

      // Step 1: Fetch fresh data (News + Weather)
      const { news: freshNews, weather } = await scanNigerianNewspapers(currentLocation);
      await fetchData();

      if (freshNews.length > 0) {
        // Step 2: Play Intro Jingle
        const intro = await getJingleAudio(JINGLE_1);
        if (intro) await playRawPcm(intro, 'jingle');

        // Step 3: Generate and Play AI Audio
        const hostName = isBrief ? "Thompson Obosa" : "Sara Obosa";
        const audioData = await getDetailedBulletinAudio({
          location: currentLocation,
          localTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          newsItems: freshNews.slice(0, 5),
          hostName: hostName,
          weather: weather,
          isBrief: isBrief
        });

        if (audioData) {
          await playRawPcm(audioData, 'news');
          dbService.addLog({
            id: Date.now().toString(),
            action: `${isBrief ? 'Headline' : 'Detailed'} Broadcast triggered at ${new Date().toLocaleTimeString()}`,
            timestamp: Date.now()
          });
        }

        // Step 4: Play Outro Jingle
        const outro = await getJingleAudio(JINGLE_2);
        if (outro) await playRawPcm(outro, 'jingle');
      }
    } catch (err) {
      console.error("Scheduled broadcast failed", err);
    } finally {
      isSyncingRef.current = false;
    }
  }, [currentLocation, fetchData, playRawPcm]);

  // Precise Heartbeat Scheduler
  useEffect(() => {
    const heartbeat = setInterval(() => {
      const now = new Date();
      const currentMinute = now.getMinutes();
      const timeTag = `${now.getHours()}:${currentMinute}`;

      // :00 = Detailed News & Weather
      if (currentMinute === 0 && lastBroadcastMarkerRef.current !== timeTag) {
        lastBroadcastMarkerRef.current = timeTag;
        runScheduledBroadcast(false);
      }
      // :30 = Headline News & Weather
      else if (currentMinute === 30 && lastBroadcastMarkerRef.current !== timeTag) {
        lastBroadcastMarkerRef.current = timeTag;
        runScheduledBroadcast(true);
      }
      // :15 & :45 = Admin Discussion Relay
      else if ((currentMinute === 15 || currentMinute === 45) && lastBroadcastMarkerRef.current !== timeTag) {
        lastBroadcastMarkerRef.current = timeTag;
        handleScheduledDiscussion();
      }
    }, 1000); // Checking every second for precise start

    return () => clearInterval(heartbeat);
  }, [runScheduledBroadcast]);

  const activeTrackIdRef = useRef<string | null>(null);
  const isRadioPlayingRef = useRef<boolean>(false);

  useEffect(() => {
    activeTrackIdRef.current = activeTrackId;
    isRadioPlayingRef.current = isRadioPlaying;
  }, [activeTrackId, isRadioPlaying]);

  // Midway Sync Logic (Supabase Realtime)
  const handleSyncUpdate = useCallback((remoteState: MidwayState) => {
    console.log("Sync Update Received:", {
      id: remoteState.activeTrackId,
      name: remoteState.activeTrackName,
      playing: remoteState.isPlaying,
      pulse: remoteState.broadcastPulse
    });

    // 1. Sync Playback State
    if (remoteState.isPlaying !== isRadioPlayingRef.current) {
      setIsRadioPlaying(remoteState.isPlaying);
    }

    // 2. Sync Track Info
    if (remoteState.activeTrackId !== activeTrackIdRef.current || remoteState.activeTrackName !== currentTrackName) {
      if (remoteState.activeTrackUrl) {
        setActiveTrackId(remoteState.activeTrackId);
        setActiveTrackUrl(remoteState.activeTrackUrl);
        setCurrentTrackName(cleanTrackName(remoteState.activeTrackName));
      } else {
        // Fallback to registry lookups
        let track = playlistRef.current.find(t => t.id === remoteState.activeTrackId);
        if (!track && remoteState.shared_media) {
          track = remoteState.shared_media.find(t => t.id === remoteState.activeTrackId);
        }
        if (track) {
          setActiveTrackId(track.id);
          setActiveTrackUrl(track.url);
          setCurrentTrackName(cleanTrackName(track.name));
        } else if (remoteState.activeTrackId === null) {
          setActiveTrackId(null);
          setActiveTrackUrl(DEFAULT_STREAM_URL || null);
          setCurrentTrackName('Live Stream');
        } else if (remoteState.activeTrackName) {
          setActiveTrackId(remoteState.activeTrackId);
          setActiveTrackUrl(DEFAULT_STREAM_URL || null);
          setCurrentTrackName(cleanTrackName(remoteState.activeTrackName));
        }
      }
    }

    // 3. Sync News
    if (remoteState.latest_news && remoteState.latest_news.length > 0) {
      setNews(remoteState.latest_news);
    }

    // 4. Sync REAL-TIME Broadcasts
    if (remoteState.activeBroadcast && remoteState.activeBroadcast.id !== lastBroadcastIdRef.current) {
      lastBroadcastIdRef.current = remoteState.activeBroadcast.id;
      const b = remoteState.activeBroadcast;
      if (b.type === 'news') {
        getNewsAudio(b.text).then(audio => audio && playRawPcm(audio, 'news'));
      } else if (b.type === 'discussion') {
        getDiscussionAudio(b.text).then(audio => audio && playRawPcm(audio, 'news'));
      }
    }

    // 5. HYBRID SYNC: Force re-sync on pulse
    if (remoteState.broadcastPulse && remoteState.broadcastPulse > lastProcessedPulseRef.current) {
      lastProcessedPulseRef.current = remoteState.broadcastPulse;
      console.log("New Broadcast Pulse - Triggering Data Refresh...");
      fetchData();
    }
  }, [currentTrackName, cleanTrackName, fetchData, playRawPcm]);

  // Midway Sync Logic (Supabase Realtime)
  useEffect(() => {
    // Initial fetch to get the current state
    dbService.getMidwayState()
      .then(remoteState => {
        if (remoteState) handleSyncUpdate(remoteState);
      })
      .catch(err => {
        console.warn("Initial Midway sync failed:", err);
      });

    const subscription = dbService.subscribeToMidway((remoteState) => {
      handleSyncUpdate(remoteState);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [handleSyncUpdate]);

  useEffect(() => {
    const handleInteraction = () => {
      if (!hasInteracted) {
        setHasInteracted(true);
        // Force sync on first interaction
        dbService.getMidwayState().then(state => {
          if (state) handleSyncUpdate(state);
        });
      }
    };
    window.addEventListener('click', handleInteraction);
    return () => window.removeEventListener('click', handleInteraction);
  }, [hasInteracted, handleSyncUpdate]);

  useEffect(() => {
    if (hasInteracted && pendingAudioRef.current) {
      const audio = pendingAudioRef.current;
      pendingAudioRef.current = null;
      playRawPcm(audio, 'news');
    }
  }, [hasInteracted, playRawPcm]);

  useEffect(() => {
    fetchData();
    // Silent initial sync
    const syncTimeout = setTimeout(() => {
      scanNigerianNewspapers(currentLocation).then(() => fetchData());
      checkApiKey(); // Perform API health check diagnostic
    }, 3000);

    const interactionHandler = () => {
      setHasInteracted(true);
      if (aiAudioContextRef.current) aiAudioContextRef.current.resume();
    };
    window.addEventListener('click', interactionHandler, { once: true });
    return () => {
      clearTimeout(syncTimeout);
      window.removeEventListener('click', interactionHandler);
    };
  }, [fetchData, currentLocation]);

  const handlePlayNext = useCallback(async () => {
    const list = playlistRef.current;
    if (list.length === 0) return;

    const currentIndex = list.findIndex(t => t.id === activeTrackId);
    let nextIndex = isShuffle ? Math.floor(Math.random() * list.length) : (currentIndex + 1) % list.length;
    const track = list[nextIndex];
    if (track) {
      // IMMEDIATE FEEDBACK for the user performing the action
      setActiveTrackId(track.id);
      setActiveTrackUrl(track.url);
      setCurrentTrackName(cleanTrackName(track.name));
      setIsRadioPlaying(true);
      setHasInteracted(true);

      const isLocalBlob = track.url.startsWith('blob:') || track.url.startsWith('data:');

      // RELAY TO MIDWAY for everyone else
      await dbService.setMidwayState({
        activeTrackId: track.id,
        activeTrackName: cleanTrackName(track.name),
        activeTrackUrl: isLocalBlob ? null : track.url,
        isPlaying: true,
        timestamp: Date.now()
      });
    }
  }, [activeTrackId, isShuffle]);

  const handlePlayAll = async () => {
    setHasInteracted(true);
    if (audioPlaylist.length === 0) return;

    const track = isShuffle ? audioPlaylist[Math.floor(Math.random() * audioPlaylist.length)] : audioPlaylist[0];

    // IMMEDIATE FEEDBACK
    setActiveTrackId(track.id);
    setActiveTrackUrl(track.url);
    setCurrentTrackName(cleanTrackName(track.name));
    setIsRadioPlaying(true);

    const isLocalBlob = track.url.startsWith('blob:') || track.url.startsWith('data:');

    // RELAY TO MIDWAY
    await dbService.setMidwayState({
      activeTrackId: track.id,
      activeTrackName: cleanTrackName(track.name),
      activeTrackUrl: isLocalBlob ? null : track.url,
      isPlaying: true,
      timestamp: Date.now()
    });
  };

  const handlePushBroadcast = async (voiceText: string) => {
    if (voiceText.trim()) {
      // Trigger sync for everyone else first
      await dbService.triggerBroadcastSync(voiceText, 'news');

      const intro = await getJingleAudio(JINGLE_1);
      if (intro) await playRawPcm(intro, 'jingle');

      const audioData = await getNewsAudio(voiceText);
      if (audioData) await playRawPcm(audioData, 'news');

      const outro = await getJingleAudio(JINGLE_2);
      if (outro) await playRawPcm(outro, 'jingle');
    }
    await fetchData();
  };

  const handleDiscussionBroadcast = async (text: string): Promise<boolean> => {
    if (!text.trim()) return false;

    console.log("Starting Admin Discussion Broadcast:", text);
    try {
      // Trigger sync for everyone else first
      await dbService.triggerBroadcastSync(text, 'discussion');

      // Add jingles to "warm up" the context and match the successful scheduled pattern
      const intro = await getJingleAudio(JINGLE_1);
      if (intro) await playRawPcm(intro, 'jingle');

      const audioData = await getDiscussionAudio(text);
      if (audioData) {
        console.log("Discussion data received, playing...");
        await playRawPcm(audioData, 'news');

        const outro = await getJingleAudio(JINGLE_2);
        if (outro) await playRawPcm(outro, 'jingle');
        return true;
      } else {
        console.error("No discussion audio data received from service.");
        return false;
      }
    } catch (err) {
      console.error("Discussion broadcast failed:", err);
      return false;
    }
  };

  const handleScheduledDiscussion = async () => {
    if (isSyncingRef.current) return;
    const nextText = await dbService.popDiscussionQueue();
    if (!nextText) return;

    isSyncingRef.current = true;
    try {
      console.log("Starting Auto-Pilot Discussion Relay:", nextText);

      const intro = await getJingleAudio(JINGLE_1);
      if (intro) await playRawPcm(intro, 'jingle');

      const audioData = await getDiscussionAudio(nextText);
      if (audioData) await playRawPcm(audioData, 'news');

      const outro = await getJingleAudio(JINGLE_2);
      if (outro) await playRawPcm(outro, 'jingle');

      dbService.addLog({
        id: Date.now().toString(),
        action: `Auto-Relay: Thompson broadcast discussion from queue`,
        timestamp: Date.now()
      });
    } catch (err) {
      console.error("Scheduled discussion failed", err);
    } finally {
      isSyncingRef.current = false;
      await fetchData();
    }
  };

  const playPing = async () => {
    console.log("Manual Sound Wake-up (Ping) requested...");
    try {
      if (!aiAudioContextRef.current || aiAudioContextRef.current.state === 'closed') {
        aiAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = aiAudioContextRef.current;

      console.log("Ping: Resuming context. Current state:", ctx.state);
      await ctx.resume();

      // Wait to see if it moves to 'running'
      if (ctx.state !== 'running') {
        alert("SOUND IS BLOCKED: Browser says the audio engine is 'suspended'. Please click anywhere on the page first, then try the Ping button again.");
        return;
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      console.log("Diagnostic Ping success.");
    } catch (err) {
      console.error("Ping Error:", err);
      alert("Sound Engine Error: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handlePlayJingle = async (idx: number) => {
    const audio = await getJingleAudio(idx === 1 ? JINGLE_1 : JINGLE_2);
    if (audio) await playRawPcm(audio, 'jingle');
  };

  const handlePeakReached = useCallback(() => {
    const randomJingle = Math.random() > 0.5 ? 1 : 2;
    console.log(`Peak reached! Triggering Jingle ID ${randomJingle}`);
    handlePlayJingle(randomJingle);
  }, []);

  if (initError) {
    return (
      <div className="min-h-screen bg-[#f0fff4] flex flex-col items-center justify-center p-6 text-center">
        <div className="glass-card p-8 rounded-3xl border-red-200 border-2 max-w-md animate-scale-in">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold mb-2">Connection Error</h1>
          <p className="text-[#008751] opacity-70 mb-6">{initError}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-[#008751] text-white py-3 rounded-xl font-bold hover:bg-[#00a86b] transition-all"
          >
            Try Refreshing
          </button>
          <p className="mt-4 text-xs text-gray-500">
            Hint: If you're on Vercel, make sure you've added your Environment Variables.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0fff4] text-[#008751] flex flex-col max-w-md mx-auto relative shadow-2xl overflow-x-hidden border-x border-green-100/30">
      <header className="p-2 sticky top-0 z-40 bg-white/90 backdrop-blur-md flex justify-between items-center border-b border-green-50 shadow-sm">
        <div className="flex flex-col">
          <h1 className="text-[11px] font-black italic uppercase leading-none text-green-950">{APP_NAME}</h1>
          <p className="text-[6px] text-green-950/60 font-black uppercase mt-0.5 tracking-widest">Designed by {DESIGNER_NAME}</p>
        </div>
        <div className="flex items-center space-x-2">
          {isDucking && <span className="text-[7px] font-black uppercase text-red-500 animate-pulse bg-red-50 px-1 rounded shadow-sm border border-red-100">Ducking Active</span>}
          {role === UserRole.ADMIN && (
            <div className={`px-1.5 py-0.5 rounded-full border text-[6px] font-black uppercase ${isRadioPlaying ? 'bg-green-500/10 border-green-500/50 text-green-700' : 'bg-gray-100 border-gray-300 text-gray-400'}`}>
              <i className="fas fa-signal mr-1"></i>
              {isRadioPlaying ? 'Signal Live' : 'Signal Off'}
            </div>
          )}
          <button
            onClick={role === UserRole.ADMIN ? () => setRole(UserRole.LISTENER) : () => setShowAuth(true)}
            className="px-2 py-0.5 rounded-full border border-green-950 text-[7px] font-black uppercase text-green-950 hover:bg-green-50 transition-colors"
          >
            {role === UserRole.ADMIN ? 'Exit Admin' : 'Admin Login'}
          </button>
        </div>
      </header>

      <main className="flex-grow pt-1 px-1.5">
        <RadioPlayer
          onStateChange={async (playing) => {
            setIsRadioPlaying(playing);
            if (role === UserRole.ADMIN) {
              // Admin interaction with the player UI should sync to listeners
              await dbService.updateMidwayState({
                isPlaying: playing,
                broadcastPulse: Date.now(),
                lastEvent: { type: playing ? 'PLAY' : 'STOP', timestamp: Date.now() }
              });
            }
          }}
          activeTrackUrl={activeTrackUrl}
          currentTrackName={currentTrackName}
          forcePlaying={isRadioPlaying}
          onTrackEnded={handlePlayNext}
          onPeakReached={handlePeakReached}
          isDucking={isDucking}
          duckingType={duckingType}
          uiMode={role === UserRole.LISTENER ? 'listener' : 'full'}
          onInteract={() => {
            setHasInteracted(true);
            // CATCH-UP LOGIC: Force a full sync update from the cloud immediately
            dbService.getMidwayState().then(state => {
              if (state) {
                console.log("Listener Catch-up Triggered via Interaction");
                handleSyncUpdate(state);
              }
            });
          }}
        />

        {/* RELOCATED NEWS TICKER (UNDER PROGRESSION TAB) */}
        <div className="bg-white/80 backdrop-blur-sm text-green-950 py-2.5 overflow-hidden relative shadow-sm border-b border-green-50 z-30">
          <div className="flex whitespace-nowrap animate-marquee">
            {[...news, ...news, ...news, ...news].map((item, idx) => (
              <span key={idx} className="mx-12 text-[9px] font-black uppercase tracking-[0.12em] flex items-center">
                <span className="w-2 h-2 bg-red-500 rounded-full mr-3 animate-pulse"></span>
                <span className="text-green-600 mr-2">[{item.category}]</span>
                {item.title}
              </span>
            ))}
            {news.length === 0 && (
              <span className="mx-12 text-[9px] font-black uppercase tracking-[0.12em] flex items-center">
                <span className="w-2 h-2 bg-red-500 rounded-full mr-3 animate-pulse"></span>
                {CHANNEL_INTRO}
              </span>
            )}
          </div>
        </div>

        {role === UserRole.LISTENER ? (
          <ListenerView
            news={news} onStateChange={setIsRadioPlaying} isRadioPlaying={isRadioPlaying}
            sponsoredVideos={sponsoredMedia} activeTrackUrl={activeTrackUrl}
            currentTrackName={currentTrackName} adminMessages={adminMessages} reports={reports}
            onPlayTrack={(t) => { setHasInteracted(true); setActiveTrackId(t.id); setActiveTrackUrl(t.url); setCurrentTrackName(cleanTrackName(t.name)); setIsRadioPlaying(true); }}
          />
        ) : (
          <AdminView
            onRefreshData={fetchData} logs={logs}
            onPlayTrack={async (t) => {
              // IMMEDIATE FEEDBACK for Admin (Uses their preferred local/cloud URL)
              setActiveTrackId(t.id);
              setActiveTrackUrl(t.url);
              setCurrentTrackName(cleanTrackName(t.name));
              setIsRadioPlaying(true);
              setHasInteracted(true);

              const isLocalBlob = t.url.startsWith('blob:') || t.url.startsWith('data:');
              // Ensure we broadcast the CLOUD URL if available, even if playing locally
              const trackInfo = playlistRef.current.find(m => m.id === t.id);
              const broadcastUrl = trackInfo?.url || (isLocalBlob ? null : t.url);

              await dbService.updateMidwayState({
                activeTrackId: t.id,
                activeTrackName: cleanTrackName(t.name),
                activeTrackUrl: broadcastUrl,
                isPlaying: true,
                broadcastPulse: Date.now()
              });
            }}
            isRadioPlaying={isRadioPlaying}
            onToggleRadio={async () => {
              const newState = !isRadioPlaying;
              // IMMEDIATE FEEDBACK for Admin
              setIsRadioPlaying(newState);
              setHasInteracted(true);

              await dbService.updateMidwayState({
                isPlaying: newState,
                broadcastPulse: Date.now(),
                lastEvent: { type: newState ? 'PLAY' : 'STOP', timestamp: Date.now() }
              });
            }}
            currentTrackName={currentTrackName} isShuffle={isShuffle} onToggleShuffle={() => setIsShuffle(!isShuffle)}
            onPlayAll={handlePlayAll} onSkipNext={handlePlayNext}
            onPushBroadcast={handlePushBroadcast} onPlayJingle={handlePlayJingle}
            news={news} onTriggerFullBulletin={() => runScheduledBroadcast(false)}
            onDiscussIssue={handleDiscussionBroadcast}
            onPing={playPing}
          />
        )}
      </main>

      {/* GLOBAL FOOTER */}
      <footer className="mt-4 pt-4 border-t border-green-100 text-center space-y-1 pb-6">
        <div className="flex items-center justify-center space-x-4 mb-3">
          <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center"><i className="fab fa-facebook-f text-[10px] text-green-950"></i></div>
          <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center"><i className="fab fa-twitter text-[10px] text-green-950"></i></div>
          <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center"><i className="fab fa-whatsapp text-[10px] text-green-950"></i></div>
        </div>
        <p className="text-[7.5px] font-black uppercase tracking-[0.2em] text-green-950">{APP_NAME}</p>
        <p className="text-[6.5px] text-green-950/50 uppercase tracking-[0.4em]">Designed by {DESIGNER_NAME} &bull; v2.5.0</p>
      </footer>

      {showAuth && <PasswordModal onClose={() => setShowAuth(false)} onSuccess={() => { setRole(UserRole.ADMIN); setShowAuth(false); }} />}

      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .animate-marquee { display: inline-flex; animation: marquee 50s linear infinite; }
      `}} />
    </div>
  );
};

export default App;
