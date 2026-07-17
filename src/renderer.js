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
  toggleUsage: $('toggleUsage'),
  usageOverlay: $('usageOverlay'),
  closeUsage: $('closeUsage'),
  statusbarMsg: $('statusbarMsg'),
  statusbarUsage: $('statusbarUsage'),
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
  resumeSelect: $('resumeSelect'),
  rsCount: $('rsCount'),
  rsList: $('rsList'),
  rsAll: $('rsAll'),
  rsNone: $('rsNone'),
  rsToggle: $('rsToggle'),
  rsCaret: $('rsCaret'),
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
  outputDir: $('outputDir'),
  browseOutput: $('browseOutput'),
  resetOutput: $('resetOutput'),
  tailorEmpty: $('tailorEmpty'),
  tailorBody: $('tailorBody'),
  missingSkillsWrap: $('missingSkillsWrap'),
  missingSkills: $('missingSkills'),
  msCount: $('msCount'),
  msAll: $('msAll'),
  msNone: $('msNone'),
  usageTotals: $('usageTotals'),
  usageTable: $('usageTable'),
  clearUsage: $('clearUsage'),
};

let hasResults = false;

// --------------------------------------------------------------------------
// Theme (light default, dark optional) — persisted in localStorage
// --------------------------------------------------------------------------
function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  const btn = $('toggleTheme');
  btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  btn.title = theme === 'dark' ? 'Switch to light' : 'Switch to dark';
}
let currentTheme = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
applyTheme(currentTheme);
$('toggleTheme').addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', currentTheme);
  applyTheme(currentTheme);
});

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
  refreshUsage();
  refreshSavedQuestions(); // show the saved question bank right away (persists across launches)

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

function activePrice() {
  const p = modelPriceMap[state.providers[state.provider].model] || {};
  return { inPrice: p.inPrice ?? null, outPrice: p.outPrice ?? null };
}

function updateEnginePill() {
  const a = activeProvider();
  const p = modelPriceMap[a.model];
  let priceStr = '';
  if (p && (p.inPrice != null || p.outPrice != null)) {
    priceStr = ` · ${fmtPrice(p.inPrice)}/M in · ${fmtPrice(p.outPrice)}/M out`;
  }
  els.enginePill.textContent = `${PROVIDER_LABELS[a.provider]} · ${a.model || 'no model'}${priceStr}`;
}

function fmtTokens(n) {
  return (n || 0).toLocaleString('en-US');
}
function fmtCost(c) {
  if (c == null) return '—';
  return '$' + (c < 0.01 ? c.toFixed(4) : c.toFixed(3));
}
function fmtUsage(u) {
  if (!u) return '';
  const total = u.totalTokens ?? (u.inTokens || 0) + (u.outTokens || 0);
  return `${fmtTokens(total)} tokens (${fmtTokens(u.inTokens)} in · ${fmtTokens(u.outTokens)} out) · ${fmtCost(u.cost)}`;
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
function openUsage() {
  refreshUsage();
  els.usageOverlay.classList.remove('hidden');
}
function closeUsage() {
  els.usageOverlay.classList.add('hidden');
}
els.toggleSettings.addEventListener('click', () => {
  els.settingsOverlay.classList.contains('hidden') ? openSettings() : closeSettings();
});
els.closeSettings.addEventListener('click', closeSettings);
els.settingsOverlay.addEventListener('click', (e) => {
  if (e.target === els.settingsOverlay) closeSettings(); // click backdrop to dismiss
});
els.toggleUsage.addEventListener('click', () => {
  els.usageOverlay.classList.contains('hidden') ? openUsage() : closeUsage();
});
els.closeUsage.addEventListener('click', closeUsage);
els.usageOverlay.addEventListener('click', (e) => {
  if (e.target === els.usageOverlay) closeUsage();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!els.settingsOverlay.classList.contains('hidden')) closeSettings();
  if (!els.usageOverlay.classList.contains('hidden')) closeUsage();
});

// Bottom status bar
function setStatus(msg) {
  if (msg) els.statusbarMsg.textContent = msg;
}

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
  els.contextBar.classList.toggle('hidden', !(hasResults && (name === 'tailor' || name === 'questions')));
}
for (const btn of document.querySelectorAll('.tab')) {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
}

els.clearUsage.addEventListener('click', async () => {
  renderUsage(await window.api.clearUsage());
});

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

// Which résumés in the folder to score (default: all).
let selectedResumes = new Set();

async function refreshCount(dir) {
  const res = await window.api.listResumes(dir);
  if (res.ok) {
    const n = res.files.length;
    els.countPill.textContent = `${n} resume${n === 1 ? '' : 's'}`;
    els.countPill.style.color = n ? 'var(--accent-2)' : 'var(--muted)';
    renderResumeList(res.files);
  } else {
    els.countPill.textContent = 'folder error';
    renderResumeList([]);
  }
}

function renderResumeList(files) {
  selectedResumes = new Set(files); // all selected by default
  els.rsList.innerHTML = '';
  if (files.length === 0) {
    els.resumeSelect.classList.add('hidden');
    return;
  }
  els.resumeSelect.classList.remove('hidden');
  els.rsList.classList.add('collapsed'); // start collapsed to avoid a scrollbar on load
  els.rsCaret.classList.remove('open');
  for (const f of files) {
    const row = document.createElement('label');
    row.className = 'rs-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.file = f;
    const span = document.createElement('span');
    span.textContent = f;
    cb.addEventListener('change', () => {
      if (cb.checked) selectedResumes.add(f);
      else selectedResumes.delete(f);
      updateRsCount();
    });
    row.append(cb, span);
    els.rsList.appendChild(row);
  }
  updateRsCount();
}

function updateRsCount() {
  const total = els.rsList.querySelectorAll('input[type=checkbox]').length;
  els.rsCount.textContent = `(${selectedResumes.size} of ${total} selected)`;
}

els.rsToggle.addEventListener('click', () => {
  const collapsed = els.rsList.classList.toggle('collapsed');
  els.rsCaret.classList.toggle('open', !collapsed);
});
els.rsAll.addEventListener('click', () => {
  selectedResumes = new Set();
  for (const cb of els.rsList.querySelectorAll('input[type=checkbox]')) {
    cb.checked = true;
    selectedResumes.add(cb.dataset.file);
  }
  updateRsCount();
});
els.rsNone.addEventListener('click', () => {
  selectedResumes = new Set();
  for (const cb of els.rsList.querySelectorAll('input[type=checkbox]')) cb.checked = false;
  updateRsCount();
});

// Where generated files go: an explicit output folder, or the resumes folder by default.
function effectiveOutputDir() {
  return state.outputDirectory || state.directory || '';
}
function updateOutputDirField() {
  const custom = !!state.outputDirectory;
  els.outputDir.value = effectiveOutputDir();
  els.outputDir.placeholder = 'Defaults to your resumes folder';
  els.resetOutput.style.display = custom ? '' : 'none';
}
els.browseOutput.addEventListener('click', async () => {
  const dir = await window.api.selectDirectory();
  if (!dir) return;
  state.outputDirectory = dir;
  await window.api.saveSettings(state);
  updateOutputDirField();
});
els.resetOutput.addEventListener('click', async () => {
  state.outputDirectory = '';
  await window.api.saveSettings(state);
  updateOutputDirField();
});

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
  else if (selectedResumes.size === 0) problems.push('at least one résumé selected');
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
    files: [...selectedResumes],
    jobDescription,
    ...activePrice(),
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
  if (res.usage) setProgress(100, `Done · used ${fmtUsage(res.usage)}`);
  refreshUsage();
}

function setProgress(pct, text) {
  els.progressFill.style.width = `${pct}%`;
  els.progressText.textContent = text || '';
  setStatus(text);
}

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------
// Theme-aware via CSS classes (see .score.good/.mid/.bad and .cat-fill.*)
function scoreClass(score) {
  if (score >= 75) return 'good';
  if (score >= 50) return 'mid';
  return 'bad';
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
    els.tailorEmpty.classList.remove('hidden');
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
  renderMissingSkills(ok[0].filePath);

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

  // Reveal the tailor tab body and the shared base-resume bar.
  els.tailorEmpty.classList.add('hidden');
  els.tailorBody.classList.remove('hidden');
  updateOutputDirField();
  const activeTab = document.querySelector('.tab.active')?.dataset.tab;
  els.contextBar.classList.toggle('hidden', activeTab === 'analyze');
  refreshSavedQuestions();
}

// Missing-keyword chips: pick which of the base resume's gaps to add to the tailored version.
let selectedSkills = new Set();

function renderMissingSkills(baseFilePath) {
  const base = lastResults.find((r) => r.filePath === baseFilePath);
  const kws = base && Array.isArray(base.missing_keywords) ? base.missing_keywords : [];
  selectedSkills = new Set(kws); // default: all selected
  if (kws.length === 0) {
    els.missingSkillsWrap.classList.add('hidden');
    els.missingSkills.innerHTML = '';
    return;
  }
  els.missingSkillsWrap.classList.remove('hidden');
  els.missingSkills.innerHTML = '';
  for (const kw of kws) {
    const chip = document.createElement('button');
    chip.className = 'ms-chip selected';
    chip.textContent = kw;
    chip.addEventListener('click', () => {
      if (chip.classList.toggle('selected')) selectedSkills.add(kw);
      else selectedSkills.delete(kw);
      updateMsCount();
    });
    els.missingSkills.appendChild(chip);
  }
  updateMsCount();
}
function updateMsCount() {
  els.msCount.textContent = `(${selectedSkills.size} selected)`;
}
els.msAll.addEventListener('click', () => {
  selectedSkills = new Set();
  for (const chip of els.missingSkills.querySelectorAll('.ms-chip')) {
    chip.classList.add('selected');
    selectedSkills.add(chip.textContent);
  }
  updateMsCount();
});
els.msNone.addEventListener('click', () => {
  selectedSkills = new Set();
  for (const chip of els.missingSkills.querySelectorAll('.ms-chip')) chip.classList.remove('selected');
  updateMsCount();
});
els.baseResume.addEventListener('change', () => renderMissingSkills(els.baseResume.value));

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
  setStatus('Generating tailored resume…');
  const res = await window.api.generateResume({
    provider: ctx.a.provider,
    apiKey: ctx.a.apiKey,
    baseUrl: ctx.a.baseUrl,
    model: ctx.a.model,
    jobDescription: ctx.jobDescription,
    baseFilePath: ctx.baseFilePath,
    outDir: effectiveOutputDir(),
    targetKeywords: [...selectedSkills],
    ...activePrice(),
  });
  els.genResume.disabled = false;
  if (!res.ok) {
    els.genStatus.textContent = '⚠ ' + res.error;
    return;
  }
  els.genStatus.textContent = `✓ Saved${res.usage ? ' · used ' + fmtUsage(res.usage) : ''}:`;
  setStatus(`Tailored resume saved${res.usage ? ' · used ' + fmtUsage(res.usage) : ''}`);
  renderFileLinks(els.genResult, [
    { label: 'DOCX', path: res.docxPath },
    { label: 'PDF', path: res.pdfPath },
  ]);
  renderCheckAts(els.genResult, res.docxPath, ctx.jobDescription);
  refreshUsage();
});

// "Check ATS" — score the generated resume against the JD to verify the tailoring helped.
function renderCheckAts(container, filePath, jobDescription) {
  const wrap = document.createElement('div');
  wrap.className = 'checkats';
  wrap.innerHTML = `<button class="btn small primary" data-check>✅ Check ATS score of this resume</button>
    <span class="checkats-status status-inline"></span>
    <div class="checkats-result"></div>`;
  const btn = wrap.querySelector('[data-check]');
  const statusEl = wrap.querySelector('.checkats-status');
  const resultEl = wrap.querySelector('.checkats-result');
  btn.addEventListener('click', async () => {
    const a = activeProvider();
    btn.disabled = true;
    statusEl.textContent = 'Scoring the generated resume…';
    const res = await window.api.checkResumeAts({
      provider: a.provider,
      apiKey: a.apiKey,
      baseUrl: a.baseUrl,
      model: a.model,
      jobDescription,
      filePath,
      ...activePrice(),
    });
    btn.disabled = false;
    if (!res.ok) {
      statusEl.textContent = '⚠ ' + res.error;
      return;
    }
    statusEl.textContent = res.usage ? `used ${fmtUsage(res.usage)}` : '';
    renderAtsScore(resultEl, res);
    setStatus(`Tailored resume ATS score: ${res.ats_score}`);
    refreshUsage();
  });
  container.appendChild(wrap);
}

function renderAtsScore(container, r) {
  const matched = (r.matched_keywords || []).slice(0, 30);
  const missing = (r.missing_keywords || []).slice(0, 30);
  container.innerHTML = `
    <div class="ats-head">
      <div class="score ${scoreClass(r.ats_score)}"><span>${r.ats_score}</span></div>
      <div class="ats-verdict">${escapeHtml(r.verdict || '')}</div>
    </div>
    ${renderBreakdown(r.categories)}
    ${matched.length ? `<div class="detail-block"><h4>Matched keywords (${matched.length})</h4><div class="chips">${matched.map((k) => `<span class="chip match">${escapeHtml(k)}</span>`).join('')}</div></div>` : ''}
    ${missing.length ? `<div class="detail-block"><h4>Missing keywords (${missing.length})</h4><div class="chips">${missing.map((k) => `<span class="chip miss">${escapeHtml(k)}</span>`).join('')}</div></div>` : ''}
    ${r.gaps ? `<div class="detail-block"><h4>Remaining gaps</h4><div class="detail-text">${escapeHtml(r.gaps)}</div></div>` : ''}`;
}

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
  setStatus('Writing cover letter…');
  const res = await window.api.generateCoverLetter({
    provider: ctx.a.provider,
    apiKey: ctx.a.apiKey,
    baseUrl: ctx.a.baseUrl,
    model: ctx.a.model,
    jobDescription: ctx.jobDescription,
    baseFilePath: ctx.baseFilePath,
    companyRole: els.companyRole.value.trim(),
    ...activePrice(),
  });
  els.genCover.disabled = false;
  if (!res.ok) {
    els.coverStatus.textContent = '⚠ ' + res.error;
    return;
  }
  lastCoverLetter = res.letter;
  els.coverStatus.textContent = `Preview below${res.usage ? ' · used ' + fmtUsage(res.usage) : ''}. Regenerate for a different draft, or save when ready.`;
  setStatus(`Cover letter drafted${res.usage ? ' · used ' + fmtUsage(res.usage) : ''}`);
  renderCoverPreview(res.text);
  refreshUsage();
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
      outDir: effectiveOutputDir(),
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
  if (!els.baseResume.value) {
    throw new Error('Run an analysis on the Analyze tab first, then pick a base resume — answers are grounded in it.');
  }
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
    ...activePrice(),
  });
  if (!res.ok) {
    statusEl.textContent = '⚠ ' + res.error;
    return;
  }
  statusEl.textContent = res.usage ? `Used ${fmtUsage(res.usage)}` : '';
  setStatus(`Answered ${res.answers.length} question${res.answers.length === 1 ? '' : 's'}${res.usage ? ' · used ' + fmtUsage(res.usage) : ''}`);
  renderAnswers(res.answers);
  if (res.questions) renderSavedQuestions(res.questions); // freshly updated frequencies
  refreshUsage();
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
// Usage history
// --------------------------------------------------------------------------
async function refreshUsage() {
  renderUsage(await window.api.listUsage());
}

function renderUsage(list) {
  list = Array.isArray(list) ? list : [];
  const totalTokens = list.reduce((s, r) => s + (r.totalTokens || 0), 0);
  const totalCost = list.reduce((s, r) => s + (r.cost || 0), 0);
  const anyCost = list.some((r) => r.cost != null);

  els.usageTotals.innerHTML = list.length
    ? `<strong>${list.length}</strong> runs · <strong>${fmtTokens(totalTokens)}</strong> tokens · <strong>${anyCost ? fmtCost(totalCost) : '—'}</strong> total`
    : 'No usage recorded yet.';

  // Mirror the running total into the bottom status bar.
  els.statusbarUsage.textContent = list.length
    ? `Total: ${fmtTokens(totalTokens)} tokens · ${anyCost ? fmtCost(totalCost) : '—'}`
    : '';

  if (list.length === 0) {
    els.usageTable.innerHTML = '';
    return;
  }
  const rows = [...list]
    .reverse() // newest first
    .map((r) => {
      const d = new Date(r.ts);
      const when = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      return `<tr>
        <td>${escapeHtml(when)}</td>
        <td>${escapeHtml(r.op || '')}</td>
        <td class="u-model">${escapeHtml(r.model || '')}</td>
        <td class="u-num">${fmtTokens(r.inTokens)}</td>
        <td class="u-num">${fmtTokens(r.outTokens)}</td>
        <td class="u-num">${fmtTokens(r.totalTokens)}</td>
        <td class="u-num">${fmtCost(r.cost)}</td>
      </tr>`;
    })
    .join('');
  els.usageTable.innerHTML = `
    <table class="usage-table">
      <thead><tr>
        <th>When</th><th>Operation</th><th>Model</th>
        <th class="u-num">In</th><th class="u-num">Out</th><th class="u-num">Total</th><th class="u-num">Cost</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

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
          <div class="cat-bar"><div class="cat-fill ${scoreClass(c.score)}" style="width:${c.score}%"></div></div>
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
      <div class="score ${scoreClass(r.ats_score)}">
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
