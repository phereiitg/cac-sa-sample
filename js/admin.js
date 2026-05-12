// ============================================================
// js/admin.js  —  Summer Analytics 2025  (v2)
// ============================================================

let adminProfile    = null;
let allWeeks        = [];
let editingWeekId   = null;
let activeQCfgId    = null;   // quiz_config.id (UUID) for question editor
let allParticipants = [];
let allResults      = [];

// ── Helpers ───────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function $(id) { return document.getElementById(id); }
function toLocalDT(iso) {
  if (!iso) return '';
  const d = new Date(iso), p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function downloadCSV(name, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})), download: name
  });
  a.click(); URL.revokeObjectURL(a.href);
}

// ── Boot ──────────────────────────────────────────────────────
(async () => {
  const auth = await requireAdmin();
  if (!auth) return;
  adminProfile = auth.profile;
  $('adminName').textContent = adminProfile.full_name || adminProfile.email;

  await Promise.all([
    loadStats(), loadContentWeeks(), loadQuizConfig(),
    loadQCfgButtons(), loadParticipants(), loadResults(),
    loadViolations(), loadAnnouncements(),
  ]);
})();

function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  $(`tab-${name}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-tab="${name}"]`)?.classList.add('active');
}

// ── Stats ─────────────────────────────────────────────────────
async function loadStats() {
  const [{ count: p },{ count: s },{ count: v },{ data: q }] = await Promise.all([
    supabaseClient.from('profiles').select('*',{count:'exact',head:true}),
    supabaseClient.from('quiz_scores').select('*',{count:'exact',head:true}),
    supabaseClient.from('quiz_violations').select('*',{count:'exact',head:true}),
    supabaseClient.from('quiz_config').select('quiz_title').eq('is_active',true).maybeSingle(),
  ]);
  $('stP').textContent = p ?? '—';
  $('stS').textContent = s ?? '—';
  $('stV').textContent = v ?? '—';
  $('stQ').textContent = q?.quiz_title || (q ? 'Active' : 'None');
}

// ═══════════════════════════════════════════════════════════════
// COURSE CONTENT  — Fix 5 & 6
// ═══════════════════════════════════════════════════════════════
async function loadContentWeeks() {
  const { data } = await supabaseClient.from('weeks').select('*').order('week_number');
  allWeeks = data || [];
  const el = $('contentWeekBtns');
  el.innerHTML = allWeeks.map(w => `
    <button class="wsb ${editingWeekId === w.id ? 'active' : ''}" onclick="selectContentWeek('${w.id}')">
      ${esc(w.title || 'Week '+w.week_number)}
      <span style="opacity:.6;font-size:.68rem;margin-left:.3rem;">${w.is_published ? '✓ Live' : 'Draft'}</span>
    </button>`).join('');
}

async function selectContentWeek(id) {
  editingWeekId = id;
  await loadContentWeeks();
  await renderContentEditor(id);
}

async function renderContentEditor(id) {
  const week = allWeeks.find(w => w.id === id);
  if (!week) return;
  const { data: days } = await supabaseClient
    .from('week_days').select('*').eq('week_id', id).order('day_number');
  $('contentEditor').innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem;margin-bottom:1rem;">
        <div class="card-title" style="margin:0;">${esc(week.title||'Week '+week.week_number)} — Editor</div>
        <label class="toggle" style="font-size:.83rem;">
          <input type="checkbox" id="wkPub" ${week.is_published?'checked':''}
            onchange="togglePublish('${id}', this.checked)">
          Published (live to students)
        </label>
      </div>
      <div class="form-row" style="margin-bottom:1.1rem;">
        <div><label>Week Title</label><input type="text" id="wkTitle" value="${esc(week.title||'')}"></div>
        <div style="display:flex;align-items:flex-end;">
          <button class="btn btn-outline" onclick="saveWeekTitle('${id}')">Save Title</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem;">
        <span style="font-weight:700;font-size:.88rem;">Daily Content</span>
        <button class="btn btn-primary btn-sm" onclick="addDay('${id}')">+ Add Day</button>
      </div>
      <div id="daysContainer">
        ${(days||[]).map(d => renderDayCard(d)).join('')}
      </div>
    </div>`;
}

// Fix 6: task editor uses tasks_json JSONB — unlimited items per slot
function renderDayCard(d) {
  // Parse tasks_json or fall back to legacy columns
  let slots = d.tasks_json && Array.isArray(d.tasks_json) && d.tasks_json.length
    ? d.tasks_json
    : [
        d.task1_label ? [{ label: d.task1_label, url: d.task1_url||'' }] : [],
        d.task2_label ? [{ label: d.task2_label, url: d.task2_url||'' }] : [],
        d.task3_label ? [{ label: d.task3_label, url: d.task3_url||'' }] : [],
      ];
  // Ensure 3 slots
  while (slots.length < 3) slots.push([]);

  const slotHtml = (slotIdx) => {
    const items = slots[slotIdx] || [];
    return `
      <div style="border:1px solid var(--border);border-radius:9px;padding:.75rem;background:var(--bg);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">
          <span style="font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;">Task ${slotIdx+1}</span>
          <button class="btn btn-outline btn-sm" style="font-size:.7rem;padding:.2rem .55rem;"
            onclick="addTaskItem('${d.id}',${slotIdx})">+ Add Link</button>
        </div>
        <div id="slot-${d.id}-${slotIdx}">
          ${items.map((item, itemIdx) => taskItemHtml(d.id, slotIdx, itemIdx, item)).join('')}
          ${!items.length ? `<div style="color:var(--muted);font-size:.75rem;padding:.25rem 0;">No links yet</div>` : ''}
        </div>
      </div>`;
  };

  return `
    <div class="day-card" id="day-${d.id}">
      <div class="day-card-header">
        <div class="day-card-title">Day ${d.day_number}</div>
        <button class="btn btn-danger btn-sm" onclick="deleteDay('${d.id}')">Delete</button>
      </div>
      <div class="form-row full" style="margin-bottom:.85rem;">
        <div><label>Description</label>
          <textarea id="desc-${d.id}" rows="2">${esc(d.description||'')}</textarea></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.6rem;margin-bottom:.85rem;">
        ${[0,1,2].map(i => slotHtml(i)).join('')}
      </div>
      <button class="btn btn-primary btn-sm" onclick="saveDay('${d.id}')">💾 Save Day ${d.day_number}</button>
    </div>`;
}

function taskItemHtml(dayId, slotIdx, itemIdx, item) {
  return `
    <div id="item-${dayId}-${slotIdx}-${itemIdx}" style="display:grid;grid-template-columns:1fr auto;gap:.35rem;margin-bottom:.35rem;align-items:start;">
      <div>
        <input type="text" value="${esc(item.label||'')}"
          placeholder="Label" id="lbl-${dayId}-${slotIdx}-${itemIdx}"
          style="margin-bottom:.25rem;">
        <input type="url"  value="${esc(item.url||'')}"
          placeholder="URL (optional)" id="url-${dayId}-${slotIdx}-${itemIdx}">
      </div>
      <button onclick="removeTaskItem('${dayId}',${slotIdx},${itemIdx})"
        style="background:none;border:1px solid var(--border);border-radius:7px;padding:.3rem .55rem;cursor:pointer;color:var(--muted);margin-top:.15rem;font-size:.85rem;">
        ×
      </button>
    </div>`;
}

function addTaskItem(dayId, slotIdx) {
  const container = $(`slot-${dayId}-${slotIdx}`);
  if (!container) return;
  // Count existing items
  const existing = container.querySelectorAll(`[id^="item-${dayId}-${slotIdx}-"]`).length;
  const noLinks  = container.querySelector('div[style*="No links"]');
  if (noLinks) noLinks.remove();
  container.insertAdjacentHTML('beforeend', taskItemHtml(dayId, slotIdx, existing, { label:'', url:'' }));
}

function removeTaskItem(dayId, slotIdx, itemIdx) {
  $(`item-${dayId}-${slotIdx}-${itemIdx}`)?.remove();
}

async function saveDay(dayId) {
  const desc = $(`desc-${dayId}`)?.value.trim() || '';

  // Collect tasks_json from UI
  const slots = [0,1,2].map(slotIdx => {
    const container = $(`slot-${dayId}-${slotIdx}`);
    if (!container) return [];
    const items = [];
    let idx = 0;
    while (true) {
      const lbl = $(`lbl-${dayId}-${slotIdx}-${idx}`);
      const url = $(`url-${dayId}-${slotIdx}-${idx}`);
      if (!lbl) break;
      
      let finalUrl = url?.value.trim() || '';
      // Force absolute URL if they forgot https://
      if (finalUrl && !/^https?:\/\//i.test(finalUrl) && !finalUrl.startsWith('/')) {
          finalUrl = 'https://' + finalUrl;
      }

      if (lbl.value.trim()) items.push({ label: lbl.value.trim(), url: finalUrl });
      idx++;
    }
    return items;
  });

  const { error } = await supabaseClient.from('week_days').update({
    description: desc,
    tasks_json:  slots,
    // Also update legacy columns from first items (for backwards compat)
    task1_label: slots[0]?.[0]?.label || null, task1_url: slots[0]?.[0]?.url || null,
    task2_label: slots[1]?.[0]?.label || null, task2_url: slots[1]?.[0]?.url || null,
    task3_label: slots[2]?.[0]?.label || null, task3_url: slots[2]?.[0]?.url || null,
  }).eq('id', dayId);

  if (error) { showToast('Save failed: ' + error.message, 'error'); return; }
  showToast('Day saved!', 'success');
}

// Fix 5: calculate next day number from DB, never use stale state
async function addDay(weekId) {
  const weekNum = allWeeks.find(w => w.id === weekId)?.week_number;

  // Always query DB for the current max day number
  const { data: existing } = await supabaseClient
    .from('week_days').select('day_number').eq('week_id', weekId)
    .order('day_number', { ascending: false }).limit(1);
  const nextDay = existing?.length ? existing[0].day_number + 1 : 1;

  const { data, error } = await supabaseClient.from('week_days').insert({
    week_id: weekId, week_number: weekNum, day_number: nextDay,
    description: '', tasks_json: [[],[],[]],
    task1_label:null, task1_url:null, task2_label:null, task2_url:null, task3_label:null, task3_url:null,
  }).select().single();

  if (error) {
    // Unique violation: day number collision, retry with max+1
    if (error.code === '23505') {
      showToast('Day number conflict — refreshing…', 'warn');
      await renderContentEditor(weekId);
      return;
    }
    showToast('Error: ' + error.message, 'error'); return;
  }
  $('daysContainer').insertAdjacentHTML('beforeend', renderDayCard(data));
  showToast(`Day ${nextDay} added.`, 'success');
}

async function saveWeekTitle(id) {
  const title = $('wkTitle').value.trim();
  const { error } = await supabaseClient.from('weeks').update({ title, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { showToast('Error: '+error.message,'error'); return; }
  allWeeks = allWeeks.map(w => w.id === id ? {...w, title} : w);
  showToast('Title saved!','success');
  await loadContentWeeks();
}

async function togglePublish(id, pub) {
  const { error } = await supabaseClient.from('weeks').update({
    is_published: pub, published_at: pub ? new Date().toISOString() : null, updated_at: new Date().toISOString()
  }).eq('id', id);
  if (error) { showToast('Error: '+error.message,'error'); return; }
  allWeeks = allWeeks.map(w => w.id === id ? {...w, is_published:pub} : w);
  showToast(pub ? '✓ Week is now LIVE!' : 'Week set to draft.', pub ? 'success' : 'warn');
  await loadContentWeeks();
}

async function deleteDay(id) {
  if (!confirm('Delete this day?')) return;
  await supabaseClient.from('week_days').delete().eq('id', id);
  $(`day-${id}`)?.remove();
  showToast('Day deleted.','warn');
}

// ═══════════════════════════════════════════════════════════════
// QUIZ SETTINGS  — Fix 2 (results_released) & Fix 3 (no unique week_number)
// ═══════════════════════════════════════════════════════════════
async function loadQuizConfig() {
  const { data: active } = await supabaseClient
    .from('quiz_config').select('*').eq('is_active',true).maybeSingle();
  if (active) fillQuizForm(active);

  const { data: all } = await supabaseClient.from('quiz_config').select('*').order('created_at', { ascending: false });
  const wrap = $('quizCfgTable');
  if (!all?.length) { wrap.innerHTML = `<p style="color:var(--muted);padding:.75rem;">No quizzes yet.</p>`; return; }

  wrap.innerHTML = `<table>
    <thead><tr>
      <th>Title</th><th>Status</th><th>Week (display)</th>
      <th>Opens</th><th>Closes</th><th>Time</th><th>Qs</th><th>Results</th><th>Actions</th>
    </tr></thead>
    <tbody>${all.map(q => `<tr>
      <td style="font-weight:600;">${esc(q.quiz_title||'Untitled')}</td>
      <td><span class="dot ${q.is_active?'dot-g':'dot-r'}"></span>${q.is_active?'Live':'Off'}</td>
      <td style="color:var(--muted);">${q.week_number||'—'}</td>
      <td style="color:var(--muted);font-size:.78rem;">${q.opens_at?new Date(q.opens_at).toLocaleString('en-IN'):'—'}</td>
      <td style="color:var(--muted);font-size:.78rem;">${q.closes_at?new Date(q.closes_at).toLocaleString('en-IN'):'—'}</td>
      <td>${q.time_limit_mins}m</td>
      <td id="qCount-${q.id}">…</td>
      <td>
        ${q.results_released
          ? `<span style="color:var(--accent);font-size:.78rem;font-weight:700;">✓ Released</span>`
          : `<button class="btn btn-outline btn-sm" onclick="releaseResults('${q.id}')">Release</button>`}
      </td>
      <td style="display:flex;gap:.35rem;">
        <button class="btn btn-outline btn-sm" onclick="loadQCIntoForm('${q.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteQC('${q.id}')">Del</button>
      </td>
    </tr>`).join('')}
    </tbody></table>`;

  all.forEach(async q => {
    const { count } = await supabaseClient.from('quiz_questions')
      .select('*',{count:'exact',head:true}).eq('quiz_config_id', q.id);
    const el = $(`qCount-${q.id}`);
    if (el) el.textContent = count ?? 0;
  });
}

function fillQuizForm(q) {
  $('qcTitle')?.setAttribute('value', q.quiz_title||'');
  if ($('qcTitle'))   $('qcTitle').value   = q.quiz_title||'';
  if ($('qcWeek'))    $('qcWeek').value    = q.week_number||'';
  if ($('qcTime'))    $('qcTime').value    = q.time_limit_mins||30;
  if ($('qcActive'))  $('qcActive').checked  = q.is_active;
  if ($('qcShuffle')) $('qcShuffle').checked = q.shuffle_questions ?? true;
  if ($('qcReleased'))$('qcReleased').checked= q.results_released ?? false;
  if (q.opens_at  && $('qcOpens'))  $('qcOpens').value  = toLocalDT(q.opens_at);
  if (q.closes_at && $('qcCloses')) $('qcCloses').value = toLocalDT(q.closes_at);
  $('quizCfgCard').dataset.editId = q.id;
}

async function loadQCIntoForm(id) {
  const { data: q } = await supabaseClient.from('quiz_config').select('*').eq('id',id).single();
  if (!q) return;
  fillQuizForm(q);
  showToast('Loaded into form — edit and save.','info');
}

async function saveQuizConfig() {
  const title   = $('qcTitle').value.trim();
  const weekNum = $('qcWeek').value ? parseInt($('qcWeek').value) : null;
  const timeMins= parseInt($('qcTime').value)||30;
  const active  = $('qcActive').checked;
  const shuffle = $('qcShuffle').checked;
  const released= $('qcReleased').checked;
  const opens   = $('qcOpens').value  ? new Date($('qcOpens').value).toISOString()  : null;
  const closes  = $('qcCloses').value ? new Date($('qcCloses').value).toISOString() : null;

  if (!title) { showToast('Quiz title is required.','error'); return; }

  // If activating, deactivate all others first
  if (active) await supabaseClient.from('quiz_config').update({ is_active: false }).eq('is_active', true);

  const payload = {
    quiz_title: title, week_number: weekNum, is_active: active,
    time_limit_mins: timeMins, shuffle_questions: shuffle,
    results_released: released,
    results_released_at: released ? new Date().toISOString() : null,
    opens_at: opens, closes_at: closes, updated_at: new Date().toISOString()
  };

  const editId = $('quizCfgCard').dataset.editId;
  const { error } = editId
    ? await supabaseClient.from('quiz_config').update(payload).eq('id', editId)
    : await supabaseClient.from('quiz_config').insert(payload);  // Fix 3: INSERT not upsert

  if (error) { showToast('Save failed: '+error.message,'error'); return; }
  showToast('Quiz saved!','success');
  delete $('quizCfgCard').dataset.editId;
  // Clear form
  if ($('qcTitle'))  $('qcTitle').value = '';
  if ($('qcWeek'))   $('qcWeek').value  = '';
  await loadQuizConfig(); await loadStats(); await loadQCfgButtons();
}

// Fix 2: release results for a specific quiz
async function releaseResults(quizConfigId) {
  if (!confirm('Release results? Students will immediately see scores and answer breakdowns.')) return;
  const { error } = await supabaseClient.from('quiz_config').update({
    results_released: true, results_released_at: new Date().toISOString()
  }).eq('id', quizConfigId);
  if (error) { showToast('Error: '+error.message,'error'); return; }
  showToast('Results released! Students can now see scores.','success');
  await loadQuizConfig();
}

async function deleteQC(id) {
  if (!confirm('Delete this quiz config? This also deletes all its questions!')) return;
  await supabaseClient.from('quiz_config').delete().eq('id', id);
  showToast('Deleted.','warn');
  await loadQuizConfig(); await loadQCfgButtons();
}

// ═══════════════════════════════════════════════════════════════
// QUIZ LIVE TOGGLE  — from Quiz Questions page
// ═══════════════════════════════════════════════════════════════
async function renderQStatusBar(cfgId) {
  const { data: q } = await supabaseClient.from('quiz_config').select('*').eq('id', cfgId).single();
  const bar = $('qStatusBar');
  if (!q || !bar) return;
  const isLive = q.is_active;
  bar.style.display = 'block';
  bar.innerHTML = `
    <div style="background:${isLive ? 'rgba(0,212,170,.08)' : 'var(--surface)'};
      border:1px solid ${isLive ? 'rgba(0,212,170,.3)' : 'var(--border)'};
      border-radius:12px;padding:.85rem 1.25rem;
      display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.65rem;">
      <div style="display:flex;align-items:center;gap:.75rem;">
        <span class="dot ${isLive ? 'dot-g' : 'dot-r'}" style="width:10px;height:10px;flex-shrink:0;"></span>
        <div>
          <span style="font-weight:700;font-size:.9rem;">${esc(q.quiz_title)}</span>
          <span style="font-size:.78rem;color:var(--muted);margin-left:.6rem;">
            ${isLive ? '● Live to students' : '○ Not visible to students'}
          </span>
        </div>
      </div>
      <button class="btn ${isLive ? 'btn-outline' : 'btn-primary'} btn-sm"
        onclick="toggleQuizLive('${cfgId}', ${!isLive})">
        ${isLive ? '⏸ Take Offline' : '▶ Go Live'}
      </button>
    </div>`;
}

async function toggleQuizLive(cfgId, makeActive) {
  const action = makeActive
    ? 'make this quiz LIVE? Students will immediately see and take it.'
    : 'take this quiz OFFLINE? Students will no longer see it.';
  if (!confirm('Are you sure you want to ' + action)) return;

  if (makeActive) {
    // Deactivate all other quizzes first (only one can be live at a time)
    await supabaseClient.from('quiz_config').update({ is_active: false }).eq('is_active', true);
  }

  const { error } = await supabaseClient.from('quiz_config')
    .update({ is_active: makeActive, updated_at: new Date().toISOString() })
    .eq('id', cfgId);

  if (error) { showToast('Error: ' + error.message, 'error'); return; }

  showToast(makeActive ? '✓ Quiz is now LIVE!' : 'Quiz taken offline.', makeActive ? 'success' : 'warn');
  await renderQStatusBar(cfgId);   // refresh the status bar
  await loadQCfgButtons();         // refresh quiz selector buttons (● LIVE dot)
  await loadQuizConfig();          // refresh the Quiz Settings table
  await loadStats();               // refresh dashboard active quiz name
}

// ═══════════════════════════════════════════════════════════════
// QUIZ QUESTIONS  — Fix 3 (quiz_config_id) & Fix 4 (CSV + images)
// ═══════════════════════════════════════════════════════════════
async function loadQCfgButtons() {
  const { data } = await supabaseClient.from('quiz_config').select('id,quiz_title,week_number,is_active').order('created_at', { ascending: false });
  const el = $('qWeekBtns');
  if (!data?.length) {
    el.innerHTML = `<p style="color:var(--muted);font-size:.85rem;">No quizzes configured yet. Create one in Quiz Settings first.</p>`;
    return;
  }
  el.innerHTML = data.map(q => `
    <button class="wsb ${activeQCfgId === q.id ? 'active' : ''}" onclick="selectQCfg('${q.id}')">
      ${esc(q.quiz_title || 'Untitled')}
      ${q.is_active ? '<span style="font-size:.65rem;color:var(--accent);margin-left:.3rem;">● LIVE</span>' : ''}
    </button>`).join('');
}

async function selectQCfg(cfgId) {
  activeQCfgId = cfgId;
  await loadQCfgButtons();
  await loadQuestions(cfgId);
}

async function loadQuestions(cfgId) {
  renderQStatusBar(cfgId);
  const { data: qs } = await supabaseClient
    .from('quiz_questions').select('*').eq('quiz_config_id', cfgId)
    .order('sort_order').order('created_at');

  $('questionsArea').style.display = 'block';
  const totalMarks = (qs||[]).reduce((s,q) => s + (q.marks||1), 0);
  $('qCountLabel').textContent = `${qs?.length||0} question${qs?.length!==1?'s':''}`;
  $('qTotalMarks').textContent = `${totalMarks} total marks`;

  const list = $('questionsList');
  if (!qs?.length) {
    list.innerHTML = `<div style="color:var(--muted);padding:2rem;text-align:center;font-size:.88rem;">No questions yet. Click "+ Add Question" to start.</div>`;
    return;
  }
  list.innerHTML = qs.map((q,i) => renderQCard(q, i+1)).join('');
}

function renderQCard(q, num) {
  const opts = [
    {key:'A',text:q.option_a},{key:'B',text:q.option_b},
    {key:'C',text:q.option_c},{key:'D',text:q.option_d},
  ].filter(o => o.text);
  return `
    <div class="q-card" id="qcard-${q.id}">
      <div class="q-card-header">
        <div class="q-num">Q${num} · ${q.marks} mark${q.marks>1?'s':''}</div>
        <div style="display:flex;gap:.4rem;align-items:center;">
          <span class="correct-badge">✓ ${q.correct_option}</span>
          <button class="btn btn-outline btn-sm" onclick="editQuestion('${q.id}')">Edit</button>
          <button class="btn btn-danger btn-sm"  onclick="deleteQuestion('${q.id}')">Del</button>
        </div>
      </div>
      ${q.question_image_url ? `<img src="${esc(q.question_image_url)}" style="max-width:200px;border-radius:7px;margin-bottom:.5rem;border:1px solid var(--border);">` : ''}
      <div style="font-size:.88rem;font-weight:600;margin-bottom:.55rem;line-height:1.5;">${esc(q.question_text)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.3rem;">
        ${opts.map(o => `<div style="font-size:.78rem;padding:.35rem .6rem;border-radius:7px;
          background:${o.key===q.correct_option?'rgba(0,212,170,.08)':'var(--bg)'};
          border:1px solid ${o.key===q.correct_option?'rgba(0,212,170,.3)':'var(--border)'};
          color:${o.key===q.correct_option?'var(--accent)':'var(--muted)'};">
          <span style="font-weight:700;font-family:'DM Mono',monospace;">${o.key}.</span> ${esc(o.text)}
        </div>`).join('')}
      </div>
      ${q.explanation?`<div style="margin-top:.5rem;font-size:.75rem;color:var(--muted);border-top:1px solid var(--border);padding-top:.5rem;line-height:1.5;">💡 ${esc(q.explanation)}</div>`:''}
    </div>`;
}

function addQuestion() {
  if (!activeQCfgId) { showToast('Select a quiz first.','warn'); return; }
  openQModal(null);
}

function editQuestion(id) {
  supabaseClient.from('quiz_questions').select('*').eq('id',id).single()
    .then(({ data }) => { if (data) openQModal(data); });
}

function openQModal(q) {
  let modal = $('qModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'qModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9000;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto;';
    modal.addEventListener('click', e => { if (e.target===modal) closeQModal(); });
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;max-width:640px;width:100%;padding:2rem;max-height:92vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <div style="font-size:1rem;font-weight:700;">${q?'Edit':'Add'} Question</div>
        <button onclick="closeQModal()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:1.3rem;">×</button>
      </div>

      <div style="margin-bottom:.85rem;">
        <label>Question Text *</label>
        <textarea id="mqQ" rows="3" placeholder="Type the question…">${esc(q?.question_text||'')}</textarea>
        <div style="font-size:.72rem;color:var(--muted);margin-top:.3rem;">Supports plain text. LaTeX coming soon.</div>
      </div>

      <!-- Fix 4: image upload for question -->
      <div style="margin-bottom:.85rem;">
        <label>Question Image (optional)</label>
        <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;">
          ${q?.question_image_url ? `<img src="${esc(q.question_image_url)}" style="height:50px;border-radius:6px;border:1px solid var(--border);">` : ''}
          <input type="file" id="mqImgFile" accept="image/*" style="font-size:.82rem;color:var(--muted);background:var(--bg);border:1px dashed var(--border);border-radius:8px;padding:.4rem .65rem;flex:1;">
        </div>
        <input type="hidden" id="mqImgUrl" value="${esc(q?.question_image_url||'')}">
      </div>

      <div class="form-row" style="margin-bottom:.75rem;">
        <div><label>Option A *</label><input type="text" id="mqA" value="${esc(q?.option_a||'')}"></div>
        <div><label>Option B *</label><input type="text" id="mqB" value="${esc(q?.option_b||'')}"></div>
      </div>
      <div class="form-row" style="margin-bottom:.75rem;">
        <div><label>Option C</label><input type="text" id="mqC" value="${esc(q?.option_c||'')}"></div>
        <div><label>Option D</label><input type="text" id="mqD" value="${esc(q?.option_d||'')}"></div>
      </div>
      <div class="form-row" style="margin-bottom:.75rem;">
        <div>
          <label>Correct Option *</label>
          <select id="mqCorrect">
            <option value="">Select</option>
            ${['A','B','C','D'].map(k=>`<option value="${k}" ${q?.correct_option===k?'selected':''}>${k}</option>`).join('')}
          </select>
        </div>
        <div><label>Marks</label><input type="number" id="mqMarks" value="${q?.marks||1}" min="1" max="20"></div>
      </div>
      <div style="margin-bottom:1.25rem;">
        <label>Explanation (shown after submission)</label>
        <textarea id="mqExp" rows="2" placeholder="Explain the correct answer…">${esc(q?.explanation||'')}</textarea>
      </div>
      <div style="display:flex;gap:.65rem;justify-content:flex-end;">
        <button class="btn btn-outline" onclick="closeQModal()">Cancel</button>
        <button class="btn btn-primary" id="mqSaveBtn" onclick="saveQuestion(${q?`'${q.id}'`:'null'})">
          ${q ? '💾 Save' : '+ Add Question'}
        </button>
      </div>
    </div>`;
}

function closeQModal() { $('qModal')?.remove(); }

async function saveQuestion(id) {
  const qText   = $('mqQ').value.trim();
  const optA    = $('mqA').value.trim();
  const optB    = $('mqB').value.trim();
  const optC    = $('mqC').value.trim();
  const optD    = $('mqD').value.trim();
  const correct = $('mqCorrect').value;
  const marks   = parseInt($('mqMarks').value)||1;
  const expl    = $('mqExp').value.trim();

  if (!qText||!optA||!optB||!correct) { showToast('Question, A, B, and correct answer required.','error'); return; }

  const saveBtn = $('mqSaveBtn');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

  // Fix 4: upload image if selected
  let imageUrl = $('mqImgUrl').value || null;
  const imgFile = $('mqImgFile')?.files?.[0];
  if (imgFile) {
    const ext = imgFile.name.split('.').pop();
    const path = `questions/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { data: upData, error: upErr } = await supabaseClient.storage
      .from('quiz-images').upload(path, imgFile, { upsert: true });
    if (upErr) { showToast('Image upload failed: '+upErr.message,'error'); saveBtn.disabled=false; saveBtn.textContent=id?'💾 Save':'+ Add Question'; return; }
    const { data: urlData } = supabaseClient.storage.from('quiz-images').getPublicUrl(path);
    imageUrl = urlData?.publicUrl || null;
  }

  const payload = {
    quiz_config_id:    activeQCfgId,
    question_text:     qText,
    option_a: optA, option_b: optB,
    option_c: optC||null, option_d: optD||null,
    correct_option:    correct,
    marks, explanation: expl||null,
    question_image_url: imageUrl,
  };

  const { error } = id
    ? await supabaseClient.from('quiz_questions').update(payload).eq('id',id)
    : await supabaseClient.from('quiz_questions').insert(payload);

  if (error) { showToast('Save failed: '+error.message,'error'); saveBtn.disabled=false; return; }
  showToast(id?'Question updated!':'Question added!','success');
  closeQModal();
  await loadQuestions(activeQCfgId);
}

async function deleteQuestion(id) {
  if (!confirm('Delete this question?')) return;
  await supabaseClient.from('quiz_questions').delete().eq('id',id);
  showToast('Deleted.','warn');
  await loadQuestions(activeQCfgId);
}

// Fix 4: Bulk import — uses TAB-separated to handle commas in text
function showBulkImport() { $('bulkImportPanel').style.display='block'; }
function hideBulkImport() { $('bulkImportPanel').style.display='none'; $('csvContent').value=''; }

async function importCSV() {
  if (!activeQCfgId) { showToast('Select a quiz first.','warn'); return; }
  const raw = $('csvContent').value.trim();
  if (!raw) { showToast('Paste content first.','warn'); return; }

  const lines = raw.split('\n').map(l=>l.trim()).filter(Boolean);
  const questions = [];
  const errors = [];

  lines.forEach((line, i) => {
    // Fix 4: use TAB as delimiter — no comma-in-text issues
    let cols = line.split('\t');
    // Fallback: if no tabs, try to use pipe |
    if (cols.length < 3) cols = line.split('|');
    // Last fallback: comma (risky)
    if (cols.length < 3) {
      // RFC4180 comma-quoted parsing
      cols = [];
      let cur = '', inQ = false;
      for (const ch of line + ',') {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
    }
    cols = cols.map(c => c.replace(/^"+|"+$/g,'').trim());

    const [question_text, option_a, option_b, option_c, option_d, correct_option, marks, explanation] = cols;
    if (!question_text||!option_a||!option_b||!correct_option) {
      errors.push(`Row ${i+1}: missing required fields.`); return;
    }
    const co = correct_option.toUpperCase().charAt(0);
    if (!['A','B','C','D'].includes(co)) {
      errors.push(`Row ${i+1}: correct_option must be A/B/C/D.`); return;
    }
    questions.push({
      quiz_config_id: activeQCfgId, question_text,
      option_a, option_b, option_c: option_c||null, option_d: option_d||null,
      correct_option: co, marks: parseInt(marks)||1, explanation: explanation||null,
    });
  });

  if (errors.length) { showToast(errors.slice(0,3).join(' | '), 'error'); return; }
  if (!questions.length) { showToast('No valid rows found.','warn'); return; }

  const { error } = await supabaseClient.from('quiz_questions').insert(questions);
  if (error) { showToast('Import failed: '+error.message,'error'); return; }
  showToast(`${questions.length} questions imported!`,'success');
  hideBulkImport();
  await loadQuestions(activeQCfgId);
}

// ═══════════════════════════════════════════════════════════════
// PARTICIPANTS
// ═══════════════════════════════════════════════════════════════
async function loadParticipants() {
  const { data } = await supabaseClient.from('profiles').select('*').order('created_at',{ascending:false});
  allParticipants = data||[];
  const tbody = $('participantsBody');
  if (!allParticipants.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--muted);text-align:center;padding:2rem;">No participants yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = allParticipants.map((p,i) => `<tr>
    <td style="color:var(--muted);">${i+1}</td>
    <td style="font-weight:600;">${esc(p.full_name||'—')}</td>
    <td style="color:var(--muted);font-size:.78rem;">${esc(p.email)}</td>
    <td>${esc(p.college||'—')}</td>
    <td>${esc(p.year_of_study||'—')}</td>
    <td>${esc(p.branch||'—')}</td>
    <td style="color:var(--muted);">${esc(p.phone||'—')}</td>
    <td style="color:var(--muted);font-size:.78rem;">${new Date(p.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</td>
  </tr>`).join('');
}

function exportParticipants() {
  if (!allParticipants.length) { showToast('No data.','warn'); return; }
  downloadCSV('participants.csv',[
    ['Name','Email','College','Year','Branch','Phone','Roll Number','Joined'],
    ...allParticipants.map(p=>[p.full_name||'',p.email,p.college||'',p.year_of_study||'',p.branch||'',p.phone||'',p.roll_number||'',new Date(p.created_at).toLocaleDateString('en-IN')])
  ]);
}

// ═══════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════
async function loadResults() {
  const wf = $('resultWeekFilter')?.value;
  let q = supabaseClient.from('quiz_scores')
    .select('*, profiles(full_name,email,college), quiz_config(quiz_title)')
    .order('submitted_at',{ascending:false});
  if (wf) q = q.eq('week_number', parseInt(wf));
  const { data } = await q;
  allResults = data||[];

  const tbody = $('resultsBody');
  if (!allResults.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="color:var(--muted);text-align:center;padding:2rem;">No results.</td></tr>`;
    return;
  }
  tbody.innerHTML = allResults.map(r => {
    const pct   = Number(r.percentage)||0;
    const pClr  = pct>=80?'var(--accent)':pct>=50?'var(--warn)':'var(--danger)';
    const ans   = Array.isArray(r.answers)?r.answers:[];
    const cor   = ans.filter(a=>a.is_correct).length;
    const title = r.quiz_config?.quiz_title || `Week ${r.week_number}`;
    return `<tr>
      <td style="font-weight:600;">${esc(r.profiles?.full_name||'—')}</td>
      <td style="color:var(--muted);font-size:.78rem;">${esc(r.profiles?.email||r.email||'—')}</td>
      <td style="color:var(--muted);">${esc(r.profiles?.college||'—')}</td>
      <td style="font-size:.8rem;">${esc(title)}</td>
      <td style="font-weight:700;">${r.score}</td>
      <td style="color:var(--muted);">${r.max_score}</td>
      <td style="font-weight:700;color:${pClr};">${pct}%</td>
      <td style="color:var(--muted);">${cor}/${ans.length||'—'}</td>
      <td style="color:${r.tab_switches>0?'var(--warn)':'var(--muted)'};">${r.tab_switches||0}</td>
      <td style="color:${r.fullscreen_exits>0?'var(--danger)':'var(--muted)'};">${r.fullscreen_exits||0}</td>
      <td style="color:var(--muted);font-size:.78rem;">${new Date(r.submitted_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</td>
      <td>${ans.length?`<button class="btn btn-outline btn-sm" onclick='showAnswerDetail(${JSON.stringify(r)})'>Answers</button>`:'—'}</td>
    </tr>`;
  }).join('');
}

function showAnswerDetail(r) {
  const ans = Array.isArray(r.answers)?r.answers:[];
  const cor = ans.filter(a=>a.is_correct).length;
  let m = $('ansModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'ansModal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:9000;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto;';
    m.addEventListener('click', e => { if(e.target===m) m.remove(); });
    document.body.appendChild(m);
  }
  const title = r.quiz_config?.quiz_title || `Week ${r.week_number}`;
  m.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;max-width:640px;width:100%;max-height:88vh;overflow-y:auto;padding:2rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <div>
          <div style="font-weight:700;font-size:1rem;">${esc(r.profiles?.full_name||r.email)} — ${esc(title)}</div>
          <div style="font-size:.8rem;color:var(--muted);">${cor}/${ans.length} correct · Score: ${r.score}/${r.max_score} · ${r.percentage}%</div>
        </div>
        <button onclick="document.getElementById('ansModal').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:1.3rem;">×</button>
      </div>
      ${ans.map((a,i)=>`
        <div style="border:1px solid ${a.is_correct?'rgba(0,212,170,.25)':'rgba(248,113,113,.25)'};border-radius:10px;padding:.85rem 1rem;margin-bottom:.5rem;background:${a.is_correct?'rgba(0,212,170,.03)':'rgba(248,113,113,.03)'};">
          <div style="font-size:.72rem;font-weight:700;color:var(--muted);margin-bottom:.3rem;">Q${i+1} — ${a.is_correct?'✓ Correct':'✗ Wrong'}</div>
          <div style="font-size:.85rem;margin-bottom:.4rem;line-height:1.5;">${esc(a.question)}</div>
          <div style="font-size:.78rem;">
            Chosen: <span style="font-weight:700;color:${a.is_correct?'var(--accent)':'var(--danger)'};">${esc(a.chosen)}</span>
            ${!a.is_correct?` · Correct: <span style="font-weight:700;color:var(--accent);">${esc(a.correct)}</span>`:''}
          </div>
          ${a.explanation?`<div style="font-size:.75rem;color:var(--muted);margin-top:.35rem;font-style:italic;">💡 ${esc(a.explanation)}</div>`:''}
        </div>`).join('')}
    </div>`;
}

function exportResults() {
  if (!allResults.length) { showToast('No results.','warn'); return; }
  downloadCSV('quiz_results.csv',[
    ['Name','Email','College','Quiz','Score','Max','%','Correct','Tab Switches','FS Exits','Submitted'],
    ...allResults.map(r=>{
      const ans=Array.isArray(r.answers)?r.answers:[];
      return [r.profiles?.full_name||'',r.profiles?.email||r.email||'',r.profiles?.college||'',
        r.quiz_config?.quiz_title||'', r.score,r.max_score,r.percentage+'%',
        ans.filter(a=>a.is_correct).length+'/'+ans.length,
        r.tab_switches||0,r.fullscreen_exits||0,new Date(r.submitted_at).toLocaleString('en-IN')];
    })
  ]);
}

// ═══════════════════════════════════════════════════════════════
// VIOLATIONS  — Fix 9: join with profiles now works via admin policy
// ═══════════════════════════════════════════════════════════════
async function loadViolations() {
  // Fix 9: profiles policy now allows admins to read all rows, so join works
  const { data } = await supabaseClient
    .from('quiz_violations')
    .select('*, profiles(full_name, email)')
    .order('occurred_at',{ascending:false}).limit(300);

  const tbody = $('violationsBody');
  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:2rem;">No violations recorded.</td></tr>`;
    return;
  }
  const labels = { tab_switch:'Tab Switch', fullscreen_exit:'Fullscreen Exit', window_blur:'Window Blur', devtools:'DevTools' };
  const colors = { tab_switch:'var(--warn)', fullscreen_exit:'var(--danger)', window_blur:'var(--muted)', devtools:'var(--danger)' };

  tbody.innerHTML = data.map(v => `<tr>
    <td style="font-weight:600;">${esc(v.profiles?.full_name || '—')}</td>
    <td style="color:var(--muted);font-size:.78rem;">${esc(v.profiles?.email || '—')}</td>
    <td style="font-family:'DM Mono',monospace;">${v.week_number ? 'W'+v.week_number : '—'}</td>
    <td style="font-weight:600;color:${colors[v.violation_type]||'var(--muted)'};">${labels[v.violation_type]||v.violation_type}</td>
    <td style="color:var(--muted);font-size:.78rem;">${new Date(v.occurred_at).toLocaleString('en-IN')}</td>
  </tr>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════
async function loadAnnouncements() {
  const { data } = await supabaseClient.from('announcements').select('*').order('created_at',{ascending:false});
  const list = $('annList');
  if (!data?.length) { list.innerHTML=`<div style="color:var(--muted);">No announcements yet.</div>`; return; }
  list.innerHTML = data.map(a=>`
    <div style="border:1px solid var(--border);border-radius:10px;padding:.85rem 1rem;margin-bottom:.55rem;display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;">
      <div style="flex:1;">
        <div style="font-weight:700;display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;margin-bottom:.2rem;">
          ${esc(a.title)}
          ${a.is_active?'<span style="background:rgba(0,212,170,.1);color:var(--accent);border-radius:5px;padding:.1rem .4rem;font-size:.62rem;font-weight:700;">LIVE</span>':'<span style="background:var(--surface2);color:var(--muted);border-radius:5px;padding:.1rem .4rem;font-size:.62rem;">OFF</span>'}
          ${a.pinned?'<span style="background:rgba(251,191,36,.1);color:var(--warn);border-radius:5px;padding:.1rem .4rem;font-size:.62rem;font-weight:700;">PINNED</span>':''}
        </div>
        ${a.body?`<div style="font-size:.8rem;color:var(--muted);">${esc(a.body)}</div>`:''}
        <div style="font-size:.7rem;color:var(--muted);margin-top:.3rem;">${new Date(a.created_at).toLocaleString('en-IN')}</div>
      </div>
      <div style="display:flex;gap:.35rem;flex-shrink:0;">
        <button class="btn btn-outline btn-sm" onclick="toggleAnn('${a.id}',${!a.is_active})">${a.is_active?'Deactivate':'Activate'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteAnn('${a.id}')">Del</button>
      </div>
    </div>`).join('');
}

async function createAnn() {
  const title = $('annTitle').value.trim();
  if (!title) { showToast('Title required.','error'); return; }
  const linksRaw = $('annLinks').value.trim();
  const links = linksRaw ? linksRaw.split('\n').map(l=>{
    const [label,...rest]=l.split('|');
    return {label:label.trim(),url:rest.join('|').trim()};
  }).filter(l=>l.label&&l.url) : [];
  const { error } = await supabaseClient.from('announcements').insert({
    title, body: $('annBody').value.trim()||null, links,
    is_active:$('annActive').checked, pinned:$('annPinned').checked,
  });
  if (error) { showToast('Error: '+error.message,'error'); return; }
  showToast('Announcement posted!','success');
  $('annTitle').value=''; $('annBody').value=''; $('annLinks').value='';
  await loadAnnouncements();
}
async function toggleAnn(id,active) {
  await supabaseClient.from('announcements').update({is_active:active}).eq('id',id);
  await loadAnnouncements();
}
async function deleteAnn(id) {
  if (!confirm('Delete?')) return;
  await supabaseClient.from('announcements').delete().eq('id',id);
  showToast('Deleted.','warn');
  await loadAnnouncements();
}