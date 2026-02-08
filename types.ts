
export interface NewsItem {
  id: string;
  title: string;
  content: string;
  category: 'Nigeria' | 'Diaspora' | 'Culture' | 'Economy' | 'Listener Report' | 'Sports' | 'Global';
  timestamp: number;
  location?: string;
  sources?: string[];
  isVerified?: boolean;
}

export interface MediaFile {
  id: string;
  name: string;
  url: string; // This will hold the Object URL in-memory
  file?: File | Blob; // The persistent binary data
  type: 'audio' | 'video' | 'image';
  timestamp: number;
  likes?: number;
}

export interface AdminMessage {
  id: string;
  text: string;
  timestamp: number;
}

export interface DjScript {
  id: string;
  script: string;
  audioData?: string;
  timestamp: number;
}

export interface AdminLog {
  id: string;
  action: string;
  timestamp: number;
}

export interface ListenerReport {
  id: string;
  reporterName: string;
  location: string;
  content: string;
  timestamp: number;
}

export enum UserRole {
  LISTENER = 'LISTENER',
  ADMIN = 'ADMIN'
}

declare global {
  interface Window {
    puter: {
      ai: {
        txt2speech: (text: string, options?: any) => Promise<HTMLAudioElement>;
      };
    };
  }
}

export interface MidwayState {
  activeTrackId: string | null;
  activeTrackName: string;
  isPlaying: boolean;
  timestamp: number;
  discussion_queue?: string[]; // Up to 10 stories
  latest_news?: NewsItem[]; // Shared news items
  activeBroadcast?: {
    id: string;
    text: string;
    type: 'news' | 'jingle' | 'discussion';
    timestamp: number;
  };
  broadcastPulse?: number; // Heartbeat/Trigger for sync
  lastEvent?: {
    type: 'PLAY' | 'STOP' | 'SYNC';
    timestamp: number;
  };
}
