// ============================================================
// js/auth.js — shared auth helpers
// ============================================================

async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = "/index.html"; return null; }
  return session;
}

async function requireAdmin() {
  const session = await requireAuth();
  if (!session) return null;
  const profile = await getProfile(session.user.id);
  if (!profile || !profile.is_admin) {
    window.location.href = "/dashboard.html";
    return null;
  }
  return { session, profile };
}

async function redirectIfLoggedIn() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const profile = await getProfile(session.user.id);
  window.location.href = profile ? "/dashboard.html" : "/complete-profile.html";
}

async function getProfile(userId) {
  const { data, error } = await supabaseClient
    .from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) { console.error("getProfile:", error); return null; }
  return data;
}

async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.href = "/index.html";
}

async function signInWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${location.origin}/auth-callback.html` },
  });
  if (error) showToast("Login failed: " + error.message, "error");
}

// ── Utility toast ─────────────────────────────────────────────
function showToast(msg, type = "info") {
  let t = document.getElementById("_toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "_toast";
    t.style.cssText = "position:fixed;bottom:1.5rem;right:1.5rem;z-index:99999;display:flex;flex-direction:column;gap:0.5rem;pointer-events:none;";
    document.body.appendChild(t);
  }
  const el = document.createElement("div");
  const colors = { info:"#3b82f6", success:"#00d4aa", error:"#f87171", warn:"#fbbf24" };
  el.style.cssText = `background:${colors[type]||colors.info};color:#0b0f1a;padding:0.75rem 1.25rem;border-radius:10px;font-weight:600;font-size:0.88rem;box-shadow:0 4px 20px rgba(0,0,0,0.4);opacity:1;transition:opacity 0.4s;`;
  el.textContent = msg;
  t.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 400); }, 3000);
}
