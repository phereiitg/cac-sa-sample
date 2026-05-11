// ============================================================
// js/dashboard.js
// ============================================================

// ── Config ───────────────────────────────────────────────────
const API_BASE = "https://fbgmoutgantwphhoncni.supabase.co/functions/v1";

// ── State ─────────────────────────────────────────────────────
let currentUser   = null;
let currentProfile= null;
let quizConfig    = null;   // active quiz config from DB
let violationCount= 0;
let quizTimerInterval = null;
let quizStartTime = null;

// ============================================================
// Boot
// ============================================================
(async () => {
  const session = await requireAuth();
  if (!session) return;

  currentUser    = session.user;
  currentProfile = await getProfile(currentUser.id);

  if (!currentProfile) { window.location.href = "/complete-profile.html"; return; }

  populateUser();
  loadAnnouncements();
  loadWeeks();
  loadOverview();
  loadMyResults();
  loadQuizStatus();

  document.getElementById("sidebarToggle")?.addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });

  // Close sidebar on backdrop click (mobile)
  document.addEventListener("click", e => {
    const sidebar = document.getElementById("sidebar");
    if (window.innerWidth <= 768 && sidebar.classList.contains("open") && !sidebar.contains(e.target) && e.target.id !== "sidebarToggle") {
      sidebar.classList.remove("open");
    }
  });
})();

// ============================================================
// User info
// ============================================================
function populateUser() {
  const name    = currentProfile.full_name || currentUser.email;
  const initial = name.charAt(0).toUpperCase();

  const el = id => document.getElementById(id);
  if (el("heroName")) el("heroName").textContent = name.split(" ")[0];
  if (el("sidebarName")) el("sidebarName").textContent = name;
  if (el("avatarInitial")) el("avatarInitial").textContent = initial;
  if (el("avatarInitialMobile")) el("avatarInitialMobile").textContent = initial;
}

// ============================================================
// Tab switching
// ============================================================
function switchTab(name) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById(`tab-${name}`)?.classList.add("active");
  document.querySelector(`.nav-item[data-tab="${name}"]`)?.classList.add("active");
  if (name === "leaderboard") loadLeaderboard();
  document.getElementById("sidebar").classList.remove("open");
}

// ============================================================
// Announcements
// ============================================================
async function loadAnnouncements() {
  const { data } = await supabaseClient
    .from("announcements").select("*").eq("is_active", true).order("pinned", {ascending: false}).order("created_at", {ascending: false}).limit(3);

  const area = document.getElementById("announcementsArea");
  if (!data || data.length === 0) { area.innerHTML = ""; return; }

  area.innerHTML = data.map(a => `
    <div class="announcement-box" id="ann-${a.id}">
      <div class="ann-header">
        <div class="ann-title">${escHtml(a.title)}</div>
        <button class="ann-close" onclick="document.getElementById('ann-${a.id}').remove()">×</button>
      </div>
      ${a.body ? `<div class="ann-body">${escHtml(a.body)}</div>` : ""}
      ${a.links && a.links.length ? `<div class="ann-links">${a.links.map(l => `<a class="ann-link" href="${escHtml(l.url)}" target="_blank" rel="noopener"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>${escHtml(l.label)}</a>`).join("")}</div>` : ""}
    </div>
  `).join("");
}

// ============================================================
// Course content (weeks from Supabase)
// ============================================================
async function loadWeeks() {
  const container = document.getElementById("weeksList");

  const { data: weeks, error } = await supabaseClient
    .from("weeks").select("*").eq("is_published", true).order("week_number");

  if (error || !weeks || weeks.length === 0) {
    container.innerHTML = `<div style="color:var(--muted);padding:2rem 0;font-size:0.88rem;">No weeks published yet. Check back soon!</div>`;
    return;
  }

  // Fetch all days for published weeks in one query
  const weekIds = weeks.map(w => w.id);
  const { data: days } = await supabaseClient
    .from("week_days").select("*").in("week_id", weekIds).order("week_id").order("day_number");

  const daysByWeek = {};
  (days || []).forEach(d => {
    if (!daysByWeek[d.week_id]) daysByWeek[d.week_id] = [];
    daysByWeek[d.week_id].push(d);
  });

  // Update week badge
  const latestWeek = weeks[weeks.length - 1];
  document.getElementById("weekBadge").textContent = latestWeek.title || `Week ${latestWeek.week_number}`;

  container.innerHTML = weeks.map((w, i) => {
    const wDays = daysByWeek[w.id] || [];
    return buildWeekAccordion(w, wDays, i === weeks.length - 1);
  }).join("");
}

function buildWeekAccordion(week, days, defaultOpen = false) {
  const daysHtml = days.length === 0
    ? `<tr><td colspan="5" style="color:var(--muted);padding:1.5rem;text-align:center;font-size:0.85rem;">Content coming soon…</td></tr>`
    : days.map(d => {
        const tasks = [
          { label: d.task1_label, url: d.task1_url },
          { label: d.task2_label, url: d.task2_url },
          { label: d.task3_label, url: d.task3_url },
        ].filter(t => t.label);

        const taskCell = (label, url) => {
          if (!label) return `<td class="task-cell"><span class="coming-soon">—</span></td>`;
          if (!url || url === "#") return `<td class="task-cell"><span style="color:var(--text);font-size:0.82rem;">${escHtml(label)}</span></td>`;
          return `<td class="task-cell"><a class="task-link" href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(label)}<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a></td>`;
        };

        return `
          <tr>
            <td class="day-cell">Day ${d.day_number}</td>
            <td class="desc-cell">${escHtml(d.description || "")}</td>
            ${taskCell(d.task1_label, d.task1_url)}
            ${taskCell(d.task2_label, d.task2_url)}
            ${taskCell(d.task3_label, d.task3_url)}
          </tr>
        `;
      }).join("");

  return `
    <div class="week-accordion ${defaultOpen ? "open" : ""}" id="wacc-${week.id}">
      <div class="week-accordion-header" onclick="toggleAccordion('wacc-${week.id}')">
        <div class="wah-left">
          <div class="wah-badge">W${week.week_number}</div>
          <div class="wah-title">${escHtml(week.title || `Week ${week.week_number}`)}</div>
        </div>
        <svg class="wah-chevron" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="week-content">
        <table class="week-table">
          <thead><tr>
            <th>Week ${week.week_number}</th>
            <th>What's In There</th>
            <th>Task 1</th>
            <th>Task 2</th>
            <th>Task 3</th>
          </tr></thead>
          <tbody>${daysHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

function toggleAccordion(id) {
  document.getElementById(id)?.classList.toggle("open");
}

// ============================================================
// Overview
// ============================================================
async function loadOverview() {
  const { data: scores } = await supabaseClient
    .from("quiz_scores").select("score, max_score, week_number").eq("user_id", currentUser.id).order("score", {ascending: false});

  if (scores && scores.length > 0) {
    const best = scores[0];
    document.getElementById("bestScore").textContent = `${best.score}/${best.max_score}`;
    document.getElementById("quizCount").textContent = scores.length;
  } else {
    document.getElementById("bestScore").textContent = "No quizzes yet";
    document.getElementById("quizCount").textContent = "0";
  }

  const rank = await getUserRank(currentUser.id);
  document.getElementById("globalRank").textContent = rank ? `#${rank}` : "—";
}

async function getUserRank(userId) {
  const { data } = await supabaseClient.from("quiz_scores").select("user_id, score");
  if (!data || !data.length) return null;
  const totals = {};
  data.forEach(r => { totals[r.user_id] = (totals[r.user_id] || 0) + Number(r.score); });
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const idx = sorted.findIndex(([uid]) => uid === userId);
  return idx === -1 ? null : idx + 1;
}

// ============================================================
// Leaderboard
// ============================================================
async function loadLeaderboard() {
  const tbody = document.getElementById("lbBody");
  tbody.innerHTML = `<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:2rem;">Loading…</td></tr>`;

  const { data, error } = await supabaseClient
    .from("quiz_scores").select("user_id, score, profiles(full_name, college)");

  if (error || !data || !data.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:2rem;">No scores yet. Be the first!</td></tr>`;
    return;
  }

  const map = {};
  data.forEach(r => {
    if (!map[r.user_id]) map[r.user_id] = { uid: r.user_id, name: r.profiles?.full_name || "Anonymous", college: r.profiles?.college || "—", total: 0 };
    map[r.user_id].total += Number(r.score);
  });

  const rows = Object.values(map).sort((a, b) => b.total - a.total);
  document.getElementById("lbUpdated").textContent = "Updated " + new Date().toLocaleTimeString("en-IN");

  tbody.innerHTML = rows.slice(0, 100).map((row, i) => {
    const rank = i + 1;
    const isYou = row.uid === currentUser.id;
    const bc = rank===1?"rank-1":rank===2?"rank-2":rank===3?"rank-3":"rank-n";
    return `
      <tr class="${isYou ? "you" : ""}">
        <td><span class="rank-badge ${bc}">${rank}</span></td>
        <td>${escHtml(row.name)} ${isYou ? '<span style="color:var(--accent);font-size:0.75rem;">(you)</span>' : ""}</td>
        <td style="color:var(--muted);">${escHtml(row.college)}</td>
        <td style="font-family:'DM Mono',monospace;font-weight:700;">${row.total}</td>
      </tr>`;
  }).join("");
}

// ============================================================
// My Results
// ============================================================
async function loadMyResults() {
  const grid = document.getElementById("resultsGrid");

  const { data: scores } = await supabaseClient
    .from("quiz_scores").select("*").eq("user_id", currentUser.id).order("week_number");

  if (!scores || !scores.length) {
    grid.innerHTML = `<div style="color:var(--muted);font-size:0.88rem;grid-column:1/-1;">No quiz results yet. Complete a weekly quiz to see your results here.</div>`;
    return;
  }

  grid.innerHTML = scores.map(s => {
    const pct = s.max_score > 0 ? Math.round((s.score / s.max_score) * 100) : 0;
    const barColor = pct >= 80 ? "var(--accent)" : pct >= 50 ? "var(--warn)" : "var(--danger)";
    const pctColor = pct >= 80 ? "color:var(--accent)" : pct >= 50 ? "color:var(--warn)" : "color:var(--danger)";
    return `
      <div class="result-card">
        <div class="rc-week">Week ${s.week_number} Quiz</div>
        <div class="rc-score">
          <div class="rc-score-big">${s.score}</div>
          <div class="rc-score-max">/ ${s.max_score}</div>
          <div class="rc-pct" style="${pctColor};margin-left:auto;">${pct}%</div>
        </div>
        <div class="rc-bar"><div class="rc-bar-fill" style="width:${pct}%;background:${barColor};"></div></div>
        ${s.feedback ? `<div style="font-size:0.78rem;color:var(--muted);line-height:1.5;margin-top:0.5rem;">${escHtml(s.feedback)}</div>` : ""}
        <div class="rc-meta" style="margin-top:0.6rem;">
          <div class="rc-meta-item">
            <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${s.submitted_at ? new Date(s.submitted_at).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) : "—"}
          </div>
          ${s.tab_switches > 0 ? `<div class="rc-meta-item" style="color:var(--warn);">⚠ ${s.tab_switches} tab switch${s.tab_switches>1?"es":""}</div>` : ""}
          ${s.fullscreen_exits > 0 ? `<div class="rc-meta-item" style="color:var(--danger);">⚠ ${s.fullscreen_exits} fullscreen exit${s.fullscreen_exits>1?"s":""}</div>` : ""}
        </div>
        ${s.answers && s.answers.length ? `<button class="btn btn-outline btn-view-detail" onclick="showAnswerDetail(${s.week_number})">View Answers →</button>` : ""}
      </div>`;
  }).join("");
}

// Show detailed answers modal
async function showAnswerDetail(weekNum) {
  const { data: s } = await supabaseClient
    .from("quiz_scores").select("answers, score, max_score, week_number")
    .eq("user_id", currentUser.id).eq("week_number", weekNum).maybeSingle();

  if (!s || !s.answers || !s.answers.length) { showToast("No detailed answer data available.", "warn"); return; }

  // Build modal
  let modal = document.getElementById("answerModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "answerModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9000;display:flex;align-items:center;justify-content:center;padding:1rem;";
    modal.addEventListener("click", e => { if (e.target===modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  const answers = Array.isArray(s.answers) ? s.answers : [];
  const correct = answers.filter(a => a.is_correct).length;

  modal.innerHTML = `
    <div style="background:#111827;border:1px solid #1e2d40;border-radius:16px;max-width:640px;width:100%;max-height:85vh;overflow-y:auto;padding:2rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <div>
          <div style="font-size:1.1rem;font-weight:700;">Week ${s.week_number} — Answer Review</div>
          <div style="font-size:0.82rem;color:#64748b;margin-top:0.2rem;">${correct}/${answers.length} correct · ${s.score}/${s.max_score} points</div>
        </div>
        <button onclick="document.getElementById('answerModal').remove()" style="background:none;border:none;cursor:pointer;color:#64748b;font-size:1.25rem;line-height:1;">×</button>
      </div>
      ${answers.map((a, i) => `
        <div style="border:1px solid ${a.is_correct ? "rgba(0,212,170,0.25)" : "rgba(248,113,113,0.25)"};border-radius:10px;padding:1rem;margin-bottom:0.75rem;background:${a.is_correct ? "rgba(0,212,170,0.04)" : "rgba(248,113,113,0.04)"};">
          <div style="font-size:0.8rem;font-weight:700;color:#64748b;margin-bottom:0.4rem;">Q${i+1}</div>
          <div style="font-size:0.88rem;margin-bottom:0.5rem;line-height:1.5;">${escHtml(a.question || "Question")}</div>
          <div style="font-size:0.8rem;">
            <span style="color:#64748b;">Your answer: </span>
            <span style="color:${a.is_correct ? "#00d4aa" : "#f87171"};font-weight:600;">${escHtml(a.chosen || "—")}</span>
            ${!a.is_correct && a.correct ? `<span style="color:#64748b;"> · Correct: </span><span style="color:#00d4aa;font-weight:600;">${escHtml(a.correct)}</span>` : ""}
          </div>
        </div>
      `).join("")}
    </div>`;
}

// ============================================================
// Profile tab
// ============================================================
function buildProfile() {
  const p = currentProfile;
  const fields = [
    { label: "Full Name",      value: p.full_name,     full: true },
    { label: "Email",          value: p.email,          full: true },
    { label: "College",        value: p.college,        full: true },
    { label: "Year of Study",  value: p.year_of_study },
    { label: "Branch",         value: p.branch         },
    { label: "Phone",          value: p.phone          },
    { label: "Roll Number",    value: p.roll_number    },
    { label: "Joined",         value: new Date(p.created_at).toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"}) },
  ];
  document.getElementById("profileGrid").innerHTML = fields.map(f => `
    <div class="pf-field ${f.full ? "full" : ""}">
      <div class="pf-label">${f.label}</div>
      <div class="pf-value">${escHtml(f.value || "—")}</div>
    </div>`).join("");
}

// ============================================================
// Quiz status
// ============================================================
async function loadQuizStatus() {
  const dot  = document.getElementById("quizStatusDot");
  const text = document.getElementById("quizStatusText");
  const btn  = document.getElementById("startQuizBtn");
  const heading = document.getElementById("quizHeading");
  const desc    = document.getElementById("quizDesc");

  // Get active quiz from DB
  const { data: cfg } = await supabaseClient
    .from("quiz_config").select("*").eq("is_active", true).maybeSingle();

  if (!cfg) {
    dot.className  = "quiz-dot closed";
    text.textContent = "No active quiz right now.";
    heading.textContent = "No Active Quiz";
    desc.textContent    = "Check back on Monday when the next weekly quiz opens.";
    btn.disabled = true;
    btn.textContent = "No Active Quiz";
    document.getElementById("quizSecurityNotice").style.display = "none";
    return;
  }

  quizConfig = cfg;

  // Check window constraints
  const now = new Date();
  const opens  = cfg.opens_at  ? new Date(cfg.opens_at)  : null;
  const closes = cfg.closes_at ? new Date(cfg.closes_at) : null;

  if (opens && now < opens) {
    dot.className = "quiz-dot closed";
    text.textContent = `Opens ${opens.toLocaleString("en-IN")}`;
    heading.textContent = cfg.quiz_title || `Week ${cfg.week_number} Quiz`;
    desc.textContent    = "This quiz hasn't opened yet. Check back at the opening time.";
    btn.disabled = true;
    btn.textContent = "Not Yet Open";
    return;
  }

  if (closes && now > closes) {
    dot.className = "quiz-dot closed";
    text.textContent = "This quiz window has closed.";
    heading.textContent = cfg.quiz_title || `Week ${cfg.week_number} Quiz`;
    desc.textContent    = "The submission window for this quiz has passed.";
    btn.disabled = true;
    btn.textContent = "Quiz Closed";
  } else {
    dot.className = "quiz-dot live";
    text.textContent = "Quiz is LIVE";
    heading.textContent = cfg.quiz_title || `Week ${cfg.week_number} Quiz`;
    desc.textContent = `Assessment for Week ${cfg.week_number}. ${cfg.time_limit_mins ? `Time limit: ${cfg.time_limit_mins} minutes.` : ""} The quiz runs in fullscreen mode. Ensure a stable connection before starting.`;
  }

  // Check if already submitted
  const { data: existing } = await supabaseClient
    .from("quiz_scores").select("score, max_score, feedback, week_number")
    .eq("user_id", currentUser.id).eq("week_number", cfg.week_number).maybeSingle();

  if (existing) {
    const sec = document.getElementById("quizScoreSection");
    sec.style.display = "block";
    document.getElementById("quizWeekLabel").textContent = existing.week_number;
    document.getElementById("scoreDisplay").textContent  = existing.score;
    document.getElementById("maxScoreDisplay").textContent = existing.max_score;
    const pct = Math.round((existing.score / existing.max_score) * 100);
    document.getElementById("scorePercent").textContent  = `${pct}%`;
    document.getElementById("scoreBarFill").style.width  = `${pct}%`;
    if (existing.feedback) {
      const fb = document.getElementById("quizFeedback");
      fb.textContent = existing.feedback;
      fb.style.display = "block";
    }
    btn.textContent = "Already Submitted";
    btn.disabled    = true;
    document.getElementById("quizBtnRow").innerHTML = `
      <button class="btn btn-outline" onclick="switchTab('myresults')">View Detailed Results →</button>`;
  }
}

// ============================================================
// Quiz security & start
// ============================================================
async function startQuiz() {
  if (!quizConfig || !quizConfig.quiz_url) {
    showToast("Quiz URL not configured. Contact admin.", "error");
    return;
  }

  const btn = document.getElementById("startQuizBtn");
  btn.disabled = true;
  btn.textContent = "Launching…";

  try {
    // Try to get secure URL from edge function first; fallback to direct quiz_url
    let quizUrl = quizConfig.quiz_url;
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      const res = await fetch(`${API_BASE}/get-test-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({ week: quizConfig.week_number }),
      });
      if (res.ok) { const json = await res.json(); if (json.url) quizUrl = json.url; }
    } catch(e) { /* fallback to direct URL */ }

    openQuizOverlay(quizUrl);
  } catch(err) {
    showToast("Could not start quiz: " + err.message, "error");
    btn.disabled = false;
    btn.textContent = "Start Quiz";
  }
}

function openQuizOverlay(url) {
  violationCount = 0;
  quizStartTime  = Date.now();

  const overlay = document.getElementById("quizOverlay");
  document.getElementById("quizIframe").src = url;
  overlay.classList.add("visible");

  // Request fullscreen
  if (overlay.requestFullscreen) overlay.requestFullscreen();
  else if (overlay.webkitRequestFullscreen) overlay.webkitRequestFullscreen();
  else if (overlay.mozRequestFullScreen) overlay.mozRequestFullScreen();

  updateViolationBadge();
  startQuizTimer();

  // Security listeners
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("blur", onWindowBlur);
}

function startQuizTimer() {
  const limitSecs = (quizConfig?.time_limit_mins || 30) * 60;
  quizTimerInterval = setInterval(() => {
    if (!quizStartTime) return;
    const elapsed = Math.floor((Date.now() - quizStartTime) / 1000);
    const remaining = Math.max(0, limitSecs - elapsed);
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    document.getElementById("quizTimerDisplay").textContent =
      `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    if (remaining === 0) {
      showToast("Time is up! The quiz window is closing.", "warn");
      setTimeout(closeQuizOverlay, 2000);
    }
  }, 1000);
}

// ── Violation handlers ────────────────────────────────────────
function onFullscreenChange() {
  const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFull && document.getElementById("quizOverlay").classList.contains("visible")) {
    recordViolation("fullscreen_exit");
  }
}

function onVisibilityChange() {
  if (document.hidden && document.getElementById("quizOverlay").classList.contains("visible")) {
    recordViolation("tab_switch");
  }
}

function onWindowBlur() {
  if (document.getElementById("quizOverlay").classList.contains("visible")) {
    recordViolation("window_blur");
  }
}

async function recordViolation(type) {
  violationCount++;
  updateViolationBadge();

  // Log to Supabase
  if (quizConfig) {
    await supabaseClient.from("quiz_violations").insert({
      user_id: currentUser.id, week_number: quizConfig.week_number, violation_type: type
    });
  }

  // Show popup
  const messages = {
    tab_switch:     "You switched away from the quiz tab. This is violation #" + violationCount + ". Repeated violations may disqualify your submission.",
    fullscreen_exit:"You exited fullscreen. This is violation #" + violationCount + ". Please stay in fullscreen for the duration of the quiz.",
    window_blur:    "The quiz window lost focus. This is violation #" + violationCount + ". Please do not switch windows during the quiz.",
  };
  document.getElementById("violationMsg").textContent = messages[type] || "A security violation was detected.";
  document.getElementById("violationPopup").classList.add("show");

  if (violationCount >= 5) {
    showToast("Maximum violations reached. Quiz will be closed.", "error");
    setTimeout(closeQuizOverlay, 2000);
  }
}

function dismissViolation() {
  document.getElementById("violationPopup").classList.remove("show");
  // Re-request fullscreen
  const overlay = document.getElementById("quizOverlay");
  if (overlay.requestFullscreen) overlay.requestFullscreen().catch(() => {});
}

function updateViolationBadge() {
  const badge = document.getElementById("violationBadge");
  badge.textContent = violationCount === 0 ? "✓ 0 violations" : `⚠ ${violationCount} violation${violationCount>1?"s":""}`;
  badge.className = "quiz-violations " + (violationCount === 0 ? "ok" : violationCount < 3 ? "warn" : "danger");
}

function confirmCloseQuiz() {
  if (confirm("Are you sure you want to exit the quiz? Your progress may be lost if not submitted.")) {
    closeQuizOverlay();
  }
}

async function closeQuizOverlay() {
  clearInterval(quizTimerInterval);
  quizTimerInterval = null;

  document.removeEventListener("fullscreenchange",       onFullscreenChange);
  document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
  document.removeEventListener("visibilitychange",       onVisibilityChange);
  window.removeEventListener("blur",                     onWindowBlur);

  if (document.exitFullscreen) document.exitFullscreen().catch(() => {});

  const overlay = document.getElementById("quizOverlay");
  overlay.classList.remove("visible");
  document.getElementById("quizIframe").src = "";
  document.getElementById("violationPopup").classList.remove("show");

  // Save violation summary
  if (quizConfig && violationCount > 0) {
    await supabaseClient.from("quiz_scores").upsert(
      { user_id: currentUser.id, email: currentUser.email, week_number: quizConfig.week_number,
        tab_switches: violationCount, fullscreen_exits: violationCount },
      { onConflict: "user_id,week_number", ignoreDuplicates: false }
    );
  }

  loadQuizStatus();
  loadMyResults();
}

// ============================================================
// Helpers
// ============================================================
function escHtml(str) {
  return String(str || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// Lazy-load profile when tab opened
document.querySelectorAll(".nav-item").forEach(n => {
  n.addEventListener("click", () => {
    if (n.dataset.tab === "profile" && currentProfile) buildProfile();
    if (n.dataset.tab === "overview")    loadOverview();
    if (n.dataset.tab === "myresults")   loadMyResults();
  });
});
