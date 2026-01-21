const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;

/**
 * Initialize Supabase client
 */
function initSupabase() {
    if (!supabaseUrl || !supabaseServiceKey) {
        console.warn('[SUPABASE] ⚠️ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
        return null;
    }

    if (!supabase) {
        supabase = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });
        console.log('[SUPABASE] ✅ Client initialized');
    }

    return supabase;
}

/**
 * Get Supabase client instance
 */
function getSupabase() {
    if (!supabase) {
        return initSupabase();
    }
    return supabase;
}

/**
 * Check if Supabase is configured
 */
function isConfigured() {
    return !!(supabaseUrl && supabaseServiceKey);
}

module.exports = {
    initSupabase,
    getSupabase,
    isConfigured
};
