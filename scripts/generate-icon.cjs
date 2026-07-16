// Generates build/icon.ico (and icon.png) from an inline SVG.
// Run with: npm run icon
'use strict';

const { app, BrowserWindow } = require('electron');
const fsp = require('fs/promises');
const path = require('path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3b7dff"/>
      <stop offset="1" stop-color="#2159d6"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="256" height="256" rx="56" fill="url(#g)"/>
  <rect x="72" y="50" width="94" height="132" rx="12" fill="#ffffff"/>
  <rect x="86" y="74" width="66" height="9" rx="4.5" fill="#2f6fed"/>
  <rect x="86" y="95" width="66" height="9" rx="4.5" fill="#c3d4f5"/>
  <rect x="86" y="116" width="44" height="9" rx="4.5" fill="#c3d4f5"/>
  <circle cx="170" cy="172" r="35" fill="#12a150" stroke="#ffffff" stroke-width="7"/>
  <path d="M153 172l12 12 22-23" fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const outDir = path.join(__dirname, '..', 'build');
const logErr = (m) => fsp.mkdir(outDir, { recursive: true }).then(() => fsp.writeFile(path.join(outDir, 'icon-error.log'), String(m)));

process.on('uncaughtException', async (e) => {
  await logErr('uncaught: ' + (e && e.stack ? e.stack : e));
  app.exit(1);
});

app.whenReady().then(async () => {
  try {
    const pngToIco = (await import('png-to-ico')).default;
    const win = new BrowserWindow({ show: false, width: 300, height: 300, webPreferences: { offscreen: false } });
    await win.loadURL('data:text/html;charset=utf-8,<!doctype html><html><body></body></html>');

    const dataUrls = await win.webContents.executeJavaScript(`(async () => {
      const svg = ${JSON.stringify(SVG)};
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('svg load failed')); });
      const sizes = [256, 128, 64, 48, 32, 16];
      return sizes.map((sz) => {
        const c = document.createElement('canvas');
        c.width = sz; c.height = sz;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, sz, sz);
        ctx.drawImage(img, 0, 0, sz, sz);
        return c.toDataURL('image/png');
      });
    })()`);

    const pngs = dataUrls.map((u) => Buffer.from(u.split(',')[1], 'base64'));
    await fsp.mkdir(outDir, { recursive: true });
    await fsp.writeFile(path.join(outDir, 'icon.ico'), await pngToIco(pngs));
    await fsp.writeFile(path.join(outDir, 'icon.png'), pngs[0]);
    await fsp.writeFile(path.join(outDir, 'icon-error.log'), 'OK');

    win.destroy();
    app.exit(0);
  } catch (e) {
    await logErr('caught: ' + (e && e.stack ? e.stack : e));
    app.exit(1);
  }
});
