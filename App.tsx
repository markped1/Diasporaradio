
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useBroadcast } from './context/BroadcastContext';
import { useListenerAudio } from './hooks/useListenerAudio';
import { radioEngine } from './core/RadioEngine';
import { supabase } from './services/supabaseClient';
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
  const [tvPlaylist, setTvPlaylist] = useState<MediaFile[]>([]);
  const [tvAdverts, setTvAdverts] = useState<MediaFile[]>([]);
  const [audioPlaylist, setAudioPlaylist] = useState<MediaFile[]>([]);
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([]);
  const [reports, setReports] = useState<ListenerReport[]>([]);
  const [isNewsroomActive, setIsNewsroomActive] = useState(false);
  const [newsroomContent, setNewsroomContent] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const { broadcast, syncStatus } = useBroadcast();
  const [hasInteracted, setHasInteracted] = useState(false);

  // DRIVER: All users (including Admin) hear audio based on global state once they interact
  useListenerAudio(hasInteracted);
  const [currentLocation, setCurrentLocation] = useState<string>("Global");
  const [expandedMedia, setExpandedMedia] = useState<'radio' | 'video' | 'none'>('none');

  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [isShuffle, setIsShuffle] = useState(true);
  const [isDucking, setIsDucking] = useState(false);
  const [duckingType, setDuckingType] = useState<'news' | 'jingle' | null>(null);

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

      const videos = processedMedia.filter(item => item.type === 'video');

      // Strict TV Playlist: must be a video AND either in 'Videos' folder OR not in audio-centric folders
      setTvAdverts(videos.filter(v => v.folder === 'TV Adverts'));
      setTvPlaylist(videos.filter(v =>
        v.folder !== 'TV Adverts' &&
        v.folder !== 'Music' &&
        v.folder !== 'Jingles' &&
        v.folder !== 'Admin Discussion' &&
        v.name.toLowerCase().endsWith('.mp4')
      ));

      setSponsoredMedia(processedMedia.filter(item => item.type === 'image'));
      setAudioPlaylist(processedMedia.filter(item => item.type === 'audio'));
      setAdminMessages(msg || []);
      setReports(rep || []);
    } catch (err: any) {
      console.error("Data fetch error", err);
      setInitError(err.message || "Failed to connect to the radio server. Check your connection or credentials.");
    }
  }, []);

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

  useEffect(() => {
    const handleInteraction = () => {
      if (!hasInteracted) {
        setHasInteracted(true);
        // Resuming context for AI DJs (news room)
        if (aiAudioContextRef.current && aiAudioContextRef.current.state === 'suspended') {
          aiAudioContextRef.current.resume();
        }
      }
    };
    window.addEventListener('click', handleInteraction);
    return () => window.removeEventListener('click', handleInteraction);
  }, [hasInteracted]);

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

  // SYNC HUB: Keep local UI state in sync with Global Midway Broadcast
  useEffect(() => {
    if (broadcast) {
      if (broadcast.isNewsroomActive !== undefined) setIsNewsroomActive(broadcast.isNewsroomActive);
      if (broadcast.newsroomContent !== undefined) setNewsroomContent(broadcast.newsroomContent);
      if (broadcast.activeVideoId !== undefined) setActiveVideoId(broadcast.activeVideoId);
      if (broadcast.activeVideoUrl !== undefined) setActiveVideoUrl(broadcast.activeVideoUrl);
      if (broadcast.activeFolder !== undefined) setActiveFolder(broadcast.activeFolder);

      // 🔊 BROADCAST RELAY: Listeners play AI-generated content (news, jingles, discussion)
      if (broadcast.activeBroadcast && broadcast.activeBroadcast.id !== lastBroadcastIdRef.current) {
        const b = broadcast.activeBroadcast;
        lastBroadcastIdRef.current = b.id;

        // Only play if it's recently triggered (within last 30 seconds) to avoid stale replay on join
        const isRecent = (Date.now() - b.timestamp) < 30000;

        if (isRecent && role === UserRole.LISTENER && hasInteracted) {
          console.log(`📡 [App] Processing Remote Broadcast: ${b.type}`);

          if (b.type === 'news') {
            getNewsAudio(b.text).then(audio => {
              if (audio) playRawPcm(audio, 'news');
            });
          } else if (b.type === 'jingle') {
            getJingleAudio(b.text).then(audio => {
              if (audio) playRawPcm(audio, 'jingle');
            });
          } else if (b.type === 'discussion') {
            getDiscussionAudio(b.text).then(audio => {
              if (audio) playRawPcm(audio, 'news');
            });
          }
        }
      }
    }
  }, [
    broadcast?.isNewsroomActive,
    broadcast?.newsroomContent,
    broadcast?.activeVideoId,
    broadcast?.activeVideoUrl,
    broadcast?.activeFolder,
    broadcast?.activeBroadcast?.id,
    role,
    hasInteracted
  ]);

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

    const currentIndex = playlist.findIndex(t => t.id === broadcast?.activeTrackId);
    let nextIndex = isShuffle ? Math.floor(Math.random() * playlist.length) : (currentIndex + 1) % playlist.length;
    const track = playlist[nextIndex];
    if (track) {
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

        // 2. IMMEDIATE FEEDBACK for Admin
        if (broadcastUrl) radioEngine.play(broadcastUrl);
      }
    }
  }, [broadcast?.activeTrackId, isShuffle, activeFolder, role, sponsoredMedia]);

  const handlePlayAll = async () => {
    setHasInteracted(true);
    if (audioPlaylist.length === 0) return;

    const track = isShuffle ? audioPlaylist[Math.floor(Math.random() * audioPlaylist.length)] : audioPlaylist[0];

    if (role === UserRole.ADMIN) {
      const isLocalBlob = track.url.startsWith('blob:') || track.url.startsWith('data:');

      // RELAY TO MIDWAY
      await dbService.updateMidwayState({
        activeTrackId: track.id,
        activeTrackName: cleanTrackName(track.name),
        activeTrackUrl: isLocalBlob ? null : track.url,
        isPlaying: true,
        broadcastPulse: Date.now()
      });

      // IMMEDIATE FEEDBACK for Admin
      if (!isLocalBlob) radioEngine.play(track.url);
    }
  };

  const handleTriggerNewsroom = async (content: string) => {
    setIsNewsroomActive(true);
    setNewsroomContent(content);
    await dbService.updateMidwayState({
      isNewsroomActive: true,
      newsroomContent: content,
      broadcastPulse: Date.now()
    });
  };

  const handleEndNewsroom = async () => {
    setIsNewsroomActive(false);
    setNewsroomContent(null);
    await dbService.updateMidwayState({
      isNewsroomActive: false,
      newsroomContent: null,
      broadcastPulse: Date.now()
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
      <header className="sticky top-0 z-40 bg-white shadow-md flex items-center h-16 overflow-hidden border-b border-green-50 px-4">
        {/* CENTERED BRANDING SECTION */}
        <div className="flex-grow flex flex-col items-center justify-center relative min-w-0">
          <div className="flex items-center space-x-2">
            <h1 className="text-[11px] font-black tracking-[0.15em] text-[#008751] uppercase italic whitespace-nowrap">Nigeria Diaspora Radio Tv (NDRTV)</h1>
            {broadcast?.isPlaying && (
              <span className="flex space-x-0.5 items-end h-3">
                <span className="w-0.5 bg-red-500 animate-pulse h-1"></span>
                <span className="w-0.5 bg-red-500 animate-pulse h-2" style={{ animationDelay: '0.2s' }}></span>
                <span className="w-0.5 bg-red-500 animate-pulse h-1.5" style={{ animationDelay: '0.4s' }}></span>
              </span>
            )}
          </div>
          <p className="text-[6px] text-green-900/40 font-black uppercase tracking-[0.4em] mt-0.5">Midway Relay Hub &bull; Diaspora Network</p>
          <p className="text-[5px] text-gray-400 font-bold uppercase tracking-widest mt-1">designed by thompson obosa</p>

          {/* STATUS INDICATORS (ABSOLUTE RIGHT) */}
          <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col items-end space-y-1">
            <div className="flex items-center space-x-1 mb-1">
              <span className={`w-1.5 h-1.5 rounded-full ${syncStatus === 'SUBSCRIBED' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
              <span className="text-[5px] font-black uppercase text-green-950/40">Sync: {syncStatus}</span>
            </div>
            {broadcast?.isPlaying && <span className="text-[5px] font-black uppercase text-red-500 bg-red-50 px-1 rounded-sm border border-red-100 flex items-center shadow-sm"><i className="fas fa-satellite-dish text-[4.5px] mr-1"></i> RELAYING</span>}
            <button
              onClick={role === UserRole.ADMIN ? () => setRole(UserRole.LISTENER) : () => setShowAuth(true)}
              className="text-[6px] font-black uppercase text-green-900/30 hover:text-green-900 transition-colors bg-green-50/50 hover:bg-green-100 px-1.5 py-0.5 rounded border border-green-100/50"
            >
              {role === UserRole.ADMIN ? 'Log Out' : 'Admin'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-grow pt-1 px-1.5">
        <RadioPlayer
          onStateChange={async (playing) => {
            if (role === UserRole.ADMIN) {
              await dbService.updateMidwayState({
                isPlaying: playing,
                broadcastPulse: Date.now(),
                lastEvent: { type: playing ? 'PLAY' : 'STOP', timestamp: Date.now() }
              });
            }
          }}
          activeTrackUrl={broadcast?.activeTrackUrl || null}
          currentTrackName={broadcast?.activeTrackName || 'Live Stream'}
          forcePlaying={broadcast?.isPlaying || false}
          onTrackEnded={handlePlayNext}
          onPeakReached={handlePeakReached}
          isDucking={isDucking}
          duckingType={duckingType}
          uiMode={role === UserRole.LISTENER ? 'listener' : 'full'}
          activeFolder={activeFolder}
          isExpanded={expandedMedia === 'radio'}
          onExpandToggle={(expanded) => setExpandedMedia(expanded ? 'radio' : 'none')}
          onInteract={() => setHasInteracted(true)}
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
              <h4 className="text-[10px] font-black text-green-900 uppercase tracking-wider line-clamp-1 min-h-[1.2rem]">
                {activeFolder ? `REELING: ${activeFolder}` : (broadcast?.activeTrackName || 'NDR RADIO')}
              </h4>
            )}
          </div>
        </div>

        {role === UserRole.LISTENER ? (
          <ListenerView
            news={news} onStateChange={() => { }} isRadioPlaying={broadcast?.isPlaying || false}
            tvPlaylist={tvPlaylist}
            tvAdverts={tvAdverts}
            activeTrackUrl={broadcast?.activeTrackUrl || null}
            currentTrackName={broadcast?.activeTrackName || 'NDR RADIO'} adminMessages={adminMessages} reports={reports}
            onPlayTrack={(t) => {
              // Listeners can't update the global track, this is likely legacy or local preview
              setHasInteracted(true);
            }}
            isNewsroomActive={isNewsroomActive}
            newsroomContent={newsroomContent}
            expandedMedia={expandedMedia}
            setExpandedMedia={setExpandedMedia}
            activeVideoId={activeVideoId}
            activeVideoUrl={activeVideoUrl}
            syncStatus={syncStatus}
          />
        ) : (
          <AdminView
            broadcast={broadcast || undefined}
            onRefreshData={fetchData} logs={logs}
            onPlayTrack={async (t) => {
              setHasInteracted(true);
              // 1. Admin local feedback
              if (t.url) radioEngine.play(t.url);

              // 2. Global Sync (Assuming t.url is already a valid Cloud URL from the new upload flow)
              await dbService.updateMidwayState({
                activeTrackId: t.id,
                activeTrackName: cleanTrackName(t.name),
                activeTrackUrl: t.url,
                isPlaying: true,
                broadcastPulse: Date.now()
              });
            }}
            isRadioPlaying={broadcast?.isPlaying || false}
            onPlayFolder={handlePlayFolder}
            activeFolder={activeFolder}
            onToggleRadio={async () => {
              const newState = !broadcast?.isPlaying;

              if (newState) {
                // 1. STARTING MASTER BROADCAST (Global Mode)
                console.log("🚀 Starting Master Broadcast (Global Mode)");
                setActiveFolder(null); // Clear local folder restriction
                setHasInteracted(true);

                // 2. Prepare target track info
                const globalPlaylist = playlistRef.current;
                let targetTrackId = broadcast?.activeTrackId;
                let targetTrackUrl = broadcast?.activeTrackUrl;
                let targetTrackName = broadcast?.activeTrackName || 'Live Stream';

                if ((!targetTrackId || targetTrackId === 'default') && globalPlaylist.length > 0) {
                  const randomTrack = globalPlaylist[Math.floor(Math.random() * globalPlaylist.length)];
                  targetTrackId = randomTrack.id;
                  targetTrackUrl = randomTrack.url;
                  targetTrackName = cleanTrackName(randomTrack.name);
                }

                // 3. Resolve Broadcast URL & Handshake Cloud
                try {
                  const allMedia = [...globalPlaylist, ...sponsoredMedia];
                  const trackInfo = allMedia.find(m => m.id === targetTrackId);
                  let broadcastUrl = targetTrackUrl || '';

                  if (targetTrackUrl?.startsWith('blob:') && trackInfo?.file && supabase) {
                    setStatusMsg("Syncing Studio to Cloud...");
                    const cloudUrl = await dbService.uploadMedia(trackInfo.file as File);
                    if (cloudUrl) {
                      broadcastUrl = cloudUrl;
                      await dbService.addMedia({ ...trackInfo, url: cloudUrl });
                    }
                  }

                  await dbService.updateMidwayState({
                    isPlaying: true,
                    activeFolder: null, // CLEAR FOLDER restriction globally
                    activeTrackId: targetTrackId || 'default',
                    activeTrackName: targetTrackName || 'Live Stream',
                    activeTrackUrl: broadcastUrl,
                    broadcastPulse: Date.now(),
                    lastEvent: { type: 'PLAY', timestamp: Date.now() }
                  });
                  setStatusMsg("");
                } catch (e) {
                  console.error("Master Sync failed:", e);
                }

              } else {
                // STOPPING BROADCAST
                setHasInteracted(true);
                await dbService.updateMidwayState({
                  isPlaying: false,
                  broadcastPulse: Date.now(),
                  lastEvent: { type: 'STOP', timestamp: Date.now() }
                });
              }
            }}
            currentTrackName={broadcast?.activeTrackName || 'NDR RADIO'} isShuffle={isShuffle} onToggleShuffle={() => setIsShuffle(!isShuffle)}
            onPlayAll={handlePlayAll} onSkipNext={handlePlayNext}
            onPushBroadcast={handlePushBroadcast} onPlayJingle={handlePlayJingle}
            news={news} onTriggerFullBulletin={() => runScheduledBroadcast(false)}
            onDiscussIssue={handleDiscussionBroadcast}
            onPing={playPing}
            tvPlaylist={tvPlaylist}
            tvAdverts={tvAdverts}
            onTriggerNewsroom={handleTriggerNewsroom}
            isNewsroomActive={isNewsroomActive}
            newsroomContent={newsroomContent}
            onEndNewsroom={handleEndNewsroom}
            onPlayVideo={async (v) => {
              // 1. IMMEDIATE
              setActiveVideoId(v.id);
              setActiveVideoUrl(v.url);

              if (role === UserRole.ADMIN) {
                try {
                  let broadcastUrl = v.url;
                  if (v.url.startsWith('blob:') && v.file && supabase) {
                    setStatusMsg("Uploading Video to Cloud...");
                    const cloudUrl = await dbService.uploadMedia(v.file as File);
                    if (cloudUrl) {
                      broadcastUrl = cloudUrl;
                      await dbService.addMedia({ ...v, url: cloudUrl });
                    }
                  }

                  await dbService.updateMidwayState({
                    activeVideoId: v.id,
                    activeVideoUrl: broadcastUrl,
                    broadcastPulse: Date.now()
                  });
                  setStatusMsg("");
                } catch (e) {
                  console.error("Video Cloud Sync failed:", e);
                  setStatusMsg("Video Sync Error.");
                }
              }
            }}
            activeVideoId={activeVideoId}
            activeVideoUrl={activeVideoUrl}
            onStatusUpdate={setStatusMsg}
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

      <DiagnosticOverlay
        hasInteracted={hasInteracted}
        broadcast={broadcast}
        syncStatus={syncStatus}
      />
    </div>
  );
}

const DiagnosticOverlay: React.FC<{
  hasInteracted: boolean;
  broadcast: any;
  syncStatus: string;
}> = ({ hasInteracted, broadcast, syncStatus }) => {
  const [show, setShow] = useState(false);
  const engineError = radioEngine.getLastError();

  if (!show) {
    return (
      <button
        onClick={() => setShow(true)}
        className="fixed bottom-4 left-4 z-[9999] bg-black/80 text-white/40 text-[8px] p-2 rounded-full hover:bg-black transition-colors"
      >
        DIAG
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-[9999] bg-black/95 text-green-400 p-4 rounded-2xl border border-white/10 shadow-2xl text-[10px] font-mono w-64 max-h-[80vh] overflow-y-auto">
      <div className="flex justify-between items-center mb-2 border-b border-white/10 pb-2">
        <span className="font-black text-white uppercase tracking-widest text-[8px]">Sync Diagnostics</span>
        <button onClick={() => setShow(false)} className="text-white/50 hover:text-white">✕</button>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between">
          <span>Interacted:</span>
          <span className={hasInteracted ? 'text-green-500' : 'text-red-500'}>{hasInteracted ? 'YES' : 'NO'}</span>
        </div>
        <div className="flex justify-between">
          <span>Sync Status:</span>
          <span className="text-white">{syncStatus}</span>
        </div>
        <div className="flex justify-between">
          <span>Role:</span>
          <span className="text-white uppercase font-black">NDR USER</span>
        </div>

        <div className="pt-2 border-t border-white/5">
          <p className="text-white/40 mb-1 text-[8px]">LIVE BROADCAST DATA:</p>
          <pre className="bg-black/50 p-2 rounded text-[8px] overflow-hidden">
            {JSON.stringify({
              playing: broadcast?.isPlaying,
              track: broadcast?.activeTrackName?.substring(0, 15),
              url: broadcast?.[broadcast.activeFolder ? 'activeFolderUrl' : 'activeTrackUrl'] ? 'SET' : 'MISSING'
            }, null, 2)}
          </pre>
        </div>

        {engineError && (
          <div className="pt-2 border-t border-red-500/20">
            <p className="text-red-500 font-bold mb-1">ENGINE ERROR:</p>
            <p className="bg-red-500/10 text-red-500 p-2 rounded border border-red-500/20">
              {engineError}
            </p>
          </div>
        )}

        <div className="pt-2 text-[8px] text-white/30 italic">
          Tip: Tap to Join should reset error.
        </div>
      </div>
    </div>
  );
};

export default App;
