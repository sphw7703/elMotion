"""index.html 하나로 묶기: 스크립트·글꼴·이미지를 모두 파일 안에 넣는다."""
import base64, io, os
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
def b64(path): return base64.b64encode(open(os.path.join(here, path), "rb").read()).decode()
def webp_b64(path, size):
    im = Image.open(os.path.join(here, path)).convert("RGBA"); im.thumbnail((size, size), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, "WEBP", quality=90, method=6); return base64.b64encode(buf.getvalue()).decode()
html = open(os.path.join(here, "index.html"), encoding="utf-8").read()
core = open(os.path.join(here, "core.js"), encoding="utf-8").read()
app = open(os.path.join(here, "app.js"), encoding="utf-8").read()
assert "</script" not in core and "</script" not in app
icon = "data:image/png;base64," + b64("assets/app-icon-180.png")
html = html.replace('href="assets/app-icon-192.png"', f'href="{icon}"').replace('href="assets/app-icon-180.png"', f'href="{icon}"')
html = html.replace('url("assets/fonts/NanumSquareNeo-Variable.woff")', 'url("data:font/woff;base64,' + b64("assets/fonts/NanumSquareNeo-Variable.woff") + '")')
for name in ["ic-records", "ic-measure", "ic-settings"]:
    html = html.replace(f'src="assets/{name}.png"', 'src="data:image/webp;base64,' + webp_b64(f"assets/{name}.png", 128) + '"')
glass = 'data:image/webp;base64,' + b64("assets/glass.webp")
html = html.replace(":root {\n  --bg:", ':root {\n  --glass-img: url("' + glass + '");\n  --bg:', 1)
html = html.replace('<script src="core.js"></script>', "<script>\n" + core + "\n</script>")
html = html.replace('<script src="app.js"></script>', "<script>\n" + app + "\n</script>")
assert "assets/" not in html and 'src="core.js"' not in html and 'src="app.js"' not in html
os.makedirs(os.path.join(here, "dist"), exist_ok=True)
out = os.path.join(here, "dist", "index.html")
open(out, "w", encoding="utf-8").write(html)
print(out, round(os.path.getsize(out) / 1e6, 2), "MB")
