import './styles.css';
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import {
  createIcons,
  Braces,
  Check,
  CircleHelp,
  Copy,
  FileCode2,
  FileOutput,
  FolderOpen,
  FolderSearch,
  Grid3X3,
  ImageDown,
  Layers3,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide';

let DESIGN_WIDTH = 1920;
let DESIGN_HEIGHT = 1080;
const ROOTS = new Set(['basic_layer', 'message_layer']);
const ANCHORS = {
  topleft: [0, 0],
  topcenter: [0.5, 0],
  topright: [1, 0],
  leftcenter: [0, 0.5],
  center: [0.5, 0.5],
  rightcenter: [1, 0.5],
  bottomleft: [0, 1],
  bottomcenter: [0.5, 1],
  bottomright: [1, 1],
};

const FALLBACK_SAMPLE_SCRIPT = `@sprite index=1000 file="bg/workbench_day"
@addto index=1000 target=basic_layer pos=[0,0] zorder=0 opacity=255

@sprite index=1200 file="ui/panel_main"
@addto index=1200 target=basic_layer pos=[88,190] zorder=2 opacity=255

@sprite index=2010 file="ui/card_frame"
@addto index=2010 target=1200 pos=[172,264] zorder=3 opacity=255

@button index=3000 idle="button/button_idle" hover="button/button_hover"
@addto index=3000 target=basic_layer pos=[1454,822] zorder=12 opacity=255`;

const dom = {
  projectInfo: document.querySelector('#projectInfo'),
  scriptInput: document.querySelector('#scriptInput'),
  highlightLayer: document.querySelector('#highlightLayer'),
  parseBadge: document.querySelector('#parseBadge'),
  warningList: document.querySelector('#warningList'),
  viewport: document.querySelector('#viewport'),
  cursorReadout: document.querySelector('#cursorReadout'),
  selectedReadout: document.querySelector('#selectedReadout'),
  nodeList: document.querySelector('#nodeList'),
  nodeCount: document.querySelector('#nodeCount'),
  exportOutput: document.querySelector('#exportOutput'),
  renderBtn: document.querySelector('#renderBtn'),
  projectBtn: document.querySelector('#projectBtn'),
  loadSampleBtn: document.querySelector('#loadSampleBtn'),
  copyBtn: document.querySelector('#copyBtn'),
  pngBtn: document.querySelector('#pngBtn'),
  helpBtn: document.querySelector('#helpBtn'),
  gridToggle: document.querySelector('#gridToggle'),
  workspace: document.querySelector('.workspace'),
  inspectorForm: document.querySelector('#inspectorForm'),
  propIndex: document.querySelector('#propIndex'),
  propFile: document.querySelector('#propFile'),
  propX: document.querySelector('#propX'),
  propY: document.querySelector('#propY'),
  propZ: document.querySelector('#propZ'),
  propOpacity: document.querySelector('#propOpacity'),
  propScaleX: document.querySelector('#propScaleX'),
  propScaleY: document.querySelector('#propScaleY'),
  propRotate: document.querySelector('#propRotate'),
  propAnchor: document.querySelector('#propAnchor'),
  setupModal: document.querySelector('#setupModal'),
  setupCloseBtn: document.querySelector('#setupCloseBtn'),
  projectRootInput: document.querySelector('#projectRootInput'),
  browseProjectBtn: document.querySelector('#browseProjectBtn'),
  useSampleBtn: document.querySelector('#useSampleBtn'),
  saveSettingsBtn: document.querySelector('#saveSettingsBtn'),
  setupError: document.querySelector('#setupError'),
  helpModal: document.querySelector('#helpModal'),
  helpCloseBtn: document.querySelector('#helpCloseBtn'),
};

const state = {
  app: null,
  projectInfo: null,
  settings: null,
  sampleScript: FALLBACK_SAMPLE_SCRIPT,
  scene: null,
  selectedIndex: null,
  renderVersion: 0,
  imageResolveCache: new Map(),
  drag: null,
  selectionOutline: null,
  history: {
    undo: [],
    redo: [],
    limit: 80,
  },
  inspectorBefore: null,
  layoutResize: null,
};

createIcons({
  icons: {
    Braces,
    Check,
    CircleHelp,
    Copy,
    FileCode2,
    FileOutput,
    FolderOpen,
    FolderSearch,
    Grid3x3: Grid3X3,
    ImageDown,
    Layers3,
    RefreshCw,
    SlidersHorizontal,
    Sparkles,
    X,
  },
});

function createNode(index, type = 'sprite') {
  return {
    index: String(index),
    type,
    file: '',
    buttonIdle: '',
    buttonHover: '',
    buttonClick: '',
    buttonDisable: '',
    buttonIdleIndex: '',
    parent: '',
    children: [],
    pos: [0, 0],
    zorder: 0,
    opacity: 255,
    fillOpacity: 0,
    anchor: 'topleft',
    scaleX: 100,
    scaleY: 100,
    rotate: 0,
    blendMode: 'normal',
    rect: null,
    text: '',
    textStyle: {},
    width: null,
    height: null,
    color: 0xffffff,
    order: 0,
    sourceLines: [],
    sourceCommands: [],
  };
}

function rememberSource(node, name, raw, lineNumber) {
  node.sourceLines.push(raw);
  node.sourceCommands.push({ name, lineNumber });
}

function createScene() {
  const basic = createNode('basic_layer', 'root');
  basic.width = DESIGN_WIDTH;
  basic.height = DESIGN_HEIGHT;
  basic.parent = '__stage__';
  basic.order = -2;

  const message = createNode('message_layer', 'root');
  message.width = DESIGN_WIDTH;
  message.height = DESIGN_HEIGHT;
  message.parent = '__stage__';
  message.zorder = 10000;
  message.order = -1;

  return {
    roots: new Map([
      ['basic_layer', basic],
      ['message_layer', message],
    ]),
    nodes: new Map(),
    warnings: [],
    commandCount: 0,
    defined: new Map(),
    variables: new Map(),
  };
}

function ensureNode(scene, index, type = 'sprite') {
  const key = String(index);
  if (ROOTS.has(key)) return scene.roots.get(key);
  if (!scene.nodes.has(key)) {
    const node = createNode(key, type);
    node.order = scene.nodes.size;
    scene.nodes.set(key, node);
  }
  const node = scene.nodes.get(key);
  if (type && node.type === 'sprite') node.type = type;
  return node;
}

function lineWithoutComment(line) {
  let quote = '';
  for (let i = 0; i < line.length - 1; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

function normalizeCommandLine(line) {
  const trimmed = lineWithoutComment(line).trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('@')) return trimmed.slice(1).trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1).trim();
  return '';
}

function readValue(text, start) {
  let quote = '';
  let depth = 0;
  let i = start;
  for (; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[' || char === '(' || char === '%') {
      depth += 1;
      continue;
    }
    if (char === ']' || char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (/\s/.test(char) && depth === 0) break;
  }
  return [text.slice(start, i), i];
}

function parseCommand(line, scene = null) {
  const normalized = normalizeCommandLine(line);
  if (!normalized) return null;
  const firstSpace = normalized.search(/\s/);
  const name = (firstSpace === -1 ? normalized : normalized.slice(0, firstSpace)).toLowerCase();
  const rest = firstSpace === -1 ? '' : normalized.slice(firstSpace + 1);
  const args = {};
  let i = 0;

  while (i < rest.length) {
    while (i < rest.length && /\s/.test(rest[i])) i += 1;
    const keyStart = i;
    while (i < rest.length && /[A-Za-z0-9_]/.test(rest[i])) i += 1;
    const key = rest.slice(keyStart, i);
    if (!key) break;
    while (i < rest.length && /\s/.test(rest[i])) i += 1;
    if (rest[i] !== '=') {
      args[key] = true;
      continue;
    }
    i += 1;
    while (i < rest.length && /\s/.test(rest[i])) i += 1;
    const [raw, next] = readValue(rest, i);
    args[key] = parseValue(raw, scene?.variables);
    i = next;
  }

  return { name, args, raw: line };
}

function splitTopLevel(inner) {
  const parts = [];
  let quote = '';
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[' || char === '(') depth += 1;
    if (char === ']' || char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(inner.slice(start).trim());
  return parts.filter(Boolean);
}

function parseValue(rawValue, variables = null) {
  if (rawValue === true) return true;
  const raw = String(rawValue ?? '').trim();
  if (!raw) return '';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return splitTopLevel(raw.slice(1, -1)).map((part) => parseValue(part, variables));
  }
  if (/^(['"]).*\1$/.test(raw)) return raw.slice(1, -1);

  const variableValue = resolveVariableValue(raw, variables);
  if (variableValue !== undefined) return variableValue;

  const stringConcat = parseStringConcat(raw, variables);
  if (stringConcat !== null) return stringConcat;

  const numeric = parseNumericWithVariables(raw, variables);
  if (Number.isFinite(numeric)) return numeric;
  return raw;
}

function resolveVariableValue(raw, variables) {
  if (!variables || !variables.size) return undefined;
  const parts = String(raw).trim().match(/^([A-Za-z_]\w*)((?:\[[^\]]+\])*)$/);
  if (!parts) return undefined;
  if (!variables.has(parts[1])) return undefined;
  let value = variables.get(parts[1]);
  const accessors = [...parts[2].matchAll(/\[([^\]]+)\]/g)].map((match) => match[1].trim());
  for (const accessor of accessors) {
    const key = Number.isInteger(Number(accessor)) ? Number(accessor) : resolveVariableValue(accessor, variables);
    if (Array.isArray(value) && Number.isInteger(key)) value = value[key];
    else return undefined;
  }
  return value;
}

function parseStringConcat(raw, variables = null) {
  if (!raw.includes('+') || !/['"]/.test(raw)) return null;
  const parts = splitPlus(raw);
  let out = '';
  for (const part of parts) {
    const trimmed = part.trim();
    if (/^(['"]).*\1$/.test(trimmed)) out += trimmed.slice(1, -1);
    else {
      const value = resolveVariableValue(trimmed, variables);
      if (value === undefined || Array.isArray(value)) return null;
      out += String(value);
    }
  }
  return out;
}

function splitPlus(raw) {
  const parts = [];
  let quote = '';
  let start = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '+') {
      parts.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts;
}

function parseNumeric(raw) {
  const text = String(raw).trim();
  if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(2), 16);
  if (!/^[0-9+\-*/().\s]+$/.test(text)) return NaN;
  try {
    const value = Function(`"use strict"; return (${text});`)();
    return Number.isFinite(value) ? value : NaN;
  } catch {
    return NaN;
  }
}

function parseNumericWithVariables(raw, variables) {
  const direct = resolveVariableValue(raw, variables);
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  if (!variables || !variables.size) return parseNumeric(raw);

  let expression = String(raw).trim();
  expression = expression.replace(/[A-Za-z_]\w*(?:\[[^\]]+\])*/g, (token) => {
    const value = resolveVariableValue(token, variables);
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : token;
  });
  return parseNumeric(expression);
}

function toIndex(value) {
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}

function toPoint(value, fallback = [0, 0]) {
  if (!Array.isArray(value) || value.length < 2) return fallback;
  const x = Number(value[0]);
  const y = Number(value[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
  return [x, y];
}

function toRect(value) {
  if (!Array.isArray(value) || value.length < 4) return null;
  const rect = value.slice(0, 4).map(Number);
  return rect.every(Number.isFinite) ? rect : null;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function applyCommand(scene, command, lineNumber) {
  const { name, args, raw } = command;
  scene.commandCount += 1;
  const index = toIndex(args.index ?? args.target);
  validateCommand(scene, name, args, lineNumber);

  if (name === 'sprite') {
    const node = ensureNode(scene, args.index, 'sprite');
    node.file = String(args.file ?? node.file ?? '');
    node.rect = toRect(args.rect);
    rememberSource(node, name, raw, lineNumber);
    return;
  }

  if (name === 'button') {
    const node = ensureNode(scene, args.index, 'button');
    node.buttonIdle = String(args.idle ?? node.buttonIdle ?? '');
    node.buttonHover = String(args.hover ?? node.buttonHover ?? '');
    node.buttonClick = String(args.click ?? node.buttonClick ?? '');
    node.buttonDisable = String(args.disable ?? node.buttonDisable ?? '');
    node.file = node.buttonIdle;
    rememberSource(node, name, raw, lineNumber);
    return;
  }

  if (name === 'buttonex') {
    const node = ensureNode(scene, args.index, 'buttonex');
    node.buttonIdleIndex = toIndex(args.idle);
    node.buttonHover = toIndex(args.hover);
    node.buttonClick = toIndex(args.click);
    node.buttonDisable = toIndex(args.disable);
    rememberSource(node, name, raw, lineNumber);
    return;
  }

  if (name === 'textsprite') {
    const node = ensureNode(scene, args.index, 'textsprite');
    node.text = String(args.text ?? node.text ?? '');
    node.textStyle = {
      fill: numberOr(args.color, node.textStyle.fill ?? 0xffffff),
      fontFamily: String(args.font ?? node.textStyle.fontFamily ?? 'Source Han Sans SC, Microsoft YaHei, sans-serif'),
      fontSize: numberOr(args.size, node.textStyle.fontSize ?? 28),
    };
    rememberSource(node, name, raw, lineNumber);
    return;
  }

  if (name === 'layer') {
    const node = ensureNode(scene, args.index, 'layer');
    node.width = numberOr(args.width, DESIGN_WIDTH);
    node.height = numberOr(args.height, DESIGN_HEIGHT);
    node.color = numberOr(args.color, 0xffffff);
    node.fillOpacity = numberOr(args.opacity, 0);
    rememberSource(node, name, raw, lineNumber);
    return;
  }

  if (name === 'anchor') {
    const node = ensureNode(scene, args.index);
    const anchor = String(args.set ?? node.anchor);
    if (ANCHORS[anchor]) node.anchor = anchor;
    else if (Array.isArray(args.set)) node.anchor = toPoint(args.set);
    rememberSource(node, name, raw, lineNumber);
    return;
  }

  if (name === 'addto') {
    const node = ensureNode(scene, args.index);
    node.parent = toIndex(args.target) || 'basic_layer';
    if (args.pos !== undefined) node.pos = toPoint(args.pos, node.pos);
    node.zorder = numberOr(args.zorder, 0);
    node.opacity = numberOr(args.opacity, 255);
    rememberSource(node, name, raw, lineNumber);
    return;
  }

  if (name === 'action') {
    applyAction(scene, args, raw, lineNumber);
    return;
  }

  if (name === 'effect') {
    const node = ensureNode(scene, args.target);
    const mode = String(args.mode ?? '').toLowerCase();
    if (mode === 'multiply') node.blendMode = 'multiply';
    rememberSource(node, name, raw, lineNumber);
    return;
  }

  if (name === 'zorder') {
    const node = ensureNode(scene, args.index);
    node.zorder = numberOr(args.set, node.zorder);
    rememberSource(node, name, raw, lineNumber);
    return;
  }

  if (name === 'remove') {
    const node = scene.nodes.get(index);
    if (node) node.parent = '';
    return;
  }

  if (['macro', 'return', 'if', 'endif', 'call', 'jump', 'wait', 'waitbutton', 'pretrans', 'trans', 'textoff', 'spriteopt', 'savepoint', 'save', 'waitaction', 'particle', 'preload'].includes(name)) return;
  scene.warnings.push(`第 ${lineNumber} 行暂未模拟 @${name}`);
}

function validateCommand(scene, name, args, lineNumber) {
  const required = {
    sprite: ['index', 'file'],
    button: ['index', 'idle'],
    buttonex: ['index', 'idle'],
    textsprite: ['index', 'text'],
    layer: ['index'],
    anchor: ['index', 'set'],
    addto: ['index', 'target'],
    action: ['mode', 'target'],
    zorder: ['index', 'set'],
    remove: ['index'],
  }[name];

  if (required) {
    for (const key of required) {
      if (args[key] === undefined || args[key] === '') {
        scene.warnings.push(`第 ${lineNumber} 行 @${name} 缺少 ${key}`);
      }
    }
  }

  if (['sprite', 'button', 'buttonex', 'textsprite', 'layer'].includes(name) && args.index !== undefined) {
    const key = toIndex(args.index);
    const previous = scene.defined.get(key);
    if (previous) scene.warnings.push(`第 ${lineNumber} 行 index=${key} 重复定义，前一次在第 ${previous} 行`);
    scene.defined.set(key, lineNumber);
  }

  if (name === 'action') {
    const mode = String(args.mode ?? '').toLowerCase();
    const supported = ['moveto', 'moveby', 'fadeto', 'scaleto', 'scaleby', 'rotateto', 'rotatezto', 'rotateby', 'rotatezby'];
    if (mode && !supported.includes(mode)) scene.warnings.push(`第 ${lineNumber} 行暂未模拟 action mode="${mode}"`);
  }
}

function targetNodes(scene, target) {
  if (Array.isArray(target)) return target.map((item) => ensureNode(scene, item));
  if (target === undefined || target === null || target === '') return [];
  return [ensureNode(scene, target)];
}

function applyAction(scene, args, raw, lineNumber) {
  const mode = String(args.mode ?? '').toLowerCase();
  const nodes = targetNodes(scene, args.target);
  for (const node of nodes) {
    rememberSource(node, 'action', raw, lineNumber);
    if (mode === 'moveto') {
      node.pos = toPoint(args.pos, node.pos);
    } else if (mode === 'moveby') {
      const [dx, dy] = toPoint(args.pos, [0, 0]);
      node.pos = [node.pos[0] + dx, node.pos[1] + dy];
    } else if (mode === 'fadeto') {
      node.opacity = numberOr(args.opacity, node.opacity);
    } else if (mode === 'scaleto') {
      node.scaleX = numberOr(args.x, node.scaleX);
      node.scaleY = numberOr(args.y, node.scaleY);
    } else if (mode === 'scaleby') {
      node.scaleX += numberOr(args.x, 0);
      node.scaleY += numberOr(args.y, 0);
    } else if (mode === 'rotateto' || mode === 'rotatezto') {
      node.rotate = numberOr(args.rotate, node.rotate);
    } else if (mode === 'rotateby' || mode === 'rotatezby') {
      node.rotate += numberOr(args.rotate, 0);
    }
  }
}

function nodeHasVisibleTree(scene, node) {
  if (node.type === 'layer' && node.children.length > 0) return true;
  if (node.type === 'sprite' || node.type === 'button' || node.type === 'textsprite') return Boolean(displayFile(scene, node) || node.text);
  return node.children.some((childIndex) => {
    const child = scene.nodes.get(childIndex);
    return child ? nodeHasVisibleTree(scene, child) : false;
  });
}

function finalizeScene(scene) {
  for (const node of [...scene.roots.values(), ...scene.nodes.values()]) node.children = [];
  for (const node of scene.nodes.values()) {
    const parentKey = node.parent || '';
    const parent = scene.nodes.get(parentKey) ?? scene.roots.get(parentKey);
    if (parent) parent.children.push(node.index);
    else if (node.parent) scene.warnings.push(`index=${node.index} 的 target=${node.parent} 不存在`);
  }
  for (const node of scene.nodes.values()) {
    if (!node.parent && nodeHasVisibleTree(scene, node)) {
      scene.roots.get('basic_layer').children.push(node.index);
      scene.warnings.push(`index=${node.index} 没有 @addto 到舞台；已临时放到 basic_layer 预览`);
    }
  }
  for (const node of [...scene.roots.values(), ...scene.nodes.values()]) {
    node.children.sort((a, b) => {
      const an = scene.nodes.get(a) ?? scene.roots.get(a);
      const bn = scene.nodes.get(b) ?? scene.roots.get(b);
      return (an.zorder - bn.zorder) || (an.order - bn.order);
    });
  }
  return scene;
}

function collectBagelVariable(scene, line) {
  const cleaned = lineWithoutComment(line).trim();
  const match = cleaned.match(/^var\s+([A-Za-z_]\w*)\s*=\s*(.+)$/);
  if (!match) return;
  const raw = match[2].replace(/;\s*$/, '').trim();
  const value = parseValue(raw, scene.variables);
  if (value !== raw) scene.variables.set(match[1], value);
}

function parseScene(script) {
  const scene = createScene();
  let inBagelBlock = false;
  script.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '##') {
      inBagelBlock = !inBagelBlock;
      return;
    }
    if (inBagelBlock) {
      collectBagelVariable(scene, line);
      return;
    }
    const command = parseCommand(line, scene);
    if (command) applyCommand(scene, command, index + 1);
  });
  return finalizeScene(scene);
}

async function resolveImage(file) {
  if (!file) return null;
  if (state.imageResolveCache.has(file)) return state.imageResolveCache.get(file);
  const promise = fetch(`/api/resolve-image?file=${encodeURIComponent(file)}`)
    .then((response) => response.json())
    .catch(() => ({ ok: false, tried: [] }));
  state.imageResolveCache.set(file, promise);
  return promise;
}

async function loadTextureForNode(scene, node) {
  const file = displayFile(scene, node);
  if (!file) return null;
  const resolved = await resolveImage(file);
  if (!resolved?.ok) {
    scene.warnings.push(`找不到图片：${file}`);
    return null;
  }
  try {
    const baseTexture = await Assets.load(resolved.url);
    if (node.rect) {
      const [x, y, width, height] = node.rect;
      return new Texture({
        source: baseTexture.source,
        frame: new Rectangle(x, y, width, height),
      });
    }
    return baseTexture;
  } catch {
    scene.warnings.push(`图片载入失败：${file}`);
    return null;
  }
}

function displayFile(scene, node) {
  if (node.type === 'buttonex') {
    const idleNode = scene.nodes.get(node.buttonIdleIndex);
    return idleNode ? displayFile(scene, idleNode) : '';
  }
  return node.file || node.buttonIdle || '';
}

function anchorVector(anchor) {
  if (Array.isArray(anchor)) return anchor;
  return ANCHORS[anchor] ?? ANCHORS.topleft;
}

async function nodeSize(scene, node, texture) {
  if (node.type === 'layer') return [node.width ?? DESIGN_WIDTH, node.height ?? DESIGN_HEIGHT];
  if (node.type === 'textsprite') {
    const fontSize = numberOr(node.textStyle.fontSize, 28);
    return [node.width ?? Math.max(48, String(node.text).length * fontSize), node.height ?? Math.max(36, fontSize * 1.45)];
  }
  if (texture) return [texture.width, texture.height];
  if (node.type === 'buttonex') {
    const idleNode = scene.nodes.get(node.buttonIdleIndex);
    if (idleNode) {
      const idleTexture = await loadTextureForNode(scene, idleNode);
      if (idleTexture) return [idleTexture.width, idleTexture.height];
    }
  }
  return [node.width ?? 160, node.height ?? 90];
}

function drawBackground(stage) {
  const background = new Graphics();
  background.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill(0x111417);
  stage.addChild(background);

  if (!dom.gridToggle.checked) return;
  const grid = new Graphics();
  for (let x = 0; x <= DESIGN_WIDTH; x += 120) {
    grid.moveTo(x, 0).lineTo(x, DESIGN_HEIGHT).stroke({ width: x % 480 === 0 ? 2 : 1, color: x % 480 === 0 ? 0x2e4643 : 0x213038, alpha: 0.72 });
  }
  for (let y = 0; y <= DESIGN_HEIGHT; y += 120) {
    grid.moveTo(0, y).lineTo(DESIGN_WIDTH, y).stroke({ width: y % 360 === 0 ? 2 : 1, color: y % 360 === 0 ? 0x2e4643 : 0x213038, alpha: 0.72 });
  }
  grid.moveTo(960, 0).lineTo(960, DESIGN_HEIGHT).stroke({ width: 2, color: 0x65d6ad, alpha: 0.55 });
  grid.moveTo(0, 540).lineTo(DESIGN_WIDTH, 540).stroke({ width: 2, color: 0x65d6ad, alpha: 0.55 });
  stage.addChild(grid);
}

function drawSelection(container, width, height) {
  const outline = new Graphics();
  outline.rect(0, 0, width, height).stroke({ width: 4, color: 0xffd166, alpha: 0.95 });
  container.addChild(outline);
  return outline;
}

function setSelectionOutline(container, width, height) {
  if (state.selectionOutline?.parent) state.selectionOutline.parent.removeChild(state.selectionOutline);
  state.selectionOutline = drawSelection(container, width, height);
}

function drawPlaceholder(container, node, width, height) {
  const box = new Graphics();
  box.rect(0, 0, width, height).fill({ color: 0x332126, alpha: 0.85 }).stroke({ width: 3, color: 0xff6b6b, alpha: 0.9 });
  container.addChild(box);
  const label = new Text({
    text: `${node.index}\n${displayFile(state.scene, node) || node.type}`,
    style: {
      fill: 0xffb0b0,
      fontFamily: 'Consolas, monospace',
      fontSize: 22,
      wordWrap: true,
      wordWrapWidth: Math.max(120, width - 24),
    },
  });
  label.x = 12;
  label.y = 12;
  container.addChild(label);
}

async function buildNode(scene, node, parentContainer, version) {
  if (version !== state.renderVersion) return null;
  const texture = await loadTextureForNode(scene, node);
  const [width, height] = await nodeSize(scene, node, texture);
  node.width = width;
  node.height = height;

  const container = new Container();
  container.sortableChildren = true;
  container.position.set(node.pos[0], node.pos[1]);
  const [ax, ay] = anchorVector(node.anchor);
  container.pivot.set(ax * width, ay * height);
  container.alpha = Math.max(0, Math.min(1, node.opacity / 255));
  container.scale.set(node.scaleX / 100, node.scaleY / 100);
  container.rotation = (node.rotate * Math.PI) / 180;
  container.zIndex = node.zorder;
  parentContainer.addChild(container);

  if (node.type === 'layer') {
    const layer = new Graphics();
    if (node.fillOpacity > 0) {
      layer.rect(0, 0, width, height).fill({ color: node.color, alpha: Math.max(0, Math.min(1, node.fillOpacity / 255)) });
    }
    container.addChild(layer);
  } else if (node.type === 'textsprite') {
    const label = new Text({
      text: node.text,
      style: {
        fill: node.textStyle.fill ?? 0xffffff,
        fontFamily: node.textStyle.fontFamily ?? 'Source Han Sans SC, Microsoft YaHei, sans-serif',
        fontSize: node.textStyle.fontSize ?? 28,
      },
    });
    container.addChild(label);
  } else if (texture) {
    const sprite = new Sprite(texture);
    sprite.position.set(0, 0);
    sprite.blendMode = node.blendMode;
    container.addChild(sprite);
  } else {
    drawPlaceholder(container, node, width, height);
  }

  if (String(node.index) === state.selectedIndex) setSelectionOutline(container, width, height);
  container.eventMode = 'static';
  container.cursor = 'move';
  container.hitArea = new Rectangle(0, 0, width, height);
  container.on('pointerdown', (event) => startDrag(node, container, parentContainer, event));

  for (const childIndex of node.children) {
    const child = scene.nodes.get(childIndex);
    if (child) await buildNode(scene, child, container, version);
  }
  return container;
}

async function renderScene() {
  if (!state.app || !state.scene) return;
  const version = ++state.renderVersion;
  const stage = state.app.stage;
  stage.removeChildren();
  stage.sortableChildren = true;
  drawBackground(stage);

  const basic = new Container();
  basic.sortableChildren = true;
  basic.zIndex = 10;
  stage.addChild(basic);
  for (const childIndex of state.scene.roots.get('basic_layer').children) {
    const child = state.scene.nodes.get(childIndex);
    if (child) await buildNode(state.scene, child, basic, version);
  }

  const message = new Container();
  message.sortableChildren = true;
  message.zIndex = 10000;
  stage.addChild(message);
  for (const childIndex of state.scene.roots.get('message_layer').children) {
    const child = state.scene.nodes.get(childIndex);
    if (child) await buildNode(state.scene, child, message, version);
  }
  stage.sortChildren();
  updateWarnings();
}

function updateWarnings() {
  const uniqueWarnings = [...new Set(state.scene?.warnings ?? [])].slice(0, 80);
  dom.warningList.innerHTML = uniqueWarnings.length
    ? uniqueWarnings.map((warning) => `<div class="warning-item"><strong>!</strong><span>${escapeHtml(warning)}</span></div>`).join('')
    : '<span>没有路径或语法警告。</span>';
}

function updateNodeList() {
  const nodes = [...(state.scene?.nodes.values() ?? [])].sort((a, b) => (a.parent || '').localeCompare(b.parent || '') || a.zorder - b.zorder || a.order - b.order);
  dom.nodeCount.textContent = String(nodes.length);
  dom.nodeList.innerHTML = '';
  for (const node of nodes) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `node-row${String(node.index) === state.selectedIndex ? ' active' : ''}`;
    row.innerHTML = `<span class="node-index">${escapeHtml(node.index)}</span><span class="node-file">${escapeHtml(displayFile(state.scene, node) || node.type)}</span><span class="node-z">z=${formatNumber(node.zorder)}</span>`;
    row.addEventListener('click', () => selectNode(node.index));
    dom.nodeList.appendChild(row);
  }
}

function updateInspector() {
  const node = state.scene?.nodes.get(String(state.selectedIndex));
  const disabled = !node;
  for (const input of dom.inspectorForm.elements) input.disabled = disabled || input.id === 'propIndex' || input.id === 'propFile';
  if (!node) {
    dom.selectedReadout.textContent = '未选择精灵';
    dom.propIndex.value = '';
    dom.propFile.value = '';
    return;
  }
  dom.selectedReadout.textContent = `index=${node.index} / ${displayFile(state.scene, node) || node.type}`;
  dom.propIndex.value = node.index;
  dom.propFile.value = displayFile(state.scene, node) || '';
  dom.propX.value = formatNumber(node.pos[0]);
  dom.propY.value = formatNumber(node.pos[1]);
  dom.propZ.value = formatNumber(node.zorder);
  dom.propOpacity.value = formatNumber(node.opacity);
  dom.propScaleX.value = formatNumber(node.scaleX);
  dom.propScaleY.value = formatNumber(node.scaleY);
  dom.propRotate.value = formatNumber(node.rotate);
  dom.propAnchor.value = typeof node.anchor === 'string' ? node.anchor : 'topleft';
}

function selectNode(index, options = {}) {
  state.selectedIndex = String(index);
  updateNodeList();
  updateInspector();
  if (options.render !== false) renderScene();
}

function startDrag(node, container, parentContainer, event) {
  event.stopPropagation();
  selectNode(node.index, { render: false });
  setSelectionOutline(container, node.width, node.height);
  const local = parentContainer.toLocal(event.global);
  state.drag = {
    node,
    container,
    parentContainer,
    offset: [local.x - node.pos[0], local.y - node.pos[1]],
    beforeSource: dom.scriptInput.value,
  };
  state.app.stage.eventMode = 'static';
  state.app.stage.hitArea = new Rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
  state.app.stage.on('pointermove', dragSelectedNode);
  state.app.stage.once('pointerup', stopDrag);
  state.app.stage.once('pointerupoutside', stopDrag);
}

function dragSelectedNode(event) {
  if (!state.drag) return;
  const { node, container, parentContainer, offset } = state.drag;
  const local = parentContainer.toLocal(event.global);
  node.pos = [Math.round(local.x - offset[0]), Math.round(local.y - offset[1])];
  container.position.set(node.pos[0], node.pos[1]);
  updateInspector();
  updateExport();
  updateSourceForNode(node);
}

function stopDrag() {
  if (!state.drag) return;
  const before = state.drag.beforeSource;
  const node = state.drag.node;
  state.app.stage.off('pointermove', dragSelectedNode);
  updateSourceForNode(node);
  pushHistory(before, dom.scriptInput.value);
  state.drag = null;
}

function updateSourceForNode(node) {
  const lines = dom.scriptInput.value.split(/\r?\n/);
  const addto = [...node.sourceCommands].reverse().find((item) => item.name === 'addto');
  const replacements = {
    pos: `pos=[${formatNumber(node.pos[0])},${formatNumber(node.pos[1])}]`,
    zorder: `zorder=${formatNumber(node.zorder)}`,
    opacity: `opacity=${formatNumber(node.opacity)}`,
  };
  if (addto && lines[addto.lineNumber - 1] !== undefined) {
    const line = lines[addto.lineNumber - 1];
    lines[addto.lineNumber - 1] = replaceOrAppendArgs(line, replacements);
  } else if (node.parent) {
    lines.push(`@addto index=${node.index} target=${node.parent} ${replacements.pos} ${replacements.zorder} ${replacements.opacity}`);
  }
  dom.scriptInput.value = lines.join('\n');
  syncHighlight();
}

function replaceOrAppendArgs(line, replacements) {
  let next = line;
  for (const [key, replacement] of Object.entries(replacements)) {
    const pattern = key === 'pos'
      ? /pos=\[[^\]]*\]/
      : new RegExp(`${key}=-?\\d+(?:\\.\\d+)?`);
    next = pattern.test(next) ? next.replace(pattern, replacement) : `${next} ${replacement}`;
  }
  return next;
}

function applyInspectorChange() {
  const node = state.scene?.nodes.get(String(state.selectedIndex));
  if (!node) return;
  node.pos = [numberOr(dom.propX.value, node.pos[0]), numberOr(dom.propY.value, node.pos[1])];
  node.zorder = numberOr(dom.propZ.value, node.zorder);
  node.opacity = Math.max(0, Math.min(255, numberOr(dom.propOpacity.value, node.opacity)));
  node.scaleX = numberOr(dom.propScaleX.value, node.scaleX);
  node.scaleY = numberOr(dom.propScaleY.value, node.scaleY);
  node.rotate = numberOr(dom.propRotate.value, node.rotate);
  node.anchor = dom.propAnchor.value;
  finalizeScene(state.scene);
  updateSourceForNode(node);
  updateNodeList();
  updateInspector();
  updateExport();
  renderScene();
}

function beginInspectorEdit() {
  state.inspectorBefore = dom.scriptInput.value;
}

function commitInspectorEdit() {
  if (!state.inspectorBefore) return;
  pushHistory(state.inspectorBefore, dom.scriptInput.value);
  state.inspectorBefore = null;
}

function pushHistory(before, after) {
  if (!before || before === after) return;
  state.history.undo.push(before);
  if (state.history.undo.length > state.history.limit) state.history.undo.shift();
  state.history.redo = [];
}

function restoreSource(source) {
  dom.scriptInput.value = source;
  refreshFromInput();
}

function undoLayoutEdit() {
  const previous = state.history.undo.pop();
  if (!previous) return;
  state.history.redo.push(dom.scriptInput.value);
  restoreSource(previous);
}

function redoLayoutEdit() {
  const next = state.history.redo.pop();
  if (!next) return;
  state.history.undo.push(dom.scriptInput.value);
  restoreSource(next);
}

function handleKeyboardShortcuts(event) {
  if (event.key === 'Escape') {
    closeSetupModal();
    closeHelpModal();
    return;
  }
  const isTextEditor = event.target === dom.scriptInput;
  if (!event.ctrlKey || isTextEditor) return;
  const key = event.key.toLowerCase();
  if (key === 'z' && !event.shiftKey) {
    event.preventDefault();
    undoLayoutEdit();
  } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
    event.preventDefault();
    redoLayoutEdit();
  }
}

function refreshFromInput() {
  syncHighlight();
  state.scene = parseScene(dom.scriptInput.value);
  if (state.selectedIndex && !state.scene.nodes.has(state.selectedIndex)) state.selectedIndex = null;
  dom.parseBadge.textContent = `${state.scene.commandCount} 条命令`;
  updateNodeList();
  updateInspector();
  updateExport();
  renderScene();
}

function exportScene(scene) {
  if (!scene) return '';
  const lines = [];
  const nodes = [...scene.nodes.values()].sort((a, b) => a.order - b.order);

  for (const node of nodes) {
    if (node.type === 'sprite') {
      lines.push(`@sprite index=${node.index} file="${displayFile(scene, node)}"${node.rect ? ` rect=[${node.rect.map(formatNumber).join(',')}]` : ''}`);
    } else if (node.type === 'button') {
      lines.push(`@button index=${node.index} idle="${node.buttonIdle}"${node.buttonHover ? ` hover="${node.buttonHover}"` : ''}${node.buttonClick ? ` click="${node.buttonClick}"` : ''}`);
    } else if (node.type === 'buttonex') {
      lines.push(`@buttonex index=${node.index} idle=${node.buttonIdleIndex}${node.buttonHover ? ` hover=${node.buttonHover}` : ''}${node.buttonClick ? ` click=${node.buttonClick}` : ''}`);
    } else if (node.type === 'textsprite') {
      lines.push(`@textsprite index=${node.index} text="${node.text}" color=0x${formatHexColor(node.textStyle.fill ?? 0xffffff)} size=${formatNumber(node.textStyle.fontSize ?? 28)}`);
    } else if (node.type === 'layer') {
      lines.push(`@layer index=${node.index} width=${formatNumber(node.width)} height=${formatNumber(node.height)} opacity=${formatNumber(node.fillOpacity)}`);
    }
    if (node.anchor !== 'topleft') lines.push(`@anchor index=${node.index} set="${node.anchor}"`);
  }

  const attached = nodes.filter((node) => node.parent);
  attached.sort((a, b) => a.order - b.order);
  if (attached.length) lines.push('');
  for (const node of attached) {
    lines.push(`@addto index=${node.index} target=${node.parent} pos=[${formatNumber(node.pos[0])},${formatNumber(node.pos[1])}] zorder=${formatNumber(node.zorder)} opacity=${formatNumber(node.opacity)}`);
    if (node.scaleX !== 100 || node.scaleY !== 100) {
      lines.push(`@action mode="scaleto" target=${node.index} x=${formatNumber(node.scaleX)} y=${formatNumber(node.scaleY)} time=0`);
    }
    if (node.rotate !== 0) {
      lines.push(`@action mode="rotateto" target=${node.index} rotate=${formatNumber(node.rotate)} time=0`);
    }
  }

  return lines.join('\n');
}

function updateExport() {
  dom.exportOutput.value = exportScene(state.scene);
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? '');
  if (Math.abs(number - Math.round(number)) < 0.0001) return String(Math.round(number));
  return String(Number(number.toFixed(3)));
}

function formatHexColor(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'ffffff';
  return Math.max(0, Math.min(0xffffff, Math.round(number))).toString(16).padStart(6, '0');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function highlightCode(source) {
  return source
    .split(/\r?\n/)
    .map((line) => {
      const commentIndex = findCommentStart(line);
      const code = commentIndex === -1 ? line : line.slice(0, commentIndex);
      const comment = commentIndex === -1 ? '' : line.slice(commentIndex);
      let html = highlightCodePart(code);
      if (comment) html += `<span class="tok-comment">${escapeHtml(comment)}</span>`;
      return html || ' ';
    })
    .join('\n');
}

function highlightCodePart(code) {
  let html = '';
  let cursor = 0;
  const stringPattern = /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g;
  for (const match of code.matchAll(stringPattern)) {
    html += highlightPlain(code.slice(cursor, match.index));
    html += `<span class="tok-string">${escapeHtml(match[0])}</span>`;
    cursor = match.index + match[0].length;
  }
  html += highlightPlain(code.slice(cursor));
  return html;
}

function highlightPlain(text) {
  const tokenPattern = /(@|\[)([A-Za-z_][\w]*)|\b([A-Za-z_][\w]*)(=)|(^|[^\w])(-?\d+(?:\.\d+)?)(?![\w])/g;
  let html = '';
  let cursor = 0;
  for (const match of text.matchAll(tokenPattern)) {
    html += escapeHtml(text.slice(cursor, match.index));
    if (match[2]) {
      html += `${escapeHtml(match[1])}<span class="tok-cmd">${escapeHtml(match[2])}</span>`;
    } else if (match[3]) {
      html += `<span class="tok-param">${escapeHtml(match[3])}</span>${escapeHtml(match[4])}`;
    } else {
      html += `${escapeHtml(match[5])}<span class="tok-number">${escapeHtml(match[6])}</span>`;
    }
    cursor = match.index + match[0].length;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
}

function findCommentStart(line) {
  let quote = '';
  for (let i = 0; i < line.length - 1; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '/' && line[i + 1] === '/') return i;
  }
  return -1;
}

function syncHighlight() {
  dom.highlightLayer.innerHTML = highlightCode(dom.scriptInput.value);
  dom.highlightLayer.scrollTop = dom.scriptInput.scrollTop;
  dom.highlightLayer.scrollLeft = dom.scriptInput.scrollLeft;
}

function debounce(fn, wait = 160) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败：${response.status}`);
  return payload;
}

async function copyExport() {
  await navigator.clipboard.writeText(dom.exportOutput.value);
}

function downloadPng() {
  if (!state.app) return;
  state.app.renderer.render(state.app.stage);
  const dataUrl = state.app.canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `bke-layout-preview-${Date.now()}.png`;
  link.click();
}

function setupPointerReadout() {
  state.app.canvas.addEventListener('mousemove', (event) => {
    const rect = state.app.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * DESIGN_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * DESIGN_HEIGHT;
    dom.cursorReadout.textContent = `x=${Math.round(x)} y=${Math.round(y)}`;
  });
}

function startLayoutResize(side, handle, event) {
  const rect = dom.workspace.getBoundingClientRect();
  state.layoutResize = {
    side,
    handle,
    rect,
    startX: event.clientX,
    left: rect.width * 0.27,
    right: rect.width * 0.24,
  };
  const computed = getComputedStyle(dom.workspace);
  const leftValue = computed.getPropertyValue('--left-panel').trim();
  const rightValue = computed.getPropertyValue('--right-panel').trim();
  const leftMatch = leftValue.match(/(\d+(?:\.\d+)?)px/);
  const rightMatch = rightValue.match(/(\d+(?:\.\d+)?)px/);
  if (leftMatch) state.layoutResize.left = Number(leftMatch[1]);
  if (rightMatch) state.layoutResize.right = Number(rightMatch[1]);
  handle.classList.add('dragging');
  document.body.classList.add('resizing-layout');
  window.addEventListener('pointermove', resizeLayout);
  window.addEventListener('pointerup', stopLayoutResize, { once: true });
}

function resizeLayout(event) {
  if (!state.layoutResize) return;
  const { side, rect, startX, left, right } = state.layoutResize;
  const delta = event.clientX - startX;
  const minSide = 300;
  const minPreview = 560;
  const maxSide = Math.max(minSide, rect.width - minPreview - 360);
  if (side === 'left') {
    const width = clamp(left + delta, minSide, maxSide);
    dom.workspace.style.setProperty('--left-panel', `${Math.round(width)}px`);
  } else {
    const width = clamp(right - delta, minSide, maxSide);
    dom.workspace.style.setProperty('--right-panel', `${Math.round(width)}px`);
  }
}

function stopLayoutResize() {
  if (!state.layoutResize) return;
  state.layoutResize.handle.classList.remove('dragging');
  document.body.classList.remove('resizing-layout');
  window.removeEventListener('pointermove', resizeLayout);
  state.layoutResize = null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function initPixi() {
  const app = new Application();
  await app.init({
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    backgroundAlpha: 1,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  state.app = app;
  dom.viewport.appendChild(app.canvas);
  setupPointerReadout();
}

function applyProjectInfo(info) {
  state.projectInfo = info;
  const [width, height] = Array.isArray(info.resolution) ? info.resolution : [1920, 1080];
  DESIGN_WIDTH = Number(width) || 1920;
  DESIGN_HEIGHT = Number(height) || 1080;
  if (state.app) state.app.renderer.resize(DESIGN_WIDTH, DESIGN_HEIGHT);

  const paths = (info.imageSearchPaths ?? []).join(' / ');
  const mode = info.usingSample ? '内置示例' : '当前项目';
  dom.projectInfo.textContent = `${DESIGN_WIDTH}×${DESIGN_HEIGHT} / ${mode} / ${info.projectRoot} / ${paths}`;
}

async function loadProjectInfo() {
  try {
    const [settings, projectInfo] = await Promise.all([
      apiJson('/api/settings'),
      apiJson('/api/project-info'),
    ]);
    state.settings = settings;
    applyProjectInfo(projectInfo);
    dom.projectRootInput.value = settings.savedProjectRoot || settings.projectRoot || '';
  } catch (error) {
    dom.projectInfo.textContent = `1920×1080 / 未能读取项目配置：${error.message}`;
  }
}

async function loadSampleScript() {
  try {
    const payload = await apiJson('/api/sample-script');
    state.sampleScript = payload.text || FALLBACK_SAMPLE_SCRIPT;
  } catch {
    state.sampleScript = FALLBACK_SAMPLE_SCRIPT;
  }
}

function openSetupModal() {
  dom.setupError.textContent = '';
  dom.projectRootInput.value = state.settings?.savedProjectRoot || state.settings?.projectRoot || '';
  dom.setupModal.classList.remove('hidden');
  window.setTimeout(() => dom.projectRootInput.focus(), 0);
}

function closeSetupModal() {
  dom.setupModal.classList.add('hidden');
}

function openHelpModal() {
  dom.helpModal.classList.remove('hidden');
}

function closeHelpModal() {
  dom.helpModal.classList.add('hidden');
}

async function saveProjectSettings(useSample = false) {
  dom.setupError.textContent = '';
  try {
    await apiJson('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        projectRoot: dom.projectRootInput.value,
        useSample,
      }),
    });
    state.imageResolveCache.clear();
    await loadProjectInfo();
    if (useSample) {
      await loadSampleScript();
      dom.scriptInput.value = state.sampleScript;
      syncHighlight();
    }
    closeSetupModal();
    refreshFromInput();
  } catch (error) {
    dom.setupError.textContent = error.message;
  }
}

async function browseProjectDirectory() {
  dom.setupError.textContent = '';
  try {
    const payload = await apiJson('/api/pick-directory');
    if (payload.ok && payload.projectRoot) dom.projectRootInput.value = payload.projectRoot;
    else if (!payload.cancelled) dom.setupError.textContent = payload.error || '没有选择目录';
  } catch (error) {
    dom.setupError.textContent = error.message;
  }
}

function bindEvents() {
  const debouncedRefresh = debounce(refreshFromInput);
  dom.scriptInput.addEventListener('input', () => {
    syncHighlight();
    debouncedRefresh();
  });
  dom.scriptInput.addEventListener('scroll', syncHighlight);
  dom.renderBtn.addEventListener('click', refreshFromInput);
  dom.projectBtn.addEventListener('click', openSetupModal);
  dom.loadSampleBtn.addEventListener('click', () => {
    dom.scriptInput.value = state.sampleScript;
    refreshFromInput();
  });
  dom.gridToggle.addEventListener('change', renderScene);
  dom.copyBtn.addEventListener('click', copyExport);
  dom.pngBtn.addEventListener('click', downloadPng);
  dom.helpBtn.addEventListener('click', openHelpModal);
  dom.setupCloseBtn.addEventListener('click', closeSetupModal);
  dom.helpCloseBtn.addEventListener('click', closeHelpModal);
  dom.saveSettingsBtn.addEventListener('click', () => saveProjectSettings(false));
  dom.useSampleBtn.addEventListener('click', () => saveProjectSettings(true));
  dom.browseProjectBtn.addEventListener('click', browseProjectDirectory);
  dom.setupModal.addEventListener('click', (event) => {
    if (event.target === dom.setupModal) closeSetupModal();
  });
  dom.helpModal.addEventListener('click', (event) => {
    if (event.target === dom.helpModal) closeHelpModal();
  });
  window.addEventListener('keydown', handleKeyboardShortcuts);
  for (const handle of document.querySelectorAll('.resize-handle')) {
    handle.addEventListener('pointerdown', (event) => startLayoutResize(handle.dataset.resize, handle, event));
  }
  for (const input of [dom.propX, dom.propY, dom.propZ, dom.propOpacity, dom.propScaleX, dom.propScaleY, dom.propRotate, dom.propAnchor]) {
    input.addEventListener('focusin', beginInspectorEdit);
    input.addEventListener('focusout', commitInspectorEdit);
    input.addEventListener('input', applyInspectorChange);
    input.addEventListener('change', applyInspectorChange);
  }
}

async function boot() {
  bindEvents();
  await loadProjectInfo();
  await Promise.all([initPixi(), loadSampleScript()]);
  dom.scriptInput.value = state.sampleScript;
  refreshFromInput();
  if (state.settings?.needsSetup) openSetupModal();
}

boot();
