export const ROOTS = new Set(['basic_layer', 'message_layer']);

export const ANCHORS = {
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

const DEFAULT_DESIGN_WIDTH = 1920;
const DEFAULT_DESIGN_HEIGHT = 1080;

function parserOptions(options = {}) {
  return {
    designWidth: Number(options.designWidth) || DEFAULT_DESIGN_WIDTH,
    designHeight: Number(options.designHeight) || DEFAULT_DESIGN_HEIGHT,
  };
}

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

export function createScene(options = {}) {
  const { designWidth, designHeight } = parserOptions(options);
  const basic = createNode('basic_layer', 'root');
  basic.width = designWidth;
  basic.height = designHeight;
  basic.parent = '__stage__';
  basic.order = -2;

  const message = createNode('message_layer', 'root');
  message.width = designWidth;
  message.height = designHeight;
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
    options: { designWidth, designHeight },
  };
}

export function ensureNode(scene, index, type = 'sprite') {
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

export function lineWithoutComment(line) {
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

export function normalizeCommandLine(line) {
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

export function parseCommand(line, scene = null) {
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

export function parseValue(rawValue, variables = null) {
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
  if (!raw.includes('+')) return null;
  const parts = splitPlus(raw);
  let out = '';
  let sawStringPart = false;
  for (const part of parts) {
    const trimmed = part.trim();
    if (/^(['"]).*\1$/.test(trimmed)) {
      out += trimmed.slice(1, -1);
      sawStringPart = true;
    }
    else {
      const value = resolveVariableValue(trimmed, variables);
      if (value === undefined || Array.isArray(value)) return null;
      if (typeof value === 'string') sawStringPart = true;
      out += String(value);
    }
  }
  return sawStringPart ? out : null;
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

export function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function applyCommand(scene, command, lineNumber) {
  const { name, args, raw } = command;
  const { designWidth, designHeight } = scene.options ?? parserOptions();
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
    node.width = numberOr(args.width, designWidth);
    node.height = numberOr(args.height, designHeight);
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

export function finalizeScene(scene) {
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

export function parseScene(script, options = {}) {
  const scene = createScene(options);
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

export function displayFile(scene, node) {
  if (node.type === 'buttonex') {
    const idleNode = scene.nodes.get(node.buttonIdleIndex);
    return idleNode ? displayFile(scene, idleNode) : '';
  }
  return node.file || node.buttonIdle || '';
}

export function exportScene(scene) {
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

export function formatNumber(value) {
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
