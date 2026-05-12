// ============================================================
// js/dashboard.js  —  Summer Analytics 2025
// Native quiz: no TestPortal, no iframe, no webhook needed.
// ============================================================

// ── State ────────────────────────────────────────────────────
let currentUser    = null;
let currentProfile = null;
let quizCfg        = null;   // active quiz_config row
let questions      = [];     // [{id, question_text, option_a…d, marks}]
let answers        = {};     // {questionId: 'A'|'B'|'C'|'D'}
let currentQIndex  = 0;
let violationCount = 0;
let timerInterval  = null;
let quizStartTime  = null;
let timeLimitSecs  = 1800;

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

// ── Helpers ───────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function $(id) { return document.getElementById(id); }

// ── User ─────────────────────────────────────────────────────
function populateUser() {
  const name    = currentProfile.full_name || currentUser.email;
  const initial = name.charAt(0).toUpperCase();
  $('heroName')     && ($('heroName').textContent     = name.split(' ')[0]);
  $('sidebarName')  && ($('sidebarName').textContent  = name);
  $('avatarInitial')&& ($('avatarInitial').textContent= initial);
  $('avatarMob')    && ($('avatarMob').textContent    = initial);
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
    .from('announcements').select('*')
    .eq('is_active', true)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(3);

  const area = $('announcementsArea');
  if (!data?.length) { area.innerHTML = ''; return; }

  area.innerHTML = data.map(a => `
    <div class="ann-box" id="ann-${a.id}">
      <div class="ann-header">
        <div class="ann-title">${esc(a.title)}</div>
        <button class="ann-close" onclick="document.getElementById('ann-${a.id}').remove()">×</button>
      </div>
      ${a.body ? `<div class="ann-body">${esc(a.body)}</div>` : ''}
      ${(a.links?.length) ? `<div>${a.links.map(l =>
        `<a class="ann-link" href="${esc(l.url)}" target="_blank" rel="noopener">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          ${esc(l.label)}</a>`).join('')}</div>` : ''}
    </div>`).join('');
}

// ── Course weeks ──────────────────────────────────────────────
async function loadWeeks() {
  const { data: weeks } = await supabaseClient
    .from('weeks').select('*').eq('is_published', true).order('week_number');

  const container = $('weeksList');
  if (!weeks?.length) {
    container.innerHTML = `<div style="color:var(--muted);padding:2rem 0;font-size:.88rem;">No weeks published yet — check back soon!</div>`;
    return;
  }

  const weekIds = weeks.map(w => w.id);
  const { data: days } = await supabaseClient
    .from('week_days').select('*').in('week_id', weekIds).order('day_number');

  const byWeek = {};
  (days || []).forEach(d => { (byWeek[d.week_id] ??= []).push(d); });

  const latest = weeks[weeks.length - 1];
  $('weekBadge').textContent = latest.title || `Week ${latest.week_number}`;

  container.innerHTML = weeks.map((w, i) =>
    buildAccordion(w, byWeek[w.id] || [], i === weeks.length - 1)
  ).join('');
}

function buildAccordion(week, days, open = false) {
  const daysHtml = days.length === 0
    ? `<tr><td colspan="5" style="color:var(--muted);padding:1.5rem;text-align:center;font-size:.85rem;">Content coming soon…</td></tr>`
    : days.map(d => {
        const tc = (lbl, url) => {
          if (!lbl) return `<td class="task-cell"><span style="color:var(--muted);">—</span></td>`;
          if (!url || url === '#') return `<td class="task-cell"><span style="font-size:.82rem;">${esc(lbl)}</span></td>`;
          return `<td class="task-cell"><a class="task-link" href="${esc(url)}" target="_blank" rel="noopener">
            ${esc(lbl)}<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a></td>`;
        };
        return `<tr>
          <td class="day-cell">Day ${d.day_number}</td>
          <td class="desc-cell">${esc(d.description || '')}</td>
          ${tc(d.task1_label, d.task1_url)}
          ${tc(d.task2_label, d.task2_url)}
          ${tc(d.task3_label, d.task3_url)}
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
      <div class="week-content">
        <table class="week-table">
          <thead><tr>
            <th>Week ${week.week_number}</th>
            <th>What's In There</th>
            <th>Task 1</th><th>Task 2</th><th>Task 3</th>
          </tr></thead>
          <tbody>${daysHtml}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Quiz status card ───────────────────────────────────────────
async function loadQuizStatus() {
  const dot  = $('qStatusDot');
  const text = $('qStatusText');
  const btn  = $('startQuizBtn');
  const hdg  = $('qHeading');
  const desc = $('qDesc');

  const { data: cfg } = await supabaseClient
    .from('quiz_config').select('*').eq('is_active', true).maybeSingle();

  if (!cfg) {
    dot.className = 'qdot off';
    text.textContent = 'No active quiz right now.';
    hdg.textContent  = 'No Active Quiz';
    desc.textContent = 'Check back on Monday when the next weekly quiz opens.';
    btn.disabled = true;
    $('qSecNotice').style.display = 'none';
    return;
  }
  quizCfg = cfg;

  const now    = new Date();
  const opens  = cfg.opens_at  ? new Date(cfg.opens_at)  : null;
  const closes = cfg.closes_at ? new Date(cfg.closes_at) : null;
  hdg.textContent = cfg.quiz_title || `Week ${cfg.week_number} Quiz`;

  if (opens && now < opens) {
    dot.className = 'qdot off';
    text.textContent = `Opens ${opens.toLocaleString('en-IN')}`;
    desc.textContent = 'This quiz has not opened yet.';
    btn.disabled = true; btn.textContent = 'Not Yet Open'; return;
  }
  if (closes && now > closes) {
    dot.className = 'qdot off';
    text.textContent = 'Submission window closed.';
    desc.textContent = 'The window for this quiz has passed.';
    btn.disabled = true; btn.textContent = 'Quiz Closed'; return;
  }

  dot.className = 'qdot live';
  text.textContent = 'Quiz is LIVE';
  desc.textContent = `Week ${cfg.week_number} assessment — ${cfg.time_limit_mins} min time limit. Quiz opens in fullscreen. Ensure a stable connection before starting.`;

  // Check already submitted
  const { data: existing } = await supabaseClient
    .from('quiz_scores').select('score,max_score,week_number')
    .eq('user_id', currentUser.id).eq('week_number', cfg.week_number).maybeSingle();

  if (existing) {
    $('qScoreSection').style.display = 'block';
    $('qWeekLabel').textContent = existing.week_number;
    $('qScore').textContent = existing.score;
    $('qMax').textContent   = existing.max_score;
    const pct = Math.round((existing.score / existing.max_score) * 100);
    $('qPct').textContent = `${pct}%`;
    $('qPct').style.color = pct >= 80 ? 'var(--accent)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';
    $('qBar').style.width = `${pct}%`;
    $('qSecNotice').style.display = 'none';
    $('qBtnRow').innerHTML = `<a href="/results.html" class="btn btn-outline" style="text-decoration:none;">View Detailed Answers →</a>`;
    btn.remove();
  }
}

// ── START QUIZ ────────────────────────────────────────────────
async function startQuiz() {
  if (!quizCfg) return;
  const btn = $('startQuizBtn');
  btn.disabled = true;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin .7s linear infinite"><path d="M21 12a9 9 0 11-9-9"/></svg> Loading questions…`;

  // Fetch questions via secure RPC (no correct answers included)
  const { data, error } = await supabaseClient.rpc('get_quiz_questions', {
    p_week_number: quizCfg.week_number
  });

  if (error) {
    showToast(error.message || 'Could not load quiz.', 'error');
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Quiz`;
    return;
  }

  questions     = data.questions || [];
  timeLimitSecs = (data.time_limit ?? quizCfg.time_limit_mins ?? 30) * 60;
  answers       = {};
  currentQIndex = 0;
  violationCount= 0;

  if (!questions.length) {
    showToast('No questions have been added to this quiz yet.', 'warn');
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Quiz`;
    return;
  }

  openQuizOverlay(data.quiz_title || quizCfg.quiz_title);
}

// ── QUIZ OVERLAY ──────────────────────────────────────────────
function openQuizOverlay(title) {
  quizStartTime = Date.now();
  const overlay = $('quizOverlay');
  $('overlayTitle').textContent = title || 'Quiz';
  overlay.classList.add('visible');

  // Request fullscreen
  const req = overlay.requestFullscreen || overlay.webkitRequestFullscreen || overlay.mozRequestFullScreen;
  req?.call(overlay).catch(() => {});

  renderQuizNav();
  renderQuestion(0);
  startTimer();

  // Security listeners
  document.addEventListener('fullscreenchange',        onFsChange);
  document.addEventListener('webkitfullscreenchange',  onFsChange);
  document.addEventListener('visibilitychange',        onVisChange);
  window.addEventListener('blur',                      onBlur);
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
        ${currentQIndex === 0 ? 'disabled' : ''}>
        ← Prev
      </button>
      <span style="font-size:.78rem;color:var(--muted);">
        ${Object.keys(answers).length} / ${total} answered
      </span>
      ${currentQIndex < total - 1
        ? `<button class="btn-quiz-nav primary" onclick="renderQuestion(${currentQIndex + 1})">Next →</button>`
        : `<button class="btn-quiz-nav submit"  onclick="confirmSubmitQuiz()">Submit Quiz ✓</button>`
      }
    </div>`;

  refreshNav();
}

// ── Option selection ──────────────────────────────────────────
function selectOption(qId, key) {
  answers[qId] = key;
  renderQuestion(currentQIndex); // re-render to show selection
}

// ── Question navigator grid ───────────────────────────────────
function renderQuizNav() {
  $('qNavGrid').innerHTML = questions.map((q, i) => `
    <button class="qnav-btn ${i === currentQIndex ? 'current' : answers[q.id] ? 'answered' : ''}"
      id="qnav-${i}" onclick="renderQuestion(${i})">${i + 1}</button>`).join('');
  updateAnsweredCount();
}

function refreshNav() {
  questions.forEach((q, i) => {
    const btn = $(`qnav-${i}`);
    if (!btn) return;
    btn.className = `qnav-btn ${i === currentQIndex ? 'current' : answers[q.id] ? 'answered' : ''}`;
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
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    const el = $('quizTimer');
    el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    el.className   = remaining <= 120 ? 'quiz-timer urgent' : 'quiz-timer';
    if (remaining === 0) {
      showToast('Time is up! Submitting automatically…', 'warn');
      submitQuiz();
    }
  }, 1000);
}

// ── Security handlers ─────────────────────────────────────────
function onFsChange() {
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  if (!fs && $('quizOverlay').classList.contains('visible'))
    logViolation('fullscreen_exit');
}
function onVisChange() {
  if (document.hidden && $('quizOverlay').classList.contains('visible'))
    logViolation('tab_switch');
}
function onBlur() {
  if ($('quizOverlay').classList.contains('visible'))
    logViolation('window_blur');
}

async function logViolation(type) {
  violationCount++;
  updateViolationBadge();

  // Persist to DB
  if (quizCfg) {
    await supabaseClient.from('quiz_violations').insert({
      user_id: currentUser.id, week_number: quizCfg.week_number, violation_type: type
    });
  }

  const msgs = {
    tab_switch:     `Tab switched (violation #${violationCount}). Return immediately.`,
    fullscreen_exit:`Fullscreen exited (violation #${violationCount}). Please stay in fullscreen.`,
    window_blur:    `Window lost focus (violation #${violationCount}). Stay on the quiz.`,
  };
  $('violationMsg').textContent = msgs[type] || 'A security event was logged.';
  $('violationPopup').classList.add('show');

  if (violationCount >= 5) {
    showToast('Maximum violations reached — quiz will be submitted.', 'error');
    setTimeout(submitQuiz, 1500);
  }
}

function dismissViolation() {
  $('violationPopup').classList.remove('show');
  const ov = $('quizOverlay');
  const req = ov.requestFullscreen || ov.webkitRequestFullscreen;
  req?.call(ov).catch(() => {});
}

function updateViolationBadge() {
  const b = $('vBadge');
  b.textContent = violationCount === 0
    ? '✓ 0 violations'
    : `⚠ ${violationCount} violation${violationCount > 1 ? 's' : ''}`;
  b.className = `violations-badge ${violationCount === 0 ? 'ok' : violationCount < 3 ? 'warn' : 'danger'}`;
}

// ── Submit ────────────────────────────────────────────────────
function confirmSubmitQuiz() {
  const unanswered = questions.length - Object.keys(answers).length;
  if (unanswered > 0) {
    if (!confirm(`You have ${unanswered} unanswered question${unanswered > 1 ? 's' : ''}. Submit anyway?`))
      return;
  }
  submitQuiz();
}

function confirmExitQuiz() {
  if (confirm('Exit the quiz? Your answers will be lost if not submitted.'))
    closeQuizOverlay();
}

async function submitQuiz() {
  // Stop timer and listeners immediately
  clearInterval(timerInterval);
  document.removeEventListener('fullscreenchange',       onFsChange);
  document.removeEventListener('webkitfullscreenchange', onFsChange);
  document.removeEventListener('visibilitychange',       onVisChange);
  window.removeEventListener('blur',                     onBlur);

  // Disable all buttons
  document.querySelectorAll('.btn-quiz-nav, .btn-exit-quiz').forEach(b => b.disabled = true);

  const timeSecs = Math.floor((Date.now() - quizStartTime) / 1000);

  // Build answers payload for RPC
  const payload = Object.entries(answers).map(([question_id, selected]) => ({
    question_id, selected
  }));

  // Count violation types
  const fsExits  = violationCount; // simplified; detailed split in schema
  const tabSw    = violationCount;

  const { data: result, error } = await supabaseClient.rpc('submit_quiz', {
    p_week_number:  quizCfg.week_number,
    p_answers:      payload,
    p_time_secs:    timeSecs,
    p_tab_switches: tabSw,
    p_fs_exits:     fsExits,
  });

  if (error) {
    showToast(error.message || 'Submission failed. Contact admin.', 'error');
    document.querySelectorAll('.btn-quiz-nav, .btn-exit-quiz').forEach(b => b.disabled = false);
    return;
  }

  showResultModal(result);
}

function showResultModal(result) {
  const score   = result.score ?? 0;
  const max     = result.max_score ?? 0;
  const pct     = result.percentage ?? 0;
  const barColor = pct >= 80 ? 'var(--accent)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';
  const pctColor = pct >= 80 ? 'var(--accent)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';
  const grade    = pct >= 90 ? ['Excellent 🎉', 'rgba(0,212,170,.15)', 'var(--accent)']
                 : pct >= 75 ? ['Good 👍',        'rgba(59,130,246,.15)', 'var(--accent2)']
                 : pct >= 50 ? ['Average 📈',     'rgba(251,191,36,.15)', 'var(--warn)']
                 :             ['Needs Work 💪',  'rgba(248,113,113,.15)','var(--danger)'];

  $('qrmWeek').textContent = `Week ${quizCfg.week_number} Result`;
  $('qrmScore').textContent = score;
  $('qrmMax').textContent   = max;
  $('qrmPct').textContent   = `${pct}%`;
  $('qrmPct').style.color   = pctColor;
  $('qrmGrade').textContent  = grade[0];
  $('qrmGrade').style.background = grade[1];
  $('qrmGrade').style.color      = grade[2];
  $('qrmBar').style.background   = barColor;

  const modal = $('quizResultModal');
  modal.classList.add('show');

  // Animate bar
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
  $('quizResultModal').classList.remove('show');
  $('violationPopup').classList.remove('show');

  // Refresh status card so score shows up immediately
  loadQuizStatus();
  loadMyResults();
  loadOverview();
}

// ── Leaderboard ───────────────────────────────────────────────
async function loadLeaderboard() {
  const tbody = $('lbBody');
  tbody.innerHTML = `<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:2rem;">Loading…</td></tr>`;

  const { data } = await supabaseClient
    .from('quiz_scores')
    .select('user_id, score, profiles(full_name, college)');

  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:2rem;">No scores yet — take the quiz!</td></tr>`;
    return;
  }

  const map = {};
  data.forEach(r => {
    if (!map[r.user_id]) map[r.user_id] = { uid: r.user_id, name: r.profiles?.full_name || 'Anonymous', college: r.profiles?.college || '—', total: 0 };
    map[r.user_id].total += Number(r.score);
  });

  const rows = Object.values(map).sort((a, b) => b.total - a.total);

  tbody.innerHTML = rows.slice(0, 100).map((row, i) => {
    const rank = i + 1;
    const isYou = row.uid === currentUser.id;
    const bc = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-n';
    return `<tr class="${isYou ? 'you' : ''}">
      <td><span class="rank-badge ${bc}">${rank}</span></td>
      <td style="font-weight:600;">${esc(row.name)} ${isYou ? '<span style="color:var(--accent);font-size:.72rem;">(you)</span>' : ''}</td>
      <td style="color:var(--muted);">${esc(row.college)}</td>
      <td style="font-family:\'DM Mono\',monospace;font-weight:700;">${row.total}</td>
    </tr>`;
  }).join('');
}

// ── My Results ────────────────────────────────────────────────
async function loadMyResults() {
  const { data: scores } = await supabaseClient
    .from('quiz_scores').select('*').eq('user_id', currentUser.id).order('week_number');

  const grid = $('resultsGrid');
  if (!scores?.length) {
    grid.innerHTML = `<div style="color:var(--muted);font-size:.88rem;grid-column:1/-1;">No quiz results yet — complete a weekly quiz to see your results here.</div>`;
    return;
  }

  grid.innerHTML = scores.map(s => {
    const pct      = Number(s.percentage) || 0;
    const barClr   = pct >= 80 ? 'var(--accent)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';
    const pctClr   = `color:${barClr}`;
    const answers  = Array.isArray(s.answers) ? s.answers : [];
    const correct  = answers.filter(a => a.is_correct).length;
    return `
      <div class="result-card">
        <div class="rc-week">Week ${s.week_number} Quiz</div>
        <div style="display:flex;align-items:baseline;gap:.4rem;margin-bottom:.3rem;">
          <span style="font-size:1.8rem;font-weight:800;font-family:'DM Mono',monospace;${pctClr};">${s.score}</span>
          <span style="color:var(--muted);font-size:.9rem;">/ ${s.max_score}</span>
          <span style="font-size:.9rem;font-weight:700;${pctClr};margin-left:auto;">${pct}%</span>
        </div>
        <div class="rc-bar"><div class="rc-bar-fill" style="width:${pct}%;background:${barClr};"></div></div>
        ${answers.length ? `<div style="font-size:.78rem;color:var(--muted);margin-bottom:.5rem;">${correct} / ${answers.length} correct</div>` : ''}
        <div class="rc-meta">
          <span>${new Date(s.submitted_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span>
          ${s.tab_switches > 0 ? `<span style="color:var(--warn);">⚠ ${s.tab_switches} tab switch${s.tab_switches>1?'es':''}</span>` : ''}
        </div>
        <a href="/results.html" style="display:inline-flex;align-items:center;gap:.35rem;margin-top:.75rem;font-size:.8rem;color:var(--accent2);text-decoration:none;font-weight:600;">
          View Answers →
        </a>
      </div>`;
  }).join('');
}

// ── Overview ──────────────────────────────────────────────────
async function loadOverview() {
  const { data: scores } = await supabaseClient
    .from('quiz_scores').select('score,max_score,week_number').eq('user_id', currentUser.id);

  if (scores?.length) {
    const best = scores.reduce((b, s) => Number(s.score) > Number(b.score) ? s : b, scores[0]);
    $('stBest')  && ($('stBest').textContent  = `${best.score}/${best.max_score}`);
    $('stCount') && ($('stCount').textContent = scores.length);
  } else {
    $('stBest')  && ($('stBest').textContent  = '—');
    $('stCount') && ($('stCount').textContent = '0');
  }

  // Compute rank
  const { data: all } = await supabaseClient.from('quiz_scores').select('user_id,score');
  if (all?.length) {
    const totals = {};
    all.forEach(r => { totals[r.user_id] = (totals[r.user_id] || 0) + Number(r.score); });
    const sorted = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    const idx    = sorted.indexOf(currentUser.id);
    $('stRank') && ($('stRank').textContent = idx >= 0 ? `#${idx + 1}` : '—');
  }
}

// ── Profile ───────────────────────────────────────────────────
function renderProfile() {
  const p = currentProfile;
  const fields = [
    { label: 'Full Name',     value: p.full_name,     full: true },
    { label: 'Email',         value: p.email,         full: true },
    { label: 'College',       value: p.college,       full: true },
    { label: 'Year of Study', value: p.year_of_study },
    { label: 'Branch',        value: p.branch         },
    { label: 'Phone',         value: p.phone          },
    { label: 'Roll Number',   value: p.roll_number    },
    { label: 'Joined',        value: new Date(p.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}) },
  ];
  $('profileGrid').innerHTML = fields.map(f => `
    <div class="pf-field ${f.full ? 'full' : ''}">
      <div class="pf-label">${f.label}</div>
      <div class="pf-value">${esc(f.value || '—')}</div>
    </div>`).join('');
}
