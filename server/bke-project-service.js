import fs from 'node:fs';
import path from 'node:path';

const imageExtensions = ['', '.png', '.jpg', '.jpeg', '.webp', '.bmp'];

function toSlash(value) {
  return String(value).replace(/\\/g, '/');
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function writeJsonFile(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function normalizeRoot(root) {
  if (!root || typeof root !== 'string') return '';
  return path.resolve(root.replace(/^['"]|['"]$/g, '').trim());
}

function isBkeProjectRoot(root) {
  if (!root) return false;
  try {
    return fs.existsSync(path.join(root, 'config.bkpsr'));
  } catch {
    return false;
  }
}

function findBkeProjectRoot(startDir) {
  let current = path.resolve(startDir);
  for (let i = 0; i < 8; i += 1) {
    if (isBkeProjectRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return '';
}

function parseConfig(projectRoot) {
  const fallback = {
    resolution: [1920, 1080],
    imageSearchPaths: ['image/cg', 'image/ui', 'image', 'image/bg', 'image/button', 'image/character'],
  };
  const configPath = path.join(projectRoot, 'config.bkpsr');
  if (!fs.existsSync(configPath)) return fallback;

  const text = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
  const resolutionMatch = text.match(/ResolutionSize\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
  const pathsMatch = text.match(/ImageAutoSearchPath\s*=\s*\[([^\]]*)\]/);
  const imageSearchPaths = pathsMatch
    ? [...pathsMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
    : fallback.imageSearchPaths;

  return {
    resolution: resolutionMatch ? [Number(resolutionMatch[1]), Number(resolutionMatch[2])] : fallback.resolution,
    imageSearchPaths: imageSearchPaths.length ? imageSearchPaths : fallback.imageSearchPaths,
  };
}

function unique(values) {
  return [...new Set(values)];
}

function candidatePaths(projectRoot, file, imageSearchPaths) {
  const normalized = String(file ?? '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');

  if (!normalized) return [];
  const hasExtension = /\.[a-z0-9]+$/i.test(normalized);
  const names = hasExtension ? [normalized] : imageExtensions.map((ext) => `${normalized}${ext}`);
  const roots = ['', ...imageSearchPaths];
  const candidates = [];

  for (const root of roots) {
    for (const name of names) {
      candidates.push(path.resolve(projectRoot, root, name));
    }
  }

  return unique(candidates);
}

function resolveInsideProject(projectRoot, relativeFile) {
  const normalized = String(relativeFile ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
  const absolutePath = path.resolve(projectRoot, normalized);
  const relative = path.relative(projectRoot, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { ok: false, error: '文件必须位于项目目录内' };
  }
  return { ok: true, absolutePath, relative };
}

function contentTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.bmp') return 'image/bmp';
  return 'application/octet-stream';
}

function firstExistingRoot(...roots) {
  for (const root of roots) {
    if (root && fs.existsSync(root)) return root;
  }
  return roots.find(Boolean) ?? '';
}

export function createBkeProjectService(options) {
  const toolRoot = path.resolve(options.toolRoot);
  const sampleProjectRoot = path.resolve(options.sampleProjectRoot ?? path.join(toolRoot, 'sample_project'));
  const settingsPath = path.resolve(options.settingsPath ?? path.join(toolRoot, '.bke-layout-preview.json'));
  const defaultProjectRoot =
    normalizeRoot(process.env.BKE_PROJECT_ROOT)
    || findBkeProjectRoot(process.cwd())
    || findBkeProjectRoot(path.resolve(toolRoot, '../..'));
  const pickDirectory = options.pickDirectory;
  const updateChecker = options.updateChecker;

  function readSettings() {
    return readJsonFile(settingsPath);
  }

  function currentState() {
    const settings = readSettings();
    const configuredRoot = normalizeRoot(settings.projectRoot);
    const hasSavedRoot = Boolean(configuredRoot);
    const hasConfiguredProject = isBkeProjectRoot(configuredRoot);
    const autoRoot = isBkeProjectRoot(defaultProjectRoot) ? defaultProjectRoot : '';
    const projectRoot = firstExistingRoot(hasConfiguredProject ? configuredRoot : '', autoRoot, sampleProjectRoot);
    const usingSample = path.resolve(projectRoot) === sampleProjectRoot || !isBkeProjectRoot(projectRoot);
    const config = parseConfig(projectRoot);

    return {
      projectRoot,
      settingsPath,
      sampleProjectRoot,
      hasSavedRoot,
      hasConfiguredProject,
      usingSample,
      needsSetup: !hasSavedRoot && usingSample,
      projectInfo: {
        ...config,
        projectRoot: toSlash(projectRoot),
        sampleProjectRoot: toSlash(sampleProjectRoot),
        usingSample,
        settingsPath: toSlash(settingsPath),
      },
    };
  }

  function findImage(file) {
    const { projectRoot } = currentState();
    const roots = unique([projectRoot, sampleProjectRoot]);
    const tried = [];
    for (const root of roots) {
      const { imageSearchPaths } = parseConfig(root);
      for (const candidate of candidatePaths(root, file, imageSearchPaths)) {
        tried.push(candidate);
        const relative = path.relative(root, candidate);
        if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return {
            ok: true,
            absolutePath: candidate,
            root,
            url: `/api/image/${encodeURIComponent(path.basename(candidate))}?file=${encodeURIComponent(file)}`,
          };
        }
      }
    }
    return {
      ok: false,
      tried: tried.slice(0, 16).map(toSlash),
    };
  }

  function resolveImage(file) {
    const resolved = findImage(file);
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      url: resolved.url,
      path: toSlash(path.relative(resolved.root, resolved.absolutePath)),
    };
  }

  function resolveProjectFile(file) {
    const { projectRoot } = currentState();
    const resolved = resolveInsideProject(projectRoot, file);
    if (!resolved.ok) return resolved;
    if (!fs.existsSync(resolved.absolutePath) || !fs.statSync(resolved.absolutePath).isFile()) {
      return { ok: false, error: '找不到文件' };
    }
    return {
      ok: true,
      path: toSlash(resolved.relative),
      text: fs.readFileSync(resolved.absolutePath, 'utf8').replace(/^\uFEFF/, ''),
    };
  }

  function sampleScript() {
    const sampleFile = path.join(sampleProjectRoot, 'layout_demo.bkscr');
    if (!fs.existsSync(sampleFile)) return { ok: false, text: '' };
    return {
      ok: true,
      path: toSlash(path.relative(sampleProjectRoot, sampleFile)),
      text: fs.readFileSync(sampleFile, 'utf8').replace(/^\uFEFF/, ''),
    };
  }

  async function handleApi(req, res) {
    const url = new URL(req.url ?? '', 'http://localhost');

    if (url.pathname === '/api/project-info') {
      sendJson(res, 200, currentState().projectInfo);
      return true;
    }

    if (url.pathname === '/api/settings' && req.method === 'GET') {
      const state = currentState();
      sendJson(res, 200, {
        projectRoot: toSlash(state.projectRoot),
        savedProjectRoot: toSlash(normalizeRoot(readSettings().projectRoot)),
        sampleProjectRoot: toSlash(state.sampleProjectRoot),
        needsSetup: state.needsSetup,
        usingSample: state.usingSample,
        settingsPath: toSlash(state.settingsPath),
      });
      return true;
    }

    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const body = JSON.parse((await readRequestBody(req)) || '{}');
      const projectRoot = body.useSample ? sampleProjectRoot : normalizeRoot(body.projectRoot);
      if (!projectRoot || !fs.existsSync(projectRoot)) {
        sendJson(res, 400, { ok: false, error: '目录不存在' });
        return true;
      }
      if (!isBkeProjectRoot(projectRoot)) {
        sendJson(res, 400, { ok: false, error: '目录下没有 config.bkpsr' });
        return true;
      }
      writeJsonFile(settingsPath, { projectRoot });
      sendJson(res, 200, { ok: true, ...currentState().projectInfo });
      return true;
    }

    if (url.pathname === '/api/pick-directory') {
      if (!pickDirectory) {
        sendJson(res, 501, { ok: false, error: '当前运行方式不支持目录选择，请手动粘贴路径。' });
        return true;
      }
      const selected = await pickDirectory();
      sendJson(res, 200, selected ? { ok: true, projectRoot: toSlash(selected) } : { ok: false, cancelled: true });
      return true;
    }

    if (url.pathname === '/api/update/check') {
      if (!updateChecker?.check) {
        sendJson(res, 501, { ok: false, error: 'Update checks are only available in the desktop app.' });
        return true;
      }
      try {
        sendJson(res, 200, await updateChecker.check());
      } catch (error) {
        sendJson(res, 503, { ok: false, error: error.message || 'Unable to check GitHub releases.' });
      }
      return true;
    }

    if (url.pathname === '/api/update/open' && req.method === 'POST') {
      if (!updateChecker?.open) {
        sendJson(res, 501, { ok: false, error: 'Update downloads are only available in the desktop app.' });
        return true;
      }
      try {
        const body = JSON.parse((await readRequestBody(req)) || '{}');
        await updateChecker.open(body.url);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message || 'Unable to open update download.' });
      }
      return true;
    }

    if (url.pathname === '/api/sample-script') {
      sendJson(res, 200, sampleScript());
      return true;
    }

    if (url.pathname === '/api/resolve-image') {
      sendJson(res, 200, resolveImage(url.searchParams.get('file') ?? ''));
      return true;
    }

    if (url.pathname === '/api/image' || url.pathname.startsWith('/api/image/')) {
      const resolved = findImage(url.searchParams.get('file') ?? '');
      if (!resolved.ok) {
        sendJson(res, 404, { ok: false, error: '找不到图片' });
        return true;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', contentTypeFor(resolved.absolutePath));
      fs.createReadStream(resolved.absolutePath).pipe(res);
      return true;
    }

    if (url.pathname === '/api/source-file') {
      sendJson(res, 200, resolveProjectFile(url.searchParams.get('file') ?? ''));
      return true;
    }

    return false;
  }

  return {
    handleApi,
    currentState,
    resolveImage,
    resolveProjectFile,
  };
}

export { toSlash };
