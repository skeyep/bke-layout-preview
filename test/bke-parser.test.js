import assert from 'node:assert/strict';
import test from 'node:test';
import {
  displayFile,
  exportScene,
  formatNumber,
  lineWithoutComment,
  parseCommand,
  parseScene,
} from '../src/bke-parser.js';

test('parseCommand keeps comment markers inside quoted strings', () => {
  const line = '@sprite index=12 file="ui/http://panel" // trailing comment';
  assert.equal(lineWithoutComment(line).trim(), '@sprite index=12 file="ui/http://panel"');
  assert.deepEqual(parseCommand(line).args, {
    index: 12,
    file: 'ui/http://panel',
  });
});

test('parseScene resolves Bagel variables, arrays, numeric expressions, and string concatenation', () => {
  const scene = parseScene(`
##
var base = "ui/extra/";
var names = ["card_idle", "card_hover"];
var pos = [120 + 8, 240 / 2];
##
@sprite index=100 file=base+names[0]
@addto index=100 target=basic_layer pos=pos zorder=2 opacity=200
@action mode="moveby" target=100 pos=[2,3]
`, { designWidth: 1280, designHeight: 720 });

  const node = scene.nodes.get('100');
  assert.equal(node.file, 'ui/extra/card_idle');
  assert.deepEqual(node.pos, [130, 123]);
  assert.equal(node.zorder, 2);
  assert.equal(node.opacity, 200);
  assert.deepEqual(scene.roots.get('basic_layer').children, ['100']);
});

test('buttonex display resolves through its idle sprite', () => {
  const scene = parseScene(`
@sprite index=8101 file="ui/extra/cg_card_idle"
@sprite index=8102 file="ui/extra/cg_card_hover"
@buttonex index=8160 idle=8101 hover=8102
@addto index=8160 target=basic_layer pos=[300,420] zorder=8
`);

  const button = scene.nodes.get('8160');
  assert.equal(button.type, 'buttonex');
  assert.equal(displayFile(scene, button), 'ui/extra/cg_card_idle');
});

test('supported actions update transform state and exportScene reflects it', () => {
  const scene = parseScene(`
@sprite index=200 file="button/config_back"
@addto index=200 target=basic_layer pos=[10,20] zorder=1
@action mode="scaleto" target=200 x=80 y=120 time=0
@action mode="rotateby" target=200 rotate=15 time=0
@action mode="fadeto" target=200 opacity=128 time=0
`);

  const node = scene.nodes.get('200');
  assert.equal(node.scaleX, 80);
  assert.equal(node.scaleY, 120);
  assert.equal(node.rotate, 15);
  assert.equal(node.opacity, 128);
  assert.match(exportScene(scene), /@action mode="rotateto" target=200 rotate=15 time=0/);
});

test('parseScene reports duplicate definitions and missing parents', () => {
  const scene = parseScene(`
@sprite index=1 file="first"
@sprite index=1 file="second"
@addto index=1 target=missing_layer pos=[0,0]
`);

  assert.ok(scene.warnings.some((warning) => warning.includes('重复定义')));
  assert.ok(scene.warnings.some((warning) => warning.includes('target=missing_layer 不存在')));
});

test('formatNumber trims insignificant fractions', () => {
  assert.equal(formatNumber(12.00001), '12');
  assert.equal(formatNumber(12.34567), '12.346');
  assert.equal(formatNumber('abc'), 'abc');
});
