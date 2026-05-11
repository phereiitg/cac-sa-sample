// supabase/functions/quiz-webhook/index.ts
// Receives quiz result webhooks from TestPortal (or any quiz provider).
// TestPortal → Admin → Webhooks → add this function's URL.
// Deploy: supabase functions deploy quiz-webhook

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Expected TestPortal webhook payload (simplified) ────────
// {
//   "email": "student@example.com",
//   "first_name": "Jane",
//   "last_name": "Doe",
//   "test_id": "abc123",
//   "score": 87,
//   "max_score": 100,
//   "percentage": 87,
//   "duration": 1823,          // seconds taken
//   "feedback": "Well done!",
//   "answers": [               // if TestPortal sends detailed answers
//     { "question": "What is …", "chosen": "B", "correct": "B", "is_correct": true }
//   ]
// }

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respond(200, { ok: true });

  try {
    // ── Verify webhook secret (set in Supabase secrets) ───────
    const webhookSecret = Deno.env.get("QUIZ_WEBHOOK_SECRET");
    if (webhookSecret) {
      const incoming = req.headers.get("x-webhook-secret") || req.headers.get("x-testportal-secret");
      if (incoming !== webhookSecret) {
        console.warn("quiz-webhook: invalid secret");
        return respond(401, { error: "Unauthorized" });
      }
    }

    const payload = await req.json();
    console.log("quiz-webhook received:", JSON.stringify(payload));

    // ── Normalise fields (different providers use different keys) ─
    const email      = (payload.email || payload.user_email || "").toLowerCase().trim();
    const score      = Number(payload.score ?? payload.result ?? 0);
    const maxScore   = Number(payload.max_score ?? payload.maxScore ?? payload.total_score ?? 100);
    const percentage = Number(payload.percentage ?? payload.percent ?? (maxScore > 0 ? Math.round(score / maxScore * 100) : 0));
    const feedback   = payload.feedback ?? payload.comment ?? null;
    const timeSecs   = Number(payload.duration ?? payload.time_taken ?? 0);
    const testId     = payload.test_id ?? payload.testId ?? null;
    const answers    = Array.isArray(payload.answers) ? payload.answers : [];

    if (!email) return respond(400, { error: "Missing email in payload" });

    // ── Init Supabase with service role ───────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Find profile by email ─────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles").select("id").eq("email", email).maybeSingle();

    if (!profile) {
      console.warn("quiz-webhook: profile not found for email:", email);
      // Still store with email only (student may not have signed up yet)
    }

    // ── Determine week number ─────────────────────────────────
    // Try from payload first, then look up quiz_config by test_id
    let weekNumber: number | null = payload.week_number ?? payload.week ?? null;

    if (!weekNumber && testId) {
      const { data: cfg } = await supabase
        .from("quiz_config").select("week_number").eq("test_id", testId).maybeSingle();
      if (cfg) weekNumber = cfg.week_number;
    }

    if (!weekNumber) {
      // Fall back to whatever quiz is currently active
      const { data: activeCfg } = await supabase
        .from("quiz_config").select("week_number").eq("is_active", true).maybeSingle();
      if (activeCfg) weekNumber = activeCfg.week_number;
    }

    if (!weekNumber) return respond(400, { error: "Could not determine week number" });

    // ── Get current violation counts for this user + week ─────
    let tabSwitches    = 0;
    let fullscreenExits = 0;
    if (profile) {
      const { data: violations } = await supabase
        .from("quiz_violations")
        .select("violation_type")
        .eq("user_id", profile.id)
        .eq("week_number", weekNumber);

      if (violations) {
        tabSwitches     = violations.filter(v => v.violation_type === "tab_switch").length;
        fullscreenExits = violations.filter(v => v.violation_type === "fullscreen_exit").length;
      }
    }

    // ── Upsert quiz score ─────────────────────────────────────
    const scorePayload = {
      user_id:          profile?.id ?? null,
      email,
      week_number:      weekNumber,
      score,
      max_score:        maxScore,
      percentage,
      feedback,
      answers,
      time_taken_secs:  timeSecs,
      tab_switches:     tabSwitches,
      fullscreen_exits: fullscreenExits,
      submitted_at:     new Date().toISOString(),
    };

    const { error: upsertErr } = await supabase
      .from("quiz_scores")
      .upsert(scorePayload, { onConflict: "user_id,week_number" });

    if (upsertErr) {
      console.error("quiz-webhook: upsert error:", upsertErr);
      return respond(500, { error: "Failed to save score", detail: upsertErr.message });
    }

    console.log(`quiz-webhook: saved score ${score}/${maxScore} for ${email} week ${weekNumber}`);
    return respond(200, { ok: true, week: weekNumber, score, max_score: maxScore, percentage });

  } catch (err) {
    console.error("quiz-webhook: unhandled error:", err);
    return respond(500, { error: "Internal server error" });
  }
});

function respond(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
