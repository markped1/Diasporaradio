import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
    console.log("Checking Supabase Connection...");
    console.log("URL:", supabaseUrl);

    // Test Media Library Table
    const { data: tableData, error: tableError } = await supabase
        .from('media_library')
        .select('*')
        .limit(1);

    if (tableError) {
        console.error("❌ Media Library Table Error:", tableError.message);
    } else {
        console.log("✅ Media Library Table Accessible.");
    }

    // Test Storage Buckets
    const { data: buckets, error: listError } = await supabase
        .storage
        .listBuckets();

    if (listError) {
        console.error("❌ List Buckets Error:", listError.message);
    } else {
        console.log("✅ Available Buckets:", buckets.map(b => b.name).join(', ') || 'None');
        const mediaBucket = buckets.find(b => b.name === 'media');
        if (mediaBucket) {
            console.log(`✅ 'media' bucket exists (Public: ${mediaBucket.public})`);
        } else {
            console.log("❌ 'media' bucket is missing from the list.");
        }
    }
}

testConnection();
