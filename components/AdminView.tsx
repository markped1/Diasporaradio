
import React, { useState, useEffect, useRef, useCallback } from 'react';
import TVPlayer from './TVPlayer';
import { dbService } from '../services/dbService';
import { AdminLog, MediaFile, NewsItem, ListenerReport, MidwayState } from '../types';

interface AdminViewProps {
  onRefreshData: () => void;
  logs: AdminLog[];
  onPlayTrack: (track: MediaFile) => Promise<void>;
  isRadioPlaying: boolean;
  onToggleRadio: () => Promise<void>;
  currentTrackName: string;
  isShuffle: boolean;
  onToggleShuffle: () => void;
  onPlayAll: () => Promise<void>;
  onSkipNext: () => Promise<void>;
  onPushBroadcast?: (voiceText: string) => Promise<void>;
  onPlayJingle?: (index: 1 | 2) => Promise<void>;
  onTriggerFullBulletin?: () => Promise<void>;
  onPlayFolder?: (folder: string) => Promise<void>;
  activeFolder?: string | null;
  tvPlaylist: MediaFile[];
  tvAdverts: MediaFile[];
  news: NewsItem[];
  onTriggerNewsroom?: (content: string) => Promise<void>;
  isNewsroomActive?: boolean;
  newsroomContent?: string | null;
  onEndNewsroom?: () => Promise<void>;
  onPlayVideo?: (video: MediaFile) => void;
  activeVideoId?: string | null;
  activeVideoUrl?: string | null;
  onStatusUpdate?: (msg: string) => void;
  broadcast?: MidwayState;
}

type Tab = 'command' | 'midway' | 'bulletin' | 'media' | 'inbox' | 'logs';
type MediaSubTab = 'audio' | 'video';

const AdminView: React.FC<AdminViewProps> = ({
  onRefreshData,
  logs,
  onPlayTrack,
  isRadioPlaying,
  onToggleRadio,
  currentTrackName,
  isShuffle,
  onToggleShuffle,
  onPlayAll,
  onSkipNext,
  onPushBroadcast,
  onPlayJingle,
  onDiscussIssue,
  onPing,
  onTriggerFullBulletin,
  onPlayFolder,
  activeFolder,
  tvPlaylist,
  tvAdverts,
  news = [],
  onTriggerNewsroom,
  isNewsroomActive,
  newsroomContent,
  onEndNewsroom,
  onPlayVideo,
  activeVideoId,
  activeVideoUrl,
  onStatusUpdate,
  broadcast
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('command');
  const [mediaSubTab, setMediaSubTab] = useState<MediaSubTab>('audio');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [selectedFolderForMaster, setSelectedFolderForMaster] = useState<string | null>(null);
  const [statusMsg, setStatusMsgInternal] = useState('');
  const setStatusMsg = (msg: string) => {
    setStatusMsgInternal(msg);
    onStatusUpdate?.(msg);
  };
  const [mediaList, setMediaList] = useState<MediaFile[]>([]);
  const [reports, setReports] = useState<ListenerReport[]>([]);
  const [voiceMsg, setVoiceMsg] = useState('');
  const [discussionText, setDiscussionText] = useState('');
  const [discussionQueue, setDiscussionQueue] = useState<string[]>([]);
  const [nextSyncIn, setNextSyncIn] = useState<string>('');
  const [apiHealth, setApiHealth] = useState<'IDLE' | 'CHECKING' | 'HEALTHY' | 'ERROR'>('IDLE');
  const [cloudMode, setCloudMode] = useState(true); // Default to global broadcast
  const [uploadProgress, setUploadProgress] = useState(0);
  const [playbackPreferences, setPlaybackPreferences] = useState<Record<string, 'cloud' | 'local'>>({});
  const [selectedTvVideo, setSelectedTvVideo] = useState<MediaFile | null>(null);

  // Initialize selected TV video
  useEffect(() => {
    if (tvPlaylist.length > 0 && !selectedTvVideo) {
      setSelectedTvVideo(tvPlaylist[0]);
    }
  }, [tvPlaylist, selectedTvVideo]);

  const handleNextTvVideo = useCallback(() => {
    if (tvPlaylist.length === 0) return;
    const currentIndex = tvPlaylist.findIndex(v => v.id === selectedTvVideo?.id);
    const nextIndex = (currentIndex + 1) % tvPlaylist.length;
    setSelectedTvVideo(tvPlaylist[nextIndex]);
    console.log("📺 Admin TV Auto-advancing:", tvPlaylist[nextIndex].name);
  }, [tvPlaylist, selectedTvVideo]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    const [m, r, dq] = await Promise.all([
      dbService.getMedia(),
      dbService.getReports(),
      dbService.getDiscussionQueue()
    ]);
    setMediaList(m || []);
    setReports(r || []);
    setDiscussionQueue(dq || []);

    // Check API Health once on load
    if (apiHealth === 'IDLE') {
      import('../services/geminiService').then(m => {
        setApiHealth('CHECKING');
        m.checkApiKey().then(ok => setApiHealth(ok ? 'HEALTHY' : 'ERROR'));
      });
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    const countdownInterval = setInterval(() => {
      const now = new Date();
      const mins = now.getMinutes() < 30 ? 29 - now.getMinutes() : 59 - now.getMinutes();
      const secs = 59 - now.getSeconds();
      setNextSyncIn(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(countdownInterval);
    };
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsProcessing(true);
    let successCount = 0;
    let failCount = 0;
    const total = files.length;

    try {
      const isCloud = cloudMode;

      for (let i = 0; i < total; i++) {
        const file = files[i];
        if (file.name.startsWith('.') || file.name.includes('DS_Store')) continue;

        setUploadProgress(Math.round(((i + 1) / total) * 100));

        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const mime = file.type.toLowerCase();
        const isAudio = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext) || mime.startsWith('audio/');
        const isVideo = (['mp4', 'mov', 'm4v', 'avi', 'mkv'].includes(ext) || mime.startsWith('video/')) && !mime.startsWith('audio/');
        const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) || mime.startsWith('image/');

        const finalType: 'audio' | 'video' | 'image' = isAudio ? 'audio' : (isVideo ? 'video' : 'image');
        if (!isAudio && !isVideo && !isImage) continue;

        setStatusMsg(`Importing: ${i + 1}/${total} - ${file.name.slice(0, 20)}...`);

        try {
          const relPath = (file as any).webkitRelativePath;
          let fileFolder = currentFolder || 'Uncategorized';
          if (relPath && relPath.includes('/')) {
            fileFolder = relPath.split('/')[0];
          }

          let cloudUrl = '';
          // Force Cloud Upload if cloudMode is on (Now default)
          if (isCloud) {
            setStatusMsg(`Cloud Uploading: ${file.name.slice(0, 15)}...`);
            cloudUrl = await dbService.uploadMedia(file) || '';
            if (!cloudUrl) {
              console.warn(`[AdminView] Skip: Cloud upload failed for ${file.name}`);
              failCount++;
              continue;
            }
          }

          await dbService.addMedia({
            id: 'media-' + Math.random().toString(36).substr(2, 9),
            name: file.name,
            url: cloudUrl,
            file: (cloudUrl && isCloud) ? undefined : file, // Don't store large blobs locally if cloud succeeds
            type: finalType,
            timestamp: Date.now(),
            likes: 0,
            folder: fileFolder
          });
          successCount++;
        } catch (err: any) {
          console.error(`Upload failed for ${file.name}:`, err);
          failCount++;
          // If it's a critical auth/storage error, we might want to stop
          if (err.message?.includes('bucket') || err.message?.includes('auth')) break;
        }
      }

      setStatusMsg(failCount === 0 ? `Success: ${successCount} items added.` : `Mixed Results: ${successCount} added, ${failCount} failed.`);
      onRefreshData();
      await loadData();
    } catch (error: any) {
      console.error("Batch Import Error:", error);
      setStatusMsg(error.message || 'Import Error.');
    } finally {
      setIsProcessing(false);
      setUploadProgress(0);
      setTimeout(() => setStatusMsg(''), 5000);
      if (e.target) e.target.value = '';
    }
  };

  const handleSyncToLocal = async (id: string) => {
    setIsProcessing(true);
    setStatusMsg("Syncing to local storage...");
    try {
      await dbService.syncToLocal(id);
      setStatusMsg("Sync successful!");
      onRefreshData();
      await loadData();
    } catch (err: any) {
      setStatusMsg(`Sync Failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setTimeout(() => setStatusMsg(''), 3000);
    }
  };

  const handleManualBroadcast = async (item: NewsItem) => {
    setIsProcessing(true);
    setStatusMsg(`Broadcasting: ${item.title}`);
    await onPushBroadcast?.(`Headline: ${item.title}. ${item.content}`);
    setIsProcessing(false);
    setStatusMsg(`Broadcast complete.`);
    setTimeout(() => setStatusMsg(''), 3000);
  };

  const handleAddFolder = async () => {
    const name = prompt("Enter new folder name:");
    if (!name || name.trim() === '') return;

    setIsProcessing(true);
    setStatusMsg(`Creating folder: ${name}...`);
    try {
      await dbService.addCustomFolder(name.trim());
      setStatusMsg("Folder created successfully!");
    } catch (err: any) {
      setStatusMsg(`Create Failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setTimeout(() => setStatusMsg(''), 3000);
    }
  };

  const triggerUpload = (accept: string = 'audio/*') => {
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute('accept', accept);
      fileInputRef.current.click();
    }
  };

  const filteredMedia = mediaList.filter(m => {
    if (mediaSubTab === 'audio') return m.type === 'audio';
    return m.type === 'video' || m.type === 'image';
  });

  return (
    <div className="space-y-4 pb-20 text-green-900 animate-scale-in">
      <input type="file" ref={fileInputRef} className="hidden" multiple onChange={handleFileUpload} />
      <input
        type="file"
        ref={folderInputRef}
        className="hidden"
        {...({ webkitdirectory: "true", directory: "true" } as any)}
        multiple
        onChange={handleFileUpload}
      />

      <div className="flex items-center space-x-1.5 px-0.5">
        <div className="flex-grow flex space-x-1 bg-[#008751]/10 p-1 rounded-xl border border-green-200 shadow-sm overflow-x-auto no-scrollbar">
          {(['command', 'midway', 'bulletin', 'media', 'inbox', 'logs'] as Tab[]).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`flex-1 min-w-[65px] py-2 text-[9.5px] font-black uppercase tracking-widest rounded-lg transition-all relative ${activeTab === t ? 'bg-[#008751] text-white shadow-md' : 'text-green-950/50 hover:text-green-950'}`}>
              {t === 'bulletin' ? 'Newsroom' : t}
              {t === 'inbox' && reports.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[6px] w-3 h-3 rounded-full flex items-center justify-center border border-white animate-bounce">{reports.length}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mx-1 px-4 py-3 bg-red-950 text-white rounded-xl shadow-2xl border-2 border-red-500/50">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
            <h3 className="text-[8px] font-black uppercase tracking-widest text-red-200">Diagnostics (v2.0)</h3>
          </div>
          <div className="flex flex-col space-y-2 mt-1">
            <div className={`px-2 py-1 rounded text-[6px] font-black border flex items-center space-x-1 ${apiHealth === 'HEALTHY' ? 'bg-green-500/20 border-green-500/50 text-green-200' :
              apiHealth === 'ERROR' ? 'bg-red-500/20 border-red-500/50 text-red-100' :
                'bg-white/10 border-white/20 text-white/50'
              }`}>
              <i className={`fas fa-brain text-[7px] ${apiHealth === 'CHECKING' ? 'animate-spin' : ''}`}></i>
              <span className="uppercase">API: {apiHealth}</span>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => {
                  import('../services/geminiService').then(m => {
                    setApiHealth('CHECKING');
                    m.checkApiKey().then(ok => setApiHealth(ok ? 'HEALTHY' : 'ERROR'));
                  });
                }}
                className="bg-white/10 hover:bg-white/20 px-3 py-1 rounded text-[7px] font-black border border-white/20 transition-all uppercase"
              >
                Re-Check AI
              </button>
              <button
                onClick={onPing}
                className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded text-[7px] font-black border border-red-400 transition-all uppercase"
              >
                Play Ping
              </button>
            </div>
          </div>
        </div>
        <div className="text-right flex flex-col items-end">
          <span className="text-[6px] font-black bg-red-500/20 text-red-100 px-1.5 py-0.5 rounded border border-red-500/30">SYSTEM MONITOR</span>
          <span className="text-[6px] text-white/40 mt-1 uppercase">Last Sync: {new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <div className="flex items-center justify-between mx-1 px-4 py-2 bg-blue-600 text-white rounded-xl shadow-lg border border-blue-400">
        <div className="flex items-center space-x-2">
          <i className="fas fa-satellite-dish animate-pulse text-xs"></i>
          <span className="text-[7px] font-black uppercase tracking-widest">Ticker Auto-Sync</span>
        </div>
        <div className="text-right">
          <div className="flex flex-col items-end">
            <span className="text-[6px] font-bold uppercase opacity-70 block">Next Headlines In</span>
            <span className="text-[10px] font-mono font-black">{nextSyncIn}</span>
            {isRadioPlaying && (
              <span className={`text-[5px] font-black uppercase px-1 rounded mt-1 ${isRadioPlaying ? 'bg-white/20' : ''}`}>
                Radio Active
              </span>
            )}
          </div>
        </div>
      </div>


      {statusMsg && (
        <div className="mx-1 space-y-1">
          <div className="p-2 text-[8px] font-black uppercase text-center rounded-lg bg-green-600 text-white border border-green-700 animate-pulse shadow-sm">
            {statusMsg}
          </div>
          {isProcessing && uploadProgress > 0 && (
            <div className="h-1.5 bg-green-100 rounded-full overflow-hidden border border-green-200">
              <div
                className="h-full bg-green-500 transition-all duration-500 ease-out"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          )}
        </div>
      )}

      {
        activeTab === 'command' && (
          <div className="space-y-4">
            {/* 📡 BROADCAST SIGNAL STATUS (Replaces redundant button) */}
            <div className="bg-white p-6 rounded-3xl border-2 border-green-100 shadow-md relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <i className="fas fa-tower-broadcast text-5xl"></i>
              </div>

              <div className="flex flex-col items-center space-y-4 text-center">
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${isRadioPlaying ? 'bg-red-500 animate-ping' : 'bg-gray-300'}`}></div>
                  <h2 className={`text-xs font-black uppercase tracking-widest ${isRadioPlaying ? 'text-red-600' : 'text-gray-500'}`}>
                    {isRadioPlaying ? 'BROADCASTING LIVE' : 'STATION ON STANDBY'}
                  </h2>
                </div>

                {/* 🔴 MASTER BROADCAST TOGGLE */}
                <button
                  onClick={async () => {
                    if (isRadioPlaying) {
                      await onToggleRadio(); // Update DB State
                      import('../core/RadioBroadcaster').then(m => m.radioBroadcaster.stopBroadcasting());
                    } else {
                      await onToggleRadio(); // Update DB State
                      import('../core/RadioBroadcaster').then(m => m.radioBroadcaster.startBroadcasting());
                    }
                  }}
                  className={`w-full py-4 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all border-4 ${isRadioPlaying
                    ? 'bg-red-600 border-red-500/20 text-white shadow-red-900/20'
                    : 'bg-[#008751] border-green-500/20 text-white shadow-green-900/20'
                    }`}
                >
                  <i className={`fas ${isRadioPlaying ? 'fa-stop-circle' : 'fa-play-circle'} mr-2 text-sm`}></i>
                  {isRadioPlaying ? 'Stop Master Broadcast' : 'Start Master Broadcast'}
                </button>

                <div className="flex flex-col space-y-1">
                  <span className="text-[7px] font-black text-green-800/40 uppercase tracking-[0.3em]">Master Engine Status</span>
                  <div className="flex justify-center space-x-1">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                      <div key={i} className={`w-1 h-3 rounded-full ${isRadioPlaying ? 'bg-green-500 animate-pulse' : 'bg-gray-100'}`} style={{ animationDelay: `${i * 0.1}s` }}></div>
                    ))}
                  </div>
                </div>

                <div className="bg-green-50/50 py-3 px-6 rounded-2xl border border-green-100/50 shadow-inner max-w-full">
                  <span className="text-[8px] font-black text-green-950 uppercase block tracking-[0.1em] truncate">
                    {activeFolder ? `FOLDER: ${activeFolder}` : (currentTrackName || 'NO ACTIVE SIGNAL')}
                  </span>
                </div>

                {/* 📂 MASTER FOLDER SELECTION */}
                <div className="w-full space-y-3 pt-2">
                  <h3 className="text-[7px] font-black uppercase text-green-800/40 tracking-[0.3em]">Master Folder Relay</h3>

                  {/* FOLDER QUICK LIST */}
                  <div className="grid grid-cols-2 gap-2 max-h-[150px] overflow-y-auto no-scrollbar p-1">
                    {Array.from(new Set(mediaList.map(m => m.folder || 'Uncategorized'))).map(f => (
                      <button
                        key={f}
                        onClick={() => setSelectedFolderForMaster(f)}
                        className={`p-3 rounded-xl border text-[8px] font-black uppercase transition-all flex items-center justify-between ${selectedFolderForMaster === f
                          ? 'bg-green-600 border-green-400 text-white shadow-md scale-105 z-10'
                          : 'bg-white border-green-50 text-green-900/60 hover:border-green-200'
                          }`}
                      >
                        <span className="truncate mr-2">{f}</span>
                        {selectedFolderForMaster === f && <i className="fas fa-check-circle text-[10px]"></i>}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => selectedFolderForMaster && onPlayFolder?.(selectedFolderForMaster)}
                    disabled={!selectedFolderForMaster}
                    className={`w-full py-4 rounded-2xl font-black text-[9px] uppercase tracking-[0.2em] transition-all border-b-4 ${selectedFolderForMaster
                      ? 'bg-amber-500 border-amber-600 text-white shadow-lg active:scale-95 active:border-b-0'
                      : 'bg-gray-100 border-gray-200 text-gray-400'
                      }`}
                  >
                    <i className="fas fa-tower-broadcast mr-2 text-xs"></i>
                    {selectedFolderForMaster ? `Relay [${selectedFolderForMaster}] to All` : 'Select Folder to Relay'}
                  </button>
                </div>

                {isRadioPlaying && (
                  <p className="text-[6px] font-bold text-green-600/70 uppercase tracking-widest animate-pulse">
                    Relaying to Global Diaspora...
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => folderInputRef.current?.click()} className="bg-white p-4 rounded-2xl border border-green-100 flex flex-col items-center justify-center space-y-2 hover:bg-green-50 shadow-sm active:scale-95 transition-all">
                <i className="fas fa-folder-open text-lg text-green-600"></i>
                <span className="text-[8px] font-black uppercase tracking-widest">Import Folder</span>
              </button>

              <button
                onClick={() => setCloudMode(!cloudMode)}
                className={`p-4 rounded-2xl border flex flex-col items-center justify-center space-y-2 shadow-sm transition-all ${cloudMode ? 'bg-green-600 text-white border-green-400' : 'bg-white text-green-600 border-green-100'}`}
              >
                <i className={`fas ${cloudMode ? 'fa-globe-africa' : 'fa-laptop-house'} text-lg`}></i>
                <span className="text-[8px] font-black uppercase tracking-widest">
                  {cloudMode ? '🌍 Global Broadcast ON' : '🏠 Local Only Mode'}
                </span>
                <span className="text-[5px] uppercase opacity-70">
                  {cloudMode ? 'Everyone can hear cloud music' : 'Private testing on this device'}
                </span>
              </button>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-amber-100 space-y-2 shadow-sm">
              <h3 className="text-[7px] font-black uppercase tracking-widest text-amber-600">Jingles</h3>
              <div className="flex space-x-2">
                <button onClick={() => onPlayJingle?.(1)} className="flex-1 bg-amber-500 text-white py-2 rounded-lg text-[7px] font-black uppercase">ID 1</button>
                <button onClick={() => onPlayJingle?.(2)} className="flex-1 bg-amber-500 text-white py-2 rounded-lg text-[7px] font-black uppercase">ID 2</button>
              </div>
            </div>
          </div>
        )
      }

      {
        activeTab === 'midway' && (
          <div className="space-y-4 animate-scale-in">
            <div className="bg-amber-600 p-6 rounded-3xl text-white shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <i className="fas fa-bridge text-5xl"></i>
              </div>
              <h2 className="text-lg font-black uppercase italic mb-1">Midway Relay Hub</h2>
              <p className="text-[10px] opacity-80 uppercase tracking-widest font-bold">Bridge the Gap between Studio and Live Diaspora</p>
            </div>

            {/* BROADCAST STATUS DISPLAY */}
            <div className="bg-white p-4 rounded-2xl border-2 border-amber-100 shadow-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className={`w-3 h-3 rounded-full ${isRadioPlaying ? 'bg-red-500 animate-pulse' : 'bg-gray-300'}`}></div>
                  <span className={`text-[9px] font-black uppercase ${isRadioPlaying ? 'text-red-600' : 'text-gray-500'}`}>
                    {isRadioPlaying ? 'BROADCASTING LIVE' : 'STANDBY MODE'}
                  </span>
                </div>
                {activeFolder && (
                  <span className="text-[7px] font-black uppercase text-amber-600 bg-amber-50 px-2 py-1 rounded">
                    📂 {activeFolder}
                  </span>
                )}
              </div>
            </div>

            {/* VOICE BROADCAST PANEL */}
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-5 rounded-3xl text-white shadow-lg space-y-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center">
                <i className="fas fa-microphone mr-2"></i> Voice Broadcast to All
              </h3>
              <textarea
                value={voiceMsg}
                onChange={(e) => setVoiceMsg(e.target.value)}
                placeholder="Type your announcement to broadcast to all listeners..."
                className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-[10px] placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30 h-20 resize-none"
              />
              <button
                onClick={async () => {
                  if (!voiceMsg.trim()) return;
                  setIsProcessing(true);
                  setStatusMsg("Broadcasting Voice Message...");
                  await onPushBroadcast?.(voiceMsg);
                  setVoiceMsg('');
                  setIsProcessing(false);
                  setStatusMsg("Voice Broadcast Complete.");
                  setTimeout(() => setStatusMsg(''), 3000);
                }}
                disabled={!voiceMsg.trim()}
                className={`w-full py-3 rounded-xl text-[8px] font-black uppercase shadow-md transition-all ${voiceMsg.trim()
                  ? 'bg-white text-blue-700 active:scale-95'
                  : 'bg-white/20 text-white/40 cursor-not-allowed'
                  }`}
              >
                <i className="fas fa-broadcast-tower mr-2"></i> Broadcast to Global Audience
              </button>
            </div>

            {/* NEWS QUICK BROADCAST */}
            {news.length > 0 && (
              <div className="bg-white p-4 rounded-2xl border border-green-100 shadow-sm space-y-3">
                <h3 className="text-[8px] font-black uppercase tracking-widest text-green-600 flex items-center">
                  <i className="fas fa-newspaper mr-2"></i> Quick News Broadcast
                </h3>
                <div className="space-y-2 max-h-[200px] overflow-y-auto no-scrollbar">
                  {news.slice(0, 5).map(n => (
                    <div key={n.id} className="bg-green-50/50 p-3 rounded-xl border border-green-100 space-y-2">
                      <h4 className="text-[9px] font-black text-green-950 line-clamp-1">{n.title}</h4>
                      <p className="text-[8px] text-green-800 line-clamp-2">{n.content}</p>
                      <button
                        onClick={async () => {
                          setIsProcessing(true);
                          setStatusMsg(`Broadcasting: ${n.title}`);
                          await onPushBroadcast?.(`Headline: ${n.title}. ${n.content}`);
                          setIsProcessing(false);
                          setStatusMsg("News Broadcast Complete.");
                          setTimeout(() => setStatusMsg(''), 3000);
                        }}
                        className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-[7px] font-black uppercase flex items-center justify-center shadow-sm active:scale-95 transition-all"
                      >
                        <i className="fas fa-volume-up mr-2"></i> Broadcast This
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* DISCUSSION PANEL */}
            <div className="bg-indigo-600 p-5 rounded-3xl text-white shadow-lg space-y-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center">
                <i className="fas fa-comments mr-2"></i> Tommy Bossman Discussion
              </h3>
              <textarea
                value={discussionText}
                onChange={(e) => setDiscussionText(e.target.value)}
                placeholder="Type a discussion topic for Tommy Bossman to broadcast..."
                className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-[10px] placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30 h-20 resize-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={async () => {
                    if (!discussionText.trim()) return;
                    setIsProcessing(true);
                    setStatusMsg("Broadcasting Discussion...");
                    const success = await onDiscussIssue?.(discussionText);
                    if (success) {
                      setDiscussionText('');
                      setStatusMsg("Discussion Broadcast Complete.");
                    } else {
                      setStatusMsg("Broadcast Failed. Try again.");
                    }
                    setIsProcessing(false);
                    setTimeout(() => setStatusMsg(''), 5000);
                  }}
                  disabled={!discussionText.trim()}
                  className={`py-3 rounded-xl text-[7px] font-black uppercase shadow-md transition-all ${discussionText.trim()
                    ? 'bg-white text-indigo-700 active:scale-95'
                    : 'bg-white/20 text-white/40 cursor-not-allowed'
                    }`}
                >
                  <i className="fas fa-broadcast-tower mr-1"></i> Broadcast Now
                </button>
                <button
                  onClick={async () => {
                    if (!discussionText.trim() || discussionQueue.length >= 10) return;
                    setIsProcessing(true);
                    await dbService.addToDiscussionQueue(discussionText);
                    setDiscussionText('');
                    await loadData();
                    setIsProcessing(false);
                    setStatusMsg("Added to Queue.");
                    setTimeout(() => setStatusMsg(''), 2000);
                  }}
                  disabled={!discussionText.trim() || discussionQueue.length >= 10}
                  className={`py-3 rounded-xl text-[7px] font-black uppercase shadow-md transition-all ${discussionText.trim() && discussionQueue.length < 10
                    ? 'bg-indigo-500 text-white border border-indigo-400 active:scale-95'
                    : 'bg-white/20 text-white/40 cursor-not-allowed'
                    }`}
                >
                  <i className="fas fa-clock mr-1"></i> Queue ({discussionQueue.length}/10)
                </button>
              </div>
            </div>

            {/* NEWSROOM ACTIVATION */}
            <div className="bg-purple-600 p-5 rounded-3xl text-white shadow-lg space-y-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center">
                <i className="fas fa-tv mr-2"></i> AI Newsroom Control
              </h3>
              <div className="flex items-center justify-between bg-white/10 p-3 rounded-xl border border-white/20">
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${isNewsroomActive ? 'bg-red-500 animate-pulse' : 'bg-gray-400'}`}></div>
                  <span className="text-[8px] font-bold uppercase">
                    {isNewsroomActive ? 'Newsroom ON AIR' : 'Newsroom Standby'}
                  </span>
                </div>
                {isNewsroomActive && (
                  <button
                    onClick={async () => {
                      await onEndNewsroom?.();
                      setStatusMsg("Newsroom Ended.");
                      setTimeout(() => setStatusMsg(''), 2000);
                    }}
                    className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg text-[7px] font-black uppercase active:scale-95 transition-all"
                  >
                    End Newsroom
                  </button>
                )}
              </div>
              {news.length > 0 && !isNewsroomActive && (
                <button
                  onClick={async () => {
                    const topNews = news.slice(0, 3).map(n => `${n.title}. ${n.content}`).join(' ');
                    setIsProcessing(true);
                    setStatusMsg("Activating AI Newsroom...");
                    await onTriggerNewsroom?.(topNews);
                    setIsProcessing(false);
                    setStatusMsg("Newsroom Activated.");
                    setTimeout(() => setStatusMsg(''), 3000);
                  }}
                  className="w-full bg-white text-purple-700 py-3 rounded-xl text-[8px] font-black uppercase shadow-md active:scale-95 transition-all"
                >
                  <i className="fas fa-users mr-2"></i> Activate Newsroom with Top Stories
                </button>
              )}
            </div>

            {/* FOLDER RELAY CONTROL */}
            <div className="bg-white p-5 rounded-3xl border-2 border-amber-100 shadow-md space-y-4">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                  <i className="fas fa-folder-tree text-amber-600"></i>
                </div>
                <div>
                  <h3 className="text-xs font-black uppercase text-amber-900">Folder Relay Control</h3>
                  <p className="text-[8px] text-amber-800/60 uppercase font-bold">Select and broadcast specific folders</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 max-h-[250px] overflow-y-auto no-scrollbar p-1">
                {Array.from(new Set(mediaList.map(m => m.folder || 'Uncategorized'))).map(f => (
                  <button
                    key={f}
                    onClick={() => onPlayFolder?.(f)}
                    className={`p-4 rounded-2xl border-2 text-[9px] font-black uppercase transition-all flex flex-col items-center justify-center space-y-2 ${activeFolder === f
                      ? 'bg-amber-600 border-amber-400 text-white shadow-lg scale-105 z-10'
                      : 'bg-white border-amber-50 text-amber-900/60 hover:border-green-200'
                      }`}
                  >
                    <i className={`fas ${activeFolder === f ? 'fa-broadcast-tower animate-pulse' : 'fa-folder'} text-lg`}></i>
                    <span className="truncate w-full text-center">{f}</span>
                  </button>
                ))}
              </div>

              <div className="pt-4 border-t border-amber-50">
                <button
                  onClick={onToggleRadio}
                  className={`w-full py-4 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all border-4 ${isRadioPlaying
                    ? 'bg-red-600 border-red-500/20 text-white shadow-red-900/20'
                    : 'bg-[#008751] border-green-500/20 text-white shadow-green-900/20'
                    }`}
                >
                  <i className={`fas ${isRadioPlaying ? 'fa-stop-circle' : 'fa-play-circle'} mr-2 text-sm`}></i>
                  {isRadioPlaying ? 'Kill Midway Signal' : 'Initialize Midway Live'}
                </button>
              </div>
            </div>

            {/* INSTANT JINGLES */}
            <div className="bg-white p-4 rounded-2xl border border-amber-100 space-y-3 shadow-sm">
              <h3 className="text-[7px] font-black uppercase tracking-widest text-amber-600 flex items-center">
                <i className="fas fa-bolt mr-2"></i> Instant Midway Jingles
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => onPlayJingle?.(1)} className="bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-xl text-[8px] font-black uppercase shadow-md active:scale-95 transition-all">ID 1 (Intro)</button>
                <button onClick={() => onPlayJingle?.(2)} className="bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-xl text-[8px] font-black uppercase shadow-md active:scale-95 transition-all">ID 2 (Outro)</button>
              </div>
            </div>
          </div>
        )
      }

      {
        activeTab === 'bulletin' && (
          <div className="space-y-4">
            <div className="bg-[#008751] p-6 rounded-3xl text-white shadow-lg">
              <h2 className="text-lg font-black uppercase italic mb-1">News Intelligence</h2>
              <button
                onClick={async () => {
                  setIsProcessing(true);
                  setStatusMsg("Scanning Diaspora News...");
                  await onTriggerFullBulletin?.();
                  setIsProcessing(false);
                  setStatusMsg("Auto-Pilot Synchronized.");
                  setTimeout(() => setStatusMsg(''), 3000);
                }}
                className="bg-white text-green-700 px-6 py-2.5 rounded-xl text-[8px] font-black uppercase shadow-md active:scale-95 transition-all"
              >
                <i className="fas fa-search-nodes mr-2"></i> Scan News & Auto-Pilot
              </button>
            </div>

            <div className="bg-indigo-600 p-5 rounded-3xl text-white shadow-lg space-y-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center">
                <i className="fas fa-comments mr-2"></i> Admin Discussion
              </h3>
              <textarea
                value={discussionText}
                onChange={(e) => setDiscussionText(e.target.value)}
                placeholder="Type a mild discussion or issue to broadcast..."
                className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-[10px] placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30 h-20 resize-none"
              />
              <button
                onClick={async () => {
                  if (!discussionText.trim()) return;
                  setIsProcessing(true);
                  setStatusMsg("Broadcasting Discussion...");
                  const success = await onDiscussIssue?.(discussionText);
                  if (success) {
                    setDiscussionText('');
                    setStatusMsg("Discussion Broadcast Complete.");
                  } else {
                    setStatusMsg("Broadcast Failed (TTS Error). Try again.");
                  }
                  setIsProcessing(false);
                  setTimeout(() => setStatusMsg(''), 5000);
                }}
                className="w-full bg-white text-indigo-700 py-3 rounded-xl text-[8px] font-black uppercase shadow-md active:scale-95 transition-all"
              >
                Broadcast Instantly (Tommy Bossman)
              </button>
              <button
                onClick={async () => {
                  if (!discussionText.trim() || discussionQueue.length >= 10) return;
                  setIsProcessing(true);
                  await dbService.addToDiscussionQueue(discussionText);
                  setDiscussionText('');
                  await loadData();
                  setIsProcessing(false);
                  setStatusMsg("Added to Queue.");
                  setTimeout(() => setStatusMsg(''), 2000);
                }}
                className="w-full bg-indigo-500 text-white py-2.5 rounded-xl text-[7px] font-black uppercase border border-indigo-400 shadow-sm active:scale-95 transition-all"
              >
                <i className="fas fa-clock mr-2"></i> Add to Scheduled Queue ({discussionQueue.length}/10)
              </button>
            </div>

            {discussionQueue.length > 0 && (
              <div className="bg-white p-4 rounded-3xl border border-indigo-100 shadow-sm space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-[8px] font-black uppercase text-indigo-600 tracking-widest">Scheduled Relay Queue</h3>
                  <span className="text-[6px] font-bold text-gray-400 uppercase">Relays (Every :15 & :45)</span>
                </div>
                <div className="divide-y divide-indigo-50">
                  {discussionQueue.map((item, idx) => {
                    const now = new Date();
                    const currentMin = now.getMinutes();

                    const getSlotTime = (indexInQueue: number) => {
                      let totalSlots = indexInQueue + 1;
                      let targetMin = currentMin;
                      let targetHour = now.getHours();

                      while (totalSlots > 0) {
                        if (targetMin < 15) { targetMin = 15; }
                        else if (targetMin < 45) { targetMin = 45; }
                        else { targetMin = 15; targetHour = (targetHour + 1) % 24; }
                        totalSlots--;
                      }
                      return `${targetHour}:${targetMin.toString().padStart(2, '0')}`;
                    };

                    return (
                      <div key={idx} className="flex items-center justify-between py-2 group">
                        <div className="flex flex-col min-w-0 pr-2">
                          <div className="flex items-center space-x-2">
                            <span className="text-[6px] font-black bg-indigo-100 text-indigo-600 px-1 rounded uppercase">Slot {getSlotTime(idx)}</span>
                            <h4 className="text-[8px] font-black text-indigo-950 truncate">Story #{idx + 1}</h4>
                          </div>
                          <p className="text-[8px] text-indigo-800/70 font-medium truncate mt-0.5">{item}</p>
                        </div>
                        <button
                          onClick={async () => {
                            await dbService.removeFromDiscussionQueue(idx);
                            await loadData();
                          }}
                          className="text-indigo-200 hover:text-red-500 transition-colors p-1"
                        >
                          <i className="fas fa-trash-can text-[9px]"></i>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {news.map(n => (
                <div key={n.id} className="bg-white p-4 rounded-2xl border border-green-50 shadow-sm space-y-3 animate-scale-in">
                  <h4 className="text-[10px] font-black text-green-950">{n.title}</h4>
                  <p className="text-[9px] text-green-800 font-medium">{n.content}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => handleManualBroadcast(n)} className="w-full bg-green-50 text-green-700 py-2 rounded-lg text-[7px] font-black uppercase flex items-center justify-center border border-green-100"><i className="fas fa-volume-up mr-2"></i> Voice</button>
                    <button onClick={() => onTriggerNewsroom?.(`Headline: ${n.title}. ${n.content}`)} className={`w-full py-2 rounded-lg text-[7px] font-black uppercase flex items-center justify-center border transition-all ${isNewsroomActive ? 'bg-indigo-600 text-white border-indigo-500 animate-pulse' : 'bg-indigo-50 text-indigo-700 border-indigo-100'}`}>
                      <i className={`fas ${isNewsroomActive ? 'fa-video' : 'fa-users'} mr-2`}></i> {isNewsroomActive ? 'On Air' : 'Newsroom'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      }

      {
        activeTab === 'media' && (
          <div className="space-y-4">
            <div className="flex bg-[#008751]/5 p-1 rounded-xl border border-green-100 items-center justify-between">
              <div className="flex flex-grow space-x-1">
                <button onClick={() => setMediaSubTab('audio')} className={`flex-grow py-2 text-[10px] font-black uppercase rounded-xl transition-all ${mediaSubTab === 'audio' ? 'bg-[#008751] text-white shadow-md' : 'text-green-600/60 hover:text-green-600'}`}>Tracks</button>
                <button onClick={() => setMediaSubTab('video')} className={`flex-grow py-2 text-[10px] font-black uppercase rounded-xl transition-all ${mediaSubTab === 'video' ? 'bg-[#008751] text-white shadow-md' : 'text-green-600/60 hover:text-green-600'}`}>Ads</button>
              </div>
              <div className="flex items-center space-x-2 ml-2">
                <button
                  onClick={handleAddFolder}
                  className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg active:scale-95 transition-all flex items-center"
                  title="Create New Folder"
                >
                  <i className="fas fa-plus-circle mr-2"></i> New Folder
                </button>
                <button
                  onClick={async () => {
                    setStatusMsg('Refreshing Library...');
                    await loadData();
                    setTimeout(() => setStatusMsg(''), 1000);
                  }}
                  className="w-9 h-9 flex items-center justify-center bg-white border border-green-100 text-green-600 hover:text-green-800 rounded-xl transition-colors shadow-sm"
                  title="Refresh Library"
                >
                  <i className="fas fa-sync-alt text-xs"></i>
                </button>
              </div>
            </div>
            {mediaSubTab === 'video' && (
              <div className="space-y-4">
                {/* MASTER TV CONTROL STAGE */}
                <div className="bg-black/95 p-4 rounded-3xl border-4 border-gray-800 shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-4 right-4 z-10 flex items-center space-x-2 bg-red-600 px-2 py-0.5 rounded-full animate-pulse border border-white/20">
                    <span className="w-1.5 h-1.5 bg-white rounded-full"></span>
                    <span className="text-[7px] text-white font-black uppercase tracking-widest">Master Control Stage</span>
                  </div>

                  <TVPlayer
                    playlist={tvPlaylist}
                    adverts={tvAdverts}
                    currentVideo={tvPlaylist.find(v => v.id === activeVideoId) || (tvPlaylist.length > 0 ? tvPlaylist[0] : undefined)}
                    onPlayVideo={onPlayVideo}
                    onVideoEnd={handleNextTvVideo}
                    showPlaylist={true} // ADMIN CAN SEE QUEUE
                    isNewsroomActive={isNewsroomActive}
                    newsroomContent={newsroomContent || undefined}
                    onNewsroomEnd={onEndNewsroom}
                  />

                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[8px] font-black text-white/30 uppercase tracking-[3px]">NDRTV Signal Status</span>
                      <span className="text-[10px] font-black text-green-500 uppercase flex items-center">
                        <i className="fas fa-signal mr-2"></i> Encrypted Loop Active
                      </span>
                    </div>
                    <button onClick={() => triggerUpload('video/*,image/*')} className="bg-white/10 hover:bg-white/20 text-white text-[7px] font-black uppercase px-4 py-2 rounded-xl border border-white/10 transition-all active:scale-95">
                      <i className="fas fa-plus mr-2"></i> Add Ad Content
                    </button>
                  </div>
                </div>
              </div>
            )}
            {/* FOLDER NAVIGATION / BACK BUTTON */}
            {currentFolder && (
              <button
                onClick={() => setCurrentFolder(null)}
                className="flex items-center text-[10px] font-black uppercase text-green-700 hover:text-green-950 transition-colors"
              >
                <i className="fas fa-chevron-left mr-2"></i> Back to Folders
              </button>
            )}

            {!currentFolder ? (
              <div className="space-y-4">
                <div className="px-2">
                  <h3 className="text-[9px] font-black uppercase text-green-800/40 tracking-[0.2em]">Storage Folders</h3>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {['Music', 'Jingles', 'Ads', 'News', 'Recordings'].map(folder => {
                    const count = mediaList.filter(m => m.folder === folder).length;
                    return (
                      <button
                        key={folder}
                        onClick={() => setCurrentFolder(folder)}
                        className="bg-white p-4 rounded-2xl border border-green-50 shadow-sm flex flex-col items-center justify-center space-y-2 hover:border-green-200 transition-all active:scale-95"
                      >
                        <i className="fas fa-folder text-2xl text-amber-500"></i>
                        <span className="text-[10px] font-black uppercase text-green-950">{folder}</span>
                        <span className="text-[7px] font-bold text-gray-400 uppercase">{count} Items</span>
                      </button>
                    );
                  })}

                  {/* Custom Folders from MidwayState */}
                  {(broadcast?.custom_folders || []).map(folder => {
                    const count = mediaList.filter(m => m.folder === folder).length;
                    return (
                      <button
                        key={folder}
                        onClick={() => setCurrentFolder(folder)}
                        className="bg-white p-4 rounded-2xl border border-blue-100 shadow-sm flex flex-col items-center justify-center space-y-2 hover:border-blue-200 transition-all active:scale-95"
                      >
                        <i className="fas fa-folder text-2xl text-blue-400"></i>
                        <span className="text-[10px] font-black uppercase text-green-950">{folder}</span>
                        <span className="text-[7px] font-bold text-gray-400 uppercase">{count} Items</span>
                      </button>
                    );
                  })}

                  {/* Dynamically detected folders that aren't in the default or custom lists */}
                  {Array.from(new Set(mediaList.map(m => m.folder || 'Uncategorized')))
                    .filter(f => !['Music', 'Jingles', 'Ads', 'News', 'Recordings'].includes(f as string) && !(broadcast?.custom_folders || []).includes(f as string))
                    .map(folder => {
                      const count = mediaList.filter(m => m.folder === folder).length;
                      return (
                        <button
                          key={folder}
                          onClick={() => setCurrentFolder(folder)}
                          className="bg-white p-4 rounded-2xl border border-green-50 shadow-sm flex flex-col items-center justify-center space-y-2 hover:border-green-200 transition-all active:scale-95"
                        >
                          <i className="fas fa-folder text-2xl text-green-400"></i>
                          <span className="text-[10px] font-black uppercase text-green-950">{folder}</span>
                          <span className="text-[7px] font-bold text-gray-400 uppercase">{count} Items</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-black uppercase text-green-950 tracking-widest flex items-center">
                    <i className="fas fa-folder-open mr-2 text-amber-500"></i> {currentFolder}
                  </h3>
                  <button onClick={() => triggerUpload()} className="text-[7px] font-black uppercase bg-green-600 text-white px-3 py-1.5 rounded-lg shadow-sm active:scale-95">Add to {currentFolder}</button>
                </div>

                <div className="grid gap-2">
                  {filteredMedia.filter(m => m.folder === currentFolder || (!m.folder && currentFolder === 'Uncategorized')).map(item => {
                    const hasLocal = !!item.file;
                    const hasCloud = !!item.url;
                    const pref = playbackPreferences[item.id] || (hasLocal ? 'local' : 'cloud');

                    return (
                      <div key={item.id} className="bg-white p-3 rounded-xl border border-green-50 flex items-center justify-between shadow-sm animate-scale-in">
                        <div className="flex items-center space-x-3 truncate pr-4">
                          <i className={`fas ${item.type === 'audio' ? 'fa-music' : 'fa-film'} text-xs text-green-600`}></i>
                          <div className="flex flex-col truncate">
                            <p className="text-[9px] font-bold text-green-950 truncate">{item.name}</p>
                            <div className="flex items-center space-x-2">
                              {hasCloud && (
                                <span className={`text-[6px] font-black uppercase flex items-center px-1.5 py-0.5 rounded bg-blue-50 border border-blue-100 ${pref === 'cloud' ? 'text-blue-600' : 'text-gray-400'}`}>
                                  <i className="fas fa-cloud mr-1"></i> Cloud Valid
                                </span>
                              )}
                              {!hasCloud && (
                                <span className="text-[6px] font-black uppercase flex items-center px-1.5 py-0.5 rounded bg-orange-50 border border-orange-100 text-orange-600">
                                  <i className="fas fa-circle-exclamation mr-1"></i> Local Only
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-1">
                          {/* Sync / Source Toggle */}
                          {hasCloud && !hasLocal && (
                            <button
                              onClick={() => handleSyncToLocal(item.id)}
                              className="w-7 h-7 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center"
                              title="Sync to Local Storage"
                            >
                              <i className="fas fa-cloud-download-alt text-[8px]"></i>
                            </button>
                          )}

                          {hasCloud && hasLocal && (
                            <button
                              onClick={() => setPlaybackPreferences(prev => ({
                                ...prev,
                                [item.id]: pref === 'cloud' ? 'local' : 'cloud'
                              }))}
                              className="w-12 h-6 bg-gray-100 rounded-full p-1 flex items-center transition-all relative"
                              title={`Currently Playing from ${pref === 'cloud' ? 'Cloud' : 'Local'}`}
                            >
                              <div className={`w-4 h-4 rounded-full shadow-sm flex items-center justify-center text-[6px] transition-all ${pref === 'cloud' ? 'translate-x-6 bg-blue-500 text-white' : 'bg-orange-500 text-white'}`}>
                                <i className={`fas ${pref === 'cloud' ? 'fa-cloud' : 'fa-hdd'}`}></i>
                              </div>
                              <span className={`absolute ${pref === 'cloud' ? 'left-2' : 'right-2'} text-[5px] font-black text-gray-400 uppercase`}>
                                {pref === 'cloud' ? 'CLD' : 'LOC'}
                              </span>
                            </button>
                          )}

                          <button
                            onClick={() => {
                              // Force play logic to use selected source
                              const playItem = { ...item };
                              if (pref === 'local' && item.file) {
                                playItem.url = URL.createObjectURL(item.file);
                              }
                              onPlayTrack(playItem);
                            }}
                            className="w-7 h-7 bg-green-50 text-green-600 rounded-full flex items-center justify-center font-black active:scale-95"
                          >
                            <i className="fas fa-play text-[8px]"></i>
                          </button>

                          <button onClick={() => dbService.deleteMedia(item.id).then(loadData)} className="w-7 h-7 bg-red-50 text-red-500 rounded-full flex items-center justify-center active:scale-95"><i className="fas fa-trash-alt text-[8px]"></i></button>
                        </div>
                      </div>
                    );
                  })}
                  {filteredMedia.filter(m => m.folder === currentFolder || (!m.folder && currentFolder === 'Uncategorized')).length === 0 && (
                    <div className="py-10 text-center opacity-40">
                      <i className="fas fa-inbox text-3xl mb-2"></i>
                      <p className="text-[8px] font-black uppercase tracking-widest">Folder Empty</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      }

      {
        activeTab === 'logs' && (
          <div className="space-y-3">
            <div className="bg-red-50 p-4 rounded-3xl border border-red-100 flex items-center justify-between shadow-sm">
              <div>
                <h4 className="text-[9px] font-black text-red-900 uppercase tracking-widest flex items-center">
                  <i className="fas fa-heartbeat mr-1"></i> Audio Engine Recovery
                </h4>
                <p className="text-[7px] text-red-700 font-bold leading-tight mt-1">If music is silent, use this to jumpstart the signal.</p>
              </div>
              <button
                onClick={async () => {
                  setStatusMsg('Repairing Audio Sequence...');
                  onRefreshData();
                  setTimeout(() => setStatusMsg('Signal Re-established.'), 2000);
                }}
                className="bg-red-600 text-white px-4 py-3 rounded-2xl text-[8px] font-black uppercase shadow-lg active:scale-95 transition-all"
              >
                Repair Audio
              </button>
            </div>

            <div className="bg-white rounded-3xl border border-indigo-100 p-4 max-h-[300px] overflow-y-auto font-mono text-[7px] shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-[8px] font-black uppercase text-indigo-600 tracking-widest">Active Station Logs</h3>
                <span className="text-[6px] font-black uppercase text-gray-400">Security & Relay</span>
              </div>
              {logs.map(log => (
                <div key={log.id} className="border-b border-indigo-50/50 py-2 flex justify-between last:border-0 hover:bg-indigo-50/20 transition-colors">
                  <span className="text-indigo-900 font-bold">{log.action}</span>
                  <span className="text-gray-400 shrink-0 ml-2">{new Date(log.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        )
      }
    </div >
  );
};

export default AdminView;
