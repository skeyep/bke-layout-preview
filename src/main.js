import './styles.css';
import { ANCHORS, displayFile, exportScene, finalizeScene, formatNumber, numberOr, parseScene } from './bke-parser.js';
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
  Magnet,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide';

let DESIGN_WIDTH = 1920;
let DESIGN_HEIGHT = 1080;

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
  snapToggle: document.querySelector('#snapToggle'),
  snapSizeInput: document.querySelector('#snapSizeInput'),
  dragModeSelect: document.querySelector('#dragModeSelect'),
  zoomReadout: document.querySelector('#zoomReadout'),
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
  displayRefs: new Map(),
  selectionOutline: null,
  zoom: 1,
  fitCanvasWidth: 0,
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
    Magnet,
    RefreshCw,
    SlidersHorizontal,
    Sparkles,
    X,
  },
});

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

function anchorVector(anchor) {
  if (Array.isArray(anchor)) return anchor;
  return ANCHORS[anchor] ?? ANCHORS.topleft;
}

function snapCoordinate(value) {
  if (!dom.snapToggle?.checked) return Math.round(value);
  const step = clamp(numberOr(dom.snapSizeInput?.value, 10), 1, 240);
  return Math.round(value / step) * step;
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
  state.displayRefs.set(String(node.index), { container, parentContainer });

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
  state.displayRefs.clear();
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
  let dragNode = node;
  let dragContainer = container;
  let dragParentContainer = parentContainer;
  const fixedSelection = dom.dragModeSelect?.value === 'fixed' && state.selectedIndex && state.scene?.nodes.has(String(state.selectedIndex));
  if (fixedSelection) {
    dragNode = state.scene.nodes.get(String(state.selectedIndex));
    const ref = state.displayRefs.get(String(dragNode.index));
    if (ref) {
      dragContainer = ref.container;
      dragParentContainer = ref.parentContainer;
    } else {
      dragNode = node;
      selectNode(node.index, { render: false });
    }
  } else {
    selectNode(node.index, { render: false });
  }
  setSelectionOutline(dragContainer, dragNode.width, dragNode.height);
  const local = dragParentContainer.toLocal(event.global);
  state.drag = {
    node: dragNode,
    container: dragContainer,
    parentContainer: dragParentContainer,
    offset: [local.x - dragNode.pos[0], local.y - dragNode.pos[1]],
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
  node.pos = [snapCoordinate(local.x - offset[0]), snapCoordinate(local.y - offset[1])];
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
  state.scene = parseScene(dom.scriptInput.value, { designWidth: DESIGN_WIDTH, designHeight: DESIGN_HEIGHT });
  if (state.selectedIndex && !state.scene.nodes.has(state.selectedIndex)) state.selectedIndex = null;
  dom.parseBadge.textContent = `${state.scene.commandCount} 条命令`;
  updateNodeList();
  updateInspector();
  updateExport();
  renderScene();
}

function updateExport() {
  dom.exportOutput.value = exportScene(state.scene);
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

function updateCanvasZoom() {
  if (!state.app?.canvas) return;
  const viewportRect = dom.viewport.getBoundingClientRect();
  const maxFitWidth = Math.max(320, viewportRect.width - 36);
  const maxFitHeight = Math.max(220, viewportRect.height - 36);
  const fitByWidth = maxFitWidth;
  const fitByHeight = maxFitHeight * (DESIGN_WIDTH / DESIGN_HEIGHT);
  state.fitCanvasWidth = Math.max(320, Math.min(fitByWidth, fitByHeight));
  const width = Math.round(state.fitCanvasWidth * state.zoom);
  state.app.canvas.style.width = `${width}px`;
  state.app.canvas.style.maxWidth = 'none';
  if (dom.zoomReadout) dom.zoomReadout.textContent = `${Math.round(state.zoom * 100)}%`;
}

function handleViewportWheel(event) {
  if (!state.app?.canvas) return;
  event.preventDefault();
  const previousZoom = state.zoom;
  const direction = event.deltaY > 0 ? -1 : 1;
  const factor = event.shiftKey ? 1.04 : 1.1;
  state.zoom = clamp(direction > 0 ? state.zoom * factor : state.zoom / factor, 0.35, 4);
  if (Math.abs(state.zoom - previousZoom) < 0.001) return;
  updateCanvasZoom();
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
  updateCanvasZoom();
}

function applyProjectInfo(info) {
  state.projectInfo = info;
  const [width, height] = Array.isArray(info.resolution) ? info.resolution : [1920, 1080];
  DESIGN_WIDTH = Number(width) || 1920;
  DESIGN_HEIGHT = Number(height) || 1080;
  if (state.app) state.app.renderer.resize(DESIGN_WIDTH, DESIGN_HEIGHT);
  updateCanvasZoom();

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
  dom.viewport.addEventListener('wheel', handleViewportWheel, { passive: false });
  window.addEventListener('resize', updateCanvasZoom);
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
