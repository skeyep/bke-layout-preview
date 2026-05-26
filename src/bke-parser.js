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
const LOOP_LIMIT = 200;
const IDENTIFIER_PATTERN = '[A-Za-z_$#]\\w*(?:\\.[A-Za-z_$#]\\w*)*';
const IDENTIFIER_RE = new RegExp(`^(${IDENTIFIER_PATTERN})((?:\\[[^\\]]+\\])*)$`);

export const WARNING_LEVELS = {
  info: '无视觉影响',
  layout: '可能影响布局',
  unsupported: '不支持',
};

function addWarning(scene, level, message) {
  const label = WARNING_LEVELS[level] ?? WARNING_LEVELS.unsupported;
  const text = `${label}：${message}`;
  scene.warnings.push(text);
  scene.warningItems.push({ level, label, message, text });
}

function addCommandNotice(scene, level, name, lineNumber, detail) {
  const key = `${level}:${name}:${detail}`;
  const previous = scene.commandNotices.get(key);
  if (previous) {
    previous.count += 1;
    return;
  }
  scene.commandNotices.set(key, {
    level,
    name,
    firstLine: lineNumber,
    count: 1,
    detail,
  });
}

function flushCommandNotices(scene) {
  if (scene.commandNoticesFlushed) return;
  scene.commandNoticesFlushed = true;
  for (const notice of scene.commandNotices.values()) {
    const suffix = notice.count > 1 ? `，共 ${notice.count} 次` : '';
    addWarning(scene, notice.level, `第 ${notice.firstLine} 行起 @${notice.name} ${notice.detail}${suffix}`);
  }
}

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
    visible: true,
    disabled: false,
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

function rememberSource(node, name, raw, lineNumber, args = null, rawArgs = null) {
  node.sourceLines.push(raw);
  node.sourceCommands.push({ name, lineNumber, args, rawArgs });
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
    warningItems: [],
    commandNotices: new Map(),
    commandNoticesFlushed: false,
    commandCount: 0,
    defined: new Map(),
    variables: new Map(),
    variableSources: new Map(),
    textStyles: new Map(),
    currentTextStyle: {},
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
    if (char === '[' || char === '(') {
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
  const rawArgs = {};
  let i = 0;

  while (i < rest.length) {
    while (i < rest.length && /\s/.test(rest[i])) i += 1;
    const keyStart = i;
    while (i < rest.length && /[A-Za-z0-9_]/.test(rest[i])) i += 1;
    const key = rest.slice(keyStart, i).toLowerCase();
    if (!key) break;
    while (i < rest.length && /\s/.test(rest[i])) i += 1;
    if (rest[i] !== '=') {
      args[key] = true;
      rawArgs[key] = 'true';
      continue;
    }
    i += 1;
    while (i < rest.length && /\s/.test(rest[i])) i += 1;
    const [raw, next] = readValue(rest, i);
    args[key] = parseValue(raw, scene?.variables);
    rawArgs[key] = raw;
    i = next;
  }

  return { name, args, rawArgs, rawRest: rest, raw: line };
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
  if (/^true$/i.test(raw)) return true;
  if (/^false$/i.test(raw)) return false;
  if (/^null$/i.test(raw)) return null;
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return splitTopLevel(raw.slice(1, -1)).map((part) => parseValue(part, variables));
  }

  const variableValue = resolveVariableValue(raw, variables);
  if (variableValue !== undefined) return variableValue;

  const stringConcat = parseStringConcat(raw, variables);
  if (stringConcat !== null) return stringConcat;

  if (isQuotedLiteral(raw)) return unquoteString(raw);

  const numeric = parseNumericWithVariables(raw, variables);
  if (Number.isFinite(numeric)) return numeric;
  return raw;
}

function resolveVariableValue(raw, variables) {
  if (!variables || !variables.size) return undefined;
  let text = String(raw).trim();
  let property = '';
  const propertyMatch = text.match(/^(.+)\.(length|size)$/i);
  if (propertyMatch) {
    text = propertyMatch[1].trim();
    property = propertyMatch[2].toLowerCase();
  }
  const parts = text.match(IDENTIFIER_RE);
  if (!parts) return undefined;
  const variableName = normalizeVariableName(parts[1]);
  if (!variables.has(variableName)) return undefined;
  let value = variables.get(variableName);
  const accessors = [...parts[2].matchAll(/\[([^\]]+)\]/g)].map((match) => match[1].trim());
  for (const accessor of accessors) {
    const directKey = Number(accessor);
    const expressionKey = parseNumericWithVariables(accessor, variables);
    const key = Number.isInteger(directKey) ? directKey : Number.isInteger(expressionKey) ? expressionKey : resolveVariableValue(accessor, variables);
    if (Array.isArray(value) && Number.isInteger(key)) {
      const index = key < 0 ? value.length + key : key;
      value = value[index];
    } else if (value && typeof value === 'object' && key !== undefined) {
      value = value[key];
    } else return undefined;
  }
  if (property === 'length' || property === 'size') return Array.isArray(value) || typeof value === 'string' ? value.length : undefined;
  return value;
}

function normalizeVariableName(name) {
  return String(name ?? '').trim().replace(/^[$#]/, '').replace(/^global\./i, '');
}

function isQuotedLiteral(raw) {
  const quote = raw[0];
  if (quote !== '"' && quote !== "'") return false;
  let escaped = false;
  for (let i = 1; i < raw.length; i += 1) {
    const char = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === quote) return i === raw.length - 1;
  }
  return false;
}

function unquoteString(raw) {
  return raw
    .slice(1, -1)
    .replace(/\\(["'\\nrt])/g, (_match, char) => {
      if (char === 'n') return '\n';
      if (char === 'r') return '\r';
      if (char === 't') return '\t';
      return char;
    });
}

function parseStringConcat(raw, variables = null) {
  if (!raw.includes('+')) return null;
  const parts = splitPlus(raw);
  let out = '';
  let sawStringPart = false;
  for (const part of parts) {
    const trimmed = part.trim();
    if (isQuotedLiteral(trimmed)) {
      out += unquoteString(trimmed);
      sawStringPart = true;
    }
    else {
      let value = resolveVariableValue(trimmed, variables);
      if (value === undefined) {
        const numeric = parseNumericWithVariables(trimmed, variables);
        if (Number.isFinite(numeric)) value = numeric;
      }
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
  let depth = 0;
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
    if (char === '[' || char === '(') {
      depth += 1;
      continue;
    }
    if (char === ']' || char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === '+' && depth === 0) {
      parts.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts;
}

function parseNumeric(raw) {
  const text = String(raw).trim()
    .replace(/\bint\s*\(/g, 'Math.trunc(')
    .replace(/\bfloor\s*\(/g, 'Math.floor(')
    .replace(/\bceil\s*\(/g, 'Math.ceil(')
    .replace(/\bround\s*\(/g, 'Math.round(');
  if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(2), 16);
  if (!/^[0-9+\-*/%().,\sA-Za-z]+$/.test(text)) return NaN;
  if (/[A-Za-z]/.test(text) && !/^(?:[0-9+\-*/%().,\s]|Math|trunc|floor|ceil|round)+$/.test(text)) return NaN;
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

  return parseNumeric(substituteNumericVariables(raw, variables));
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

function booleanOr(value, fallback) {
  if (value === true || value === false) return value;
  if (/^true$/i.test(String(value))) return true;
  if (/^false$/i.test(String(value))) return false;
  return fallback;
}

function firstArg(args, names) {
  for (const name of names) {
    const key = name.toLowerCase();
    if (args[key] !== undefined) return args[key];
  }
  return undefined;
}

function textStyleFromArgs(args, base = {}) {
  const next = { ...base };
  const color = firstArg(args, ['color', 'fill']);
  const size = firstArg(args, ['size', 'fontsize', 'font_size']);
  const font = firstArg(args, ['font', 'fontface', 'fontname', 'face']);
  const align = firstArg(args, ['align', 'textalign']);
  const bold = firstArg(args, ['bold']);
  const italic = firstArg(args, ['italic']);
  if (color !== undefined) next.fill = numberOr(color, next.fill ?? 0xffffff);
  if (size !== undefined) next.fontSize = numberOr(size, next.fontSize ?? 28);
  if (font !== undefined) next.fontFamily = String(font);
  if (align !== undefined) next.align = String(align);
  if (bold !== undefined) next.fontWeight = booleanOr(bold, false) ? '700' : '400';
  if (italic !== undefined) next.fontStyle = booleanOr(italic, false) ? 'italic' : 'normal';
  return next;
}

function applyNodeBoxArgs(node, args) {
  if (args.width !== undefined) node.width = numberOr(args.width, node.width);
  if (args.height !== undefined) node.height = numberOr(args.height, node.height);
}

function applySpriteOptions(scene, args, raw, lineNumber) {
  const nodes = targetNodes(scene, args.index ?? args.target);
  if (!nodes.length) {
    addWarning(scene, 'layout', `第 ${lineNumber} 行 @spriteopt 缺少 index 或 target`);
    return;
  }
  for (const node of nodes) {
    if (args.disable !== undefined || args.disabled !== undefined) {
      node.disabled = booleanOr(args.disable ?? args.disabled, node.disabled);
    }
    if (args.visible !== undefined || args.show !== undefined) {
      node.visible = booleanOr(args.visible ?? args.show, node.visible);
    }
    if (args.hide !== undefined) {
      const hide = booleanOr(args.hide, false);
      if (hide !== false) node.visible = !hide;
    }
    if (args.opacity !== undefined || args.alpha !== undefined) {
      node.opacity = numberOr(args.opacity ?? args.alpha, node.opacity);
    }
    if (args.zorder !== undefined || args.z !== undefined) {
      node.zorder = numberOr(args.zorder ?? args.z, node.zorder);
    }
    if (args.pos !== undefined) node.pos = toPoint(args.pos, node.pos);
    if (args.x !== undefined) node.pos = [numberOr(args.x, node.pos[0]), node.pos[1]];
    if (args.y !== undefined) node.pos = [node.pos[0], numberOr(args.y, node.pos[1])];
    if (args.scalex !== undefined || args.xscale !== undefined) node.scaleX = numberOr(args.scalex ?? args.xscale, node.scaleX);
    if (args.scaley !== undefined || args.yscale !== undefined) node.scaleY = numberOr(args.scaley ?? args.yscale, node.scaleY);
    if (args.scale !== undefined) {
      const scale = numberOr(args.scale, null);
      if (scale !== null) {
        node.scaleX = scale;
        node.scaleY = scale;
      }
    }
    if (args.rotate !== undefined || args.rotation !== undefined) node.rotate = numberOr(args.rotate ?? args.rotation, node.rotate);
    rememberSource(node, 'spriteopt', raw, lineNumber);
  }
}

const PASSIVE_COMMANDS = new Map([
  ['macro', '宏定义不影响当前静态画面'],
  ['return', '返回流程已忽略，预览继续按文本顺序解析'],
  ['wait', '等待指令不改变静态布局'],
  ['waitbutton', '等待按钮输入不改变静态布局'],
  ['quake', '震屏效果在静态预览中忽略'],
  ['pretrans', '转场准备不改变当前静态布局'],
  ['trans', '转场动画在静态预览中忽略'],
  ['savepoint', '存档点不改变静态布局'],
  ['save', '存档指令不改变静态布局'],
  ['waitaction', '等待动画完成不改变静态布局'],
  ['preload', '预载资源不改变静态布局'],
  ['textoff', '文本隐藏指令暂不影响布局预览'],
]);

const FLOW_COMMANDS = new Map([
  ['if', '条件分支未执行，后续视觉指令会按文本顺序解析'],
  ['elseif', '条件分支未执行，后续视觉指令会按文本顺序解析'],
  ['else', '条件分支未执行，后续视觉指令会按文本顺序解析'],
  ['endif', '条件分支未执行，后续视觉指令会按文本顺序解析'],
  ['call', '脚本调用未展开，外部脚本中的布局可能缺失'],
  ['jump', '跳转流程未执行，预览继续按文本顺序解析'],
  ['goto', '跳转流程未执行，预览继续按文本顺序解析'],
]);

const UNSUPPORTED_COMMANDS = new Map([
  ['particle', '粒子效果暂不渲染'],
  ['video', '视频/影片暂不渲染'],
  ['movie', '视频/影片暂不渲染'],
  ['mask', '遮罩效果暂不渲染'],
  ['filter', '滤镜效果暂不渲染'],
]);

export function applyCommand(scene, command, lineNumber) {
  const { name, args, rawArgs, raw } = command;
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
    node.textStyle = textStyleFromArgs(args, {
      fill: 0xffffff,
      fontFamily: 'Source Han Sans SC, Microsoft YaHei, sans-serif',
      fontSize: 28,
      ...scene.currentTextStyle,
      ...node.textStyle,
    });
    applyNodeBoxArgs(node, args);
    rememberSource(node, name, raw, lineNumber);
    return;
  }

  if (name === 'textstyle') {
    const target = args.index ?? args.target;
    const style = textStyleFromArgs(args, scene.currentTextStyle);
    applyNodeBoxArgs(style, args);
    if (args.name !== undefined || args.id !== undefined) {
      scene.textStyles.set(String(args.name ?? args.id), style);
    }
    if (target !== undefined && target !== '') {
      for (const node of targetNodes(scene, target)) {
        node.textStyle = textStyleFromArgs(args, node.textStyle);
        applyNodeBoxArgs(node, args);
        rememberSource(node, name, raw, lineNumber);
      }
    } else {
      scene.currentTextStyle = style;
    }
    return;
  }

  if (name === 'nametext') {
    const target = args.index ?? args.target;
    const text = args.text ?? args.name ?? args.value;
    if (target !== undefined && target !== '') {
      for (const node of targetNodes(scene, target)) {
        node.type = 'textsprite';
        if (text !== undefined) node.text = String(text);
        node.textStyle = textStyleFromArgs(args, {
          fill: 0xffffff,
          fontFamily: 'Source Han Sans SC, Microsoft YaHei, sans-serif',
          fontSize: 28,
          ...scene.currentTextStyle,
          ...node.textStyle,
        });
        applyNodeBoxArgs(node, args);
        rememberSource(node, name, raw, lineNumber);
      }
    } else {
      addCommandNotice(scene, 'layout', name, lineNumber, '会改变姓名文本，但没有 index/target，无法定位到预览节点');
    }
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
    rememberSource(node, name, raw, lineNumber, args, rawArgs);
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
    if (node) removeNode(scene, node, booleanOr(args.delete, false), booleanOr(args.recursive, false));
    return;
  }

  if (name === 'removeall') {
    removeChildren(scene, index, booleanOr(args.delete, false), booleanOr(args.recursive, false));
    return;
  }

  if (name === 'spriteopt') {
    applySpriteOptions(scene, args, raw, lineNumber);
    return;
  }

  if (PASSIVE_COMMANDS.has(name)) {
    addCommandNotice(scene, 'info', name, lineNumber, PASSIVE_COMMANDS.get(name));
    return;
  }

  if (FLOW_COMMANDS.has(name)) {
    addCommandNotice(scene, 'layout', name, lineNumber, FLOW_COMMANDS.get(name));
    return;
  }

  if (UNSUPPORTED_COMMANDS.has(name)) {
    addCommandNotice(scene, 'unsupported', name, lineNumber, UNSUPPORTED_COMMANDS.get(name));
    return;
  }

  addWarning(scene, 'unsupported', `第 ${lineNumber} 行暂未模拟 @${name}`);
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
    removeall: ['index'],
  }[name];

  if (required) {
    for (const key of required) {
      if (args[key] === undefined || args[key] === '') {
        addWarning(scene, 'layout', `第 ${lineNumber} 行 @${name} 缺少 ${key}`);
      }
    }
  }

  if (['sprite', 'button', 'buttonex', 'textsprite', 'layer'].includes(name) && args.index !== undefined) {
    const key = toIndex(args.index);
    const previous = scene.defined.get(key);
    if (previous) addWarning(scene, 'layout', `第 ${lineNumber} 行 index=${key} 重复定义，前一次在第 ${previous} 行`);
    scene.defined.set(key, lineNumber);
  }

  if (name === 'action') {
    const mode = String(args.mode ?? '').toLowerCase();
    const supported = ['moveto', 'moveby', 'fadeto', 'scaleto', 'scaleby', 'rotateto', 'rotatezto', 'rotateby', 'rotatezby'];
    if (mode && !supported.includes(mode)) addWarning(scene, 'layout', `第 ${lineNumber} 行暂未模拟 action mode="${mode}"`);
  }
}

function targetNodes(scene, target) {
  if (Array.isArray(target)) return target.map((item) => ensureNode(scene, item));
  if (target === undefined || target === null || target === '') return [];
  return [ensureNode(scene, target)];
}

function childNodesOf(scene, parentIndex) {
  const key = String(parentIndex);
  return [...scene.nodes.values()].filter((node) => node.parent === key);
}

function removeNode(scene, node, deleteNode = false, recursive = false) {
  if (!node) return;
  const children = childNodesOf(scene, node.index);
  for (const child of children) {
    if (recursive) removeNode(scene, child, deleteNode, true);
    else child.parent = '';
  }
  node.parent = '';
  if (deleteNode) scene.nodes.delete(node.index);
}

function removeChildren(scene, parentIndex, deleteChildren = false, recursive = false) {
  for (const child of childNodesOf(scene, parentIndex)) {
    removeNode(scene, child, deleteChildren, recursive);
  }
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
  if (node.visible === false) return false;
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
    else if (node.parent) addWarning(scene, 'layout', `index=${node.index} 的 target=${node.parent} 不存在`);
  }
  for (const node of scene.nodes.values()) {
    if (!node.parent && nodeHasVisibleTree(scene, node)) {
      scene.roots.get('basic_layer').children.push(node.index);
      addWarning(scene, 'layout', `index=${node.index} 没有 @addto 到舞台；已临时放到 basic_layer 预览`);
    }
  }
  for (const node of [...scene.roots.values(), ...scene.nodes.values()]) {
    node.children.sort((a, b) => {
      const an = scene.nodes.get(a) ?? scene.roots.get(a);
      const bn = scene.nodes.get(b) ?? scene.roots.get(b);
      return (an.zorder - bn.zorder) || (an.order - bn.order);
    });
  }
  flushCommandNotices(scene);
  return scene;
}

function parseVariableAssignment(line, variables) {
  const cleaned = lineWithoutComment(line).trim().replace(/^#\s*/, '');
  if (!cleaned || cleaned.startsWith('@')) return null;
  const match = cleaned.match(new RegExp(`^(?:(?:var|let|const)\\s+)?(${IDENTIFIER_PATTERN})(?:\\s*:\\s*[A-Za-z_]\\w*)?\\s*=\\s*(.+?)\\s*;?$`));
  if (!match) return null;
  const raw = match[2].replace(/;\s*$/, '').trim();
  const value = parseValue(raw, variables);
  return { name: normalizeVariableName(match[1]), value, raw };
}

function collectBagelVariable(scene, line, lineNumber) {
  const assignment = parseVariableAssignment(line, scene.variables);
  if (!assignment) return;
  if (assignment.value !== assignment.raw) {
    scene.variables.set(assignment.name, assignment.value);
    scene.variableSources.set(assignment.name, { lineNumber, raw: assignment.raw });
  }
}

function cleanControlLine(line) {
  return lineWithoutComment(line).trim().replace(/^@/, '').trim();
}

function isForLine(line) {
  return /^for\b/i.test(cleanControlLine(line));
}

function isNextLine(line) {
  return /^next\b/i.test(cleanControlLine(line));
}

function parseForHeader(scene, line, lineNumber) {
  const cleaned = cleanControlLine(line);
  const match = cleaned.match(/^for\b\s*(.*)$/i);
  if (!match) return null;
  let header = match[1].trim();
  if (header.startsWith('(') && header.endsWith(')')) header = header.slice(1, -1).trim();

  const rangeMatch = header.match(/^var\s*=\s*([A-Za-z_]\w*)\s+range\s*=\s*(.+)$/i);
  if (rangeMatch) {
    const values = parseRangeValues(rangeMatch[2], scene.variables);
    if (!values) {
      addWarning(scene, 'layout', `第 ${lineNumber} 行 for range 边界无法解析`);
      return null;
    }
    return {
      variable: rangeMatch[1],
      values,
    };
  }

  const toMatch = header.match(/^(?:var\s+)?([A-Za-z_]\w*)\s*=\s*(.+?)\s+to\s+(.+?)(?:\s+step\s+(.+))?$/i);
  if (toMatch) {
    const start = parseNumericWithVariables(toMatch[2], scene.variables);
    const end = parseNumericWithVariables(toMatch[3], scene.variables);
    const stepValue = toMatch[4] !== undefined ? parseNumericWithVariables(toMatch[4], scene.variables) : (start <= end ? 1 : -1);
    if (![start, end, stepValue].every(Number.isFinite) || stepValue === 0) {
      addWarning(scene, 'layout', `第 ${lineNumber} 行 for/next 循环边界无法解析`);
      return null;
    }
    return {
      variable: toMatch[1],
      start,
      condition: (value) => (stepValue > 0 ? value <= end : value >= end),
      next: (value) => value + stepValue,
    };
  }

  const semiMatch = header.match(/^(?:var\s+)?([A-Za-z_]\w*)\s*=\s*(.+?)\s*;\s*(.+?)\s*;\s*(.+)$/);
  if (semiMatch) {
    const start = parseNumericWithVariables(semiMatch[2], scene.variables);
    if (!Number.isFinite(start)) {
      addWarning(scene, 'layout', `第 ${lineNumber} 行 for 初始值无法解析`);
      return null;
    }
    return {
      variable: semiMatch[1],
      start,
      condition: () => evaluateLoopCondition(semiMatch[3], scene.variables),
      next: (value) => advanceLoopValue(semiMatch[4], semiMatch[1], value, scene.variables),
    };
  }

  addWarning(scene, 'layout', `第 ${lineNumber} 行 for/next 循环格式暂不支持`);
  return null;
}

function parseRangeValues(raw, variables) {
  const text = String(raw ?? '').trim();
  const match = text.match(/^range\s*\((.*)\)$/i);
  if (!match) return null;
  const parts = splitTopLevel(match[1]);
  if (parts.length < 1 || parts.length > 3) return null;
  const start = parts.length === 1 ? 0 : parseNumericWithVariables(parts[0], variables);
  const end = parts.length === 1 ? parseNumericWithVariables(parts[0], variables) : parseNumericWithVariables(parts[1], variables);
  const step = parts.length === 3 ? parseNumericWithVariables(parts[2], variables) : (start <= end ? 1 : -1);
  if (![start, end, step].every(Number.isFinite) || step === 0) return null;
  const values = [];
  if (step > 0) {
    for (let value = start; value < end && values.length < LOOP_LIMIT; value += step) values.push(value);
  } else {
    for (let value = start; value > end && values.length < LOOP_LIMIT; value += step) values.push(value);
  }
  return values;
}

function evaluateLoopCondition(raw, variables) {
  const expression = substituteNumericVariables(raw, variables);
  if (!/^[0-9+\-*/().<>=!&|\s]+$/.test(expression)) return false;
  try {
    return Boolean(Function(`"use strict"; return (${expression});`)());
  } catch {
    return false;
  }
}

function substituteNumericVariables(raw, variables) {
  if (!variables || !variables.size) return String(raw).trim();
  return String(raw).trim().replace(/[A-Za-z_$#]\w*(?:\.[A-Za-z_$#]\w*)*(?:\[[^\]]+\])*(?:\.(?:length|size))?/g, (token) => {
    const value = resolveVariableValue(token, variables);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? '1' : '0';
    return token;
  });
}

function advanceLoopValue(raw, variable, current, variables) {
  const cleaned = String(raw).trim();
  if (cleaned === `${variable}++` || cleaned === `++${variable}`) return current + 1;
  if (cleaned === `${variable}--` || cleaned === `--${variable}`) return current - 1;

  let match = cleaned.match(new RegExp(`^${variable}\\s*([+\\-*/])=\\s*(.+)$`));
  if (match) {
    const delta = parseNumericWithVariables(match[2], variables);
    if (!Number.isFinite(delta)) return NaN;
    if (match[1] === '+') return current + delta;
    if (match[1] === '-') return current - delta;
    if (match[1] === '*') return current * delta;
    if (match[1] === '/') return current / delta;
  }

  match = cleaned.match(new RegExp(`^${variable}\\s*=\\s*(.+)$`));
  if (match) return parseNumericWithVariables(match[1], variables);
  return NaN;
}

function findMatchingNext(lines, start, end) {
  let depth = 0;
  for (let i = start + 1; i < end; i += 1) {
    if (isForLine(lines[i].text)) depth += 1;
    if (isNextLine(lines[i].text)) {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

function cleanLabelLine(line) {
  const cleaned = lineWithoutComment(line).trim();
  return cleaned.startsWith('*') ? cleaned.split(/\s+/)[0] : '';
}

function collectLabels(lines) {
  const labels = new Map();
  lines.forEach((line, index) => {
    const label = cleanLabelLine(line.text);
    if (label && !labels.has(label)) labels.set(label, index);
  });
  return labels;
}

function isConditionalLine(line) {
  return /^(if|elseif|else|endif)\b/i.test(cleanControlLine(line));
}

function isFlowActive(context) {
  return !(context.skipStack ?? []).some((item) => !item.active);
}

function stripConditionKeyword(line, keyword) {
  let condition = cleanControlLine(line).replace(new RegExp(`^${keyword}\\b`, 'i'), '').trim();
  if (condition.startsWith('(') && condition.endsWith(')')) condition = condition.slice(1, -1).trim();
  if (isQuotedLiteral(condition)) condition = unquoteString(condition);
  return condition;
}

function evaluateCondition(raw, variables) {
  const condition = String(raw ?? '').trim();
  if (!condition) return false;
  const comparison = condition.match(/^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/);
  if (comparison) {
    const left = parseValue(comparison[1], variables);
    const right = parseValue(comparison[3], variables);
    const op = comparison[2];
    if (op === '==' || op === '!=') {
      const equal = typeof left === 'number' || typeof right === 'number'
        ? Number(left) === Number(right)
        : String(left) === String(right);
      return op === '==' ? equal : !equal;
    }
    const lnum = Number(left);
    const rnum = Number(right);
    if (!Number.isFinite(lnum) || !Number.isFinite(rnum)) return false;
    if (op === '<') return lnum < rnum;
    if (op === '>') return lnum > rnum;
    if (op === '<=') return lnum <= rnum;
    if (op === '>=') return lnum >= rnum;
  }
  const value = parseValue(condition, variables);
  return !(value === undefined || value === null || value === false || value === 0 || value === '');
}

function handleConditionalLine(scene, line, lineNumber, context) {
  const cleaned = cleanControlLine(line);
  const keyword = cleaned.match(/^(if|elseif|else|endif)\b/i)?.[1]?.toLowerCase();
  if (!keyword) return false;
  context.skipStack ??= [];
  if (keyword === 'if') {
    const parentActive = isFlowActive(context);
    const active = parentActive && evaluateCondition(stripConditionKeyword(line, 'if'), scene.variables);
    context.skipStack.push({ parentActive, matched: active, active });
    return true;
  }
  const current = context.skipStack[context.skipStack.length - 1];
  if (!current) {
    addWarning(scene, 'layout', `第 ${lineNumber} 行 @${keyword} 没有匹配的 @if`);
    return true;
  }
  if (keyword === 'elseif') {
    const active = current.parentActive && !current.matched && evaluateCondition(stripConditionKeyword(line, 'elseif'), scene.variables);
    current.active = active;
    current.matched = current.matched || active;
  } else if (keyword === 'else') {
    const active = current.parentActive && !current.matched;
    current.active = active;
    current.matched = true;
  } else if (keyword === 'endif') {
    context.skipStack.pop();
  }
  return true;
}

function normalizeLabel(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.startsWith('*') ? text : `*${text}`;
}

function flowTargetLabel(command, scene) {
  const explicit = command.args.label ?? command.args.target ?? command.args.storage;
  if (explicit !== undefined && explicit !== true) return normalizeLabel(explicit);
  const raw = String(command.rawRest ?? '').trim();
  if (!raw) return '';
  return normalizeLabel(parseValue(raw, scene.variables));
}

function runLabel(scene, lines, label, context) {
  const index = context.labels?.get(label);
  if (index === undefined) return false;
  if ((context.callDepth ?? 0) >= 32) {
    addWarning(scene, 'layout', `标签调用超过 32 层，已停止展开 ${label}`);
    return true;
  }
  processLineRange(scene, lines, index + 1, lines.length, {
    ...context,
    callDepth: (context.callDepth ?? 0) + 1,
    inBagelBlock: false,
    skipStack: [],
    stopAtLabel: true,
  });
  return true;
}

function runLoop(scene, lines, bodyStart, bodyEnd, loop, context) {
  const hadPrevious = scene.variables.has(loop.variable);
  const previous = scene.variables.get(loop.variable);
  if (Array.isArray(loop.values)) {
    for (let count = 0; count < loop.values.length; count += 1) {
      scene.variables.set(loop.variable, loop.values[count]);
      processLineRange(scene, lines, bodyStart, bodyEnd, { ...context });
      if (count + 1 >= LOOP_LIMIT) {
        addWarning(scene, 'layout', `for/next 循环超过 ${LOOP_LIMIT} 次，已停止展开`);
        break;
      }
    }
    if (hadPrevious) scene.variables.set(loop.variable, previous);
    else scene.variables.delete(loop.variable);
    return;
  }
  let value = loop.start;
  let count = 0;

  while (Number.isFinite(value)) {
    scene.variables.set(loop.variable, value);
    if (!loop.condition(value)) break;
    processLineRange(scene, lines, bodyStart, bodyEnd, { ...context });
    count += 1;
    if (count >= LOOP_LIMIT) {
      addWarning(scene, 'layout', `for/next 循环超过 ${LOOP_LIMIT} 次，已停止展开`);
      break;
    }
    value = loop.next(value);
  }

  if (hadPrevious) scene.variables.set(loop.variable, previous);
  else scene.variables.delete(loop.variable);
}

function processLineRange(scene, lines, start, end, context) {
  for (let i = start; i < end; i += 1) {
    const { text, lineNumber } = lines[i];
    const label = cleanLabelLine(text);
    if (label) {
      if (context.stopAtLabel) return { reason: 'label' };
      continue;
    }
    if (text.trim() === '##') {
      context.inBagelBlock = !context.inBagelBlock;
      continue;
    }
    if (context.inBagelBlock) {
      collectBagelVariable(scene, text, lineNumber);
      continue;
    }

    if (isConditionalLine(text)) {
      handleConditionalLine(scene, text, lineNumber, context);
      continue;
    }
    if (!isFlowActive(context)) continue;

    if (isForLine(text)) {
      const matchingNext = findMatchingNext(lines, i, end);
      if (matchingNext === -1) {
        addWarning(scene, 'layout', `第 ${lineNumber} 行 for 没有匹配的 next`);
        continue;
      }
      const loop = parseForHeader(scene, text, lineNumber);
      if (loop) runLoop(scene, lines, i + 1, matchingNext, loop, context);
      i = matchingNext;
      continue;
    }

    if (isNextLine(text)) {
      addWarning(scene, 'layout', `第 ${lineNumber} 行 next 没有匹配的 for`);
      continue;
    }

    const assignment = parseVariableAssignment(text, scene.variables);
    if (assignment && assignment.value !== assignment.raw) {
      scene.variables.set(assignment.name, assignment.value);
      scene.variableSources.set(assignment.name, { lineNumber, raw: assignment.raw });
      continue;
    }

    const command = parseCommand(text, scene);
    if (!command) continue;
    if (command.name === 'return') {
      addCommandNotice(scene, 'info', command.name, lineNumber, PASSIVE_COMMANDS.get('return'));
      return { reason: 'return' };
    }
    if (command.name === 'call') {
      const target = flowTargetLabel(command, scene);
      if (!target || !runLabel(scene, lines, target, context)) {
        addCommandNotice(scene, 'layout', command.name, lineNumber, FLOW_COMMANDS.get('call'));
      }
      continue;
    }
    if (command.name === 'jump' || command.name === 'goto') {
      const target = flowTargetLabel(command, scene);
      if (!target || !runLabel(scene, lines, target, context)) {
        addCommandNotice(scene, 'layout', command.name, lineNumber, FLOW_COMMANDS.get(command.name));
      }
      return { reason: command.name };
    }
    applyCommand(scene, command, lineNumber);
  }
  return { reason: 'end' };
}

export function parseScene(script, options = {}) {
  const scene = createScene(options);
  const lines = script.split(/\r?\n/).map((text, index) => ({ text, lineNumber: index + 1 }));
  const labels = collectLabels(lines);
  const entry = labels.get('*main');
  const start = entry === undefined ? 0 : entry + 1;
  processLineRange(scene, lines, start, lines.length, {
    inBagelBlock: false,
    labels,
    callDepth: 0,
    skipStack: [],
    stopAtLabel: entry !== undefined,
  });
  return finalizeScene(scene);
}

export function displayFile(scene, node) {
  if (node.type === 'buttonex') {
    const displayIndex = node.disabled && node.buttonDisable ? node.buttonDisable : node.buttonIdleIndex;
    const idleNode = scene.nodes.get(displayIndex);
    return idleNode ? displayFile(scene, idleNode) : '';
  }
  if (node.type === 'button' && node.disabled && node.buttonDisable) return node.buttonDisable;
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
    if (node.disabled || node.visible === false) {
      lines.push(`@spriteopt index=${node.index}${node.disabled ? ' disable=true' : ''}${node.visible === false ? ' visible=false' : ''}`);
    }
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
