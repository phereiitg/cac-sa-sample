// ============================================================
// js/admin.js — all admin panel logic
// ============================================================

let adminProfile = null;
let allWeeks     = [];
let editingWeekId = null;

// ============================================================
// Boot — require admin
// ============================================================
(async () => {
  const auth = await requireAdmin();
  if (!auth) return;

  adminProfile = auth.profile;
  document.getElementById("adminName").textContent = adminProfile.full_name || adminProfile.email;

  await loadDashboardStats();
  await loadWeekSelectorButtons();
  await loadQuizConfig();
  await loadParticipants();
  await loadResults();
  await loadViolations();
  await loadAnnouncements();
})();

// ============================================================
// Tab switching
// ============================================================
function switchTab(name) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById(`tab-${name}`)?.classList.add("active");
  document.querySelector(`.nav-item[data-tab="${name}"]`)?.classList.add("active");
}

// ============================================================
// Dashboard stats
// ============================================================
async function loadDashboardStats() {
  const [{ count: pCount }, { count: sCount }, { count: vCount }, { data: qActive }] = await Promise.all([
    supabaseClient.from("profiles").select("id", { count: "exact", head: true }),
    supabaseClient.from("quiz_scores").select("id", { count: "exact", head: true }),
    supabaseClient.from("quiz_violations").select("id", { count: "exact", head: true }),
    supabaseClient.from("quiz_config").select("week_number").eq("is_active", true).maybeSingle(),
  ]);

  document.getElementById("statParticipants").textContent = pCount ?? "—";
  document.getElementById("statSubmissions").textContent  = sCount ?? "—";
  document.getElementById("statViolations").textContent   = vCount ?? "—";
  document.getElementById("statActiveQuiz").textContent   = qActive ? `Week ${qActive.week_number}` : "None";
}

// ============================================================
// ── CONTENT MANAGER ──────────────────────────────────────────
// ============================================================

async function loadWeekSelectorButtons() {
  const { data: weeks } = await supabaseClient.from("weeks").select("*").order("week_number");
  allWeeks = weeks || [];
  const container = document.getElementById("weekSelectorBtns");
  container.innerHTML = allWeeks.map(w => `
    <button class="btn ${editingWeekId === w.id ? "btn-primary" : "btn-outline"}"
      onclick="selectWeek('${w.id}')">
      ${w.title || "Week " + w.week_number}
      <span style="margin-left:0.4rem;font-size:0.7rem;opacity:0.7;">${w.is_published ? "✓ Live" : "Draft"}</span>
    </button>`).join("");
}

async function selectWeek(weekId) {
  editingWeekId = weekId;
  await loadWeekSelectorButtons();
  await renderWeekEditor(weekId);
}

async function renderWeekEditor(weekId) {
  const week = allWeeks.find(w => w.id === weekId);
  if (!week) return;

  const { data: days } = await supabaseClient
    .from("week_days").select("*").eq("week_id", weekId).order("day_number");

  const area = document.getElementById("weekEditorArea");
  area.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.75rem;">
        <div class="card-title" style="margin:0;">${week.title || "Week " + week.week_number} — Editor</div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
          <label class="toggle" style="font-size:0.82rem;">
            <input type="checkbox" id="weekPublished" ${week.is_published ? "checked" : ""}
              onchange="toggleWeekPublish('${weekId}', this.checked)">
            <span>Published (visible to students)</span>
          </label>
        </div>
      </div>

      <div class="form-row" style="margin-bottom:1.25rem;">
        <div>
          <label>Week Title</label>
          <input type="text" id="weekTitle" value="${escHtml(week.title || "")}" placeholder="e.g. Week 2">
        </div>
        <div style="display:flex;align-items:flex-end;">
          <button class="btn btn-outline" onclick="saveWeekTitle('${weekId}')">Save Title</button>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
        <div style="font-size:0.85rem;font-weight:700;">Daily Content</div>
        <button class="btn btn-primary btn-sm" onclick="addDay('${weekId}', ${(days||[]).length + 1})">+ Add Day</button>
      </div>
      <div id="daysContainer">
        ${(days || []).map(d => renderDayRow(d)).join("")}
      </div>
    </div>`;
}

function renderDayRow(d) {
  return `
    <div class="day-row" id="day-${d.id}">
      <div class="day-row-header">
        <div class="day-row-title">Day ${d.day_number}</div>
        <button class="btn btn-danger btn-sm" onclick="deleteDay('${d.id}')">Delete</button>
      </div>
      <div class="form-row full" style="margin-bottom:0.75rem;">
        <div>
          <label>Description (bold keywords with **bold**)</label>
          <textarea id="desc-${d.id}" rows="2">${escHtml(d.description || "")}</textarea>
        </div>
      </div>
      <div class="form-row three" style="margin-bottom:0.5rem;">
        <div><label>Task 1 Label</label><input type="text" id="t1l-${d.id}" value="${escHtml(d.task1_label||"")}"></div>
        <div><label>Task 2 Label</label><input type="text" id="t2l-${d.id}" value="${escHtml(d.task2_label||"")}"></div>
        <div><label>Task 3 Label</label><input type="text" id="t3l-${d.id}" value="${escHtml(d.task3_label||"")}"></div>
      </div>
      <div class="form-row three" style="margin-bottom:0.75rem;">
        <div><label>Task 1 URL</label><input type="url" id="t1u-${d.id}" value="${escHtml(d.task1_url||"")}"></div>
        <div><label>Task 2 URL</label><input type="url" id="t2u-${d.id}" value="${escHtml(d.task2_url||"")}"></div>
        <div><label>Task 3 URL</label><input type="url" id="t3u-${d.id}" value="${escHtml(d.task3_url||"")}"></div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="saveDay('${d.id}', '${d.week_id}')">💾 Save Day ${d.day_number}</button>
    </div>`;
}

async function saveWeekTitle(weekId) {
  const title = document.getElementById("weekTitle").value.trim();
  const { error } = await supabaseClient.from("weeks").update({ title, updated_at: new Date().toISOString() }).eq("id", weekId);
  if (error) { showToast("Error: " + error.message, "error"); return; }
  showToast("Week title saved!", "success");
  allWeeks = allWeeks.map(w => w.id === weekId ? { ...w, title } : w);
  await loadWeekSelectorButtons();
}

async function toggleWeekPublish(weekId, published) {
  const { error } = await supabaseClient.from("weeks").update({
    is_published: published,
    published_at: published ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  }).eq("id", weekId);
  if (error) { showToast("Error: " + error.message, "error"); return; }
  showToast(published ? "Week is now LIVE for students!" : "Week set to draft.", published ? "success" : "warn");
  allWeeks = allWeeks.map(w => w.id === weekId ? { ...w, is_published: published } : w);
  await loadWeekSelectorButtons();
}

async function addDay(weekId, dayNumber) {
  const { data, error } = await supabaseClient.from("week_days").insert({
    week_id: weekId, week_number: allWeeks.find(w => w.id === weekId)?.week_number, day_number: dayNumber,
    description: "", task1_label: "", task1_url: "", task2_label: "", task2_url: "", task3_label: "", task3_url: ""
  }).select().single();
  if (error) { showToast("Error: " + error.message, "error"); return; }
  const container = document.getElementById("daysContainer");
  container.insertAdjacentHTML("beforeend", renderDayRow(data));
  showToast(`Day ${dayNumber} added!`, "success");
}

async function saveDay(dayId, weekId) {
  const g = id => document.getElementById(`${id}-${dayId}`)?.value.trim() || "";
  const { error } = await supabaseClient.from("week_days").update({
    description: g("desc"),
    task1_label: g("t1l"), task1_url: g("t1u"),
    task2_label: g("t2l"), task2_url: g("t2u"),
    task3_label: g("t3l"), task3_url: g("t3u"),
  }).eq("id", dayId);
  if (error) { showToast("Save failed: " + error.message, "error"); return; }
  showToast("Day saved!", "success");
}

async function deleteDay(dayId) {
  if (!confirm("Delete this day's content? This cannot be undone.")) return;
  const { error } = await supabaseClient.from("week_days").delete().eq("id", dayId);
  if (error) { showToast("Error: " + error.message, "error"); return; }
  document.getElementById(`day-${dayId}`)?.remove();
  showToast("Day deleted.", "warn");
}

// ============================================================
// ── QUIZ MANAGER ─────────────────────────────────────────────
// ============================================================

async function loadQuizConfig() {
  // Load active config into form
  const { data: active } = await supabaseClient.from("quiz_config").select("*").eq("is_active", true).maybeSingle();
  if (active) {
    document.getElementById("qcWeek").value     = active.week_number;
    document.getElementById("qcTitle").value    = active.quiz_title || "";
    document.getElementById("qcUrl").value      = active.quiz_url || "";
    document.getElementById("qcMaxScore").value = active.max_score || 100;
    document.getElementById("qcTimeLimit").value= active.time_limit_mins || 30;
    document.getElementById("qcActive").checked = active.is_active;
    if (active.opens_at)  document.getElementById("qcOpens").value  = toLocalDatetime(active.opens_at);
    if (active.closes_at) document.getElementById("qcCloses").value = toLocalDatetime(active.closes_at);
  }

  // Load all configs into table
  const { data: all } = await supabaseClient.from("quiz_config").select("*").order("week_number");
  const wrap = document.getElementById("quizConfigTable");
  if (!all || !all.length) { wrap.innerHTML = `<div style="color:var(--muted);padding:1rem;">No quiz configs yet.</div>`; return; }
  wrap.innerHTML = `<table>
    <thead><tr><th>Week</th><th>Title</th><th>Active</th><th>Opens</th><th>Closes</th><th>Max Score</th><th>Actions</th></tr></thead>
    <tbody>${all.map(q => `
      <tr>
        <td style="font-family:'DM Mono',monospace;font-weight:700;">W${q.week_number}</td>
        <td>${escHtml(q.quiz_title || "—")}</td>
        <td><span class="dot ${q.is_active ? "dot-green" : "dot-red"}"></span>${q.is_active ? "Live" : "Off"}</td>
        <td style="color:var(--muted);font-size:0.78rem;">${q.opens_at ? new Date(q.opens_at).toLocaleString("en-IN") : "—"}</td>
        <td style="color:var(--muted);font-size:0.78rem;">${q.closes_at ? new Date(q.closes_at).toLocaleString("en-IN") : "—"}</td>
        <td>${q.max_score}</td>
        <td><button class="btn btn-outline btn-sm" onclick="loadQuizIntoForm('${q.id}')">Edit</button>
            <button class="btn btn-danger btn-sm" style="margin-left:0.4rem;" onclick="deleteQuizConfig('${q.id}')">Del</button></td>
      </tr>`).join("")}
    </tbody></table>`;
}

async function loadQuizIntoForm(id) {
  const { data: q } = await supabaseClient.from("quiz_config").select("*").eq("id", id).single();
  if (!q) return;
  document.getElementById("qcWeek").value     = q.week_number;
  document.getElementById("qcTitle").value    = q.quiz_title || "";
  document.getElementById("qcUrl").value      = q.quiz_url || "";
  document.getElementById("qcMaxScore").value = q.max_score || 100;
  document.getElementById("qcTimeLimit").value= q.time_limit_mins || 30;
  document.getElementById("qcActive").checked = q.is_active;
  if (q.opens_at)  document.getElementById("qcOpens").value  = toLocalDatetime(q.opens_at);
  if (q.closes_at) document.getElementById("qcCloses").value = toLocalDatetime(q.closes_at);
  document.getElementById("quizConfigCard").dataset.editingId = id;
  showToast("Config loaded into form — edit and save.", "info");
}

async function saveQuizConfig() {
  const weekNum   = parseInt(document.getElementById("qcWeek").value);
  const title     = document.getElementById("qcTitle").value.trim();
  const url       = document.getElementById("qcUrl").value.trim();
  const maxScore  = parseFloat(document.getElementById("qcMaxScore").value) || 100;
  const timeLimit = parseInt(document.getElementById("qcTimeLimit").value) || 30;
  const isActive  = document.getElementById("qcActive").checked;
  const opensVal  = document.getElementById("qcOpens").value;
  const closesVal = document.getElementById("qcCloses").value;

  if (!weekNum || !url) { showToast("Week number and quiz URL are required.", "error"); return; }

  // If activating, deactivate all others first
  if (isActive) {
    await supabaseClient.from("quiz_config").update({ is_active: false }).neq("week_number", weekNum);
  }

  const payload = {
    week_number: weekNum, quiz_title: title, quiz_url: url,
    max_score: maxScore, time_limit_mins: timeLimit, is_active: isActive,
    opens_at:  opensVal  ? new Date(opensVal).toISOString()  : null,
    closes_at: closesVal ? new Date(closesVal).toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const editingId = document.getElementById("quizConfigCard").dataset.editingId;
  let err;
  if (editingId) {
    ({ error: err } = await supabaseClient.from("quiz_config").update(payload).eq("id", editingId));
  } else {
    ({ error: err } = await supabaseClient.from("quiz_config").upsert(payload, { onConflict: "week_number" }));
  }

  if (err) { showToast("Save failed: " + err.message, "error"); return; }
  showToast("Quiz config saved!", "success");
  delete document.getElementById("quizConfigCard").dataset.editingId;
  await loadQuizConfig();
  await loadDashboardStats();
}

async function deleteQuizConfig(id) {
  if (!confirm("Delete this quiz config?")) return;
  await supabaseClient.from("quiz_config").delete().eq("id", id);
  showToast("Deleted.", "warn");
  await loadQuizConfig();
}

// ============================================================
// ── PARTICIPANTS ──────────────────────────────────────────────
// ============================================================
let allParticipants = [];

async function loadParticipants() {
  const { data } = await supabaseClient.from("profiles").select("*").order("created_at", { ascending: false });
  allParticipants = data || [];

  const tbody = document.getElementById("participantsBody");
  if (!allParticipants.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:var(--muted);padding:2rem;text-align:center;">No participants yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = allParticipants.map((p, i) => `
    <tr>
      <td style="color:var(--muted);">${i + 1}</td>
      <td style="font-weight:600;">${escHtml(p.full_name || "—")}</td>
      <td style="color:var(--muted);font-size:0.8rem;">${escHtml(p.email)}</td>
      <td>${escHtml(p.college || "—")}</td>
      <td>${escHtml(p.year_of_study || "—")}</td>
      <td>${escHtml(p.branch || "—")}</td>
      <td style="color:var(--muted);">${escHtml(p.phone || "—")}</td>
      <td style="color:var(--muted);font-size:0.78rem;">${new Date(p.created_at).toLocaleDateString("en-IN", {day:"numeric",month:"short",year:"numeric"})}</td>
      <td>${p.is_admin ? '<span style="color:var(--danger);font-weight:700;">Admin</span>' : '—'}</td>
    </tr>`).join("");
}

function exportParticipantsCSV() {
  if (!allParticipants.length) { showToast("No data to export.", "warn"); return; }
  const headers = ["Name","Email","College","Year","Branch","Phone","Roll Number","Joined"];
  const rows = allParticipants.map(p => [
    p.full_name||"", p.email, p.college||"", p.year_of_study||"", p.branch||"", p.phone||"", p.roll_number||"",
    new Date(p.created_at).toLocaleDateString("en-IN")
  ]);
  downloadCSV("participants.csv", [headers, ...rows]);
}

// ============================================================
// ── RESULTS ───────────────────────────────────────────────────
// ============================================================
let allResults = [];

async function loadResults() {
  const weekFilter = document.getElementById("resultsWeekFilter")?.value;
  let query = supabaseClient.from("quiz_scores").select("*, profiles(full_name, email, college)").order("submitted_at", { ascending: false });
  if (weekFilter) query = query.eq("week_number", parseInt(weekFilter));
  const { data } = await query;
  allResults = data || [];

  const tbody = document.getElementById("resultsBody");
  if (!allResults.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="color:var(--muted);padding:2rem;text-align:center;">No results found.</td></tr>`;
    return;
  }

  tbody.innerHTML = allResults.map(r => {
    const pct = r.max_score > 0 ? Math.round((r.score / r.max_score) * 100) : 0;
    const pctColor = pct >= 80 ? "color:var(--accent)" : pct >= 50 ? "color:var(--warn)" : "color:var(--danger)";
    return `
      <tr>
        <td style="font-weight:600;">${escHtml(r.profiles?.full_name || "—")}</td>
        <td style="color:var(--muted);font-size:0.78rem;">${escHtml(r.profiles?.email || r.email || "—")}</td>
        <td style="color:var(--muted);">${escHtml(r.profiles?.college || "—")}</td>
        <td style="font-family:'DM Mono',monospace;font-weight:700;">W${r.week_number}</td>
        <td style="font-weight:700;">${r.score}</td>
        <td style="color:var(--muted);">${r.max_score}</td>
        <td style="${pctColor};font-weight:700;">${pct}%</td>
        <td style="${r.tab_switches > 0 ? "color:var(--warn);" : "color:var(--muted);"}">${r.tab_switches || 0}</td>
        <td style="${r.fullscreen_exits > 0 ? "color:var(--danger);" : "color:var(--muted);"}">${r.fullscreen_exits || 0}</td>
        <td style="color:var(--muted);font-size:0.78rem;">${new Date(r.submitted_at).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</td>
        <td>${r.answers && r.answers.length ? `<button class="btn btn-outline btn-sm" onclick='showAdminAnswerDetail(${JSON.stringify(r)})'>Answers</button>` : "—"}</td>
      </tr>`;
  }).join("");
}

function showAdminAnswerDetail(r) {
  const answers = Array.isArray(r.answers) ? r.answers : [];
  if (!answers.length) { showToast("No detailed answers stored.", "warn"); return; }

  let modal = document.getElementById("adminAnswerModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "adminAnswerModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9000;display:flex;align-items:center;justify-content:center;padding:1rem;";
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  const correct = answers.filter(a => a.is_correct).length;
  modal.innerHTML = `
    <div style="background:#111827;border:1px solid #1e2d40;border-radius:16px;max-width:640px;width:100%;max-height:85vh;overflow-y:auto;padding:2rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <div>
          <div style="font-size:1rem;font-weight:700;">${escHtml(r.profiles?.full_name || r.email)} — Week ${r.week_number}</div>
          <div style="font-size:0.82rem;color:#64748b;margin-top:0.2rem;">${correct}/${answers.length} correct · Score: ${r.score}/${r.max_score}</div>
        </div>
        <button onclick="document.getElementById('adminAnswerModal').remove()" style="background:none;border:none;cursor:pointer;color:#64748b;font-size:1.3rem;line-height:1;">×</button>
      </div>
      ${answers.map((a, i) => `
        <div style="border:1px solid ${a.is_correct ? "rgba(0,212,170,0.2)" : "rgba(248,113,113,0.2)"};border-radius:10px;padding:0.85rem;margin-bottom:0.6rem;background:${a.is_correct ? "rgba(0,212,170,0.03)" : "rgba(248,113,113,0.03)"};">
          <div style="font-size:0.75rem;font-weight:700;color:#64748b;margin-bottom:0.3rem;">Q${i+1} — ${a.is_correct ? "✓ Correct" : "✗ Wrong"}</div>
          <div style="font-size:0.85rem;margin-bottom:0.4rem;line-height:1.5;">${escHtml(a.question || "Question")}</div>
          <div style="font-size:0.78rem;color:#94a3b8;">
            Chosen: <span style="color:${a.is_correct ? "#00d4aa" : "#f87171"};font-weight:600;">${escHtml(a.chosen || "—")}</span>
            ${!a.is_correct && a.correct ? ` · Correct: <span style="color:#00d4aa;font-weight:600;">${escHtml(a.correct)}</span>` : ""}
          </div>
        </div>`).join("")}
    </div>`;
}

function exportResultsCSV() {
  if (!allResults.length) { showToast("No results to export.", "warn"); return; }
  const headers = ["Name","Email","College","Week","Score","Max Score","%","Tab Switches","Fullscreen Exits","Submitted"];
  const rows = allResults.map(r => {
    const pct = r.max_score > 0 ? Math.round((r.score / r.max_score) * 100) : 0;
    return [
      r.profiles?.full_name||"", r.profiles?.email||r.email||"", r.profiles?.college||"",
      r.week_number, r.score, r.max_score, pct+"%",
      r.tab_switches||0, r.fullscreen_exits||0,
      new Date(r.submitted_at).toLocaleString("en-IN")
    ];
  });
  downloadCSV("quiz_results.csv", [headers, ...rows]);
}

// ============================================================
// ── VIOLATIONS ────────────────────────────────────────────────
// ============================================================
async function loadViolations() {
  const { data } = await supabaseClient
    .from("quiz_violations")
    .select("*, profiles(full_name, email)")
    .order("occurred_at", { ascending: false })
    .limit(200);

  const tbody = document.getElementById("violationsBody");
  if (!data || !data.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--muted);padding:2rem;text-align:center;">No violations recorded.</td></tr>`;
    return;
  }

  const typeLabels = {
    tab_switch:     "Tab Switch",
    fullscreen_exit:"Fullscreen Exit",
    window_blur:    "Window Blur",
    devtools:       "DevTools Open"
  };
  const typeColors = {
    tab_switch:"var(--warn)",
    fullscreen_exit:"var(--danger)",
    window_blur:"var(--muted)",
    devtools:"var(--danger)"
  };

  tbody.innerHTML = data.map(v => `
    <tr>
      <td style="font-weight:600;">${escHtml(v.profiles?.full_name || "—")}</td>
      <td style="color:var(--muted);font-size:0.78rem;">${escHtml(v.profiles?.email || "—")}</td>
      <td style="font-family:'DM Mono',monospace;">W${v.week_number}</td>
      <td style="font-weight:600;color:${typeColors[v.violation_type]||"var(--muted)"};">${typeLabels[v.violation_type] || v.violation_type}</td>
      <td style="color:var(--muted);font-size:0.78rem;">${new Date(v.occurred_at).toLocaleString("en-IN")}</td>
    </tr>`).join("");
}

// ============================================================
// ── ANNOUNCEMENTS ─────────────────────────────────────────────
// ============================================================
async function loadAnnouncements() {
  const { data } = await supabaseClient.from("announcements").select("*").order("created_at", { ascending: false });
  const list = document.getElementById("annList");
  if (!data || !data.length) { list.innerHTML = `<div style="color:var(--muted);padding:1rem;">No announcements yet.</div>`; return; }

  list.innerHTML = data.map(a => `
    <div style="border:1px solid var(--border);border-radius:10px;padding:1rem;margin-bottom:0.75rem;display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;">
      <div style="flex:1;">
        <div style="font-weight:700;margin-bottom:0.25rem;display:flex;align-items:center;gap:0.5rem;">
          ${escHtml(a.title)}
          ${a.is_active ? '<span style="background:rgba(0,212,170,0.1);color:var(--accent);border-radius:5px;padding:0.1rem 0.4rem;font-size:0.65rem;font-weight:700;">LIVE</span>' : '<span style="background:var(--surface2);color:var(--muted);border-radius:5px;padding:0.1rem 0.4rem;font-size:0.65rem;">OFF</span>'}
          ${a.pinned ? '<span style="background:rgba(251,191,36,0.1);color:var(--warn);border-radius:5px;padding:0.1rem 0.4rem;font-size:0.65rem;font-weight:700;">PINNED</span>' : ""}
        </div>
        ${a.body ? `<div style="color:var(--muted);font-size:0.82rem;">${escHtml(a.body)}</div>` : ""}
        <div style="font-size:0.72rem;color:var(--muted);margin-top:0.4rem;">${new Date(a.created_at).toLocaleString("en-IN")}</div>
      </div>
      <div style="display:flex;gap:0.4rem;flex-shrink:0;">
        <button class="btn btn-outline btn-sm" onclick="toggleAnn('${a.id}', ${!a.is_active})">${a.is_active ? "Deactivate" : "Activate"}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteAnn('${a.id}')">Del</button>
      </div>
    </div>`).join("");
}

async function createAnnouncement() {
  const title  = document.getElementById("annTitle").value.trim();
  const body   = document.getElementById("annBody").value.trim();
  const linksRaw = document.getElementById("annLinks").value.trim();
  const active = document.getElementById("annActive").checked;
  const pinned = document.getElementById("annPinned").checked;

  if (!title) { showToast("Title is required.", "error"); return; }

  const links = linksRaw ? linksRaw.split("\n").map(l => {
    const [label, ...urlParts] = l.split("|");
    return { label: label.trim(), url: urlParts.join("|").trim() };
  }).filter(l => l.label && l.url) : [];

  const { error } = await supabaseClient.from("announcements").insert({ title, body: body||null, links, is_active: active, pinned });
  if (error) { showToast("Error: " + error.message, "error"); return; }
  showToast("Announcement posted!", "success");
  document.getElementById("annTitle").value = "";
  document.getElementById("annBody").value  = "";
  document.getElementById("annLinks").value = "";
  await loadAnnouncements();
}

async function toggleAnn(id, active) {
  await supabaseClient.from("announcements").update({ is_active: active }).eq("id", id);
  await loadAnnouncements();
}

async function deleteAnn(id) {
  if (!confirm("Delete this announcement?")) return;
  await supabaseClient.from("announcements").delete().eq("id", id);
  showToast("Deleted.", "warn");
  await loadAnnouncements();
}

// ============================================================
// ── Utilities ─────────────────────────────────────────────────
// ============================================================
function escHtml(str) {
  return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function toLocalDatetime(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
