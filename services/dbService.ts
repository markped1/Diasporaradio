import { NewsItem, DjScript, AdminLog, MediaFile, AdminMessage, ListenerReport, MidwayState } from '../types';
import { supabase } from './supabaseClient';

const DB_NAME = 'NDN_RADIO_DB';
const MEDIA_STORE = 'media_files';
const CACHE_STORE = 'cached_audio';
const DB_VERSION = 2;

class DBService {
  private STORAGE_KEYS = {
    NEWS: 'ndn_radio_news',
    SCRIPTS: 'ndn_radio_scripts',
    LOGS: 'ndn_radio_logs',
    ADMIN_MSGS: 'ndn_radio_admin_msgs',
    REPORTS: 'ndn_radio_reports',
    LAST_SYNC: 'ndn_radio_last_sync',
    MIDWAY: 'ndn_radio_midway',
    DISCUSSION_QUEUE: 'ndn_radio_discussion_queue'
  };

  private checkConfig() {
    if (!supabase) {
      throw new Error("Supabase configuration missing (VITE_SUPABASE_URL/ANON_KEY). Please add them to Vercel.");
    }
  }

  async getMidwayState(): Promise<MidwayState | null> {
    this.checkConfig();
    const { data, error } = await supabase
      .from('midway_state')
      .select('*')
      .eq('id', 'global')
      .single();

    if (error) {
      console.error("Supabase getMidwayState failed:", error);
      throw new Error(`Database Error: ${error.message} (${error.code || 'Unauthorized'})`);
    }

    if (data) {
      localStorage.setItem(this.STORAGE_KEYS.MIDWAY, JSON.stringify(data));
      return data;
    }

    const localData = localStorage.getItem(this.STORAGE_KEYS.MIDWAY);
    return localData ? JSON.parse(localData) : null;
  }

  async setMidwayState(state: MidwayState): Promise<void> {
    this.checkConfig();
    const { error } = await supabase
      .from('midway_state')
      .upsert({ id: 'global', ...state });

    if (error) {
      console.error("Supabase setMidwayState failed:", error);
      throw new Error(`Cloud Sync Error: ${error.message}`);
    }

    localStorage.setItem(this.STORAGE_KEYS.MIDWAY, JSON.stringify(state));
  }

  async updateMidwayState(partial: Partial<MidwayState>): Promise<void> {
    this.checkConfig();
    const current = await this.getMidwayState();
    const newState: MidwayState = {
      ...(current || { activeTrackId: null, activeTrackName: 'Live Stream', isPlaying: false, timestamp: Date.now() }),
      ...partial,
      timestamp: Date.now()
    };
    await this.setMidwayState(newState);
  }

  private async getDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event: any) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(MEDIA_STORE)) {
          db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getCachedAudio(key: string): Promise<Uint8Array | null> {
    const db = await this.getDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(CACHE_STORE, 'readonly');
      const store = transaction.objectStore(CACHE_STORE);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  async setCachedAudio(key: string, data: Uint8Array): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE, 'readwrite');
      const store = transaction.objectStore(CACHE_STORE);
      const request = store.put(data, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getNews(): Promise<NewsItem[]> {
    const data = localStorage.getItem(this.STORAGE_KEYS.NEWS);
    const localNews: NewsItem[] = data ? JSON.parse(data) : [];

    // Fallback/Merge logic: If we have a MidwayState, use its news
    try {
      const state = await this.getMidwayState();
      if (state?.latest_news && state.latest_news.length > 0) {
        return state.latest_news;
      }
    } catch (e) {
      console.warn("Could not sync remote news:", e);
    }

    const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000;
    return localNews.filter(n => n.timestamp > fortyEightHoursAgo);
  }

  async cleanupOldNews(): Promise<void> {
    const news = await this.getNews();
    const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000;
    const freshNews = news.filter(n => n.timestamp > fortyEightHoursAgo);
    localStorage.setItem(this.STORAGE_KEYS.NEWS, JSON.stringify(freshNews));
  }

  async saveNews(news: NewsItem[]): Promise<void> {
    const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000;
    const freshOnly = news.filter(n => n.timestamp > fortyEightHoursAgo);
    localStorage.setItem(this.STORAGE_KEYS.NEWS, JSON.stringify(freshOnly));
    localStorage.setItem(this.STORAGE_KEYS.LAST_SYNC, Date.now().toString());

    // Sync to Supabase so listeners see it
    try {
      if (supabase) {
        const state = await this.getMidwayState();
        await this.setMidwayState({
          ...(state || { activeTrackId: null, activeTrackName: 'Live Stream', isPlaying: false, timestamp: Date.now() }),
          latest_news: freshOnly
        });
      }
    } catch (e) {
      console.error("Supabase news sync failed:", e);
    }
  }

  async getLastSyncTime(): Promise<number> {
    const time = localStorage.getItem(this.STORAGE_KEYS.LAST_SYNC);
    return time ? parseInt(time, 10) : 0;
  }

  async addScript(script: DjScript): Promise<void> {
    const scripts = await this.getScripts();
    scripts.unshift(script);
    localStorage.setItem(this.STORAGE_KEYS.SCRIPTS, JSON.stringify(scripts.slice(0, 50)));
  }

  async getScripts(): Promise<DjScript[]> {
    const data = localStorage.getItem(this.STORAGE_KEYS.SCRIPTS);
    return data ? JSON.parse(data) : [];
  }

  async uploadMedia(file: File): Promise<string | null> {
    if (!supabase) return null;

    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
    const filePath = `music/${fileName}`;

    try {
      // Attempt to upload to 'media' bucket
      const { data, error } = await supabase.storage
        .from('media')
        .upload(filePath, file);

      if (error) {
        if (error.message.includes('bucket not found')) {
          throw new Error("Supabase Storage bucket 'media' not found. Please create a PUBLIC bucket named 'media' in your Supabase dashboard.");
        }
        throw error;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('media')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (e: any) {
      console.error("Supabase Storage Upload failed:", e);
      throw e;
    }
  }

  async addMedia(file: MediaFile): Promise<void> {
    const db = await this.getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(MEDIA_STORE, 'readwrite');
      const store = transaction.objectStore(MEDIA_STORE);
      if (!file.likes) file.likes = 0;
      const request = store.put(file);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // If it's a cloud file (URL exists and No binary file), sync to Global Persistent Library
    if (file.url && !file.file && supabase) {
      try {
        const { error } = await supabase
          .from('media_library')
          .upsert({
            id: file.id,
            name: file.name,
            url: file.url,
            type: file.type,
            timestamp: file.timestamp,
            likes: file.likes || 0
          });

        if (error) {
          console.error("Supabase Media Library sync error:", error);
          if (error.message.includes('relation "media_library" does not exist')) {
            throw new Error("Cloud Persistence Failed: Table 'media_library' missing. Please run the SQL provided in the instructions.");
          }
          throw error;
        }

        // Also trigger a pulse to notify listeners of library update
        await this.sendPulse('SYNC');
      } catch (e: any) {
        console.error("Global Library persistence failed:", e);
        throw e; // Propagate to UI
      }
    }
  }

  async getMedia(): Promise<MediaFile[]> {
    const db = await this.getDB();
    const localFiles = await new Promise<MediaFile[]>((resolve, reject) => {
      const transaction = db.transaction(MEDIA_STORE, 'readonly');
      const store = transaction.objectStore(MEDIA_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as MediaFile[]);
      request.onerror = () => reject(request.error);
    });

    // Merge with Persistent Global Media Library
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from('media_library')
          .select('*')
          .order('timestamp', { ascending: false });

        if (!error && data) {
          const mediaMap = new Map<string, MediaFile>();
          // Local files act as placeholders if cloud sync fails or for truly local files
          localFiles.forEach(f => mediaMap.set(f.id, f));
          // Cloud files overwrite/supplement local records
          data.forEach(f => mediaMap.set(f.id, f as MediaFile));
          return Array.from(mediaMap.values()).sort((a, b) => b.timestamp - a.timestamp);
        }
      }
    } catch (e) {
      console.warn("Could not fetch global persistent library:", e);
    }

    return localFiles.sort((a, b) => b.timestamp - a.timestamp);
  }

  async deleteMedia(id: string): Promise<void> {
    const db = await this.getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(MEDIA_STORE, 'readwrite');
      const store = transaction.objectStore(MEDIA_STORE);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // Remove from Global Persistent Registry
    try {
      if (supabase) {
        await supabase.from('media_library').delete().eq('id', id);
        await this.sendPulse('SYNC');
      }
    } catch (e) {
      console.warn("Global Library remove failed:", e);
    }
  }

  async getAdminMessages(): Promise<AdminMessage[]> {
    const data = localStorage.getItem(this.STORAGE_KEYS.ADMIN_MSGS);
    return data ? JSON.parse(data) : [];
  }

  async clearAdminMessages(): Promise<void> {
    localStorage.removeItem(this.STORAGE_KEYS.ADMIN_MSGS);
  }

  async addAdminMessage(msg: AdminMessage): Promise<void> {
    const msgs = await this.getAdminMessages();
    msgs.unshift(msg);
    // Keep only recent messages to prevent ticker bloat
    localStorage.setItem(this.STORAGE_KEYS.ADMIN_MSGS, JSON.stringify(msgs.slice(0, 5)));
  }

  async addReport(report: ListenerReport): Promise<void> {
    const reports = await this.getReports();
    reports.unshift(report);
    localStorage.setItem(this.STORAGE_KEYS.REPORTS, JSON.stringify(reports.slice(0, 50)));
  }

  async getReports(): Promise<ListenerReport[]> {
    const data = localStorage.getItem(this.STORAGE_KEYS.REPORTS);
    return data ? JSON.parse(data) : [];
  }

  async addLog(log: AdminLog): Promise<void> {
    const logs = await this.getLogs();
    logs.unshift(log);
    localStorage.setItem(this.STORAGE_KEYS.LOGS, JSON.stringify(logs.slice(0, 100)));
  }

  async getLogs(): Promise<AdminLog[]> {
    const data = localStorage.getItem(this.STORAGE_KEYS.LOGS);
    return data ? JSON.parse(data) : [];
  }

  subscribeToMidway(onUpdate: (state: MidwayState) => void) {
    if (!supabase) {
      console.warn("Supabase not configured. Realtime subscription skipped.");
      return { unsubscribe: () => { } };
    }

    const channel = supabase
      .channel('midway_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'midway_state', filter: 'id=eq.global' },
        (payload) => {
          if (payload.new) onUpdate(payload.new as MidwayState);
        }
      )
      .subscribe();

    return {
      unsubscribe: () => {
        supabase.removeChannel(channel);
      }
    };
  }

  async getDiscussionQueue(): Promise<string[]> {
    try {
      if (supabase) {
        const { data } = await supabase.from('midway_state').select('discussion_queue').eq('id', 'global').single();
        if (data?.discussion_queue) {
          localStorage.setItem(this.STORAGE_KEYS.DISCUSSION_QUEUE, JSON.stringify(data.discussion_queue));
          return data.discussion_queue;
        }
      }
    } catch (e) {
      console.warn("Queue fetch failed:", e);
    }
    const local = localStorage.getItem(this.STORAGE_KEYS.DISCUSSION_QUEUE);
    return local ? JSON.parse(local) : [];
  }

  async addToDiscussionQueue(text: string): Promise<void> {
    const current = await this.getDiscussionQueue();
    if (current.length >= 10) return;
    const updated = [...current, text];
    try {
      if (supabase) {
        await supabase.from('midway_state').upsert({ id: 'global', discussion_queue: updated });
      }
    } catch (e) {
      console.warn("Queue add failed:", e);
    }
    localStorage.setItem(this.STORAGE_KEYS.DISCUSSION_QUEUE, JSON.stringify(updated));
  }

  async popDiscussionQueue(): Promise<string | null> {
    const current = await this.getDiscussionQueue();
    if (current.length === 0) return null;
    const discussion = current[0];
    const remaining = current.slice(1);
    try {
      if (supabase) {
        await supabase.from('midway_state').upsert({ id: 'global', discussion_queue: remaining });
      }
    } catch (e) {
      console.warn("Queue pop failed:", e);
    }
    localStorage.setItem(this.STORAGE_KEYS.DISCUSSION_QUEUE, JSON.stringify(remaining));
    return discussion;
  }

  async removeFromDiscussionQueue(index: number): Promise<void> {
    const current = await this.getDiscussionQueue();
    const updated = current.filter((_, i) => i !== index);
    try {
      if (supabase) {
        await supabase.from('midway_state').upsert({ id: 'global', discussion_queue: updated });
      }
    } catch (e) {
      console.warn("Queue remove failed:", e);
    }
    localStorage.setItem(this.STORAGE_KEYS.DISCUSSION_QUEUE, JSON.stringify(updated));
  }

  async triggerBroadcastSync(text: string, type: 'news' | 'jingle' | 'discussion'): Promise<void> {
    this.checkConfig();
    const state = await this.getMidwayState();
    const updatedState: MidwayState = {
      ...(state || { activeTrackId: null, activeTrackName: 'Live Stream', isPlaying: false, timestamp: Date.now() }),
      activeBroadcast: {
        id: Math.random().toString(36).substr(2, 9),
        text,
        type,
        timestamp: Date.now()
      },
      broadcastPulse: Date.now() // Force event trigger
    };
    await this.setMidwayState(updatedState);
  }

  async sendPulse(type: 'PLAY' | 'STOP' | 'SYNC'): Promise<void> {
    this.checkConfig();
    const state = await this.getMidwayState();
    const updatedState: MidwayState = {
      ...(state || { activeTrackId: null, activeTrackName: 'Live Stream', isPlaying: false, timestamp: Date.now() }),
      broadcastPulse: Date.now(),
      lastEvent: {
        type,
        timestamp: Date.now()
      }
    };
    await this.setMidwayState(updatedState);
  }
}

export const dbService = new DBService();
