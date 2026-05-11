// supabase/functions/get-test-link/index.ts
// Generates a secure, time-limited quiz URL for TestPortal (or any quiz provider).
// Deploy: supabase functions deploy get-test-link

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // ── Auth: verify JWT ──────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond(401, { error: "Missing Authorization header" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return respond(401, { error: "Unauthorized" });

    // ── Get profile ───────────────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (!profile) return respond(404, { error: "Profile not found. Complete your profile first." });

    // ── Get quiz config ───────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const weekNum: number = body.week ?? null;

    let configQuery = supabase.from("quiz_config").select("*").eq("is_active", true);
    if (weekNum) configQuery = configQuery.eq("week_number", weekNum);
    const { data: cfg } = await configQuery.maybeSingle();

    if (!cfg) return respond(404, { error: "No active quiz found." });

    // ── Check if already submitted ────────────────────────────
    const { data: existing } = await supabase
      .from("quiz_scores")
      .select("id")
      .eq("user_id", user.id)
      .eq("week_number", cfg.week_number)
      .maybeSingle();
    if (existing) return respond(409, { error: "You have already submitted this quiz." });

    // ── Check time window ─────────────────────────────────────
    const now = new Date();
    if (cfg.opens_at  && now < new Date(cfg.opens_at))  return respond(403, { error: "Quiz has not opened yet." });
    if (cfg.closes_at && now > new Date(cfg.closes_at)) return respond(403, { error: "Quiz window has closed." });

    // ── Build quiz URL ────────────────────────────────────────
    // For TestPortal: embed user details as query params so the platform pre-fills them.
    // Adjust this section for your specific quiz provider's embed/API format.
    let quizUrl = cfg.quiz_url;

    if (quizUrl && quizUrl.includes("testportal")) {
      // TestPortal supports prefilling via query params
      const params = new URLSearchParams({
        email:      user.email!,
        first_name: (profile.full_name || "").split(" ")[0] || "",
        last_name:  (profile.full_name || "").split(" ").slice(1).join(" ") || "",
        college:    profile.college || "",
        roll:       profile.roll_number || "",
      });
      quizUrl = `${quizUrl}${quizUrl.includes("?") ? "&" : "?"}${params.toString()}`;
    } else if (quizUrl) {
      // Generic: append user identity for any quiz tool that supports it
      const params = new URLSearchParams({
        user_email: user.email!,
        user_name:  profile.full_name || "",
        week:       String(cfg.week_number),
      });
      quizUrl = `${quizUrl}${quizUrl.includes("?") ? "&" : "?"}${params.toString()}`;
    }

    return respond(200, {
      url:          quizUrl,
      week_number:  cfg.week_number,
      quiz_title:   cfg.quiz_title,
      time_limit:   cfg.time_limit_mins,
      max_score:    cfg.max_score,
      user_name:    profile.full_name,
      user_email:   user.email,
    });

  } catch (err) {
    console.error("get-test-link error:", err);
    return respond(500, { error: "Internal server error" });
  }
});

function respond(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
