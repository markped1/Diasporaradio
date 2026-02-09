-- 🎙️ DIASPORA RADIO - COMPLETE SUPABASE SCHEMA

-- 1. Create the Midway State table (Core Synchronization Hub)
CREATE TABLE IF NOT EXISTS public.midway_state (
    id TEXT PRIMARY KEY DEFAULT 'global',
    activeTrackId TEXT,
    activeTrackName TEXT,
    activeTrackUrl TEXT,
    activeFolder TEXT,
    isPlaying BOOLEAN DEFAULT false,
    isNewsroomActive BOOLEAN DEFAULT false,
    newsroomContent TEXT,
    activeVideoId TEXT,
    activeVideoUrl TEXT,
    custom_folders JSONB DEFAULT '[]',
    broadcastPulse BIGINT,
    activeBroadcast JSONB,
    latest_news JSONB DEFAULT '[]',
    discussion_queue JSONB DEFAULT '[]',
    lastEvent JSONB,
    timestamp BIGINT DEFAULT extract(epoch from now()) * 1000
);

-- 2. Create the Media Library Table (Persistent Cloud Library)
CREATE TABLE IF NOT EXISTS public.media_library (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    type TEXT NOT NULL,
    timestamp BIGINT NOT NULL,
    likes INTEGER DEFAULT 0,
    folder TEXT DEFAULT 'Uncategorized'
);

-- 3. Enable Realtime for midway_state (Instant Listener Relay)
ALTER TABLE public.midway_state REPLICA IDENTITY FULL;
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime FOR TABLE midway_state;
COMMIT;

-- 4. Set Permissions (Row Level Security)
ALTER TABLE public.midway_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read/Write Access" ON public.midway_state FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Read/Write Access" ON public.media_library FOR ALL USING (true) WITH CHECK (true);

-- 5. Insert Initial Global State
INSERT INTO public.midway_state (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;

-- 6. Storage Instructions:
-- Create a PUBLIC bucket named 'media' in the Supabase Storage dashboard.
