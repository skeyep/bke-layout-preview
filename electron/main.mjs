import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { createBkeProjectService, toSlash } from '../server/bke-project-service.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(appRoot, 'dist');
const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const updateConfig = {
  currentVersion: packageJson.version,
  latestReleaseUrl: 'https://api.github.com/repos/skeyep/bke-layout-preview/releases/latest',
};

function compareVersions(a, b) {
  const left = String(a ?? '').replace(/^v/i, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b ?? '').replace(/^v/i, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    if ((left[i] ?? 0) > (right[i] ?? 0)) return 1;
    if ((left[i] ?? 0) < (right[i] ?? 0)) return -1;
  }
  return 0;
}

function portableAssetFrom(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  return assets.find((asset) => /portable\.exe$/i.test(asset.name ?? ''))
    ?? assets.find((asset) => /\.exe$/i.test(asset.name ?? ''))
    ?? null;
}

async function checkForUpdates() {
  const response = await fetch(updateConfig.latestReleaseUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `bke-layout-preview/${updateConfig.currentVersion}`,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`GitHub release check failed: ${response.status}`);
  const release = await response.json();
  const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '');
  const asset = portableAssetFrom(release);
  const hasUpdate = latestVersion && compareVersions(latestVersion, updateConfig.currentVersion) > 0;
  return {
    ok: true,
    currentVersion: updateConfig.currentVersion,
    latestVersion: latestVersion || updateConfig.currentVersion,
    hasUpdate,
    releaseUrl: release.html_url || '',
    publishedAt: release.published_at || '',
    asset: asset
      ? {
          name: asset.name,
          size: asset.size,
          url: asset.browser_download_url,
        }
      : null,
  };
}

async function openUpdateUrl(url) {
  const target = String(url || '');
  if (!/^https:\/\/github\.com\/skeyep\/bke-layout-preview\/releases\//i.test(target)) {
    throw new Error('Unsupported update URL');
  }
  await shell.openExternal(target);
}

function contentTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const absolutePath = path.resolve(distRoot, requested);
  const relative = path.relative(distRoot, absolutePath);

  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', contentTypeFor(absolutePath));
  fs.createReadStream(absolutePath).pipe(res);
}

async function createServer() {
  const service = createBkeProjectService({
    toolRoot: appRoot,
    sampleProjectRoot: path.join(appRoot, 'sample_project'),
    settingsPath: path.join(app.getPath('userData'), 'settings.json'),
    pickDirectory: async () => {
      const result = await dialog.showOpenDialog({
        title: '选择 BKE 项目根目录',
        properties: ['openDirectory'],
      });
      return result.canceled ? '' : result.filePaths[0];
    },
    updateChecker: {
      check: checkForUpdates,
      open: openUpdateUrl,
    },
  });

  const server = http.createServer(async (req, res) => {
    if (await service.handleApi(req, res)) return;
    serveStatic(req, res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/`,
    projectRoot: toSlash(service.currentState().projectRoot),
  };
}

async function createWindow() {
  const { server, url } = await createServer();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    title: 'BKE UI 布局工作台',
    backgroundColor: '#101214',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('closed', () => server.close());
  await win.loadURL(url);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
