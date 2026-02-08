
import React, { useState, useEffect, useRef } from 'react';
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
  onDiscussIssue?: (text: string) => Promise<boolean>;
  onPing?: () => void;
  news?: NewsItem[];
  onTriggerFullBulletin?: () => Promise<void>;
}

type Tab = 'command' | 'bulletin' | 'media' | 'inbox' | 'logs';
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
  news = [],
  onTriggerFullBulletin
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('command');
  const [mediaSubTab, setMediaSubTab] = useState<MediaSubTab>('audio');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [mediaList, setMediaList] = useState<MediaFile[]>([]);
  const [reports, setReports] = useState<ListenerReport[]>([]);
  const [voiceMsg, setVoiceMsg] = useState('');
  const [discussionText, setDiscussionText] = useState('');
  const [discussionQueue, setDiscussionQueue] = useState<string[]>([]);
  const [nextSyncIn, setNextSyncIn] = useState<string>('');
  const [midway, setMidway] = useState<MidwayState | null>(null);
  const [apiHealth, setApiHealth] = useState<'IDLE' | 'CHECKING' | 'HEALTHY' | 'ERROR'>('IDLE');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    const [m, r, mid, dq] = await Promise.all([
      dbService.getMedia(),
      dbService.getReports(),
      dbService.getMidwayState(),
      dbService.getDiscussionQueue()
    ]);
    setMediaList(m || []);
    setReports(r || []);
    setMidway(mid);
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
    let count = 0;
    try {
      const isCloud = window.confirm("Do you want to upload these files to the CLOUD for global listeners? \n\n(Requires a public 'media' bucket in Supabase. Cancel to keep them local-only.)");

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.startsWith('.') || file.name.includes('DS_Store')) continue;
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const mime = file.type.toLowerCase();
        const isAudio = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext) || mime.startsWith('audio/');
        const isVideo = ['mp4', 'webm', 'mov'].includes(ext) || mime.startsWith('video/');
        const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) || mime.startsWith('image/');
        let finalType: 'audio' | 'video' | 'image' = isAudio ? 'audio' : (isVideo ? 'video' : 'image');
        if (!isAudio && !isVideo && !isImage) continue;

        setStatusMsg(`Processing: ${count + 1}...`);

        let cloudUrl = '';
        if (isCloud) {
          try {
            cloudUrl = await dbService.uploadMedia(file) || '';
          } catch (err: any) {
            alert(err.message);
            break;
          }
        }

        await dbService.addMedia({
          id: 'media-' + Math.random().toString(36).substr(2, 9),
          name: file.name,
          url: cloudUrl,
          file: cloudUrl ? undefined : file, // Don't store local file if we have cloud URL
          type: finalType,
          timestamp: Date.now(),
          likes: 0
        });
        count++;
      }
      setStatusMsg(`Success: ${count} items added.`);
      onRefreshData();
      await loadData();
    } catch (error) { setStatusMsg('Import Error.'); }
    finally { setIsProcessing(false); setTimeout(() => setStatusMsg(''), 5000); if (e.target) e.target.value = ''; }
  };

  const handleManualBroadcast = async (item: NewsItem) => {
    setIsProcessing(true);
    setStatusMsg(`Broadcasting: ${item.title}`);
    await onPushBroadcast?.(`Headline: ${item.title}. ${item.content}`);
    setIsProcessing(false);
    setStatusMsg(`Broadcast complete.`);
    setTimeout(() => setStatusMsg(''), 3000);
  };

  const triggerUpload = (accept: string) => {
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
          {(['command', 'bulletin', 'media', 'inbox', 'logs'] as Tab[]).map(t => (
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

      <div className="mx-1 px-4 py-3 bg-purple-600 text-white rounded-2xl shadow-xl border border-purple-400 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-2 opacity-20 group-hover:opacity-40 transition-opacity">
          <i className="fas fa-random text-3xl"></i>
        </div>
        <div className="relative z-10 flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
              <h3 className="text-[9px] font-black uppercase tracking-[0.2em]">Midway Relay</h3>
            </div>
            <p className="text-[10px] font-bold truncate max-w-[200px]">
              {midway ? midway.activeTrackName : 'Idle - No Relay'}
            </p>
          </div>
          <div className="text-right">
            <span className="text-[7px] font-black uppercase bg-white/20 px-2 py-0.5 rounded-full">
              {midway?.isPlaying ? 'On Air' : 'Standby'}
            </span>
          </div>
        </div>
      </div>

      {statusMsg && <div className="mx-1 p-2 text-[8px] font-black uppercase text-center rounded-lg bg-green-600 text-white border border-green-700 animate-pulse shadow-sm">{statusMsg}</div>}

      {
        activeTab === 'command' && (
          <div className="space-y-4">
            <div className="bg-white p-6 rounded-3xl text-center border border-green-100 shadow-md relative">
              <button onClick={isRadioPlaying ? onToggleRadio : onPlayAll} className={`w-28 h-28 rounded-full border-8 ${isRadioPlaying ? 'bg-red-500 border-red-50' : 'bg-[#008751] border-green-50'} text-white flex flex-col items-center justify-center mx-auto mb-4 shadow-2xl active:scale-95 transition-all`}>
                <i className={`fas ${isRadioPlaying ? 'fa-stop' : 'fa-play'} text-3xl mb-1`}></i>
                <span className="text-[9px] font-black uppercase tracking-widest">{isRadioPlaying ? 'Stop' : 'Go Live'}</span>
              </button>
              <div className="bg-green-50 py-2.5 px-5 rounded-2xl border border-green-100 inline-block shadow-inner"><span className="text-[8px] font-black text-green-700 uppercase block tracking-widest truncate max-w-[200px]">{currentTrackName}</span></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => folderInputRef.current?.click()} className="bg-white p-4 rounded-2xl border border-green-100 flex flex-col items-center justify-center space-y-2 hover:bg-green-50 shadow-sm"><i className="fas fa-folder-open text-lg text-green-600"></i><span className="text-[8px] font-black uppercase tracking-widest">Import Folder</span></button>
              <div className="bg-white p-4 rounded-2xl border border-amber-100 space-y-2 shadow-sm">
                <h3 className="text-[7px] font-black uppercase tracking-widest text-amber-600">Jingles</h3>
                <div className="flex space-x-2">
                  <button onClick={() => onPlayJingle?.(1)} className="flex-1 bg-amber-500 text-white py-2 rounded-lg text-[7px] font-black uppercase">ID 1</button>
                  <button onClick={() => onPlayJingle?.(2)} className="flex-1 bg-amber-500 text-white py-2 rounded-lg text-[7px] font-black uppercase">ID 2</button>
                </div>
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
                  <button onClick={() => handleManualBroadcast(n)} className="w-full bg-green-50 text-green-700 py-2 rounded-lg text-[7px] font-black uppercase flex items-center justify-center"><i className="fas fa-volume-up mr-2"></i> Voice Broadcast Story</button>
                </div>
              ))}
            </div>
          </div>
        )
      }

      {
        activeTab === 'media' && (
          <div className="space-y-4">
            <div className="flex bg-[#008751]/5 p-1 rounded-xl border border-green-100">
              <button onClick={() => setMediaSubTab('audio')} className={`flex-1 py-2 text-[8px] font-black uppercase rounded-lg ${mediaSubTab === 'audio' ? 'bg-white text-[#008751] shadow-sm' : 'text-green-600/60'}`}>Tracks</button>
              <button onClick={() => setMediaSubTab('video')} className={`flex-1 py-2 text-[8px] font-black uppercase rounded-lg ${mediaSubTab === 'video' ? 'bg-white text-[#008751] shadow-sm' : 'text-green-600/60'}`}>Ads</button>
            </div>
            {mediaSubTab === 'video' && (
              <button onClick={() => triggerUpload('video/*,image/*')} className="w-full bg-blue-600 text-white py-4 rounded-2xl flex flex-col items-center justify-center shadow-lg active:scale-95 transition-all"><i className="fas fa-cloud-upload-alt text-xl mb-1"></i><span className="text-[10px] font-black uppercase tracking-widest">Upload New Ad Content</span></button>
            )}
            <div className="grid gap-2">
              {filteredMedia.map(item => (
                <div key={item.id} className="bg-white p-3 rounded-xl border border-green-50 flex items-center justify-between shadow-sm animate-scale-in">
                  <div className="flex items-center space-x-3 truncate pr-4">
                    <i className={`fas ${item.type === 'audio' ? 'fa-music' : 'fa-film'} text-xs text-green-600`}></i>
                    <div className="flex flex-col truncate">
                      <p className="text-[9px] font-bold text-green-950 truncate">{item.name}</p>
                      <div className="flex items-center space-x-1">
                        {item.url ? (
                          <span className="text-[6px] font-black uppercase text-blue-500 flex items-center">
                            <i className="fas fa-cloud mr-1"></i> Cloud Synced
                          </span>
                        ) : (
                          <span className="text-[6px] font-black uppercase text-amber-500 flex items-center">
                            <i className="fas fa-microchip mr-1"></i> Local Only
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex space-x-1">
                    <button onClick={() => onPlayTrack(item)} className="w-7 h-7 bg-green-50 text-green-600 rounded-full flex items-center justify-center"><i className="fas fa-play text-[8px]"></i></button>
                    <button onClick={() => dbService.deleteMedia(item.id).then(loadData)} className="w-7 h-7 bg-red-50 text-red-500 rounded-full flex items-center justify-center"><i className="fas fa-trash-alt text-[8px]"></i></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      }

      {
        activeTab === 'logs' && (
          <div className="bg-white rounded-xl border border-green-50 p-2 max-h-[300px] overflow-y-auto font-mono text-[7px]">
            {logs.map(log => (
              <div key={log.id} className="border-b border-green-50 py-1 flex justify-between">
                <span className="text-green-700">{log.action}</span>
                <span className="text-gray-400 shrink-0 ml-2">{new Date(log.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )
      }
    </div >
  );
};

export default AdminView;
