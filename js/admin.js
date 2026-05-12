// ============================================================
// js/admin.js  —  Summer Analytics 2025
// ============================================================

let adminProfile    = null;
let allWeeks        = [];
let editingWeekId   = null;
let activeQWeek     = null;   // currently selected week in question editor
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
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
    download: name
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
    loadStats(),
    loadContentWeeks(),
    loadQuizConfig(),
    loadQWeekButtons(),
    loadParticipants(),
    loadResults(),
    loadViolations(),
    loadAnnouncements(),
  ]);
})();

// ── Tab switch ────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  $(`tab-${name}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-tab="${name}"]`)?.classList.add('active');
}

// ── Stats ─────────────────────────────────────────────────────
async function loadStats() {
  const [{ count: p }, { count: s }, { count: v }, { data: q }] = await Promise.all([
    supabaseClient.from('profiles').select('*', { count: 'exact', head: true }),
    supabaseClient.from('quiz_scores').select('*', { count: 'exact', head: true }),
    supabaseClient.from('quiz_violations').select('*', { count: 'exact', head: true }),
    supabaseClient.from('quiz_config').select('week_number').eq('is_active', true).maybeSingle(),
  ]);
  $('stP').textContent = p ?? '—';
  $('stS').textContent = s ?? '—';
  $('stV').textContent = v ?? '—';
  $('stQ').textContent = q ? `Week ${q.week_number}` : 'None';
}

// ═══════════════════════════════════════════════════════════════
// COURSE CONTENT
// ═══════════════════════════════════════════════════════════════
async function loadContentWeeks() {
  const { data } = await supabaseClient.from('weeks').select('*').order('week_number');
  allWeeks = data || [];
  const el = $('contentWeekBtns');
  el.innerHTML = allWeeks.map(w => `
    <button class="wsb ${editingWeekId === w.id ? 'active' : ''}" onclick="selectContentWeek('${w.id}')">
      ${esc(w.title || 'Week ' + w.week_number)}
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
        <div class="card-title" style="margin:0;">${esc(week.title || 'Week '+week.week_number)} — Editor</div>
        <label class="toggle" style="font-size:.83rem;">
          <input type="checkbox" id="wkPublished" ${week.is_published ? 'checked' : ''}
            onchange="togglePublish('${id}', this.checked)">
          Published (students can see this week)
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
        <button class="btn btn-primary btn-sm" onclick="addDay('${id}', ${(days||[]).length + 1})">+ Add Day</button>
      </div>
      <div id="daysContainer">
        ${(days || []).map(d => renderDayCard(d)).join('')}
      </div>
    </div>`;
}

function renderDayCard(d) {
  return `
    <div class="day-card" id="day-${d.id}">
      <div class="day-card-header">
        <div class="day-card-title">Day ${d.day_number}</div>
        <button class="btn btn-danger btn-sm" onclick="deleteDay('${d.id}')">Delete</button>
      </div>
      <div class="form-row full" style="margin-bottom:.65rem;">
        <div><label>Description</label>
          <textarea id="desc-${d.id}" rows="2">${esc(d.description||'')}</textarea></div>
      </div>
      <div class="form-row three" style="margin-bottom:.45rem;">
        <div><label>Task 1 Label</label><input type="text" id="t1l-${d.id}" value="${esc(d.task1_label||'')}"></div>
        <div><label>Task 2 Label</label><input type="text" id="t2l-${d.id}" value="${esc(d.task2_label||'')}"></div>
        <div><label>Task 3 Label</label><input type="text" id="t3l-${d.id}" value="${esc(d.task3_label||'')}"></div>
      </div>
      <div class="form-row three" style="margin-bottom:.75rem;">
        <div><label>Task 1 URL</label><input type="url" id="t1u-${d.id}" value="${esc(d.task1_url||'')}"></div>
        <div><label>Task 2 URL</label><input type="url" id="t2u-${d.id}" value="${esc(d.task2_url||'')}"></div>
        <div><label>Task 3 URL</label><input type="url" id="t3u-${d.id}" value="${esc(d.task3_url||'')}"></div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="saveDay('${d.id}')">💾 Save Day ${d.day_number}</button>
    </div>`;
}

async function saveWeekTitle(id) {
  const title = $('wkTitle').value.trim();
  const { error } = await supabaseClient.from('weeks').update({ title, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  allWeeks = allWeeks.map(w => w.id === id ? { ...w, title } : w);
  showToast('Title saved!', 'success');
  await loadContentWeeks();
}

async function togglePublish(id, pub) {
  const { error } = await supabaseClient.from('weeks').update({
    is_published: pub, published_at: pub ? new Date().toISOString() : null, updated_at: new Date().toISOString()
  }).eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  allWeeks = allWeeks.map(w => w.id === id ? { ...w, is_published: pub } : w);
  showToast(pub ? '✓ Week is now LIVE for students!' : 'Week set to draft.', pub ? 'success' : 'warn');
  await loadContentWeeks();
}

async function addDay(weekId, dayNum) {
  const weekNum = allWeeks.find(w => w.id === weekId)?.week_number;
  const { data, error } = await supabaseClient.from('week_days').insert({
    week_id: weekId, week_number: weekNum, day_number: dayNum,
    description:'', task1_label:'', task1_url:'', task2_label:'', task2_url:'', task3_label:'', task3_url:''
  }).select().single();
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  $('daysContainer').insertAdjacentHTML('beforeend', renderDayCard(data));
  showToast(`Day ${dayNum} added.`, 'success');
}

async function saveDay(id) {
  const g = pre => $(`${pre}-${id}`)?.value.trim() ?? '';
  const { error } = await supabaseClient.from('week_days').update({
    description: g('desc'),
    task1_label: g('t1l'), task1_url: g('t1u'),
    task2_label: g('t2l'), task2_url: g('t2u'),
    task3_label: g('t3l'), task3_url: g('t3u'),
  }).eq('id', id);
  if (error) { showToast('Save failed: ' + error.message, 'error'); return; }
  showToast('Day saved!', 'success');
}

async function deleteDay(id) {
  if (!confirm('Delete this day? Cannot be undone.')) return;
  await supabaseClient.from('week_days').delete().eq('id', id);
  $(`day-${id}`)?.remove();
  showToast('Day deleted.', 'warn');
}

// ═══════════════════════════════════════════════════════════════
// QUIZ SETTINGS
// ═══════════════════════════════════════════════════════════════
async function loadQuizConfig() {
  const { data: active } = await supabaseClient.from('quiz_config').select('*').eq('is_active', true).maybeSingle();
  if (active) {
    $('qcWeek').value   = active.week_number;
    $('qcTitle').value  = active.quiz_title || '';
    $('qcTime').value   = active.time_limit_mins || 30;
    $('qcActive').checked  = active.is_active;
    $('qcShuffle').checked = active.shuffle_questions ?? true;
    if (active.opens_at)  $('qcOpens').value  = toLocalDT(active.opens_at);
    if (active.closes_at) $('qcCloses').value = toLocalDT(active.closes_at);
    $('quizCfgCard').dataset.editId = active.id;
  }

  const { data: all } = await supabaseClient.from('quiz_config').select('*').order('week_number');
  const wrap = $('quizCfgTable');
  if (!all?.length) { wrap.innerHTML = `<p style="color:var(--muted);padding:.75rem;">No quiz configs yet.</p>`; return; }
  wrap.innerHTML = `<table>
    <thead><tr><th>Week</th><th>Title</th><th>Status</th><th>Opens</th><th>Closes</th><th>Time</th><th>Qs</th><th>Actions</th></tr></thead>
    <tbody id="quizCfgRows">${all.map(q => `
      <tr>
        <td style="font-family:'DM Mono',monospace;font-weight:700;">W${q.week_number}</td>
        <td>${esc(q.quiz_title||'—')}</td>
        <td><span class="dot ${q.is_active?'dot-g':'dot-r'}"></span>${q.is_active?'Live':'Off'}</td>
        <td style="color:var(--muted);font-size:.78rem;">${q.opens_at?new Date(q.opens_at).toLocaleString('en-IN'):'—'}</td>
        <td style="color:var(--muted);font-size:.78rem;">${q.closes_at?new Date(q.closes_at).toLocaleString('en-IN'):'—'}</td>
        <td>${q.time_limit_mins}m</td>
        <td id="qCount-${q.week_number}">—</td>
        <td style="display:flex;gap:.4rem;">
          <button class="btn btn-outline btn-sm" onclick="loadQCIntoForm('${q.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteQC('${q.id}')">Del</button>
        </td>
      </tr>`).join('')}
    </tbody></table>`;

  // Fill question counts asynchronously
  all.forEach(async q => {
    const { count } = await supabaseClient.from('quiz_questions')
      .select('*', { count: 'exact', head: true }).eq('week_number', q.week_number);
    const el = $(`qCount-${q.week_number}`);
    if (el) el.textContent = count ?? 0;
  });
}

async function loadQCIntoForm(id) {
  const { data: q } = await supabaseClient.from('quiz_config').select('*').eq('id', id).single();
  if (!q) return;
  $('qcWeek').value   = q.week_number; $('qcTitle').value  = q.quiz_title || '';
  $('qcTime').value   = q.time_limit_mins || 30;
  $('qcActive').checked  = q.is_active; $('qcShuffle').checked = q.shuffle_questions ?? true;
  if (q.opens_at)  $('qcOpens').value  = toLocalDT(q.opens_at);
  if (q.closes_at) $('qcCloses').value = toLocalDT(q.closes_at);
  $('quizCfgCard').dataset.editId = id;
  showToast('Loaded into form — edit and save.', 'info');
}

async function saveQuizConfig() {
  const weekNum = parseInt($('qcWeek').value);
  const title   = $('qcTitle').value.trim();
  const timeMins= parseInt($('qcTime').value) || 30;
  const active  = $('qcActive').checked;
  const shuffle = $('qcShuffle').checked;
  const opens   = $('qcOpens').value  ? new Date($('qcOpens').value).toISOString()  : null;
  const closes  = $('qcCloses').value ? new Date($('qcCloses').value).toISOString() : null;

  if (!weekNum) { showToast('Week number is required.', 'error'); return; }

  // Deactivate others if this one is being activated
  if (active) await supabaseClient.from('quiz_config').update({ is_active: false }).neq('week_number', weekNum);

  const payload = { week_number: weekNum, quiz_title: title, is_active: active,
    time_limit_mins: timeMins, shuffle_questions: shuffle, opens_at: opens, closes_at: closes,
    updated_at: new Date().toISOString() };

  const editId = $('quizCfgCard').dataset.editId;
  const { error } = editId
    ? await supabaseClient.from('quiz_config').update(payload).eq('id', editId)
    : await supabaseClient.from('quiz_config').upsert(payload, { onConflict: 'week_number' });

  if (error) { showToast('Save failed: ' + error.message, 'error'); return; }
  showToast('Quiz config saved!', 'success');
  delete $('quizCfgCard').dataset.editId;
  await loadQuizConfig();
  await loadStats();
}

async function deleteQC(id) {
  if (!confirm('Delete this quiz config?')) return;
  await supabaseClient.from('quiz_config').delete().eq('id', id);
  showToast('Deleted.', 'warn');
  await loadQuizConfig();
}

// ═══════════════════════════════════════════════════════════════
// QUIZ QUESTIONS
// ═══════════════════════════════════════════════════════════════
async function loadQWeekButtons() {
  const { data } = await supabaseClient.from('quiz_config').select('week_number,quiz_title').order('week_number');
  const el = $('qWeekBtns');
  if (!data?.length) {
    el.innerHTML = `<p style="color:var(--muted);font-size:.85rem;">No quiz weeks configured yet. Set one up in Quiz Settings first.</p>`;
    return;
  }
  el.innerHTML = data.map(q => `
    <button class="wsb ${activeQWeek === q.week_number ? 'active' : ''}" onclick="selectQWeek(${q.week_number})">
      Week ${q.week_number}${q.quiz_title ? ' — ' + esc(q.quiz_title) : ''}
    </button>`).join('');
}

async function selectQWeek(weekNum) {
  activeQWeek = weekNum;
  // Refresh button states
  document.querySelectorAll('#qWeekBtns .wsb').forEach((b, i) => b.classList.toggle('active', i+1 === weekNum || b.textContent.startsWith(`Week ${weekNum}`)));
  await loadQuestions(weekNum);
}

async function loadQuestions(weekNum) {
  const { data: qs, error } = await supabaseClient
    .from('quiz_questions').select('*').eq('week_number', weekNum).order('sort_order').order('created_at');

  $('questionsArea').style.display = 'block';
  const totalMarks = (qs || []).reduce((s, q) => s + (q.marks || 1), 0);
  $('qCountLabel').textContent = `${qs?.length || 0} question${qs?.length !== 1 ? 's' : ''}`;
  $('qTotalMarks').textContent = `${totalMarks} total marks`;

  const list = $('questionsList');
  if (!qs?.length) {
    list.innerHTML = `<div style="color:var(--muted);padding:2rem;text-align:center;font-size:.88rem;">No questions yet for Week ${weekNum}. Click "+ Add Question" to start.</div>`;
    return;
  }
  list.innerHTML = qs.map((q, i) => renderQCard(q, i + 1)).join('');
}

function renderQCard(q, num) {
  const opts = [
    { key:'A', text: q.option_a }, { key:'B', text: q.option_b },
    { key:'C', text: q.option_c }, { key:'D', text: q.option_d },
  ].filter(o => o.text);

  return `
    <div class="q-card" id="qcard-${q.id}">
      <div class="q-card-header">
        <div class="q-num">Q${num}  ·  ${q.marks} mark${q.marks > 1 ? 's' : ''}</div>
        <div style="display:flex;gap:.4rem;align-items:center;">
          <span class="correct-badge">✓ ${q.correct_option}</span>
          <button class="btn btn-outline btn-sm" onclick="editQuestion('${q.id}')">Edit</button>
          <button class="btn btn-danger btn-sm"  onclick="deleteQuestion('${q.id}')">Del</button>
        </div>
      </div>
      <div style="font-size:.9rem;font-weight:600;margin-bottom:.65rem;line-height:1.5;">${esc(q.question_text)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.35rem;">
        ${opts.map(o => `
          <div style="font-size:.8rem;padding:.4rem .65rem;border-radius:7px;
            background:${o.key === q.correct_option ? 'rgba(0,212,170,.08)' : 'var(--bg)'};
            border:1px solid ${o.key === q.correct_option ? 'rgba(0,212,170,.3)' : 'var(--border)'};
            color:${o.key === q.correct_option ? 'var(--accent)' : 'var(--muted)'};">
            <span style="font-weight:700;font-family:'DM Mono',monospace;">${o.key}.</span> ${esc(o.text)}
          </div>`).join('')}
      </div>
      ${q.explanation ? `<div style="margin-top:.65rem;font-size:.78rem;color:var(--muted);border-top:1px solid var(--border);padding-top:.65rem;line-height:1.5;">💡 ${esc(q.explanation)}</div>` : ''}
    </div>`;
}

function addQuestion() {
  if (!activeQWeek) { showToast('Select a quiz week first.', 'warn'); return; }
  openQuestionModal(null);
}

function editQuestion(id) {
  const card = $(`qcard-${id}`);
  // We need the question data — fetch it
  supabaseClient.from('quiz_questions').select('*').eq('id', id).single()
    .then(({ data }) => { if (data) openQuestionModal(data); });
}

function openQuestionModal(q) {
  let modal = $('qModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'qModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9000;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto;';
    modal.addEventListener('click', e => { if (e.target === modal) closeQModal(); });
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;max-width:620px;width:100%;padding:2rem;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <div style="font-size:1rem;font-weight:700;">${q ? 'Edit Question' : 'Add Question'} — Week ${activeQWeek}</div>
        <button onclick="closeQModal()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:1.3rem;line-height:1;">×</button>
      </div>

      <div style="margin-bottom:1rem;">
        <label>Question Text *</label>
        <textarea id="mqQ" rows="3" placeholder="What is the formula for linear regression?">${esc(q?.question_text||'')}</textarea>
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
            ${['A','B','C','D'].map(k => `<option value="${k}" ${q?.correct_option===k?'selected':''}>${k}</option>`).join('')}
          </select>
        </div>
        <div><label>Marks</label><input type="number" id="mqMarks" value="${q?.marks||1}" min="1" max="10"></div>
      </div>
      <div style="margin-bottom:1.25rem;">
        <label>Explanation (shown to students after submission)</label>
        <textarea id="mqExp" rows="2" placeholder="The slope formula is…">${esc(q?.explanation||'')}</textarea>
      </div>
      <div style="display:flex;gap:.65rem;justify-content:flex-end;">
        <button class="btn btn-outline" onclick="closeQModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveQuestion(${q ? `'${q.id}'` : 'null'})">
          ${q ? '💾 Save Changes' : '+ Add Question'}
        </button>
      </div>
    </div>`;
}

function closeQModal() { $('qModal')?.remove(); }

async function saveQuestion(id) {
  const qText  = $('mqQ').value.trim();
  const optA   = $('mqA').value.trim();
  const optB   = $('mqB').value.trim();
  const optC   = $('mqC').value.trim();
  const optD   = $('mqD').value.trim();
  const correct= $('mqCorrect').value;
  const marks  = parseInt($('mqMarks').value) || 1;
  const expl   = $('mqExp').value.trim();

  if (!qText || !optA || !optB || !correct) {
    showToast('Question, options A & B, and correct answer are required.', 'error'); return;
  }

  const payload = {
    week_number:   activeQWeek,
    question_text: qText,
    option_a: optA, option_b: optB,
    option_c: optC || null, option_d: optD || null,
    correct_option: correct,
    marks, explanation: expl || null,
  };

  const { error } = id
    ? await supabaseClient.from('quiz_questions').update(payload).eq('id', id)
    : await supabaseClient.from('quiz_questions').insert(payload);

  if (error) { showToast('Save failed: ' + error.message, 'error'); return; }
  showToast(id ? 'Question updated!' : 'Question added!', 'success');
  closeQModal();
  await loadQuestions(activeQWeek);
}

async function deleteQuestion(id) {
  if (!confirm('Delete this question? This cannot be undone.')) return;
  const { error } = await supabaseClient.from('quiz_questions').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Question deleted.', 'warn');
  await loadQuestions(activeQWeek);
}

// ── Bulk CSV import ───────────────────────────────────────────
function showBulkImport() { $('bulkImportPanel').style.display = 'block'; }
function hideBulkImport() { $('bulkImportPanel').style.display = 'none'; $('csvContent').value = ''; }

async function importCSV() {
  if (!activeQWeek) { showToast('Select a quiz week first.', 'warn'); return; }
  const raw = $('csvContent').value.trim();
  if (!raw) { showToast('Paste CSV content first.', 'warn'); return; }

  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const questions = [];
  const errors = [];

  lines.forEach((line, i) => {
    // Support comma-separated (quoted values OK)
    const cols = line.match(/(".*?"|[^,]+)(?=,|$)/g)?.map(c => c.replace(/^"|"$/g,'').trim()) || line.split(',').map(s => s.trim());
    const [question_text, option_a, option_b, option_c, option_d, correct_option, marks, explanation] = cols;

    if (!question_text || !option_a || !option_b || !correct_option) {
      errors.push(`Row ${i+1}: missing required fields.`); return;
    }
    if (!['A','B','C','D'].includes(correct_option.toUpperCase())) {
      errors.push(`Row ${i+1}: correct_option must be A, B, C, or D.`); return;
    }
    questions.push({
      week_number: activeQWeek, question_text, option_a, option_b,
      option_c: option_c || null, option_d: option_d || null,
      correct_option: correct_option.toUpperCase(),
      marks: parseInt(marks) || 1, explanation: explanation || null,
    });
  });

  if (errors.length) { showToast(errors.join(' | '), 'error'); return; }
  if (!questions.length) { showToast('No valid questions found.', 'warn'); return; }

  const { error } = await supabaseClient.from('quiz_questions').insert(questions);
  if (error) { showToast('Import failed: ' + error.message, 'error'); return; }
  showToast(`${questions.length} questions imported!`, 'success');
  hideBulkImport();
  await loadQuestions(activeQWeek);
}

// ═══════════════════════════════════════════════════════════════
// PARTICIPANTS
// ═══════════════════════════════════════════════════════════════
async function loadParticipants() {
  const { data } = await supabaseClient.from('profiles').select('*').order('created_at', { ascending: false });
  allParticipants = data || [];
  const tbody = $('participantsBody');
  if (!allParticipants.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--muted);text-align:center;padding:2rem;">No participants yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = allParticipants.map((p, i) => `<tr>
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
  if (!allParticipants.length) { showToast('No data.', 'warn'); return; }
  downloadCSV('participants.csv', [
    ['Name','Email','College','Year','Branch','Phone','Roll Number','Joined'],
    ...allParticipants.map(p => [p.full_name||'',p.email,p.college||'',p.year_of_study||'',p.branch||'',p.phone||'',p.roll_number||'',new Date(p.created_at).toLocaleDateString('en-IN')])
  ]);
}

// ═══════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════
async function loadResults() {
  const wf = $('resultWeekFilter')?.value;
  let q = supabaseClient.from('quiz_scores').select('*, profiles(full_name,email,college)').order('submitted_at', { ascending: false });
  if (wf) q = q.eq('week_number', parseInt(wf));
  const { data } = await q;
  allResults = data || [];

  const tbody = $('resultsBody');
  if (!allResults.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="color:var(--muted);text-align:center;padding:2rem;">No results.</td></tr>`;
    return;
  }

  tbody.innerHTML = allResults.map(r => {
    const pct    = Number(r.percentage) || 0;
    const pClr   = pct >= 80 ? 'var(--accent)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';
    const answers= Array.isArray(r.answers) ? r.answers : [];
    const correct= answers.filter(a => a.is_correct).length;
    return `<tr>
      <td style="font-weight:600;">${esc(r.profiles?.full_name||'—')}</td>
      <td style="color:var(--muted);font-size:.78rem;">${esc(r.profiles?.email||r.email||'—')}</td>
      <td style="color:var(--muted);">${esc(r.profiles?.college||'—')}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:700;">W${r.week_number}</td>
      <td style="font-weight:700;">${r.score}</td>
      <td style="color:var(--muted);">${r.max_score}</td>
      <td style="font-weight:700;color:${pClr};">${pct}%</td>
      <td style="color:var(--muted);">${correct}/${answers.length||'—'}</td>
      <td style="color:${r.tab_switches>0?'var(--warn)':'var(--muted)'};">${r.tab_switches||0}</td>
      <td style="color:${r.fullscreen_exits>0?'var(--danger)':'var(--muted)'};">${r.fullscreen_exits||0}</td>
      <td style="color:var(--muted);font-size:.78rem;">${new Date(r.submitted_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</td>
      <td>${answers.length ? `<button class="btn btn-outline btn-sm" onclick='showAnswerDetail(${JSON.stringify(r)})'>Answers</button>` : '—'}</td>
    </tr>`;
  }).join('');
}

function showAnswerDetail(r) {
  const answers = Array.isArray(r.answers) ? r.answers : [];
  const correct = answers.filter(a => a.is_correct).length;

  let m = $('ansModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'ansModal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:9000;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto;';
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;max-width:640px;width:100%;max-height:88vh;overflow-y:auto;padding:2rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <div>
          <div style="font-weight:700;font-size:1rem;">${esc(r.profiles?.full_name||r.email)} — Week ${r.week_number}</div>
          <div style="font-size:.8rem;color:var(--muted);">${correct}/${answers.length} correct · Score: ${r.score}/${r.max_score} · ${r.percentage}%</div>
        </div>
        <button onclick="document.getElementById('ansModal').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:1.3rem;">×</button>
      </div>
      ${answers.map((a, i) => `
        <div style="border:1px solid ${a.is_correct?'rgba(0,212,170,.25)':'rgba(248,113,113,.25)'};border-radius:10px;padding:.9rem 1rem;margin-bottom:.55rem;background:${a.is_correct?'rgba(0,212,170,.03)':'rgba(248,113,113,.03)'};">
          <div style="font-size:.72rem;font-weight:700;color:var(--muted);margin-bottom:.35rem;">Q${i+1} — ${a.is_correct?'✓ Correct':'✗ Wrong'}</div>
          <div style="font-size:.86rem;margin-bottom:.45rem;line-height:1.5;">${esc(a.question)}</div>
          <div style="font-size:.78rem;">
            Chosen: <span style="font-weight:700;color:${a.is_correct?'var(--accent)':'var(--danger)'};">${esc(a.chosen)}</span>
            ${!a.is_correct?` · Correct: <span style="font-weight:700;color:var(--accent);">${esc(a.correct)}</span>`:''}
          </div>
          ${a.explanation?`<div style="font-size:.76rem;color:var(--muted);margin-top:.4rem;font-style:italic;">💡 ${esc(a.explanation)}</div>`:''}
        </div>`).join('')}
    </div>`;
}

function exportResults() {
  if (!allResults.length) { showToast('No results to export.', 'warn'); return; }
  downloadCSV('quiz_results.csv', [
    ['Name','Email','College','Week','Score','Max','%','Correct','Tab Switches','FS Exits','Submitted'],
    ...allResults.map(r => {
      const answers = Array.isArray(r.answers) ? r.answers : [];
      return [r.profiles?.full_name||'',r.profiles?.email||r.email||'',r.profiles?.college||'',
        r.week_number,r.score,r.max_score,r.percentage+'%',
        answers.filter(a=>a.is_correct).length+'/'+answers.length,
        r.tab_switches||0,r.fullscreen_exits||0,new Date(r.submitted_at).toLocaleString('en-IN')];
    })
  ]);
}

// ═══════════════════════════════════════════════════════════════
// VIOLATIONS
// ═══════════════════════════════════════════════════════════════
async function loadViolations() {
  const { data } = await supabaseClient
    .from('quiz_violations').select('*, profiles(full_name,email)')
    .order('occurred_at', { ascending: false }).limit(300);

  const tbody = $('violationsBody');
  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:2rem;">No violations recorded.</td></tr>`;
    return;
  }
  const labels = { tab_switch:'Tab Switch', fullscreen_exit:'Fullscreen Exit', window_blur:'Window Blur', devtools:'DevTools' };
  const colors = { tab_switch:'var(--warn)', fullscreen_exit:'var(--danger)', window_blur:'var(--muted)', devtools:'var(--danger)' };

  tbody.innerHTML = data.map(v => `<tr>
    <td style="font-weight:600;">${esc(v.profiles?.full_name||'—')}</td>
    <td style="color:var(--muted);font-size:.78rem;">${esc(v.profiles?.email||'—')}</td>
    <td style="font-family:'DM Mono',monospace;">W${v.week_number}</td>
    <td style="font-weight:600;color:${colors[v.violation_type]||'var(--muted)'};">${labels[v.violation_type]||v.violation_type}</td>
    <td style="color:var(--muted);font-size:.78rem;">${new Date(v.occurred_at).toLocaleString('en-IN')}</td>
  </tr>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════
async function loadAnnouncements() {
  const { data } = await supabaseClient.from('announcements').select('*').order('created_at', { ascending: false });
  const list = $('annList');
  if (!data?.length) { list.innerHTML = `<div style="color:var(--muted);">No announcements yet.</div>`; return; }
  list.innerHTML = data.map(a => `
    <div style="border:1px solid var(--border);border-radius:10px;padding:.9rem 1rem;margin-bottom:.6rem;display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;">
      <div style="flex:1;">
        <div style="font-weight:700;display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;margin-bottom:.2rem;">
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
  if (!title) { showToast('Title required.', 'error'); return; }
  const linksRaw = $('annLinks').value.trim();
  const links = linksRaw ? linksRaw.split('\n').map(l => {
    const [label, ...rest] = l.split('|');
    return { label: label.trim(), url: rest.join('|').trim() };
  }).filter(l => l.label && l.url) : [];

  const { error } = await supabaseClient.from('announcements').insert({
    title, body: $('annBody').value.trim() || null, links,
    is_active: $('annActive').checked, pinned: $('annPinned').checked,
  });
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Announcement posted!', 'success');
  $('annTitle').value = ''; $('annBody').value = ''; $('annLinks').value = '';
  await loadAnnouncements();
}

async function toggleAnn(id, active) {
  await supabaseClient.from('announcements').update({ is_active: active }).eq('id', id);
  await loadAnnouncements();
}
async function deleteAnn(id) {
  if (!confirm('Delete announcement?')) return;
  await supabaseClient.from('announcements').delete().eq('id', id);
  showToast('Deleted.', 'warn');
  await loadAnnouncements();
}
