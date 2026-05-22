from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / "sample_project"
IMAGE = PROJECT / "image"


def font(size):
    for name in ("arial.ttf", "seguiemj.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def rounded(size, fill, outline=None, width=3, radius=18):
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    box = [width // 2, width // 2, size[0] - width // 2 - 1, size[1] - width // 2 - 1]
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)
    return img


def save(img, relative):
    path = IMAGE / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)


def background():
    img = Image.new("RGBA", (1920, 1080), (25, 29, 32, 255))
    d = ImageDraw.Draw(img)
    for y in range(1080):
        t = y / 1079
        r = int(24 + 18 * t)
        g = int(32 + 20 * t)
        b = int(38 + 16 * t)
        d.line([(0, y), (1920, y)], fill=(r, g, b, 255))
    for x in range(-160, 2100, 160):
        d.line([(x, 0), (x - 420, 1080)], fill=(58, 80, 84, 70), width=2)
    for i, (x, y, r, color) in enumerate([
        (360, 260, 140, (98, 214, 174, 75)),
        (1540, 190, 210, (255, 209, 102, 55)),
        (1320, 760, 180, (112, 167, 255, 48)),
    ]):
        d.ellipse([x - r, y - r, x + r, y + r], fill=color)
    d.text((72, 62), "BKE Layout Preview", font=font(48), fill=(234, 245, 241, 235))
    d.text((76, 128), "Generated sample assets - CC0 style placeholders", font=font(24), fill=(170, 190, 186, 230))
    save(img, "bg/workbench_day.png")


def ui_assets():
    panel = rounded((980, 660), (26, 32, 36, 235), (94, 214, 174, 190), 4, 24)
    d = ImageDraw.Draw(panel)
    d.rectangle([0, 0, 980, 88], fill=(37, 47, 52, 238))
    d.text((36, 28), "Scene Composer", font=font(30), fill=(238, 245, 242, 255))
    d.text((720, 32), "z=2", font=font(22), fill=(255, 209, 102, 230))
    save(panel, "ui/panel_main.png")

    side = rounded((420, 720), (22, 27, 31, 238), (64, 82, 88, 210), 4, 20)
    d = ImageDraw.Draw(side)
    d.text((30, 28), "Inspector", font=font(30), fill=(238, 245, 242, 255))
    for y in range(108, 610, 86):
        d.rounded_rectangle([30, y, 390, y + 46], radius=8, fill=(36, 43, 48, 255), outline=(66, 79, 86, 255), width=2)
    save(side, "ui/panel_side.png")

    card = rounded((340, 220), (239, 244, 235, 240), (101, 214, 173, 230), 5, 18)
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([20, 20, 320, 132], radius=12, fill=(51, 67, 70, 255))
    d.text((34, 156), "Sprite Card", font=font(28), fill=(22, 32, 34, 255))
    d.text((34, 190), "drag / inspect / export", font=font(18), fill=(68, 84, 86, 255))
    save(card, "ui/card_frame.png")

    glow = rounded((370, 250), (101, 214, 173, 50), (255, 209, 102, 210), 6, 26)
    save(glow, "ui/card_glow.png")

    for name, fill, outline in [
        ("button_idle", (42, 52, 58, 245), (101, 214, 173, 210)),
        ("button_hover", (70, 92, 96, 250), (255, 209, 102, 235)),
    ]:
        img = rounded((240, 74), fill, outline, 4, 14)
        d = ImageDraw.Draw(img)
        d.text((52, 22), "Preview", font=font(28), fill=(238, 245, 242, 255))
        save(img, f"button/{name}.png")

    badge = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    d = ImageDraw.Draw(badge)
    points = [(48, 6), (60, 34), (90, 34), (66, 52), (76, 84), (48, 64), (20, 84), (30, 52), (6, 34), (36, 34)]
    d.polygon(points, fill=(255, 209, 102, 245), outline=(84, 60, 22, 255))
    save(badge, "ui/badge_star.png")

    portrait = rounded((260, 360), (72, 82, 94, 255), (238, 245, 242, 190), 4, 18)
    d = ImageDraw.Draw(portrait)
    d.ellipse([72, 54, 188, 170], fill=(238, 199, 166, 255))
    d.rounded_rectangle([52, 178, 208, 324], radius=44, fill=(101, 214, 173, 240))
    d.text((72, 22), "Actor A", font=font(24), fill=(238, 245, 242, 255))
    save(portrait, "character/actor_a.png")

    atlas = Image.new("RGBA", (512, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(atlas)
    d.rounded_rectangle([0, 0, 180, 72], radius=12, fill=(101, 214, 173, 255))
    d.text((38, 20), "ATLAS", font=font(26), fill=(21, 31, 33, 255))
    d.rounded_rectangle([192, 0, 372, 72], radius=12, fill=(255, 209, 102, 255))
    d.text((226, 20), "RECT", font=font(26), fill=(45, 36, 18, 255))
    d.rounded_rectangle([0, 92, 120, 212], radius=18, fill=(112, 167, 255, 240))
    save(atlas, "ui/demo_atlas.png")


def config_files():
    PROJECT.mkdir(parents=True, exist_ok=True)
    (PROJECT / "config.bkpsr").write_text(
        """; Minimal BKE config used by bke-layout-preview sample project
ResolutionSize = [1920, 1080]
ImageAutoSearchPath = ["image", "image/bg", "image/ui", "image/button", "image/character"]
""",
        encoding="utf-8",
    )
    (PROJECT / "layout_demo.bkscr").write_text(
        """// BKE Layout Preview generated sample: complex enough to use as a tiny tutorial.
// Assets are generated by tools/sample/generate_sample_assets.py and are not from any game project.

##
var cards = [[172, 264], [548, 264], [924, 264]];
var panelFile = "ui/panel_main";
##

@sprite index=1000 file="bg/workbench_day"
@addto index=1000 target=basic_layer pos=[0,0] zorder=0 opacity=255

@layer index=1100 width=1920 height=1080 color=0x000000 opacity=42
@addto index=1100 target=basic_layer pos=[0,0] zorder=1 opacity=255

@sprite index=1200 file=panelFile
@addto index=1200 target=basic_layer pos=[88,190] zorder=2 opacity=255

@sprite index=1201 file="ui/panel_side"
@addto index=1201 target=basic_layer pos=[1390,180] zorder=4 opacity=238

@sprite index=1300 file="character/actor_a"
@anchor index=1300 set="bottomcenter"
@addto index=1300 target=basic_layer pos=[1518,905] zorder=7 opacity=255
@action mode="scaleto" target=1300 x=92 y=92

@sprite index=2000 file="ui/card_glow"
@addto index=2000 target=1200 pos=[142,194] zorder=2 opacity=180
@action mode="moveto" target=2000 pos=[128,184]

@sprite index=2010 file="ui/card_frame"
@addto index=2010 target=1200 pos=cards[0] zorder=3 opacity=255

@sprite index=2020 file="ui/card_frame"
@addto index=2020 target=1200 pos=cards[1] zorder=3 opacity=210
@action mode="moveby" target=2020 pos=[0,28]
@action mode="fadeto" target=2020 opacity=165

@sprite index=2030 file="ui/card_frame"
@addto index=2030 target=1200 pos=cards[2] zorder=3 opacity=255
@anchor index=2030 set="center"
@action mode="rotateto" target=2030 rotate=-4

@sprite index=2040 file="ui/badge_star"
@anchor index=2040 set="center"
@addto index=2040 target=2030 pos=[290,36] zorder=8 opacity=255

@sprite index=2050 file="ui/demo_atlas" rect=[0,0,180,72]
@addto index=2050 target=1200 pos=[52,564] zorder=5 opacity=255

@sprite index=2051 file="ui/demo_atlas" rect=[192,0,180,72]
@addto index=2051 target=1200 pos=[252,564] zorder=5 opacity=255

@button index=3000 idle="button/button_idle" hover="button/button_hover"
@addto index=3000 target=basic_layer pos=[1454,822] zorder=12 opacity=255

@buttonex index=3010 idle=3000 hover=3000
@addto index=3010 target=basic_layer pos=[118,922] zorder=12 opacity=190

@textsprite index=4000 text="TextSprite: coordinates, zorder and parent layers" size=32 color=0xEEF5F1
@addto index=4000 target=basic_layer pos=[128,116] zorder=20 opacity=255
""",
        encoding="utf-8",
    )


def main():
    background()
    ui_assets()
    config_files()


if __name__ == "__main__":
    main()
