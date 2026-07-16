'use strict';

const $ = (id) => document.getElementById(id);

const PROVIDER_LABELS = { chutes: 'Chutes.ai', openai: 'OpenAI', anthropic: 'Anthropic' };
const KEY_HINTS = {
  chutes: '(cpk_…)',
  openai: '(sk-…)',
  anthropic: '(sk-ant-…)',
};

const els = {
  toggleSettings: $('toggleSettings'),
  settingsOverlay: $('settingsOverlay'),
  closeSettings: $('closeSettings'),
  provider: $('provider'),
  providerKeyHint: $('providerKeyHint'),
  apiKey: $('apiKey'),
  baseUrl: $('baseUrl'),
  modelSelect: $('modelSelect'),
  modelPrice: $('modelPrice'),
  loadModels: $('loadModels'),
  concurrency: $('concurrency'),
  saveSettings: $('saveSettings'),
  settingsStatus: $('settingsStatus'),
  directory: $('directory'),
  browse: $('browse'),
  countPill: $('countPill'),
  enginePill: $('enginePill'),
  jobDescription: $('jobDescription'),
  analyze: $('analyze'),
  progressFill: $('progressFill'),
  progressText: $('progressText'),
  resultsSection: $('resultsSection'),
  resultsSummary: $('resultsSummary'),
  results: $('results'),
  baseResume: $('baseResume'),
  genResume: $('genResume'),
  genStatus: $('genStatus'),
  genResult: $('genResult'),
  genCover: $('genCover'),
  companyRole: $('companyRole'),
  coverStatus: $('coverStatus'),
  coverResult: $('coverResult'),
  answerQs: $('answerQs'),
  questions: $('questions'),
  qaStatus: $('qaStatus'),
  qaResult: $('qaResult'),
  answerPinned: $('answerPinned'),
  savedQuestions: $('savedQuestions'),
  savedCount: $('savedCount'),
  contextBar: $('contextBar'),
  tailorEmpty: $('tailorEmpty'),
  tailorBody: $('tailorBody'),
  questionsEmpty: $('questionsEmpty'),
  questionsBody: $('questionsBody'),
};

let hasResults = false;

// Full settings object, kept in sync with the UI.
let state = null;
let analyzing = false;
let lastResults = []; // successful results from the most recent analysis

// --------------------------------------------------------------------------
// Init
// --------------------------------------------------------------------------
async function init() {
  state = await window.api.getSettings();
  els.provider.value = state.provider;
  els.concurrency.value = state.concurrency;
  els.directory.value = state.directory || '';
  loadProviderFields();
  updateEnginePill();
  if (state.directory) refreshCount(state.directory);

  const active = state.providers[state.provider];
  if (!active.apiKey) {
    openSettings();
  } else {
    // Key already saved → fetch the model list (with prices) automatically.
    loadModelsForActive(true);
  }
}

function loadProviderFields() {
  const p = state.providers[state.provider];
  els.apiKey.value = p.apiKey || '';
  els.baseUrl.value = p.baseUrl || '';
  els.providerKeyHint.textContent = KEY_HINTS[state.provider] || '';
  // Model list is provider-specific: show only the saved model until re-loaded.
  setModelOptions([], p.model);
}

// id -> { inPrice, outPrice } (USD per 1M tokens), from the last model load.
let modelPriceMap = {};

function fmtPrice(v) {
  if (v == null) return '$?';
  return '$' + (v < 0.1 ? v.toFixed(3) : v.toFixed(2));
}
function priceSuffix(m) {
  if (m.inPrice == null && m.outPrice == null) return '';
  return `  —  ${fmtPrice(m.inPrice)}/M in · ${fmtPrice(m.outPrice)}/M out`;
}
function updateModelPrice() {
  const id = els.modelSelect.value;
  const p = modelPriceMap[id];
  if (!id || !p || (p.inPrice == null && p.outPrice == null)) {
    els.modelPrice.textContent = '';
    return;
  }
  els.modelPrice.textContent = `Price: ${fmtPrice(p.inPrice)} / M input · ${fmtPrice(p.outPrice)} / M output`;
}

// Rebuild the model dropdown. Accepts model objects {id,inPrice,outPrice} or plain id strings.
// Keeps `selected` visible even if it isn't in `models`.
function setModelOptions(models, selected) {
  const list = models.map((m) => (typeof m === 'string' ? { id: m } : m));
  modelPriceMap = {};
  for (const m of list) modelPriceMap[m.id] = { inPrice: m.inPrice ?? null, outPrice: m.outPrice ?? null };
  if (selected && !list.some((m) => m.id === selected)) list.unshift({ id: selected });

  els.modelSelect.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = list.length ? '— select a model —' : '— Load models, then choose —';
  els.modelSelect.appendChild(ph);
  for (const m of list) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.id + priceSuffix(m);
    els.modelSelect.appendChild(opt);
  }
  els.modelSelect.value = selected && list.some((m) => m.id === selected) ? selected : '';
  updateModelPrice();
}

// Pull the visible provider fields back into state.
function syncProviderFields() {
  const p = state.providers[state.provider];
  p.apiKey = els.apiKey.value.trim();
  p.baseUrl = els.baseUrl.value.trim() || p.baseUrl;
  p.model = els.modelSelect.value;
  state.concurrency = Number(els.concurrency.value) || 3;
  state.directory = els.directory.value.trim();
}

function activeProvider() {
  return { provider: state.provider, ...state.providers[state.provider] };
}

function updateEnginePill() {
  const a = activeProvider();
  els.enginePill.textContent = `${PROVIDER_LABELS[a.provider]} · ${a.model || 'no model'}`;
}

async function persist() {
  syncProviderFields();
  state = await window.api.saveSettings(state);
}

// --------------------------------------------------------------------------
// Settings interactions
// --------------------------------------------------------------------------
function openSettings() {
  els.settingsOverlay.classList.remove('hidden');
}
function closeSettings() {
  els.settingsOverlay.classList.add('hidden');
}
els.toggleSettings.addEventListener('click', () => {
  els.settingsOverlay.classList.contains('hidden') ? openSettings() : closeSettings();
});
els.closeSettings.addEventListener('click', closeSettings);
els.settingsOverlay.addEventListener('click', (e) => {
  if (e.target === els.settingsOverlay) closeSettings(); // click backdrop to dismiss
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.settingsOverlay.classList.contains('hidden')) closeSettings();
});

// --------------------------------------------------------------------------
// Tabs
// --------------------------------------------------------------------------
function activateTab(name) {
  for (const btn of document.querySelectorAll('.tab')) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.classList.toggle('active', panel.id === 'tab-' + name);
  }
  // The shared base-resume bar only applies to the tailor/questions tabs.
  els.contextBar.classList.toggle('hidden', name === 'analyze' || !hasResults);
}
for (const btn of document.querySelectorAll('.tab')) {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
}

els.provider.addEventListener('change', () => {
  syncProviderFields(); // keep edits to the previous provider
  state.provider = els.provider.value;
  loadProviderFields();
  updateEnginePill();
  if (state.providers[state.provider].apiKey) loadModelsForActive(true); // auto-refresh list for the new provider
});

for (const el of [els.apiKey, els.baseUrl, els.concurrency]) {
  el.addEventListener('input', () => {
    syncProviderFields();
    updateEnginePill();
  });
}

els.modelSelect.addEventListener('change', () => {
  syncProviderFields();
  updateEnginePill();
  updateModelPrice();
});

els.saveSettings.addEventListener('click', async () => {
  await persist();
  updateEnginePill();
  els.settingsStatus.textContent = '✓ Saved';
  setTimeout(() => (els.settingsStatus.textContent = ''), 2000);
});

async function loadModelsForActive(silent) {
  syncProviderFields();
  const a = activeProvider();
  if (!a.apiKey) {
    if (!silent) els.settingsStatus.textContent = 'Enter this provider’s API key first.';
    return;
  }
  els.loadModels.disabled = true;
  if (!silent) els.settingsStatus.textContent = `Loading ${PROVIDER_LABELS[a.provider]} models…`;
  const res = await window.api.fetchModels({ provider: a.provider, apiKey: a.apiKey, baseUrl: a.baseUrl });
  els.loadModels.disabled = false;
  if (!res.ok) {
    els.settingsStatus.textContent = (silent ? 'Auto-load failed: ' : 'Failed: ') + res.error;
    return;
  }
  setModelOptions(res.models, state.providers[state.provider].model);
  syncProviderFields();
  updateEnginePill();
  els.settingsStatus.textContent = `Loaded ${res.models.length} ${PROVIDER_LABELS[a.provider]} models${
    silent ? ' automatically' : ' — pick one from the dropdown'
  }.`;
}
els.loadModels.addEventListener('click', () => loadModelsForActive(false));

// --------------------------------------------------------------------------
// Folder
// --------------------------------------------------------------------------
els.browse.addEventListener('click', async () => {
  const dir = await window.api.selectDirectory();
  if (!dir) return;
  els.directory.value = dir;
  await persist();
  refreshCount(dir);
});

async function refreshCount(dir) {
  const res = await window.api.listResumes(dir);
  if (res.ok) {
    const n = res.files.length;
    els.countPill.textContent = `${n} resume${n === 1 ? '' : 's'}`;
    els.countPill.style.color = n ? 'var(--accent-2)' : 'var(--muted)';
  } else {
    els.countPill.textContent = 'folder error';
  }
}

// --------------------------------------------------------------------------
// Analyze
// --------------------------------------------------------------------------
els.analyze.addEventListener('click', runAnalysis);

async function runAnalysis() {
  if (analyzing) return;
  await persist();
  const a = activeProvider();
  const jobDescription = els.jobDescription.value.trim();

  const problems = [];
  if (!a.apiKey) problems.push(`${PROVIDER_LABELS[a.provider]} API key`);
  if (!a.model) problems.push('model');
  if (!state.directory) problems.push('resumes folder');
  if (!jobDescription) problems.push('job description');
  if (problems.length) {
    setProgress(0, `Missing: ${problems.join(', ')}.`);
    if (!a.apiKey || !a.model) openSettings();
    return;
  }

  analyzing = true;
  els.analyze.disabled = true;
  els.results.innerHTML = '';
  els.resultsSection.classList.add('hidden');
  document.body.classList.remove('has-results');
  setProgress(2, 'Reading resumes…');

  const unsubscribe = window.api.onProgress((p) => {
    if (p.type === 'start') {
      setProgress(4, `Found ${p.total} resume${p.total === 1 ? '' : 's'}. Scoring with ${PROVIDER_LABELS[a.provider]}…`);
    } else if (p.type === 'progress') {
      const pct = Math.round((p.done / p.total) * 100);
      setProgress(pct, `Scored ${p.done} / ${p.total} — ${p.file}${p.ok ? '' : ' (failed)'}`);
    } else if (p.type === 'done') {
      setProgress(100, 'Done.');
    }
  });

  const res = await window.api.analyze({
    provider: a.provider,
    apiKey: a.apiKey,
    baseUrl: a.baseUrl,
    model: a.model,
    concurrency: state.concurrency,
    directory: state.directory,
    jobDescription,
  });
  unsubscribe();
  analyzing = false;
  els.analyze.disabled = false;

  if (!res.ok) {
    setProgress(0, '');
    renderError(res.error);
    return;
  }
  renderResults(res.results);
}

function setProgress(pct, text) {
  els.progressFill.style.width = `${pct}%`;
  els.progressText.textContent = text || '';
}

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------
function scoreColor(score) {
  if (score >= 75) return { bg: 'rgba(53,208,127,0.18)', ring: '#35d07f', text: '#9df0c3' };
  if (score >= 50) return { bg: 'rgba(244,192,77,0.18)', ring: '#f4c04d', text: '#f7d488' };
  return { bg: 'rgba(255,122,122,0.16)', ring: '#ff7a7a', text: '#ffb3b3' };
}
function barColor(score) {
  if (score >= 75) return '#35d07f';
  if (score >= 50) return '#f4c04d';
  return '#ff7a7a';
}

function renderError(message) {
  els.resultsSection.classList.remove('hidden');
  els.resultsSummary.textContent = '';
  els.results.innerHTML = `<div class="empty error-text">⚠ ${escapeHtml(message)}</div>`;
}

function renderResults(results) {
  els.resultsSection.classList.remove('hidden');
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  els.resultsSummary.textContent = `${ok.length} scored` + (failed.length ? ` · ${failed.length} failed` : '');

  els.results.innerHTML = '';
  if (results.length === 0) {
    els.results.innerHTML = '<div class="empty">No resumes to show.</div>';
    return;
  }
  let rank = 0;
  for (const r of results) {
    if (r.ok) rank++;
    els.results.appendChild(renderCard(r, r.ok ? rank : null));
  }

  lastResults = ok;
  populateTools(ok);
}

// --------------------------------------------------------------------------
// Tools panel (tailored resume + Q&A)
// --------------------------------------------------------------------------
function populateTools(ok) {
  hasResults = ok.length > 0;
  document.body.classList.toggle('has-results', hasResults);
  if (!hasResults) {
    els.contextBar.classList.add('hidden');
    els.tailorBody.classList.add('hidden');
    els.questionsBody.classList.add('hidden');
    els.tailorEmpty.classList.remove('hidden');
    els.questionsEmpty.classList.remove('hidden');
    return;
  }
  els.baseResume.innerHTML = '';
  ok.forEach((r, i) => {
    const opt = document.createElement('option');
    opt.value = r.filePath;
    opt.textContent = `#${i + 1} · ${r.candidate_name || 'Unknown'} — ${r.file} (${r.ats_score})`;
    els.baseResume.appendChild(opt);
  });
  els.baseResume.value = ok[0].filePath; // default: best match

  const top = ok[0].ats_score;
  els.genResult.classList.add('hidden');
  els.genResult.innerHTML = '';
  els.coverResult.classList.add('hidden');
  els.coverResult.innerHTML = '';
  els.qaResult.innerHTML = '';
  els.genStatus.textContent =
    top < 75
      ? `Top match scored only ${top}. Generating a tailored resume from your base resume is recommended.`
      : '';

  // Reveal the tailor/questions tab bodies and the shared base-resume bar.
  els.tailorEmpty.classList.add('hidden');
  els.questionsEmpty.classList.add('hidden');
  els.tailorBody.classList.remove('hidden');
  els.questionsBody.classList.remove('hidden');
  const activeTab = document.querySelector('.tab.active')?.dataset.tab;
  els.contextBar.classList.toggle('hidden', activeTab === 'analyze');
  refreshSavedQuestions();
}

// Render a "saved: <file> [Open] [Show in folder]" line for each output file.
function renderFileLinks(container, files) {
  container.classList.remove('hidden');
  container.innerHTML = files
    .map(
      (f) => `
      <div class="file-line">
        <span class="file-tag">${escapeHtml(f.label)}</span>
        <span class="file-path">${escapeHtml(f.path)}</span>
        <button class="btn small" data-open="${escapeHtml(f.path)}">Open</button>
        <button class="btn small" data-reveal="${escapeHtml(f.path)}">Show in folder</button>
      </div>`
    )
    .join('');
  container.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => window.api.openFile(b.getAttribute('data-open')))
  );
  container.querySelectorAll('[data-reveal]').forEach((b) =>
    b.addEventListener('click', () => window.api.revealFile(b.getAttribute('data-reveal')))
  );
}

async function ensureReady() {
  await persist();
  const a = activeProvider();
  const jobDescription = els.jobDescription.value.trim();
  const baseFilePath = els.baseResume.value;
  if (!a.apiKey || !a.model) {
    openSettings();
    throw new Error(`Set your ${PROVIDER_LABELS[a.provider]} API key and model in Settings.`);
  }
  return { a, jobDescription, baseFilePath };
}

els.genResume.addEventListener('click', async () => {
  let ctx;
  try {
    ctx = await ensureReady();
  } catch (e) {
    els.genStatus.textContent = e.message;
    return;
  }
  if (!ctx.jobDescription) {
    els.genStatus.textContent = 'Paste a job description first.';
    return;
  }
  els.genResume.disabled = true;
  els.genResult.classList.add('hidden');
  els.genStatus.textContent = 'Generating tailored resume (.docx + .pdf)…';
  const res = await window.api.generateResume({
    provider: ctx.a.provider,
    apiKey: ctx.a.apiKey,
    baseUrl: ctx.a.baseUrl,
    model: ctx.a.model,
    jobDescription: ctx.jobDescription,
    baseFilePath: ctx.baseFilePath,
    outDir: state.directory,
  });
  els.genResume.disabled = false;
  if (!res.ok) {
    els.genStatus.textContent = '⚠ ' + res.error;
    return;
  }
  els.genStatus.textContent = '✓ Saved in your resumes folder:';
  renderFileLinks(els.genResult, [
    { label: 'DOCX', path: res.docxPath },
    { label: 'PDF', path: res.pdfPath },
  ]);
});

let lastCoverLetter = null; // structured letter from the latest generation, for on-demand saving

els.genCover.addEventListener('click', async () => {
  let ctx;
  try {
    ctx = await ensureReady();
  } catch (e) {
    els.coverStatus.textContent = e.message;
    return;
  }
  if (!ctx.jobDescription) {
    els.coverStatus.textContent = 'Paste a job description first.';
    return;
  }
  els.genCover.disabled = true;
  els.coverResult.classList.add('hidden');
  els.coverStatus.textContent = 'Writing cover letter…';
  const res = await window.api.generateCoverLetter({
    provider: ctx.a.provider,
    apiKey: ctx.a.apiKey,
    baseUrl: ctx.a.baseUrl,
    model: ctx.a.model,
    jobDescription: ctx.jobDescription,
    baseFilePath: ctx.baseFilePath,
    companyRole: els.companyRole.value.trim(),
  });
  els.genCover.disabled = false;
  if (!res.ok) {
    els.coverStatus.textContent = '⚠ ' + res.error;
    return;
  }
  lastCoverLetter = res.letter;
  els.coverStatus.textContent = 'Preview below. Regenerate for a different draft, or save when ready.';
  renderCoverPreview(res.text);
});

function renderCoverPreview(text) {
  els.coverResult.classList.remove('hidden');
  els.coverResult.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'qa-card';
  card.innerHTML = `
    <div class="qa-a">${escapeHtml(text)}</div>
    <div class="cover-actions">
      <button class="btn small" data-copy>Copy text</button>
      <button class="btn small primary" data-save>💾 Save .docx + .pdf</button>
    </div>
    <div class="cover-files"></div>`;

  card.querySelector('[data-copy]').addEventListener('click', (ev) => {
    navigator.clipboard.writeText(text);
    ev.target.textContent = 'Copied ✓';
    setTimeout(() => (ev.target.textContent = 'Copy text'), 1500);
  });

  card.querySelector('[data-save]').addEventListener('click', async (ev) => {
    if (!lastCoverLetter) return;
    ev.target.disabled = true;
    ev.target.textContent = 'Saving…';
    const res = await window.api.saveCoverLetter({
      letter: lastCoverLetter,
      baseFilePath: els.baseResume.value,
      outDir: state.directory,
    });
    ev.target.disabled = false;
    ev.target.textContent = '💾 Save .docx + .pdf';
    if (!res.ok) {
      els.coverStatus.textContent = '⚠ ' + res.error;
      return;
    }
    els.coverStatus.textContent = '✓ Saved in your resumes folder:';
    renderFileLinks(card.querySelector('.cover-files'), [
      { label: 'DOCX', path: res.docxPath },
      { label: 'PDF', path: res.pdfPath },
    ]);
  });

  els.coverResult.appendChild(card);
}

async function answerAndShow(questions, statusEl) {
  const ctx = await ensureReady();
  statusEl.textContent = `Answering ${questions.length} question${questions.length === 1 ? '' : 's'}…`;
  const res = await window.api.answerQuestions({
    provider: ctx.a.provider,
    apiKey: ctx.a.apiKey,
    baseUrl: ctx.a.baseUrl,
    model: ctx.a.model,
    jobDescription: ctx.jobDescription,
    baseFilePath: ctx.baseFilePath,
    questions,
  });
  if (!res.ok) {
    statusEl.textContent = '⚠ ' + res.error;
    return;
  }
  statusEl.textContent = '';
  renderAnswers(res.answers);
  if (res.questions) renderSavedQuestions(res.questions); // freshly updated frequencies
}

function renderAnswers(answers) {
  els.qaResult.innerHTML = '';
  for (const qa of answers) {
    const card = document.createElement('div');
    card.className = 'qa-card';
    card.innerHTML = `
      <div class="qa-q">${escapeHtml(qa.question)}</div>
      <div class="qa-a">${escapeHtml(qa.answer)}</div>
      <button class="btn small qa-copy">Copy answer</button>`;
    card.querySelector('.qa-copy').addEventListener('click', (ev) => {
      navigator.clipboard.writeText(qa.answer);
      ev.target.textContent = 'Copied ✓';
      setTimeout(() => (ev.target.textContent = 'Copy answer'), 1500);
    });
    els.qaResult.appendChild(card);
  }
}

els.answerQs.addEventListener('click', async () => {
  const questions = els.questions.value.split('\n').map((q) => q.trim()).filter(Boolean);
  if (questions.length === 0) {
    els.qaStatus.textContent = 'Enter at least one question (one per line).';
    return;
  }
  els.answerQs.disabled = true;
  els.qaResult.innerHTML = '';
  try {
    await answerAndShow(questions, els.qaStatus);
  } catch (e) {
    els.qaStatus.textContent = e.message;
  }
  els.answerQs.disabled = false;
});

els.answerPinned.addEventListener('click', async () => {
  const pinned = savedQuestionsCache.filter((q) => q.pinned).map((q) => q.text);
  if (pinned.length === 0) {
    els.qaStatus.textContent = 'No pinned questions yet — pin some from the list below.';
    return;
  }
  els.answerPinned.disabled = true;
  els.qaResult.innerHTML = '';
  try {
    await answerAndShow(pinned, els.qaStatus);
  } catch (e) {
    els.qaStatus.textContent = e.message;
  }
  els.answerPinned.disabled = false;
});

// --------------------------------------------------------------------------
// Saved question bank
// --------------------------------------------------------------------------
let savedQuestionsCache = [];

async function refreshSavedQuestions() {
  renderSavedQuestions(await window.api.listQuestions());
}

function renderSavedQuestions(list) {
  savedQuestionsCache = Array.isArray(list) ? list : [];
  const pinnedCount = savedQuestionsCache.filter((q) => q.pinned).length;
  els.savedCount.textContent = savedQuestionsCache.length
    ? `(${savedQuestionsCache.length} saved · ${pinnedCount} pinned)`
    : '';

  if (savedQuestionsCache.length === 0) {
    els.savedQuestions.innerHTML = '<div class="muted saved-empty">No saved questions yet. Answer some above and they’ll appear here.</div>';
    return;
  }
  els.savedQuestions.innerHTML = '';
  for (const q of savedQuestionsCache) {
    const row = document.createElement('div');
    row.className = 'saved-row' + (q.pinned ? ' pinned' : '');
    row.innerHTML = `
      <button class="pin-btn" title="${q.pinned ? 'Unpin' : 'Pin'}">${q.pinned ? '📌' : '📍'}</button>
      <span class="saved-text">${escapeHtml(q.text)}</span>
      <span class="saved-badge" title="Times used">×${q.count || 1}</span>
      <button class="del-btn" title="Delete">✕</button>`;
    row.querySelector('.pin-btn').addEventListener('click', async () => {
      renderSavedQuestions(await window.api.pinQuestion(q.id, !q.pinned));
    });
    row.querySelector('.del-btn').addEventListener('click', async () => {
      renderSavedQuestions(await window.api.deleteQuestion(q.id));
    });
    els.savedQuestions.appendChild(row);
  }
}

function renderBreakdown(categories) {
  if (!categories) return '';
  const order = ['hard_skills', 'experience', 'job_title', 'education', 'soft_skills', 'formatting'];
  const rows = order
    .filter((k) => categories[k])
    .map((k) => {
      const c = categories[k];
      return `
        <div class="cat-row">
          <div class="cat-label">${escapeHtml(c.label)} <span class="cat-weight">${c.weight}%</span></div>
          <div class="cat-bar"><div class="cat-fill" style="width:${c.score}%;background:${barColor(c.score)}"></div></div>
          <div class="cat-score">${c.score}</div>
        </div>`;
    })
    .join('');
  return `<div class="detail-block"><h4>Score breakdown</h4><div class="breakdown">${rows}</div></div>`;
}

function renderCard(r, rank) {
  const card = document.createElement('div');
  card.className = 'result-card';

  if (!r.ok) {
    card.classList.add('failed');
    card.innerHTML = `
      <div class="result-top">
        <div class="rank-badge">—</div>
        <div class="result-main">
          <div class="result-name">${escapeHtml(r.file)}</div>
          <div class="error-text">Could not score: ${escapeHtml(r.error || 'unknown error')}</div>
        </div>
      </div>`;
    return card;
  }

  if (rank === 1) card.classList.add('best');
  const c = scoreColor(r.ats_score);
  const isBest = rank === 1;
  const matched = (r.matched_keywords || []).slice(0, 30);
  const missing = (r.missing_keywords || []).slice(0, 30);

  card.innerHTML = `
    <div class="result-top" data-toggle>
      <div class="rank-badge">${rank}</div>
      <div class="result-main">
        <div class="result-name">
          ${escapeHtml(r.candidate_name || 'Unknown')}${isBest ? '<span class="best-tag">BEST MATCH</span>' : ''}
        </div>
        <div class="result-file">${escapeHtml(r.file)}</div>
        <div class="verdict">${escapeHtml(r.verdict || '')}</div>
      </div>
      <div class="score" style="background:${c.bg};box-shadow:inset 0 0 0 3px ${c.ring};color:${c.text}">
        <span>${r.ats_score}</span>
      </div>
      <div class="expand-caret">▸</div>
    </div>
    <div class="result-details hidden">
      ${renderBreakdown(r.categories)}
      ${matched.length ? `<div class="detail-block"><h4>Matched keywords (${matched.length})</h4><div class="chips">${matched.map((k) => `<span class="chip match">${escapeHtml(k)}</span>`).join('')}</div></div>` : ''}
      ${missing.length ? `<div class="detail-block"><h4>Missing keywords (${missing.length})</h4><div class="chips">${missing.map((k) => `<span class="chip miss">${escapeHtml(k)}</span>`).join('')}</div></div>` : ''}
      ${r.strengths ? `<div class="detail-block"><h4>Strengths</h4><div class="detail-text">${escapeHtml(r.strengths)}</div></div>` : ''}
      ${r.gaps ? `<div class="detail-block"><h4>Gaps</h4><div class="detail-text">${escapeHtml(r.gaps)}</div></div>` : ''}
    </div>`;

  const top = card.querySelector('[data-toggle]');
  const details = card.querySelector('.result-details');
  const caret = card.querySelector('.expand-caret');
  top.addEventListener('click', () => {
    const open = details.classList.toggle('hidden');
    caret.textContent = open ? '▸' : '▾';
  });
  return card;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
