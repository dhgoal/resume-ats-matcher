# Resume ATS Matcher

A native Windows desktop app (Electron) that ranks **.docx resumes** in a folder against a **job description**, using an LLM from **Chutes.ai, OpenAI, or Anthropic** via your API key. Each resume gets an **ATS score (0–100)** from a weighted, industry-style rubric, plus a category breakdown, matched/missing keywords, strengths, and gaps. The best match is highlighted at the top.

## ATS scoring rubric

The overall score is a weighted blend of six categories (each rated 0–100 by the model; the app computes the weighted total, so it's transparent and reproducible):

| Category | Weight | What it measures |
|---|---|---|
| Hard skills & keywords | 45% | Required technical skills, tools, and JD keywords present |
| Experience & depth | 20% | Required years + relevant depth/impact/seniority |
| Job title & role relevance | 13% | Title/scope alignment with the target role |
| Education & certifications | 8% | Required degrees, fields, licenses, certs |
| Soft skills & competencies | 7% | Leadership, communication, collaboration, etc. |
| ATS formatting & parseability | 7% | Standard sections, clean dates, no image/table reliance |

## Providers

- **Chutes.ai** and **OpenAI** use the OpenAI-compatible API (`/chat/completions`, `Authorization: Bearer`).
- **Anthropic** uses its Messages API (`/messages`, `x-api-key`, `anthropic-version`).

Each provider keeps its own API key and model — switch the **Provider** dropdown in Settings to configure each. The active provider/model is shown on the pill next to the Analyze button.

## Run it

Double-click **`Start Resume Matcher.bat`**, or from a terminal:

```powershell
cd D:\Projects\resume-ats-matcher
npm start
```

## First-time setup (inside the app)

1. Click **⚙️ Settings**.
2. Choose a **Provider** (Chutes.ai / OpenAI / Anthropic).
3. Paste that provider's **API key** (`cpk_…` / `sk-…` / `sk-ant-…`).
4. Click **Load models** and pick a model, or type one.
5. Click **Save settings**. Repeat for other providers if you want; switch anytime via the dropdown. (Keys are stored locally on this PC only.)

## Everyday use

1. **Browse…** to the folder containing your `.docx` resumes.
2. Paste the **job description**.
3. Click **▶ Analyze & rank**.
4. Review the ranked list; click any card to expand keyword/strength/gap details.

## Tailor & apply (after an analysis)

A **Tailor & apply** panel appears under the results, working from a **Base resume** you pick (defaults to the top match):

- **✨ Generate a tailored resume** — rewrites your base resume to match the job description (keyword emphasis, targeted summary) in the same section style, and saves a new `.docx` in your resumes folder. If the top match scored under 75 it's recommended automatically. **It never invents experience** — only reorganizes, rephrases, and emphasizes what's already in your source resume. Buttons let you **Open** the file or **Show in folder**.
- **📝 Generate a cover letter** — writes a tailored letter from your base resume + JD (optional company/role hint). It **previews the text first** (with a Copy button); press **💾 Save .docx + .pdf** only when you're happy, and it saves both in your resumes folder. Regenerate as many drafts as you like before saving.
- **💬 Answer application questions** — paste screening questions (one per line); it generates honest, first-person answers grounded in your resume + the JD, each with a **Copy** button.

## Notes

- Only `.docx` files are read (Word temp files like `~$name.docx` are ignored).
- Long resumes/JDs are truncated to keep token cost reasonable.
- "Parallel requests" (Settings) controls how many resumes are scored at once (1–8).
- Each resume = one LLM call, so cost scales with folder size × your Chutes model price.

## Build a standalone .exe (optional)

```powershell
npm install --save-dev electron-builder --registry=https://registry.npmmirror.com
npm run dist
```

The portable `.exe` will appear in the `dist/` folder.
