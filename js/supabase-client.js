// ============================================================
// js/supabase-client.js — Supabase initialisation
// Replace SUPABASE_URL and SUPABASE_ANON with your project values
// Dashboard → Settings → API
// ============================================================

const SUPABASE_URL  = "https://fbgmoutgantwphhoncni.supabase.co";
const SUPABASE_ANON = "sb_publishable_n1OJCANgPcFCta6fXBmbUQ_o7pYuYAd";

// supabaseClient is used throughout all pages
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  }
});
