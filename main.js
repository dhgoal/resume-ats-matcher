'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fsp = require('fs/promises');
const mammoth = require('mammoth');
const JSZip = require('jszip');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
} = require('docx');

// ---------------------------------------------------------------------------
// Providers & settings
// ---------------------------------------------------------------------------
const PROVIDER_DEFAULTS = {
  chutes: {
    apiKey: '',
    baseUrl: 'https://llm.chutes.ai/v1',
    model: 'deepseek-ai/DeepSeek-V3-0324',
  },
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  anthropic: {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5',
  },
};
const PROVIDER_IDS = Object.keys(PROVIDER_DEFAULTS);

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');

function normalizeSettings(saved) {
  saved = saved && typeof saved === 'object' ? saved : {};
  const providers = {};
  for (const id of PROVIDER_IDS) {
    providers[id] = { ...PROVIDER_DEFAULTS[id], ...(saved.providers?.[id] || {}) };
  }
  // Migrate legacy flat settings (v1 stored a single apiKey/baseUrl/model for Chutes).
  if (!saved.providers && (saved.apiKey || saved.model)) {
    providers.chutes = {
      ...providers.chutes,
      apiKey: saved.apiKey || '',
      baseUrl: saved.baseUrl || providers.chutes.baseUrl,
      model: saved.model || providers.chutes.model,
    };
  }
  const provider = PROVIDER_IDS.includes(saved.provider) ? saved.provider : 'chutes';
  return {
    provider,
    providers,
    directory: typeof saved.directory === 'string' ? saved.directory : '',
    concurrency: Math.max(1, Math.min(8, Number(saved.concurrency) || 3)),
  };
}

async function loadSettings() {
  try {
    const raw = await fsp.readFile(SETTINGS_FILE(), 'utf8');
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return normalizeSettings({});
  }
}

async function saveSettings(settings) {
  const merged = normalizeSettings(settings);
  await fsp.writeFile(SETTINGS_FILE(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0f1420',
    title: 'Resume ATS Matcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// Resume handling
// ---------------------------------------------------------------------------
async function listResumes(directory) {
  if (!directory) return [];
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => name.toLowerCase().endsWith('.docx') && !name.startsWith('~$'))
    .sort((a, b) => a.localeCompare(b));
}

async function extractDocxText(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return (result.value || '').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------
// Generic model access (OpenAI-compatible + Anthropic)
// ---------------------------------------------------------------------------
function trimTrailingSlash(url) {
  return (url || '').replace(/\/+$/, '');
}

async function fetchModels({ provider, apiKey, baseUrl }) {
  const base = trimTrailingSlash(baseUrl);
  const headers =
    provider === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${apiKey}` };
  const res = await fetch(`${base}/models`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Model list failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return (json.data || [])
    .map((m) => m.id)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

// Returns the assistant's raw text content, regardless of provider.
async function chatComplete({ provider, apiKey, baseUrl, model, system, user }) {
  const base = trimTrailingSlash(baseUrl);

  if (provider === 'anthropic') {
    const res = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1400,
        temperature: 0.1,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${t.slice(0, 300)}`);
    }
    const json = await res.json();
    return Array.isArray(json.content)
      ? json.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
      : '';
  }

  // OpenAI-compatible: Chutes and OpenAI.
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const call = (withJsonFormat) => {
    const body = { model, messages, temperature: 0.1, max_tokens: 1400 };
    if (withJsonFormat) body.response_format = { type: 'json_object' };
    return fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };
  let res = await call(true);
  if (res.status === 400 || res.status === 422) res = await call(false); // model may not support JSON mode
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  return json?.choices?.[0]?.message?.content || '';
}

// ---------------------------------------------------------------------------
// Industry-style ATS rubric (weighted category scoring)
// ---------------------------------------------------------------------------
const RUBRIC = [
  { key: 'hard_skills', label: 'Hard skills & keywords', weight: 35, hasKeywords: true },
  { key: 'experience', label: 'Experience & depth', weight: 20, hasKeywords: false },
  { key: 'job_title', label: 'Job title & role relevance', weight: 15, hasKeywords: false },
  { key: 'education', label: 'Education & certifications', weight: 10, hasKeywords: false },
  { key: 'soft_skills', label: 'Soft skills & competencies', weight: 10, hasKeywords: true },
  { key: 'formatting', label: 'ATS formatting & parseability', weight: 10, hasKeywords: false },
];

const SYSTEM_PROMPT =
  'You are a rigorous Applicant Tracking System (ATS) and senior technical recruiter. ' +
  'You score how well a resume matches a specific job description using a fixed, industry-standard ' +
  'weighted rubric. Be objective and evidence-based: only credit skills/experience actually present ' +
  'in the resume. Reply with ONLY a single valid JSON object and nothing else.';

function buildUserPrompt(jobDescription, resumeText) {
  const jd = jobDescription.slice(0, 8000);
  const resume = resumeText.slice(0, 16000);
  return `Score the RESUME against the JOB DESCRIPTION using this industry ATS rubric. Rate EACH category 0-100 (100 = fully meets the job's requirements for that category):

1. hard_skills — Required technical/hard skills, tools, technologies, and JD keywords. List which required ones are present (matched) and which required ones are absent (missing).
2. experience — Required years of experience AND relevant depth/impact/seniority for this specific role.
3. job_title — Alignment of the candidate's current/previous job titles and scope with the target role and its seniority.
4. education — Required degrees, fields of study, licenses, and certifications.
5. soft_skills — Required competencies (leadership, communication, collaboration, problem-solving, etc.). List matched and missing.
6. formatting — ATS parseability: standard sections (Experience, Education, Skills), clear contact info, consistent dates, no reliance on tables/images/graphics, standard headings. Would a real ATS parse this cleanly?

Return ONLY this JSON object:
{
  "candidate_name": "candidate name from the resume, or \\"Unknown\\"",
  "categories": {
    "hard_skills": { "score": 0-100, "matched": ["..."], "missing": ["..."] },
    "experience": { "score": 0-100, "note": "one short sentence" },
    "job_title":  { "score": 0-100, "note": "one short sentence" },
    "education":  { "score": 0-100, "note": "one short sentence" },
    "soft_skills": { "score": 0-100, "matched": ["..."], "missing": ["..."] },
    "formatting": { "score": 0-100, "note": "one short sentence" }
  },
  "strengths": "one concise sentence on the biggest strengths for this role",
  "gaps": "one concise sentence on the biggest gaps or risks",
  "verdict": "3-6 word overall verdict"
}

=== JOB DESCRIPTION ===
${jd}

=== RESUME ===
${resume}

Return ONLY the JSON object.`;
}

function clampScore(v) {
  const n = Math.round(Number(v));
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
function str(v) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
}
function arr(v) {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}
function dedup(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = item.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    const first = t.indexOf('{');
    const last = t.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(t.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function scoreResume(params) {
  const text = await chatComplete({
    provider: params.provider,
    apiKey: params.apiKey,
    baseUrl: params.baseUrl,
    model: params.model,
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(params.jobDescription, params.resumeText),
  });

  const parsed = extractJson(text);
  if (!parsed || !parsed.categories || typeof parsed.categories !== 'object') {
    throw new Error('Could not parse a valid JSON score from the model response.');
  }

  const categories = {};
  let weightedTotal = 0;
  const allMatched = [];
  const allMissing = [];

  for (const def of RUBRIC) {
    const c = parsed.categories[def.key] || {};
    const score = clampScore(c.score);
    weightedTotal += score * def.weight;
    categories[def.key] = {
      label: def.label,
      weight: def.weight,
      score,
      note: str(c.note),
      matched: def.hasKeywords ? arr(c.matched) : [],
      missing: def.hasKeywords ? arr(c.missing) : [],
    };
    if (def.hasKeywords) {
      allMatched.push(...categories[def.key].matched);
      allMissing.push(...categories[def.key].missing);
    }
  }

  const overall = Math.round(weightedTotal / 100); // weights sum to 100

  return {
    ats_score: overall,
    candidate_name: str(parsed.candidate_name) || 'Unknown',
    categories,
    matched_keywords: dedup(allMatched),
    missing_keywords: dedup(allMissing),
    strengths: str(parsed.strengths),
    gaps: str(parsed.gaps),
    verdict: str(parsed.verdict),
  };
}

// ---------------------------------------------------------------------------
// Concurrency-limited analysis with progress events
// ---------------------------------------------------------------------------
async function analyze(event, params) {
  const { provider, apiKey, baseUrl, model, directory, jobDescription } = params;
  const concurrency = Math.max(1, Math.min(8, Number(params.concurrency) || 3));

  if (!apiKey) throw new Error('Please enter your API key for the selected provider in Settings.');
  if (!model) throw new Error('Please choose a model in Settings.');
  if (!directory) throw new Error('Please choose a resumes folder.');
  if (!jobDescription || !jobDescription.trim()) throw new Error('Please paste a job description.');

  const files = await listResumes(directory);
  if (files.length === 0) throw new Error('No .docx resumes found in that folder.');

  const send = (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send('analyze:progress', payload);
  };
  send({ type: 'start', total: files.length });

  const results = [];
  let index = 0;
  let done = 0;

  async function worker() {
    while (index < files.length) {
      const file = files[index++];
      const filePath = path.join(directory, file);
      const record = { file, filePath };
      try {
        const resumeText = await extractDocxText(filePath);
        if (!resumeText || resumeText.length < 20) throw new Error('Resume text was empty or unreadable.');
        Object.assign(
          record,
          await scoreResume({ provider, apiKey, baseUrl, model, jobDescription, resumeText }),
          { ok: true }
        );
      } catch (err) {
        Object.assign(record, { ok: false, error: err.message || String(err), ats_score: -1 });
      }
      results.push(record);
      done++;
      send({ type: 'progress', done, total: files.length, file, ok: record.ok });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

  results.sort((a, b) => {
    if (a.ok && !b.ok) return -1;
    if (!a.ok && b.ok) return 1;
    return (b.ats_score || 0) - (a.ats_score || 0);
  });

  send({ type: 'done', total: files.length });
  return results;
}

// ---------------------------------------------------------------------------
// Tailored resume generation (grounded in an existing resume)
// ---------------------------------------------------------------------------
const GEN_SYSTEM_PROMPT =
  'You are an expert resume writer and ATS-optimization specialist. You tailor a candidate\'s ' +
  'EXISTING resume to a specific job description to maximize ATS keyword match — WITHOUT fabricating. ' +
  'Hard rules: use ONLY the employers, job titles, dates, education, certifications, and skills that ' +
  'appear in the SOURCE RESUME. Never invent experience, degrees, certifications, employers, or skills ' +
  'the candidate does not already have. You MAY rephrase bullet points, reorder for relevance, emphasize ' +
  'the most relevant experience, mirror the job description\'s terminology for skills the candidate ' +
  'genuinely possesses, and write a targeted professional summary. Preserve the candidate\'s section ' +
  'structure and overall writing style. Reply with ONLY a single valid JSON object.';

function buildGenPrompt(jobDescription, resumeText) {
  const jd = jobDescription.slice(0, 8000);
  const resume = resumeText.slice(0, 16000);
  return `Rewrite the SOURCE RESUME into a version tailored to the JOB DESCRIPTION, following all the rules. Return ONLY this JSON object describing the tailored resume:
{
  "name": "candidate full name",
  "contact": "single line: email | phone | location | links (only those present in the source)",
  "summary": "2-4 sentence professional summary targeted at this job",
  "sections": [
    { "heading": "SECTION TITLE (e.g. Skills)", "type": "bullets", "items": ["...", "..."] },
    { "heading": "Experience", "type": "entries", "entries": [
        { "title": "Job Title", "org": "Employer", "date": "date range", "bullets": ["achievement bullet", "..."] }
    ] }
  ]
}
Use "bullets" for simple lists (Skills, Certifications). Use "entries" for Experience/Education/Projects. Keep the same section headings and ordering style as the source resume. Every fact must be traceable to the source resume.

=== JOB DESCRIPTION ===
${jd}

=== SOURCE RESUME ===
${resume}

Return ONLY the JSON object.`;
}

// --- Extract the source resume's formatting so the tailored copy matches it ---
const DEFAULT_STYLE = {
  fontFamily: 'Calibri',
  fontSizePt: 11,
  headingColor: '1A3B6B',
  margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, // twips (1 inch)
};

async function extractDocxStyle(filePath) {
  try {
    const zip = await JSZip.loadAsync(await fsp.readFile(filePath));
    const read = async (name) => {
      const f = zip.file(name);
      return f ? await f.async('string') : '';
    };
    const styles = await read('word/styles.xml');
    const docXml = await read('word/document.xml');
    const theme = await read('word/theme/theme1.xml');

    const minorTheme = (theme.match(/<a:minorFont>[\s\S]*?<a:latin[^>]*typeface="([^"]+)"/) || [])[1];
    const majorTheme = (theme.match(/<a:majorFont>[\s\S]*?<a:latin[^>]*typeface="([^"]+)"/) || [])[1];

    const dd = (styles.match(/<w:docDefaults>[\s\S]*?<w:rPrDefault>([\s\S]*?)<\/w:rPrDefault>/) || [])[1] || '';
    let font = (dd.match(/<w:rFonts[^>]*w:ascii="([^"]+)"/) || [])[1];
    if (!font) {
      const at = (dd.match(/<w:rFonts[^>]*w:asciiTheme="([^"]+)"/) || [])[1];
      if (at) font = at.toLowerCase().includes('major') ? majorTheme : minorTheme;
    }
    font = font || minorTheme || DEFAULT_STYLE.fontFamily;

    const szHalf = Number((dd.match(/<w:sz\s+w:val="(\d+)"/) || [])[1]);
    const fontSizePt = szHalf ? szHalf / 2 : DEFAULT_STYLE.fontSizePt;

    const headingColor =
      (styles.match(/w:styleId="Heading[1-3]"[\s\S]*?<w:color\s+w:val="([0-9A-Fa-f]{6})"/) || [])[1] ||
      DEFAULT_STYLE.headingColor;

    const pg = (docXml.match(/<w:pgMar\b[^>]*>/) || [])[0] || '';
    const m = (k) => Number((pg.match(new RegExp('w:' + k + '="(\\d+)"')) || [])[1]);
    const margins = {
      top: m('top') || DEFAULT_STYLE.margins.top,
      right: m('right') || DEFAULT_STYLE.margins.right,
      bottom: m('bottom') || DEFAULT_STYLE.margins.bottom,
      left: m('left') || DEFAULT_STYLE.margins.left,
    };

    return { fontFamily: font, fontSizePt, headingColor, margins };
  } catch {
    return { ...DEFAULT_STYLE };
  }
}

// Font sizes are relative to the source resume's base size.
function sizeSet(style) {
  const base = style.fontSizePt || 11;
  const hp = (pt) => Math.round(pt * 2); // docx sizes are in half-points
  return {
    basePt: base,
    body: hp(base),
    name: hp(base + 7),
    contact: hp(base - 1),
    heading: hp(base + 1),
    date: hp(base - 1),
  };
}

function buildResumeDocx(r, style) {
  const s = sizeSet(style);
  const font = style.fontFamily;
  const headColor = style.headingColor || DEFAULT_STYLE.headingColor;
  const children = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [new TextRun({ text: str(r.name) || 'Candidate', bold: true, size: s.name, font })],
    })
  );
  if (str(r.contact)) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [new TextRun({ text: str(r.contact), size: s.contact, color: '444444', font })],
      })
    );
  }
  if (str(r.summary)) {
    children.push(sectionHeading('Summary', s, headColor, font));
    children.push(
      new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: str(r.summary), size: s.body, font })] })
    );
  }

  for (const section of Array.isArray(r.sections) ? r.sections : []) {
    const heading = str(section.heading);
    if (!heading) continue;
    children.push(sectionHeading(heading, s, headColor, font));

    if (section.type === 'entries' && Array.isArray(section.entries)) {
      for (const e of section.entries) {
        const line = [str(e.title), str(e.org)].filter(Boolean).join(' — ');
        const date = str(e.date);
        children.push(
          new Paragraph({
            spacing: { before: 80, after: 20 },
            children: [
              new TextRun({ text: line, bold: true, size: s.body, font }),
              date
                ? new TextRun({ text: `   (${date})`, italics: true, size: s.date, color: '555555', font })
                : new TextRun(''),
            ],
          })
        );
        for (const b of arr(e.bullets)) {
          children.push(new Paragraph({ text: b, bullet: { level: 0 }, spacing: { after: 20 } }));
        }
      }
    } else {
      for (const item of arr(section.items)) {
        children.push(new Paragraph({ text: item, bullet: { level: 0 }, spacing: { after: 20 } }));
      }
    }
  }

  return new Document({
    styles: { default: { document: { run: { font, size: s.body } } } },
    sections: [{ properties: { page: { margin: style.margins } }, children }],
  });
}

function sectionHeading(text, s, color, font) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 160, after: 40 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'aaaaaa' } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: s.heading, color, font })],
  });
}

// --- HTML + PDF (rendered with real Windows fonts via Electron printToPDF) ---
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildResumeHtml(r, style) {
  const base = style.fontSizePt || 11;
  const font = style.fontFamily;
  const head = '#' + (style.headingColor || DEFAULT_STYLE.headingColor);
  const sectionsHtml = (Array.isArray(r.sections) ? r.sections : [])
    .filter((sec) => str(sec.heading))
    .map((sec) => {
      let body = '';
      if (sec.type === 'entries' && Array.isArray(sec.entries)) {
        body = sec.entries
          .map((e) => {
            const line = [str(e.title), str(e.org)].filter(Boolean).join(' — ');
            const date = str(e.date) ? ` <span class="date">(${esc(e.date)})</span>` : '';
            const bullets = arr(e.bullets).map((b) => `<li>${esc(b)}</li>`).join('');
            return `<div class="entry"><div class="etitle">${esc(line)}${date}</div><ul>${bullets}</ul></div>`;
          })
          .join('');
      } else {
        body = `<ul>${arr(sec.items).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
      }
      return `<h2>${esc(sec.heading)}</h2>${body}`;
    })
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: '${esc(font)}', Calibri, Arial, sans-serif; font-size: ${base}pt; color: #111; margin: 0; line-height: 1.4; }
    .name { text-align: center; font-size: ${base + 7}pt; font-weight: bold; margin: 0 0 2pt; }
    .contact { text-align: center; font-size: ${base - 1}pt; color: #444; margin: 0 0 10pt; }
    h2 { font-size: ${base + 1}pt; text-transform: uppercase; color: ${head}; border-bottom: 1px solid #aaa; padding-bottom: 2pt; margin: 12pt 0 4pt; }
    p.summary { margin: 0 0 8pt; }
    .entry { margin: 0 0 6pt; }
    .etitle { font-weight: bold; }
    .date { font-weight: normal; font-style: italic; color: #555; }
    ul { margin: 2pt 0 6pt; padding-left: 18pt; }
    li { margin: 0 0 2pt; }
  </style></head><body>
    <div class="name">${esc(r.name) || 'Candidate'}</div>
    ${str(r.contact) ? `<div class="contact">${esc(r.contact)}</div>` : ''}
    ${str(r.summary) ? `<h2>Summary</h2><p class="summary">${esc(r.summary)}</p>` : ''}
    ${sectionsHtml}
  </body></html>`;
}

async function htmlToPdf(html, margins, outPath) {
  const win = new BrowserWindow({ show: false, width: 850, height: 1100 });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
      margins: {
        top: margins.top / 1440,
        bottom: margins.bottom / 1440,
        left: margins.left / 1440,
        right: margins.right / 1440,
      },
    });
    await fsp.writeFile(outPath, data);
  } finally {
    win.destroy();
  }
}

function sanitizeFilename(name) {
  return (name || 'Candidate').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60) || 'Candidate';
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

async function generateResume(params) {
  const { provider, apiKey, baseUrl, model, jobDescription, baseFilePath, outDir } = params;
  if (!apiKey || !model) throw new Error('Set your provider API key and model in Settings first.');
  if (!jobDescription || !jobDescription.trim()) throw new Error('Paste a job description first.');
  if (!baseFilePath) throw new Error('Choose a base resume to build from.');

  const resumeText = await extractDocxText(baseFilePath);
  if (!resumeText || resumeText.length < 20) throw new Error('Base resume text was empty or unreadable.');

  const style = await extractDocxStyle(baseFilePath);
  const text = await chatComplete({
    provider,
    apiKey,
    baseUrl,
    model,
    system: GEN_SYSTEM_PROMPT,
    user: buildGenPrompt(jobDescription, resumeText),
  });
  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.sections)) {
    throw new Error('The model did not return a usable resume structure. Try again or use a different model.');
  }

  const dir = outDir || path.dirname(baseFilePath);
  const baseName = `Tailored - ${sanitizeFilename(parsed.name)} - ${timestamp()}`;

  const docxPath = path.join(dir, baseName + '.docx');
  await fsp.writeFile(docxPath, await Packer.toBuffer(buildResumeDocx(parsed, style)));

  const pdfPath = path.join(dir, baseName + '.pdf');
  await htmlToPdf(buildResumeHtml(parsed, style), style.margins, pdfPath);

  return { docxPath, pdfPath, name: str(parsed.name) || 'Candidate' };
}

// ---------------------------------------------------------------------------
// Application question answering
// ---------------------------------------------------------------------------
const QA_SYSTEM_PROMPT =
  'You help a job applicant answer application and screening questions for a specific role. ' +
  'Write concise, professional, first-person answers grounded in the candidate\'s actual resume and ' +
  'the job description. Be honest: do not claim experience the resume does not support — where the ' +
  'resume lacks something, answer diplomatically using transferable skills and genuine willingness to ' +
  'learn. Keep each answer roughly 3-6 sentences unless the question implies otherwise. ' +
  'Reply with ONLY a single valid JSON object.';

function buildQaPrompt(jobDescription, resumeText, questions) {
  const jd = jobDescription.slice(0, 6000);
  const resume = resumeText.slice(0, 14000);
  const qlist = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
  return `Answer each APPLICATION QUESTION for this candidate applying to this role. Return ONLY this JSON:
{ "answers": [ { "question": "the question", "answer": "the tailored answer" } ] }

=== JOB DESCRIPTION ===
${jd}

=== CANDIDATE RESUME ===
${resume}

=== APPLICATION QUESTIONS ===
${qlist}

Return ONLY the JSON object, with one entry per question in the same order.`;
}

async function answerQuestions(params) {
  const { provider, apiKey, baseUrl, model, jobDescription, baseFilePath, questions } = params;
  if (!apiKey || !model) throw new Error('Set your provider API key and model in Settings first.');
  if (!baseFilePath) throw new Error('Choose a base resume for context.');
  const qs = arr(questions);
  if (qs.length === 0) throw new Error('Enter at least one question.');

  const resumeText = await extractDocxText(baseFilePath);
  if (!resumeText || resumeText.length < 20) throw new Error('Base resume text was empty or unreadable.');

  const text = await chatComplete({
    provider,
    apiKey,
    baseUrl,
    model,
    system: QA_SYSTEM_PROMPT,
    user: buildQaPrompt(jobDescription || '', resumeText, qs),
  });
  const parsed = extractJson(text);
  let answers = parsed && Array.isArray(parsed.answers) ? parsed.answers : null;
  if (!answers) throw new Error('The model did not return usable answers. Try again.');

  return answers.map((a, i) => ({
    question: str(a.question) || qs[i] || `Question ${i + 1}`,
    answer: str(a.answer),
  }));
}

// ---------------------------------------------------------------------------
// Cover letter generation
// ---------------------------------------------------------------------------
const COVER_SYSTEM_PROMPT =
  'You are an expert cover-letter writer. Using the candidate\'s actual resume and the job description, ' +
  'write a compelling, tailored, professional cover letter. Be specific and grounded: reference real ' +
  'experience from the resume that maps to the job\'s needs. Do not invent experience, employers, or ' +
  'credentials. Keep it to 3-4 concise paragraphs, confident but not exaggerated. ' +
  'Reply with ONLY a single valid JSON object.';

function buildCoverPrompt(jobDescription, resumeText, companyRole) {
  const jd = jobDescription.slice(0, 7000);
  const resume = resumeText.slice(0, 14000);
  return `Write a tailored cover letter for this candidate and role. Return ONLY this JSON:
{
  "name": "candidate full name (from the resume)",
  "greeting": "e.g. Dear Hiring Manager,",
  "paragraphs": ["opening paragraph", "body paragraph(s)", "closing paragraph"],
  "closing": "e.g. Sincerely,"
}
${companyRole ? 'Target (company / role hint): ' + companyRole + '\n' : ''}
=== JOB DESCRIPTION ===
${jd}

=== CANDIDATE RESUME ===
${resume}

Return ONLY the JSON object.`;
}

function coverLetterText(c) {
  const lines = [];
  if (str(c.greeting)) lines.push(str(c.greeting), '');
  for (const p of arr(c.paragraphs)) lines.push(p, '');
  if (str(c.closing)) lines.push(str(c.closing));
  if (str(c.name)) lines.push(str(c.name));
  return lines.join('\n');
}

function buildLetterDocx(c, style) {
  const s = sizeSet(style);
  const font = style.fontFamily;
  const children = [];
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  children.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: dateStr, size: s.body, font })] }));
  if (str(c.greeting))
    children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: str(c.greeting), size: s.body, font })] }));
  for (const p of arr(c.paragraphs))
    children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: p, size: s.body, font })] }));
  if (str(c.closing))
    children.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [new TextRun({ text: str(c.closing), size: s.body, font })] }));
  if (str(c.name))
    children.push(new Paragraph({ children: [new TextRun({ text: str(c.name), bold: true, size: s.body, font })] }));

  return new Document({
    styles: { default: { document: { run: { font, size: s.body } } } },
    sections: [{ properties: { page: { margin: style.margins } }, children }],
  });
}

function buildLetterHtml(c, style) {
  const base = style.fontSizePt || 11;
  const font = style.fontFamily;
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const paras = arr(c.paragraphs).map((p) => `<p>${esc(p)}</p>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: '${esc(font)}', Calibri, Arial, sans-serif; font-size: ${base}pt; color: #111; margin: 0; line-height: 1.5; }
    .date { margin: 0 0 14pt; }
    p { margin: 0 0 11pt; }
    .sign { margin-top: 10pt; }
    .name { font-weight: bold; }
  </style></head><body>
    <div class="date">${esc(dateStr)}</div>
    ${str(c.greeting) ? `<p>${esc(c.greeting)}</p>` : ''}
    ${paras}
    <div class="sign">${str(c.closing) ? esc(c.closing) + '<br>' : ''}${str(c.name) ? `<span class="name">${esc(c.name)}</span>` : ''}</div>
  </body></html>`;
}

async function generateCoverLetter(params) {
  const { provider, apiKey, baseUrl, model, jobDescription, baseFilePath, outDir, companyRole } = params;
  if (!apiKey || !model) throw new Error('Set your provider API key and model in Settings first.');
  if (!jobDescription || !jobDescription.trim()) throw new Error('Paste a job description first.');
  if (!baseFilePath) throw new Error('Choose a base resume for context.');

  const resumeText = await extractDocxText(baseFilePath);
  if (!resumeText || resumeText.length < 20) throw new Error('Base resume text was empty or unreadable.');

  const style = await extractDocxStyle(baseFilePath);
  const text = await chatComplete({
    provider,
    apiKey,
    baseUrl,
    model,
    system: COVER_SYSTEM_PROMPT,
    user: buildCoverPrompt(jobDescription, resumeText, str(companyRole)),
  });
  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.paragraphs)) {
    throw new Error('The model did not return a usable cover letter. Try again.');
  }

  const dir = outDir || path.dirname(baseFilePath);
  const baseName = `Cover Letter - ${sanitizeFilename(parsed.name)} - ${timestamp()}`;

  const docxPath = path.join(dir, baseName + '.docx');
  await fsp.writeFile(docxPath, await Packer.toBuffer(buildLetterDocx(parsed, style)));

  const pdfPath = path.join(dir, baseName + '.pdf');
  await htmlToPdf(buildLetterHtml(parsed, style), style.margins, pdfPath);

  return { docxPath, pdfPath, text: coverLetterText(parsed) };
}

// ---------------------------------------------------------------------------
// Persistent question bank (frequency + pinning)
// ---------------------------------------------------------------------------
const QUESTIONS_FILE = () => path.join(app.getPath('userData'), 'questions.json');

function normalizeQuestion(text) {
  return str(text).toLowerCase().replace(/\s+/g, ' ').replace(/[?.!,;:]+$/, '').trim();
}

async function loadQuestions() {
  try {
    const raw = await fsp.readFile(QUESTIONS_FILE(), 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeQuestions(list) {
  await fsp.writeFile(QUESTIONS_FILE(), JSON.stringify(list, null, 2), 'utf8');
  return list;
}

// Record questions the user actually used, incrementing frequency counts.
async function recordQuestions(texts) {
  const list = await loadQuestions();
  const byKey = new Map(list.map((q) => [q.key, q]));
  const now = Date.now();
  let nextId = list.reduce((m, q) => Math.max(m, q.id || 0), 0) + 1;
  for (const t of arr(texts)) {
    const key = normalizeQuestion(t);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.lastUsed = now;
    } else {
      const q = { id: nextId++, key, text: str(t), count: 1, pinned: false, createdAt: now, lastUsed: now };
      byKey.set(key, q);
      list.push(q);
    }
  }
  await writeQuestions(list);
  return sortedQuestions(list);
}

function sortedQuestions(list) {
  return [...list].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0);
    return (b.lastUsed || 0) - (a.lastUsed || 0);
  });
}

async function setQuestionPinned(id, pinned) {
  const list = await loadQuestions();
  const q = list.find((x) => x.id === id);
  if (q) q.pinned = !!pinned;
  await writeQuestions(list);
  return sortedQuestions(list);
}

async function deleteQuestion(id) {
  const list = (await loadQuestions()).filter((x) => x.id !== id);
  await writeQuestions(list);
  return sortedQuestions(list);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle('settings:get', async () => loadSettings());
ipcMain.handle('settings:save', async (_e, settings) => saveSettings(settings));

ipcMain.handle('dialog:selectDirectory', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose the folder that contains your resumes',
    properties: ['openDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

ipcMain.handle('resumes:list', async (_e, directory) => {
  try {
    return { ok: true, files: await listResumes(directory) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('models:fetch', async (_e, params) => {
  try {
    return { ok: true, models: await fetchModels(params) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('analyze:run', async (event, params) => {
  try {
    return { ok: true, results: await analyze(event, params) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('resume:generate', async (_e, params) => {
  try {
    return { ok: true, ...(await generateResume(params)) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('cover:generate', async (_e, params) => {
  try {
    return { ok: true, ...(await generateCoverLetter(params)) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('qa:answer', async (_e, params) => {
  try {
    const answers = await answerQuestions(params);
    const questions = await recordQuestions(params.questions); // remember for frequency/pinning
    return { ok: true, answers, questions };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('questions:list', async () => sortedQuestions(await loadQuestions()));
ipcMain.handle('questions:pin', async (_e, { id, pinned }) => setQuestionPinned(id, pinned));
ipcMain.handle('questions:delete', async (_e, id) => deleteQuestion(id));

ipcMain.handle('file:open', async (_e, filePath) => {
  const err = await shell.openPath(filePath);
  return { ok: !err, error: err || undefined };
});

ipcMain.handle('file:reveal', async (_e, filePath) => {
  shell.showItemInFolder(filePath);
  return { ok: true };
});
