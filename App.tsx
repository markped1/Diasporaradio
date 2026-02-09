
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ListenerView from './components/ListenerView';
import AdminView from './components/AdminView';
import PasswordModal from './components/PasswordModal';
import RadioPlayer from './components/RadioPlayer';
import { dbService } from './services/dbService';
import { app as firebaseApp } from './services/firebaseConfig'; // Initialize Firebase
import { scanNigerianNewspapers } from './services/newsAIService';
import { checkApiKey } from './services/geminiService';
import {
  generateDjSegment,
  getDetailedBulletinAudio,
  getDetailedBulletinScript,
  getNewsAudio,
  getJingleAudio,
  getDiscussionAudio
} from './services/aiDjService';
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
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
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
        // Step 2: Generate Script and Sync to Listeners
        const hostName = isBrief ? "Thompson Obosa" : "Sara Obosa";
        const scriptParams = {
          location: currentLocation,
          localTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          newsItems: freshNews.slice(0, 5),
          hostName: hostName,
          weather: weather,
          isBrief: isBrief
        };
        const fullScript = getDetailedBulletinScript(scriptParams);

        // Broadcast the script to all listeners
        await dbService.triggerBroadcastSync(fullScript, 'news');

        // Step 3: Play Intro Jingle locally
        const intro = await getJingleAudio(JINGLE_1);
        if (intro) await playRawPcm(intro, 'jingle');

        // Step 4: Generate and Play AI Audio locally
        const audioData = await getDetailedBulletinAudio(scriptParams);

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
      if (role !== UserRole.ADMIN) return;

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
  }, [runScheduledBroadcast, role]);

  const activeTrackIdRef = useRef<string | null>(null);
  const isRadioPlayingRef = useRef<boolean>(false);

  useEffect(() => {
    activeTrackIdRef.current = activeTrackId;
    isRadioPlayingRef.current = isRadioPlaying;
  }, [activeTrackId, isRadioPlaying]);

  // Midway Sync Logic (Supabase Realtime)
  const handleSyncUpdate = useCallback((remoteState: MidwayState) => {
    console.log("🔥 [App.tsx] Sync Update Received from Supabase:", {
      id: remoteState.activeTrackId,
      name: remoteState.activeTrackName,
      playing: remoteState.isPlaying,
      pulse: remoteState.broadcastPulse,
      url: remoteState.activeTrackUrl
    });

    // 1. Sync Playback State
    if (remoteState.isPlaying !== isRadioPlayingRef.current) {
      console.log(`🎵 [App.tsx] State Change Detected: isPlaying ${isRadioPlayingRef.current} -> ${remoteState.isPlaying}`);
      setIsRadioPlaying(remoteState.isPlaying);
    }

    // 2. Sync Folder Context
    if (remoteState.activeFolder !== activeFolder) {
      setActiveFolder(remoteState.activeFolder || null);
    }

    // 3. Sync Track Info
    if (remoteState.activeTrackId !== activeTrackIdRef.current || remoteState.activeTrackName !== currentTrackName) {
      if (remoteState.activeTrackUrl) {
        setActiveTrackId(remoteState.activeTrackId);
        setActiveTrackUrl(remoteState.activeTrackUrl);
        setCurrentTrackName(cleanTrackName(remoteState.activeTrackName));
        console.log(`🔗 [App.tsx] Direct URL Update: ${remoteState.activeTrackUrl}`);
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
        } else {
          // If totally lost, at least don't block the UI
          setActiveTrackUrl(null);
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
        (async () => {
          const intro = await getJingleAudio(JINGLE_1);
          if (intro) await playRawPcm(intro, 'jingle');
          const audio = await getNewsAudio(b.text);
          if (audio) await playRawPcm(audio, 'news');
          const outro = await getJingleAudio(JINGLE_2);
          if (outro) await playRawPcm(outro, 'jingle');
        })();
      } else if (b.type === 'discussion') {
        (async () => {
          const intro = await getJingleAudio(JINGLE_1);
          if (intro) await playRawPcm(intro, 'jingle');
          const audio = await getDiscussionAudio(b.text);
          if (audio) await playRawPcm(audio, 'news');
          const outro = await getJingleAudio(JINGLE_2);
          if (outro) await playRawPcm(outro, 'jingle');
        })();
      }
    }

    // 5. HYBRID SYNC: Force re-sync on pulse
    if (remoteState.broadcastPulse && remoteState.broadcastPulse > lastProcessedPulseRef.current) {
      lastProcessedPulseRef.current = remoteState.broadcastPulse;
      console.log("New Broadcast Pulse - Triggering Data Refresh...");
      fetchData();
    }
  }, [currentTrackName, cleanTrackName, fetchData, playRawPcm, activeFolder]);

  // Midway Sync Logic (Supabase Realtime)
  useEffect(() => {
    // Initial fetch to get the current state and AUTO-JOIN if broadcast is live
    dbService.getMidwayState()
      .then(remoteState => {
        if (remoteState) {
          handleSyncUpdate(remoteState);

          // AUTO-SYNC FOR LISTENERS: If Admin is broadcasting, join immediately
          if (role === UserRole.LISTENER && remoteState.isPlaying && remoteState.activeTrackUrl) {
            console.log("Auto-joining live broadcast for listener");
            setHasInteracted(true); // Enable audio playback
          }
        }
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
  }, [handleSyncUpdate, role]);

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
      if (role === UserRole.ADMIN) {
        scanNigerianNewspapers(currentLocation).then(() => fetchData());
      } else {
        fetchData();
      }
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
    let playlist = playlistRef.current;

    // If a folder is active, restrict playback to that folder
    if (activeFolder) {
      playlist = playlist.filter(m => m.folder === activeFolder);
      if (playlist.length === 0) {
        playlist = playlistRef.current; // Fallback
        setActiveFolder(null); // Clear active folder if it doesn't exist anymore
      }
    }

    if (playlist.length === 0) return;

    const currentIndex = playlist.findIndex(t => t.id === activeTrackId);
    let nextIndex = isShuffle ? Math.floor(Math.random() * playlist.length) : (currentIndex + 1) % playlist.length;
    const track = playlist[nextIndex];
    if (track) {
      // IMMEDIATE FEEDBACK for the user performing the action
      setActiveTrackId(track.id);
      setActiveTrackUrl(track.url);
      setCurrentTrackName(cleanTrackName(track.name));
      setIsRadioPlaying(true);
      setHasInteracted(true);

      if (role === UserRole.ADMIN) {
        const isLocalBlob = track.url.startsWith('blob:') || track.url.startsWith('data:');

        // Find Cloud URL if available
        const allMedia = [...playlistRef.current, ...sponsoredMedia];
        const trackInfo = allMedia.find(m => m.id === track.id);
        const broadcastUrl = trackInfo?.url || (isLocalBlob ? null : track.url);

        // RELAY TO MIDWAY for everyone else
        await dbService.updateMidwayState({
          activeTrackId: track.id,
          activeTrackName: cleanTrackName(track.name),
          activeTrackUrl: broadcastUrl,
          isPlaying: true,
          broadcastPulse: Date.now()
        });
      }
    }
  }, [activeTrackId, isShuffle, activeFolder, role]);

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
    await dbService.updateMidwayState({
      activeTrackId: track.id,
      activeTrackName: cleanTrackName(track.name),
      activeTrackUrl: isLocalBlob ? null : track.url,
      isPlaying: true
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

  const handlePlayFolder = async (folder: string) => {
    // 1. Find all tracks in this folder
    const folderTracks = playlistRef.current.filter(m => m.folder === folder);
    if (folderTracks.length === 0) return;

    // 2. Pick first track
    const firstTrack = folderTracks[0];

    // 3. Update local state
    setActiveFolder(folder);
    setActiveTrackId(firstTrack.id);
    setActiveTrackUrl(firstTrack.url);
    setCurrentTrackName(cleanTrackName(firstTrack.name));
    setIsRadioPlaying(true);
    setHasInteracted(true);

    // 4. Update GLOBAL state
    const allMedia = [...playlistRef.current, ...sponsoredMedia];
    const trackInfo = allMedia.find(m => m.id === firstTrack.id);
    const broadcastUrl = trackInfo?.url || (firstTrack.url.startsWith('blob:') ? null : firstTrack.url);

    await dbService.updateMidwayState({
      activeTrackId: firstTrack.id,
      activeTrackName: cleanTrackName(firstTrack.name),
      activeTrackUrl: broadcastUrl,
      activeFolder: folder,
      isPlaying: true,
      broadcastPulse: Date.now(),
      lastEvent: { type: 'PLAY', timestamp: Date.now() }
    });

    dbService.addLog({
      id: Date.now().toString(),
      action: `Master Broadcast: Started playing folder [${folder}]`,
      timestamp: Date.now()
    });
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
      <header className="sticky top-0 z-40 bg-white shadow-md flex items-stretch h-14 overflow-hidden border-b border-green-50">
        {/* LEFT GREEN STRIPE */}
        <div className="w-12 bg-[#008751] flex items-center justify-center space-x-0.5 px-1 relative">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className={`strand strand-${i} ${isRadioPlaying ? '' : 'paused'}`}></div>
          ))}
          <div className="absolute inset-0 bg-green-900/10 pointer-events-none"></div>
        </div>

        {/* CENTER WHITE SECTION */}
        <div className="flex-grow bg-white flex flex-col items-center justify-center px-4 relative min-w-0">
          <div className="flex items-center space-x-2">
            <h1 className="text-[13px] font-black tracking-[0.2em] text-[#008751] uppercase italic whitespace-nowrap">NDR RADIO</h1>
            {isRadioPlaying && (
              <span className="flex space-x-0.5 items-end h-3">
                <span className="w-0.5 bg-red-500 animate-pulse h-1"></span>
                <span className="w-0.5 bg-red-500 animate-pulse h-2" style={{ animationDelay: '0.2s' }}></span>
                <span className="w-0.5 bg-red-500 animate-pulse h-1.5" style={{ animationDelay: '0.4s' }}></span>
              </span>
            )}
          </div>
          <p className="text-[5.5px] text-green-900/40 font-black uppercase tracking-[0.4em] mt-0.5">Diaspora Relay Network</p>

          {/* STATUS INDICATORS */}
          <div className="absolute right-2 top-1 flex flex-col items-end space-y-0.5">
            {isRadioPlaying && <span className="text-[5px] font-black uppercase text-red-500 bg-red-50 px-1 rounded-sm border border-red-100 flex items-center"><i className="fas fa-circle text-[4px] mr-1 animate-ping"></i> LIVE</span>}
            <button
              onClick={role === UserRole.ADMIN ? () => setRole(UserRole.LISTENER) : () => setShowAuth(true)}
              className="text-[6px] font-black uppercase text-green-900/30 hover:text-green-900 transition-colors bg-green-50/50 hover:bg-green-100 px-1.5 py-0.5 rounded border border-green-100/50"
            >
              {role === UserRole.ADMIN ? 'Log Out' : 'Admin'}
            </button>
          </div>
        </div>

        {/* RIGHT GREEN STRIPE */}
        <div className="w-12 bg-[#008751] flex items-center justify-center space-x-0.5 px-1 relative">
          {[5, 4, 3, 2, 1].map(i => (
            <div key={i} className={`strand strand-${i} ${isRadioPlaying ? '' : 'paused'}`}></div>
          ))}
          <div className="absolute inset-0 bg-green-900/10 pointer-events-none"></div>
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
          activeFolder={activeFolder}
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
              <h4 className="text-[10px] font-black text-white uppercase tracking-wider line-clamp-1 min-h-[1.2rem]">
                {activeFolder ? `REELING: ${activeFolder}` : (currentTrackName || 'NDR RADIO')}
              </h4>
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
              // Search in both audioPlaylist and sponsoredMedia
              const allMedia = [...playlistRef.current, ...sponsoredMedia];
              const trackInfo = allMedia.find(m => m.id === t.id);
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
            onPlayFolder={handlePlayFolder}
            activeFolder={activeFolder}
            onToggleRadio={async () => {
              const newState = !isRadioPlaying;

              if (newState) {
                // 1. STARTING MASTER BROADCAST (Global Mode)
                console.log("🚀 Starting Master Broadcast (Global Mode)");
                setActiveFolder(null); // Clear local folder restriction

                // 2. Ensure a track is ready if none is selected
                let targetTrackId = activeTrackId;
                let targetTrackUrl = activeTrackUrl;
                let targetTrackName = currentTrackName;

                // Use playlistRef to get latest tracks
                const globalPlaylist = playlistRef.current;

                if ((!targetTrackId || targetTrackId === 'default') && globalPlaylist.length > 0) {
                  // Pick specific track to ensure listeners sync to *something*
                  const randomTrack = globalPlaylist[Math.floor(Math.random() * globalPlaylist.length)];
                  targetTrackId = randomTrack.id;
                  targetTrackUrl = randomTrack.url;
                  targetTrackName = cleanTrackName(randomTrack.name);

                  // Update local immediately
                  setActiveTrackId(targetTrackId);
                  setActiveTrackUrl(targetTrackUrl);
                  setCurrentTrackName(targetTrackName);
                }

                setIsRadioPlaying(true);
                setHasInteracted(true);

                // 3. Resolve Broadcast URL
                // Find Cloud URL if available for the track
                const allMedia = [...globalPlaylist, ...sponsoredMedia];
                const trackInfo = allMedia.find(m => m.id === targetTrackId);
                const isLocalBlob = targetTrackUrl?.startsWith('blob:') || targetTrackUrl?.startsWith('data:');
                const broadcastUrl = trackInfo?.url || (isLocalBlob ? null : targetTrackUrl);

                await dbService.updateMidwayState({
                  isPlaying: true,
                  activeFolder: null, // CLEAR FOLDER restriction globally
                  activeTrackId: targetTrackId,
                  activeTrackName: targetTrackName,
                  activeTrackUrl: broadcastUrl,
                  broadcastPulse: Date.now(),
                  lastEvent: { type: 'PLAY', timestamp: Date.now() }
                });

              } else {
                // STOPPING BROADCAST
                setIsRadioPlaying(false);
                setHasInteracted(true);

                await dbService.updateMidwayState({
                  isPlaying: false,
                  broadcastPulse: Date.now(),
                  lastEvent: { type: 'STOP', timestamp: Date.now() }
                });
              }
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
