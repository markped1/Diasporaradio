
import React, { useState, useEffect, useCallback, useRef } from 'react';
import TVPlayer from './TVPlayer';
import { NewsItem, MediaFile, AdminMessage, ListenerReport } from '../types';
import { dbService } from './../services/dbService';
import { CHANNEL_INTRO, DESIGNER_NAME, APP_NAME } from '../constants';

interface ListenerViewProps {
  news: NewsItem[];
  onStateChange: (isPlaying: boolean) => void;
  isRadioPlaying: boolean;
  tvPlaylist: MediaFile[];
  tvAdverts: MediaFile[];
  activeTrackUrl: string | null;
  currentTrackName: string;
  adminMessages: AdminMessage[];
  reports: ListenerReport[];
  onPlayTrack: (track: MediaFile) => void;
  isNewsroomActive?: boolean;
  newsroomContent?: string | null;
  expandedMedia: 'radio' | 'video' | 'none';
  setExpandedMedia: (val: 'radio' | 'video' | 'none') => void;
  activeVideoId?: string | null;
  activeVideoUrl?: string | null;
}

const ListenerView: React.FC<ListenerViewProps> = ({
  news,
  tvPlaylist,
  tvAdverts,
  reports,
  adminMessages = [],
  isRadioPlaying,
  onStateChange,
  activeTrackUrl,
  currentTrackName,
  onPlayTrack,
  isNewsroomActive,
  newsroomContent,
  expandedMedia,
  setExpandedMedia,
  activeVideoId,
  activeVideoUrl
}) => {
  const [location, setLocation] = useState<string>('Syncing...');
  const [localTime, setLocalTime] = useState<string>('');
  const [reportText, setReportText] = useState('');
  const [isReporting, setIsReporting] = useState(false);
  const [shareFeedback, setShareFeedback] = useState('');
  const [selectedVideo, setSelectedVideo] = useState<MediaFile | null>(null);

  const handleNextVideo = useCallback(() => {
    if (tvPlaylist.length === 0) return;
    const currentIndex = tvPlaylist.findIndex(v => v.id === selectedVideo?.id);
    const nextIndex = (currentIndex + 1) % tvPlaylist.length;
    setSelectedVideo(tvPlaylist[nextIndex]);
    console.log("📺 TV Auto-advancing to next video:", tvPlaylist[nextIndex].name);
  }, [tvPlaylist, selectedVideo]);

  // Initialize selected video
  useEffect(() => {
    if (tvPlaylist.length > 0 && !selectedVideo) {
      setSelectedVideo(tvPlaylist[0]);
    }
  }, [tvPlaylist, selectedVideo]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => setLocation(`Node: ${pos.coords.latitude.toFixed(1)}, ${pos.coords.longitude.toFixed(1)}`), () => setLocation('Global Diaspora'));
    }
    const timer = setInterval(() => setLocalTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleShare = async () => {
    const text = "📻 Tune in to Nigeria Diaspora Radio (NDR)! The voice of Nigerians abroad. Live news and culture. Listen here: ";
    const url = window.location.href.split('?')[0];
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Nigeria Diaspora Radio', text, url });
        setShareFeedback('Shared!');
      } else {
        await navigator.clipboard.writeText(`${text}${url}`);
        setShareFeedback('Link Copied!');
      }
    } catch (err) {
      console.warn("Share failed", err);
    } finally {
      setTimeout(() => setShareFeedback(''), 3000);
    }
  };

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportText.trim()) return;
    await dbService.addReport({
      id: Math.random().toString(36).substring(2, 9),
      reporterName: 'Listener',
      location,
      content: reportText,
      timestamp: Date.now()
    });
    setReportText('');
    setIsReporting(false);
    setShareFeedback('Report Sent!');
    setTimeout(() => setShareFeedback(''), 3000);
  };
  return (
    <div className="flex flex-col space-y-4 pb-8 px-1 text-[#008751] animate-scale-in">
      {/* 1. STATUS BAR */}
      <div className="flex justify-between items-center bg-white p-2 rounded-xl border border-green-100 shadow-sm relative overflow-hidden">
        <div className="flex flex-col z-10">
          <span className="text-[6px] font-black uppercase tracking-widest text-green-600">{location}</span>
          <span className="text-[6px] font-mono text-green-900 font-black">{localTime}</span>
        </div>

        <button
          onClick={handleShare}
          className="relative z-10 bg-[#008751] hover:bg-green-700 text-white px-4 py-1.5 rounded-full text-[7px] font-black uppercase tracking-widest shadow-md active:scale-95 transition-all flex items-center space-x-2"
        >
          <i className="fas fa-paper-plane"></i>
          <span>{shareFeedback || 'Invite Friends'}</span>
        </button>
        <div className="absolute top-0 right-0 w-16 h-16 bg-green-50/50 rounded-full -mr-8 -mt-8"></div>
      </div>

      {/* 2. NDRTV LIVE STAGE */}
      <section className="space-y-1">
        <TVPlayer
          playlist={tvPlaylist}
          adverts={tvAdverts}
          currentVideo={tvPlaylist.find(v => v.id === activeVideoId) || (tvPlaylist.length > 0 ? tvPlaylist[0] : undefined)}
          onPlayVideo={() => { }} // Listeners don't change the video themselves
          onVideoEnd={handleNextVideo}
          showPlaylist={false}
          isNewsroomActive={isNewsroomActive}
          newsroomContent={newsroomContent || undefined}
          isExpanded={expandedMedia === 'video'}
          onExpandToggle={(expanded) => setExpandedMedia(expanded ? 'video' : 'none')}
        />
      </section>

      {/* 2. COMMUNITY DESK (Journalist HQ) */}
      <section className="space-y-1">
        <div className="p-3 rounded-2xl border border-dashed border-green-200 bg-white/60 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-2 opacity-5 scale-150 rotate-12 group-hover:rotate-0 transition-all duration-700">
            <i className="fas fa-microphone-alt text-4xl"></i>
          </div>

          {!isReporting ? (
            <button
              onClick={() => setIsReporting(true)}
              className="w-full py-2.5 text-[7px] font-black text-[#008751] uppercase tracking-widest flex items-center justify-center bg-white rounded-xl border border-green-50 shadow-sm active:scale-95 transition-all"
            >
              <i className="fas fa-microphone-alt mr-2 text-red-500"></i> Contribute to the Diaspora Feed
            </button>
          ) : (
            <form onSubmit={handleReport} className="space-y-2 animate-scale-in relative z-10">
              <textarea
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                placeholder="Briefly describe what's happening near you..."
                className="w-full bg-green-50 border border-green-100 rounded-xl p-3 text-[9px] h-20 outline-none focus:border-green-400 font-medium resize-none shadow-inner"
              />
              <div className="flex space-x-2">
                <button type="submit" className="flex-1 bg-[#008751] text-white py-2.5 rounded-xl font-black text-[7px] uppercase tracking-widest shadow-md active:scale-95 transition-all">
                  Broadcast Report
                </button>
                <button type="button" onClick={() => setIsReporting(false)} className="px-5 bg-white text-green-700 py-2.5 rounded-xl text-[7px] font-black border border-green-100 active:scale-95 transition-all">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* 3. SONG REQUESTS / DEDICATIONS */}
      <section className="space-y-1">
        <div className="bg-white p-3 rounded-2xl border border-green-50 shadow-sm">
          <h3 className="text-[7px] font-black uppercase text-green-900 mb-2 flex items-center">
            <i className="fas fa-music mr-1.5 text-amber-500"></i> Request A Song / Dedication
          </h3>
          <div className="flex space-x-2">
            <input
              type="text"
              placeholder="Artist - Song Title (Dedication...)"
              className="flex-grow bg-green-50 border border-green-100 rounded-lg px-2 py-1.5 text-[8px] focus:outline-none focus:border-green-300"
              id="songRequestInput"
            />
            <button
              onClick={async () => {
                const input = document.getElementById('songRequestInput') as HTMLInputElement;
                if (input && input.value.trim()) {
                  await dbService.addReport({
                    id: Math.random().toString(36).substring(2, 9),
                    reporterName: 'Listener Request',
                    location: location,
                    content: `REQUEST: ${input.value}`,
                    timestamp: Date.now()
                  });
                  input.value = '';
                  alert('Request Sent to Studio!');
                }
              }}
              className="bg-amber-500 text-white px-3 py-1.5 rounded-lg text-[7px] font-black uppercase shadow-sm active:scale-95"
            >
              Send
            </button>
          </div>
        </div>
      </section>

      {/* 5. LIVE COMMUNITY REPORTS */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[7px] font-black uppercase text-green-600/40 tracking-[0.2em]">Live Community Reports</h3>
          <span className="text-[6px] font-black text-red-500 flex items-center">
            <span className="w-1 h-1 bg-red-500 rounded-full mr-1 animate-ping"></span> ON-AIR FEED
          </span>
        </div>
        <div className="bg-white/60 border border-green-50 rounded-2xl p-3 max-h-[150px] overflow-y-auto no-scrollbar shadow-inner">
          {reports.length > 0 ? (
            <div className="space-y-3">
              {reports.slice(0, 10).map((r) => (
                <div key={r.id} className="bg-white p-2.5 rounded-xl border border-green-50 shadow-sm animate-scale-in">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[7px] font-black text-green-800 uppercase flex items-center">
                      <i className="fas fa-map-marker-alt mr-1 text-red-500"></i> {r.location}
                    </span>
                    <span className="text-[6px] text-gray-400 font-mono">{new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-[9px] text-green-950 leading-relaxed font-medium">"{r.content}"</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center opacity-30 flex flex-col items-center">
              <i className="fas fa-broadcast-tower text-2xl mb-2 text-green-300"></i>
              <span className="text-[7px] font-black uppercase tracking-widest">No community reports</span>
            </div>
          )}
        </div>
      </section>


    </div >
  );
};

export default ListenerView;
