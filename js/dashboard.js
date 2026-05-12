// ============================================================
// js/dashboard.js  —  Summer Analytics 2025  (v2)
// ============================================================

let currentUser    = null;
let currentProfile = null;
let quizCfg        = null;   // active quiz_config row (full object)
let questions      = [];
let answers        = {};
let currentQIndex  = 0;
let violationCount = 0;
let localTabSwitches = 0;
let localFsExits     = 0;
let timerInterval  = null;
let quizStartTime  = null;
let timeLimitSecs  = 1800;

// ── Helpers ───────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function $(id) { return document.getElementById(id); }

// ── Boot ─────────────────────────────────────────────────────
(async () => {
  const session = await requireAuth();
  if (!session) return;
  currentUser    = session.user;
  currentProfile = await getProfile(currentUser.id);
  if (!currentProfile) { window.location.href = '/complete-profile.html'; return; }

  populateUser();
  loadAnnouncements();
  loadWeeks();
  loadQuizStatus();
  loadMyResults();
  loadOverview();

  document.getElementById('sidebarToggle')?.addEventListener('click', () =>
    document.getElementById('sidebar').classList.toggle('open'));
  document.addEventListener('click', e => {
    const sb = document.getElementById('sidebar');
    if (window.innerWidth <= 768 && sb.classList.contains('open') &&
        !sb.contains(e.target) && e.target.id !== 'sidebarToggle')
      sb.classList.remove('open');
  });
})();

// ── User + Fix 1: Admin button ────────────────────────────────
function populateUser() {
  const name    = currentProfile.full_name || currentUser.email;
  const initial = name.charAt(0).toUpperCase();
  $('heroName')      && ($('heroName').textContent      = name.split(' ')[0]);
  $('sidebarName')   && ($('sidebarName').textContent   = name);
  $('avatarInitial') && ($('avatarInitial').textContent = initial);
  $('avatarMob')     && ($('avatarMob').textContent     = initial);

  // Fix 1: inject Admin Panel link for admin users
  if (currentProfile.is_admin) {
    const nav = document.querySelector('.sidebar-nav');
    if (nav && !$('adminNavLink')) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--border);margin:.4rem 0;';
      nav.appendChild(sep);

      const link = document.createElement('a');
      link.id   = 'adminNavLink';
      link.href = '/admin.html';
      link.className = 'nav-item';
      link.style.color = 'var(--danger)';
      link.innerHTML = `
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <rect x="3" y="11" width="18" height="11" rx="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        Admin Panel`;
      nav.appendChild(link);
    }
  }
}

// ── Tab switching ─────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  $(`tab-${name}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-tab="${name}"]`)?.classList.add('active');
  if (name === 'leaderboard') loadLeaderboard();
  if (name === 'profile')     renderProfile();
  if (name === 'myresults')   loadMyResults();
  if (name === 'overview')    loadOverview();
  document.getElementById('sidebar').classList.remove('open');
}

// ── Announcements ─────────────────────────────────────────────
async function loadAnnouncements() {
  const { data } = await supabaseClient
    .from('announcements').select('*').eq('is_active', true)
    .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(3);
  const area = $('announcementsArea');
  if (!data?.length) { area.innerHTML = ''; return; }
  area.innerHTML = data.map(a => `
    <div class="ann-box" id="ann-${a.id}">
      <div class="ann-header">
        <div class="ann-title">${esc(a.title)}</div>
        <button class="ann-close" onclick="document.getElementById('ann-${a.id}').remove()">×</button>
      </div>
      ${a.body ? `<div class="ann-body">${esc(a.body)}</div>` : ''}
      ${a.links?.length ? `<div>${a.links.map(l =>
        `<a class="ann-link" href="${esc(l.url)}" target="_blank" rel="noopener">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>${esc(l.label)}</a>`).join('')}</div>` : ''}
    </div>`).join('');
}

// ── Course content — Fix 7: show all weeks, unpublished = Coming Soon ──
async function loadWeeks() {
  // Fetch ALL weeks (published + unpublished) so coming-soon is visible
  const { data: allWeeks } = await supabaseClient
    .from('weeks').select('*').order('week_number');

  const container = $('weeksList');
  if (!allWeeks?.length) {
    container.innerHTML = `<div style="color:var(--muted);padding:2rem 0;font-size:.88rem;">No weeks configured yet — check back soon!</div>`;
    return;
  }

  const published = allWeeks.filter(w => w.is_published);

  // Fetch days only for published weeks
  let daysByWeek = {};
  if (published.length) {
    const { data: days } = await supabaseClient
      .from('week_days').select('*').in('week_id', published.map(w => w.id)).order('day_number');
    (days || []).forEach(d => { (daysByWeek[d.week_id] ??= []).push(d); });
  }

  const latest = published[published.length - 1] || allWeeks[0];
  $('weekBadge').textContent = latest.title || `Week ${latest.week_number}`;

  container.innerHTML = allWeeks.map((w, i) => {
    if (!w.is_published) return buildComingSoonAccordion(w);
    return buildAccordion(w, daysByWeek[w.id] || [], i === allWeeks.length - 1 && w.is_published);
  }).join('');
}

// Fix 7: Coming soon accordion
function buildComingSoonAccordion(week) {
  return `
    <div class="week-acc" style="opacity:.55;">
      <div class="week-acc-header" style="cursor:default;">
        <div class="wah-left">
          <div class="wah-badge" style="background:rgba(100,116,139,.15);color:var(--muted);">W${week.week_number}</div>
          <div class="wah-title" style="color:var(--muted);">${esc(week.title || `Week ${week.week_number}`)}</div>
        </div>
        <span style="font-size:.72rem;font-weight:700;background:rgba(100,116,139,.1);color:var(--muted);padding:.2rem .6rem;border-radius:6px;letter-spacing:.05em;">COMING SOON</span>
      </div>
    </div>`;
}

// Fix 6: tasks_json rendering — multiple items per task column
// Fix: tasks_json rendering with strict table formatting and URL fix
function buildAccordion(week, days, open = false) {
  const daysHtml = days.length === 0
    ? `<tr><td colspan="5" style="color:var(--muted);padding:2rem;text-align:center;font-size:.9rem;">Content coming soon…</td></tr>`
    : days.map(d => {
        const taskSlots = buildTaskSlots(d);
        return `<tr style="border-bottom: 1px solid var(--border);">
          <td style="vertical-align:top; padding:1.2rem .75rem; font-weight:600; color:var(--text);">Day ${d.day_number}</td>
          <td style="vertical-align:top; padding:1.2rem .75rem; line-height:1.6; color:var(--muted); word-wrap:break-word;">${esc(d.description || '—')}</td>
          ${taskSlots.map(slotLinks => `
            <td style="vertical-align:top; padding:1.2rem .75rem;">
              ${slotLinks.length > 0
                ? `<div style="display:flex;flex-direction:column;gap:0.6rem;">` + 
                  slotLinks.map(lnk => {
                    const safeUrl = lnk.url;
                    return (safeUrl !== '#')
                      ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:flex-start;gap:.4rem;text-decoration:none;color:var(--text);font-size:.85rem;font-weight:500;line-height:1.4;transition:color .15s;" onmouseover="this.style.color='var(--accent2)'" onmouseout="this.style.color='var(--text)'">
                          <span style="word-wrap:break-word;">${esc(lnk.label)}</span>
                          <svg width="12" height="12" style="flex-shrink:0;margin-top:.2rem;color:var(--muted);" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        </a>`
                      : `<span style="font-size:.85rem;color:var(--text);display:block;line-height:1.4;font-weight:500;">${esc(lnk.label)}</span>`;
                  }).join('') + `</div>`
                : '<span style="color:var(--muted);font-size:.85rem;">—</span>'}
            </td>`).join('')}
        </tr>`;
      }).join('');

  return `
    <div class="week-acc ${open ? 'open' : ''}" id="wacc-${week.id}">
      <div class="week-acc-header" onclick="document.getElementById('wacc-${week.id}').classList.toggle('open')">
        <div class="wah-left">
          <div class="wah-badge">W${week.week_number}</div>
          <div class="wah-title">${esc(week.title || `Week ${week.week_number}`)}</div>
        </div>
        <svg class="wah-chevron" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="week-content" style="overflow-x:auto;">
        <table class="week-table" style="width:100%; table-layout:fixed; border-collapse:collapse; min-width:600px;">
          <thead>
            <tr style="border-bottom: 2px solid var(--border);">
              <th style="text-align:left; padding:1rem .75rem; color:var(--muted); font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; width:12%;">Week ${week.week_number}</th>
              <th style="text-align:left; padding:1rem .75rem; color:var(--muted); font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; width:28%;">What's In There</th>
              <th style="text-align:left; padding:1rem .75rem; color:var(--muted); font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; width:20%;">Task 1</th>
              <th style="text-align:left; padding:1rem .75rem; color:var(--muted); font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; width:20%;">Task 2</th>
              <th style="text-align:left; padding:1rem .75rem; color:var(--muted); font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; width:20%;">Task 3</th>
            </tr>
          </thead>
          <tbody>${daysHtml}</tbody>
        </table>
      </div>
    </div>`;
}
// Fix 6: Build task slots — prefers tasks_json, falls back to legacy columns
// Fix 6: Build task slots — handles 2D arrays, 1D arrays, and legacy columns
function buildTaskSlots(d) {
  // New format handling
  if (d.tasks_json && Array.isArray(d.tasks_json) && d.tasks_json.length > 0) {
    
    // FAILSAFE: If the database accidentally saved a flat list instead of proper slots,
    // distribute the first 3 items across the 3 columns so they don't all clump in Task 1.
    if (d.tasks_json[0] && !Array.isArray(d.tasks_json[0])) {
       return [
         d.tasks_json[0] ? [d.tasks_json[0]] : [],
         d.tasks_json[1] ? [d.tasks_json[1]] : [],
         d.tasks_json[2] ? [d.tasks_json[2]] : []
       ];
    }
    
    // Standard format: [[{label,url}], [...], [...]]
    const slots = [...d.tasks_json];
    while (slots.length < 3) slots.push([]);
    return slots.slice(0, 3).map(slot => Array.isArray(slot) ? slot : []);
  }
  
  // Legacy columns fallback
  return [
    d.task1_label ? [{ label: d.task1_label, url: d.task1_url }] : [],
    d.task2_label ? [{ label: d.task2_label, url: d.task2_url }] : [],
    d.task3_label ? [{ label: d.task3_label, url: d.task3_url }] : [],
  ];
}

// ── Quiz status — Fix 3: use quiz config ID, not week_number ──
async function loadQuizStatus() {
  const dot  = $('qStatusDot');
  const text = $('qStatusText');
  const btn  = $('startQuizBtn');
  const hdg  = $('qHeading');
  const desc = $('qDesc');

  const { data: cfg } = await supabaseClient
    .from('quiz_config').select('*').eq('is_active', true).maybeSingle();

  if (!cfg) {
    dot.className    = 'qdot off';
    text.textContent = 'No active quiz right now.';
    hdg.textContent  = 'No Active Quiz';
    desc.textContent = 'Check back when the next quiz goes live.';
    btn?.remove();
    $('qSecNotice').style.display = 'none';
    return;
  }
  quizCfg = cfg;

  const now    = new Date();
  const opens  = cfg.opens_at  ? new Date(cfg.opens_at)  : null;
  const closes = cfg.closes_at ? new Date(cfg.closes_at) : null;

  // Use the quiz title directly — no "Week X" hardcoding
  hdg.textContent = cfg.quiz_title || 'Untitled Quiz';

  if (opens && now < opens) {
    dot.className    = 'qdot off';
    text.textContent = `Opens ${opens.toLocaleString('en-IN')}`;
    desc.textContent = 'This quiz has not opened yet.';
    if (btn) { btn.disabled = true; btn.textContent = 'Not Yet Open'; }
    return;
  }
  if (closes && now > closes) {
    dot.className    = 'qdot off';
    text.textContent = 'Submission window closed.';
    desc.textContent = 'The window for this quiz has passed.';
    if (btn) { btn.disabled = true; btn.textContent = 'Quiz Closed'; }
    return;
  }

  dot.className    = 'qdot live';
  text.textContent = 'Quiz is LIVE';
  desc.textContent = `${cfg.time_limit_mins}-minute timed quiz. Runs in fullscreen. Stable connection recommended.`;

  // Fix 3: Check submitted by quiz_config_id, not week_number
  const { data: existing } = await supabaseClient
    .from('quiz_scores').select('score,max_score,percentage')
    .eq('user_id', currentUser.id).eq('quiz_config_id', cfg.id).maybeSingle();

  if (existing) {
    // Fix 2: Only show score/answers if admin has released results
    if (cfg.results_released) {
      $('qScoreSection').style.display = 'block';
      $('qWeekLabel').textContent   = cfg.quiz_title || 'Quiz';
      $('qScore').textContent        = existing.score;
      $('qMax').textContent          = existing.max_score;
      const pct = Math.round(Number(existing.percentage));
      $('qPct').textContent = `${pct}%`;
      $('qPct').style.color = pct >= 80 ? 'var(--accent)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';
      $('qBar').style.width = `${pct}%`;
    } else {
      // Submitted but results not released
      $('qScoreSection').style.display = 'none';
      const notice = document.createElement('div');
      notice.style.cssText = 'background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.2);border-radius:10px;padding:.85rem 1rem;margin:1rem 0;font-size:.85rem;color:var(--warn);';
      notice.innerHTML = '⏳ <strong>Quiz submitted!</strong> Your score will be visible once the admin releases results.';
      $('qScoreSection').insertAdjacentElement('afterend', notice);
    }
    $('qSecNotice').style.display = 'none';
    $('qBtnRow').innerHTML = cfg.results_released
      ? `<a href="/results.html" class="btn btn-outline" style="text-decoration:none;">View Detailed Answers →</a>`
      : `<div style="color:var(--muted);font-size:.82rem;">Results will appear here once released.</div>`;
    if (btn) btn.remove();
  }
}

// ── Start quiz — Fix 3 & 8: pass quiz_config_id UUID to RPC ───
async function startQuiz() {
  if (!quizCfg) return;
  const btn = $('startQuizBtn');
  btn.disabled = true;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin .7s linear infinite"><path d="M21 12a9 9 0 11-9-9"/></svg> Loading…`;

  // Fix 8: pass UUID, not week_number
  const { data, error } = await supabaseClient.rpc('get_quiz_questions', {
    p_quiz_config_id: quizCfg.id
  });

  if (error) {
    showToast(error.message || 'Could not load quiz.', 'error');
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Quiz`;
    return;
  }

  questions     = data.questions || [];
  timeLimitSecs = (data.time_limit || quizCfg.time_limit_mins || 30) * 60;
  answers       = {};
  currentQIndex = 0;
  violationCount = 0;
  localTabSwitches = 0;
  localFsExits = 0;

  if (!questions.length) {
    showToast('No questions have been added to this quiz yet.', 'warn');
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Quiz`;
    return;
  }

  openQuizOverlay(data.quiz_title || quizCfg.quiz_title || 'Quiz');
}

// ── Quiz overlay ──────────────────────────────────────────────
function openQuizOverlay(title) {
  quizStartTime = Date.now();
  const overlay = $('quizOverlay');
  $('overlayTitle').textContent = title;
  overlay.classList.add('visible');

  const req = overlay.requestFullscreen || overlay.webkitRequestFullscreen || overlay.mozRequestFullScreen;
  req?.call(overlay).catch(() => {});

  renderQuizNav();
  renderQuestion(0);
  startTimer();

  document.addEventListener('fullscreenchange',       onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  document.addEventListener('visibilitychange',       onVisChange);
  window.addEventListener('blur',                     onBlur);
}

// ── Render question ───────────────────────────────────────────
function renderQuestion(index) {
  currentQIndex = Math.max(0, Math.min(index, questions.length - 1));
  const q      = questions[currentQIndex];
  const total  = questions.length;
  const pct    = ((currentQIndex + 1) / total * 100).toFixed(1);
  const chosen = answers[q.id];

  const opts = [
    { key: 'A', text: q.option_a },
    { key: 'B', text: q.option_b },
    { key: 'C', text: q.option_c },
    { key: 'D', text: q.option_d },
  ].filter(o => o.text);

  $('qPanel').innerHTML = `
    <div class="quiz-progress-row">
      <span class="quiz-progress-label">Q ${currentQIndex + 1} / ${total}</span>
      <div class="quiz-progress-bar"><div class="quiz-progress-fill" style="width:${pct}%"></div></div>
    </div>

    <div>
      <div class="quiz-q-num">Question ${currentQIndex + 1}</div>
      ${q.question_image_url ? `<img src="${esc(q.question_image_url)}" alt="Question image"
        style="max-width:100%;border-radius:10px;margin:.65rem 0;border:1px solid var(--border);">` : ''}
      <div class="quiz-q-text">${esc(q.question_text)}</div>
      ${q.marks > 1 ? `<span class="quiz-q-marks">${q.marks} marks</span>` : ''}
    </div>

    <div class="quiz-options">
      ${opts.map(o => `
        <button class="quiz-option ${chosen === o.key ? 'selected' : ''}"
          onclick="selectOption('${q.id}','${o.key}')">
          <span class="opt-letter">${o.key}</span>
          <span class="opt-text">${esc(o.text)}</span>
        </button>`).join('')}
    </div>

    <div class="quiz-nav">
      <button class="btn-quiz-nav" onclick="renderQuestion(${currentQIndex - 1})"
        ${currentQIndex === 0 ? 'disabled' : ''}>← Prev</button>
      <span style="font-size:.78rem;color:var(--muted);">${Object.keys(answers).length}/${total} answered</span>
      ${currentQIndex < total - 1
        ? `<button class="btn-quiz-nav primary" onclick="renderQuestion(${currentQIndex + 1})">Next →</button>`
        : `<button class="btn-quiz-nav submit" onclick="confirmSubmitQuiz()">Submit Quiz ✓</button>`}
    </div>`;

  refreshNav();
}

// ── Option selection ──────────────────────────────────────────
function selectOption(qId, key) {
  answers[qId] = key;
  // Re-render current question to highlight selection
  renderQuestion(currentQIndex);
}

// ── Nav grid ──────────────────────────────────────────────────
function renderQuizNav() {
  $('qNavGrid').innerHTML = questions.map((q, i) => `
    <button class="qnav-btn ${i === currentQIndex ? 'current' : answers[q.id] ? 'answered' : ''}"
      id="qnav-${i}" onclick="renderQuestion(${i})">${i + 1}</button>`).join('');
  updateAnsweredCount();
}

function refreshNav() {
  questions.forEach((q, i) => {
    const btn = $(`qnav-${i}`);
    if (btn) btn.className = `qnav-btn ${i === currentQIndex ? 'current' : answers[q.id] ? 'answered' : ''}`;
  });
  updateAnsweredCount();
}

function updateAnsweredCount() {
  const done = Object.keys(answers).length;
  $('aCount') && ($('aCount').textContent = done);
  $('tCount') && ($('tCount').textContent = questions.length);
}

// ── Timer ─────────────────────────────────────────────────────
function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed   = Math.floor((Date.now() - quizStartTime) / 1000);
    const remaining = Math.max(0, timeLimitSecs - elapsed);
    const m = Math.floor(remaining / 60), s = remaining % 60;
    const el = $('quizTimer');
    if (!el) { clearInterval(timerInterval); return; }
    el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    el.className   = remaining <= 120 ? 'quiz-timer urgent' : 'quiz-timer';
    if (remaining === 0) { showToast('Time is up! Submitting…', 'warn'); submitQuiz(); }
  }, 1000);
}

// ── Security ──────────────────────────────────────────────────
function onFsChange() {
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  if (!fs && $('quizOverlay')?.classList.contains('visible')) logViolation('fullscreen_exit');
}
function onVisChange() {
  if (document.hidden && $('quizOverlay')?.classList.contains('visible')) logViolation('tab_switch');
}
function onBlur() {
  if ($('quizOverlay')?.classList.contains('visible')) logViolation('window_blur');
}

async function logViolation(type) {
  violationCount++;
  if (type === 'tab_switch') localTabSwitches++; 
  if (type === 'fullscreen_exit') localFsExits++; 
  updateViolationBadge();
  if (quizCfg) {
    supabaseClient.from('quiz_violations').insert({
      user_id: currentUser.id, week_number: quizCfg.week_number || null,
      violation_type: type
    }).then(() => {});
  }
  const msgs = {
    tab_switch:     `Tab switch detected (violation #${violationCount}).`,
    fullscreen_exit:`Fullscreen exited (violation #${violationCount}). Please stay fullscreen.`,
    window_blur:    `Window lost focus (violation #${violationCount}).`,
  };
  $('violationMsg').textContent = msgs[type] || 'Security event logged.';
  $('violationPopup').classList.add('show');
  if (violationCount >= 5) { showToast('Max violations — submitting.', 'error'); setTimeout(submitQuiz, 1500); }
}

function dismissViolation() {
  $('violationPopup').classList.remove('show');
  const ov = $('quizOverlay');
  (ov.requestFullscreen || ov.webkitRequestFullscreen)?.call(ov).catch(() => {});
}

function updateViolationBadge() {
  const b = $('vBadge');
  b.textContent = violationCount === 0
    ? '✓ 0 violations'
    : `⚠ ${violationCount} violation${violationCount > 1 ? 's' : ''}`;
  b.className = `violations-badge ${violationCount === 0 ? 'ok' : violationCount < 3 ? 'warn' : 'danger'}`;
}

// ── Submit — Fix 8: use quiz_config_id, proper error handling ──
function confirmSubmitQuiz() {
  const unanswered = questions.length - Object.keys(answers).length;
  if (unanswered > 0 && !confirm(`${unanswered} question${unanswered > 1 ? 's' : ''} unanswered. Submit anyway?`)) return;
  submitQuiz();
}

function confirmExitQuiz() {
  if (confirm('Exit the quiz? Your answers will be lost.')) closeQuizOverlay();
}

async function submitQuiz() {
  // Guard: prevent double submission
  if ($('quizOverlay')?.dataset.submitting === 'true') return;
  $('quizOverlay').dataset.submitting = 'true';

  clearInterval(timerInterval);
  document.removeEventListener('fullscreenchange',       onFsChange);
  document.removeEventListener('webkitfullscreenchange', onFsChange);
  document.removeEventListener('visibilitychange',       onVisChange);
  window.removeEventListener('blur',                     onBlur);

  // Disable nav buttons
  document.querySelectorAll('.btn-quiz-nav, .btn-exit-quiz').forEach(b => { b.disabled = true; });

  // Show a submitting indicator in the panel
  const panel = $('qPanel');
  if (panel) panel.innerHTML = `
    <div style="text-align:center;padding:4rem 2rem;">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5"
        style="animation:spin .7s linear infinite;display:inline-block;margin-bottom:1rem;">
        <path d="M21 12a9 9 0 11-9-9"/>
      </svg>
      <div style="font-size:.95rem;font-weight:600;color:var(--text);">Submitting your answers…</div>
      <div style="font-size:.82rem;color:var(--muted);margin-top:.4rem;">Please wait, do not close this window.</div>
    </div>`;

  const timeSecs = Math.floor((Date.now() - quizStartTime) / 1000);

  // Build answers array — Fix 8: ensure this is a proper JSON array
  const payload = Object.entries(answers).map(([question_id, selected]) => ({ question_id, selected }));

  // Call RPC with local session counters
  const { data: result, error } = await supabaseClient.rpc('submit_quiz', {
    p_quiz_config_id: quizCfg.id,
    p_answers:        payload,
    p_time_secs:      timeSecs,
    p_tab_switches:   localTabSwitches,
    p_fs_exits:       localFsExits,
  });

  if (error) {
    $('quizOverlay').dataset.submitting = 'false';
    if (panel) panel.innerHTML = `
      <div style="text-align:center;padding:3rem 2rem;">
        <div style="font-size:1.5rem;margin-bottom:.75rem;">⚠</div>
        <div style="font-weight:700;color:var(--danger);margin-bottom:.5rem;">Submission failed</div>
        <div style="font-size:.85rem;color:var(--muted);margin-bottom:1.5rem;">${esc(error.message)}</div>
        <button class="btn-quiz-nav primary" onclick="submitQuiz()">Retry</button>
      </div>`;
    document.querySelectorAll('.btn-exit-quiz').forEach(b => { b.disabled = false; });
    return;
  }

  showResultModal(result);
}

function showResultModal(result) {
  const score    = result?.score    ?? 0;
  const max      = result?.max_score?? 0;
  const pct      = result?.percentage ?? 0;
  const barColor = pct >= 80 ? 'var(--accent)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';
  const pctColor = pct >= 80 ? 'var(--accent)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';
  const grade    = pct >= 90 ? ['Excellent 🎉','rgba(0,212,170,.15)','var(--accent)']
                 : pct >= 75 ? ['Good 👍',       'rgba(59,130,246,.15)','var(--accent2)']
                 : pct >= 50 ? ['Average 📈',    'rgba(251,191,36,.15)','var(--warn)']
                 :             ['Keep going 💪', 'rgba(248,113,113,.15)','var(--danger)'];

  $('qrmWeek').textContent       = esc(quizCfg?.quiz_title || 'Quiz Result');
  $('qrmScore').textContent      = score;
  $('qrmMax').textContent        = max;
  $('qrmPct').textContent        = `${pct}%`;
  $('qrmPct').style.color        = pctColor;
  $('qrmGrade').textContent      = grade[0];
  $('qrmGrade').style.background = grade[1];
  $('qrmGrade').style.color      = grade[2];
  $('qrmBar').style.background   = barColor;

  $('quizResultModal').classList.add('show');
  requestAnimationFrame(() => {
    $('qrmBar').style.width = '0%';
    requestAnimationFrame(() => { $('qrmBar').style.width = `${pct}%`; });
  });
}

function closeQuizOverlay() {
  clearInterval(timerInterval);
  document.removeEventListener('fullscreenchange',       onFsChange);
  document.removeEventListener('webkitfullscreenchange', onFsChange);
  document.removeEventListener('visibilitychange',       onVisChange);
  window.removeEventListener('blur',                     onBlur);
  if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
  $('quizOverlay').classList.remove('visible');
  $('quizOverlay').dataset.submitting = 'false';
  $('quizResultModal').classList.remove('show');
  $('violationPopup').classList.remove('show');
  loadQuizStatus();
  loadMyResults();
  loadOverview();
}

// ── Leaderboard ───────────────────────────────────────────────
async function loadLeaderboard() {
  const tbody = $('lbBody');
  tbody.innerHTML = `<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:2rem;">Loading…</td></tr>`;
  const { data } = await supabaseClient
    .from('quiz_scores').select('user_id, score, profiles(full_name, college)');
  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:2rem;">No scores yet.</td></tr>`;
    return;
  }
  const map = {};
  data.forEach(r => {
    if (!map[r.user_id]) map[r.user_id] = { uid: r.user_id, name: r.profiles?.full_name || 'Anonymous', college: r.profiles?.college || '—', total: 0 };
    map[r.user_id].total += Number(r.score);
  });
  const rows = Object.values(map).sort((a, b) => b.total - a.total);
  tbody.innerHTML = rows.slice(0, 100).map((row, i) => {
    const rank = i + 1, isYou = row.uid === currentUser.id;
    const bc = rank===1?'rank-1':rank===2?'rank-2':rank===3?'rank-3':'rank-n';
    return `<tr class="${isYou?'you':''}">
      <td><span class="rank-badge ${bc}">${rank}</span></td>
      <td style="font-weight:600;">${esc(row.name)} ${isYou?'<span style="color:var(--accent);font-size:.72rem;">(you)</span>':''}</td>
      <td style="color:var(--muted);">${esc(row.college)}</td>
      <td style="font-family:\'DM Mono\',monospace;font-weight:700;">${row.total}</td>
    </tr>`;
  }).join('');
}

// ── My Results — Fix 2: respect results_released ──────────────
async function loadMyResults() {
  const [{ data: scores }, { data: configs }] = await Promise.all([
    supabaseClient.from('quiz_scores').select('*').eq('user_id', currentUser.id).order('submitted_at', { ascending: false }),
    supabaseClient.from('quiz_config').select('id, quiz_title, results_released, week_number'),
  ]);

  const cfgMap = {};
  (configs || []).forEach(c => { cfgMap[c.id] = c; });

  const grid = $('resultsGrid');
  if (!scores?.length) {
    grid.innerHTML = `<div style="color:var(--muted);font-size:.88rem;grid-column:1/-1;">No quiz results yet. Complete a quiz to see your results here.</div>`;
    return;
  }

  grid.innerHTML = scores.map(s => {
    const cfg     = cfgMap[s.quiz_config_id] || {};
    const released= cfg.results_released;
    const pct     = Number(s.percentage) || 0;
    const barClr  = pct >= 80 ? 'var(--accent)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';
    const answers = Array.isArray(s.answers) ? s.answers : [];
    const correct = answers.filter(a => a.is_correct).length;
    const title   = cfg.quiz_title || `Quiz (Week ${s.week_number})`;

    return `
      <div class="result-card">
        <div class="rc-week">${esc(title)}</div>
        ${released ? `
          <div style="display:flex;align-items:baseline;gap:.4rem;margin-bottom:.3rem;">
            <span style="font-size:1.8rem;font-weight:800;font-family:'DM Mono',monospace;color:${barClr};">${s.score}</span>
            <span style="color:var(--muted);font-size:.9rem;">/ ${s.max_score}</span>
            <span style="font-size:.9rem;font-weight:700;color:${barClr};margin-left:auto;">${pct}%</span>
          </div>
          <div class="rc-bar"><div class="rc-bar-fill" style="width:${pct}%;background:${barClr};"></div></div>
          ${answers.length ? `<div style="font-size:.78rem;color:var(--muted);margin-bottom:.5rem;">${correct} / ${answers.length} correct</div>` : ''}
          <a href="/results.html" style="display:inline-flex;align-items:center;gap:.35rem;margin-top:.75rem;font-size:.8rem;color:var(--accent2);text-decoration:none;font-weight:600;">View Answers →</a>
        ` : `
          <div style="background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.2);border-radius:8px;padding:.65rem .85rem;margin:.5rem 0;">
            <div style="font-size:.8rem;font-weight:600;color:var(--warn);">⏳ Submitted</div>
            <div style="font-size:.75rem;color:var(--muted);margin-top:.2rem;">Results will be visible once the admin releases them.</div>
          </div>
        `}
        <div class="rc-meta" style="margin-top:.5rem;">
          <span>${new Date(s.submitted_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span>
          ${s.tab_switches > 0 ? `<span style="color:var(--warn);">⚠ ${s.tab_switches} switch${s.tab_switches>1?'es':''}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ── Overview ──────────────────────────────────────────────────
async function loadOverview() {
  const { data: scores } = await supabaseClient
    .from('quiz_scores').select('score,max_score').eq('user_id', currentUser.id);
  if (scores?.length) {
    const best = scores.reduce((b, s) => Number(s.score) > Number(b.score) ? s : b, scores[0]);
    $('stBest')  && ($('stBest').textContent  = `${best.score}/${best.max_score}`);
    $('stCount') && ($('stCount').textContent = scores.length);
  } else {
    $('stBest')  && ($('stBest').textContent  = '—');
    $('stCount') && ($('stCount').textContent = '0');
  }
  const { data: all } = await supabaseClient.from('quiz_scores').select('user_id,score');
  if (all?.length) {
    const totals = {};
    all.forEach(r => { totals[r.user_id] = (totals[r.user_id]||0) + Number(r.score); });
    const sorted = Object.keys(totals).sort((a,b) => totals[b]-totals[a]);
    const idx = sorted.indexOf(currentUser.id);
    $('stRank') && ($('stRank').textContent = idx >= 0 ? `#${idx+1}` : '—');
  }
}

// ── Profile ───────────────────────────────────────────────────
function renderProfile() {
  const p = currentProfile;
  const fields = [
    { label:'Full Name',     value:p.full_name,     full:true },
    { label:'Email',         value:p.email,         full:true },
    { label:'College',       value:p.college,       full:true },
    { label:'Year of Study', value:p.year_of_study },
    { label:'Branch',        value:p.branch         },
    { label:'Phone',         value:p.phone          },
    { label:'Roll Number',   value:p.roll_number    },
    { label:'Joined',        value:new Date(p.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}) },
  ];
  $('profileGrid').innerHTML = fields.map(f => `
    <div class="pf-field ${f.full?'full':''}">
      <div class="pf-label">${f.label}</div>
      <div class="pf-value">${esc(f.value||'—')}</div>
    </div>`).join('');
}