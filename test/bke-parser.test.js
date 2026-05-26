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

test('parseScene resolves quoted string concatenation used in image paths', () => {
  const scene = parseScene(`
##
var cg_folder = "album_01";
##
@sprite index=120 file="ui/extra/thumb_"+cg_folder+".png"
`);

  assert.equal(scene.nodes.get('120').file, 'ui/extra/thumb_album_01.png');
});

test('parseScene expands simple for/next loops with variables', () => {
  const scene = parseScene(`
##
var folders = ["a", "b", "c"];
##
for (var i=0; i<folders.length; i++)
@sprite index=8000+i file="ui/extra/thumb_"+folders[i]+".png"
@addto index=8000+i target=basic_layer pos=[100+i*40,200] zorder=i
next
`);

  assert.deepEqual([...scene.nodes.keys()], ['8000', '8001', '8002']);
  assert.equal(scene.nodes.get('8002').file, 'ui/extra/thumb_c.png');
  assert.deepEqual(scene.nodes.get('8002').pos, [180, 200]);
  assert.equal(scene.nodes.get('8002').zorder, 2);
});

test('parseScene expands BKE range loops and dotted variables', () => {
  const scene = parseScene(`
##
tf.card_positions = [[10, 20], [30, 40]];
tf.count = tf.card_positions.length;
##
@for var=i range=range(0,tf.count)
@sprite index=500+i file="ui/card_frame"
@addto index=500+i target=basic_layer pos=tf.card_positions[i] zorder=i
@next
`);

  assert.deepEqual([...scene.nodes.keys()], ['500', '501']);
  assert.deepEqual(scene.nodes.get('501').pos, [30, 40]);
  assert.equal(scene.nodes.get('501').zorder, 1);
});

test('parseScene follows same-file calls and stops at return or jumped label', () => {
  const scene = parseScene(`
*main
@call label="*draw"
@jump "*idle"

*draw
@sprite index=100 file="ui/panel_main"
@addto index=100 target=basic_layer pos=[11,22]
@return

*idle
@waitbutton

*exit
@remove index=100 delete=true
@return
`);

  assert.equal(scene.nodes.has('100'), true);
  assert.deepEqual(scene.nodes.get('100').pos, [11, 22]);
});

test('spriteopt updates disabled and visible state', () => {
  const scene = parseScene(`
@button index=300 idle="button/idle" disable="button/disable"
@addto index=300 target=basic_layer pos=[0,0]
@spriteopt index=300 disable=true
@sprite index=301 file="ui/hidden"
@addto index=301 target=basic_layer pos=[0,0]
@spriteopt index=301 visible=false
`);

  const button = scene.nodes.get('300');
  assert.equal(button.disabled, true);
  assert.equal(displayFile(scene, button), 'button/disable');
  assert.equal(scene.nodes.get('301').visible, false);
});

test('unsupported command notices are classified and grouped', () => {
  const scene = parseScene(`
@waitbutton
@waitbutton
@call storage="common.ks"
@particle name="shine"
@unknownthing foo=1
`);

  assert.ok(scene.warnings.some((warning) => warning.includes('无视觉影响') && warning.includes('@waitbutton') && warning.includes('共 2 次')));
  assert.ok(scene.warnings.some((warning) => warning.includes('可能影响布局') && warning.includes('@call')));
  assert.ok(scene.warnings.some((warning) => warning.includes('不支持') && warning.includes('@particle')));
  assert.ok(scene.warnings.some((warning) => warning.includes('不支持') && warning.includes('@unknownthing')));
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
