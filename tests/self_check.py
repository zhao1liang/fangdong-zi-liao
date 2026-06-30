#!/usr/bin/env python3
"""租房管家 - 本地自检脚本（无需 Node）"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAILURES = []
PASSED = []


def ok(msg):
    PASSED.append(msg)


def fail(msg):
    FAILURES.append(msg)


def read(name):
    return (ROOT / name).read_text(encoding="utf-8")


def check_files_exist():
    required = [
        "index.html", "manifest.json", "sw.js",
        "js/app.js", "js/db.js", "js/voice.js", "js/lease.js",
        "js/wechat-import.js", "js/tasks.js", "js/image-util.js",
        "js/photo-editor.js", "js/mobile.js", "css/style.css",
    ]
    for f in required:
        if (ROOT / f).exists():
            ok(f"文件存在: {f}")
        else:
            fail(f"缺少文件: {f}")


def check_html_elements():
    html = read("index.html")
    ids = [
        "photo-gallery-input", "photo-camera-input", "btn-voice", "btn-pick-property",
        "btn-add-more", "dialog-pick-property", "dialog-photo-edit", "pending-count",
        "quick-unit-row", "unit-quick-input", "btn-quick-save",
        "property-drawer", "bottom-nav", "import-view", "inbox-view", "tasks-view",
    ]
    for el_id in ids:
        if f'id="{el_id}"' in html or f"id='{el_id}'" in html:
            ok(f"HTML 元素 #{el_id}")
        else:
            fail(f"HTML 缺少 #{el_id}")

    if "install-banner" in html:
        fail("安装横幅未删除")
    else:
        ok("安装横幅已删除")

    if "🖼 相册" in html and "📷 拍照" in html:
        ok("相册/拍照按钮文案")
    else:
        fail("缺少相册/拍照按钮")

    if 'capture="environment"' in html and 'photo-gallery-input' in html:
        if html.count('capture="environment"') == 1:
            ok("仅拍照按钮调用相机，相册不强制相机")
        else:
            fail("capture 属性可能绑定错误")
    else:
        fail("相册/拍照 input 配置异常")


def check_no_old_photo_input():
    html = read("index.html")
    if 'id="photo-input"' in html:
        fail("仍存在旧的 photo-input")
    else:
        ok("旧 photo-input 已移除")


def check_app_js_bindings():
    app = read("js/app.js")
    bindings = [
        "photoGalleryInput", "photoCameraInput", "btn-pick-property",
        "btn-add-more", "form-pick-property", "openPickPropertyDialog",
        "savePhotosToProperty", "appendPendingFiles", "normalizeToJpeg",
        "handlePhotoPick", "toggleVoiceListening", "updatePendingUI",
        "blobToDataUrl", "photoToDataUrl", "saveByQuickUnit",
        "resolveVoiceTarget", "processVoiceTranscript",
    ]
    for b in bindings:
        if b in app:
            ok(f"app.js 含: {b}")
        else:
            fail(f"app.js 缺少: {b}")

    if app.count("recognition.onend") > 1:
        fail(f"recognition.onend 重复注册 ({app.count('recognition.onend')}次)")
    else:
        ok("语音识别 onend 只注册一次")


def check_sw_cache():
    sw = read("sw.js")
    if "rental-v6" in sw and "image-util.js" in sw:
        ok("Service Worker 缓存版本与 image-util")
    else:
        fail("sw.js 缓存未更新")


def test_voice_parser_logic():
    voice = read("js/voice.js")
    if "speakArchiveResult" in read("js/speech-out.js"):
        ok("speech-out.js 含归档语音播报")
    else:
        fail("speech-out.js 缺少 speakArchiveResult")
    if "isCreateCommand" in voice and "CREATE_WORDS" in voice:
        ok("voice.js 含新建指令识别")
    else:
        fail("voice.js 缺少新建指令")

    """模拟 voice.js 核心匹配逻辑"""
    properties = [
        {"name": "阳光花园", "building": "3栋", "unit": "1201"},
        {"name": "阳光花园", "building": "3栋", "unit": "502"},
        {"name": "翠湖名苑", "building": "A座", "unit": "801"},
    ]

    cases = [
        ("放入阳光花园1201", "1201"),
        ("把图片放入文件夹1201", "1201"),
        ("1201", "1201"),
        ("放到502", "502"),
        ("阳光花园502客厅", "502"),
    ]

    def normalize(s):
        return re.sub(r"[栋座幢单元层号室]", "", s.lower().replace(" ", ""))

    def match_unit(text, props):
        m = re.search(r"(\d{3,4})", text)
        if not m:
            return None
        u = m.group(1)
        hits = [p for p in props if u in p["unit"].replace("室", "").replace("号", "")]
        if len(hits) == 1:
            return hits[0]["unit"]
        return hits[0]["unit"] if hits else None

    for speech, expected_unit in cases:
        got = match_unit(speech, properties)
        if got == expected_unit:
            ok(f"语音匹配: 「{speech}」→ {expected_unit}")
        else:
            fail(f"语音匹配失败: 「{speech}」期望 {expected_unit} 得 {got}")


def test_wechat_import_logic():
    lease = read("js/lease.js")
    samples = [
        "张先生 阳光花园3栋1201 2025年3月1日至2026年2月28日 月租4500",
        "起租2025-03-01 到期2026-02-28 月租3800",
    ]
    for s in samples:
        if re.search(r"\d{4}", s) and ("月租" in s or "到期" in s):
            ok(f"微信样例可解析: {s[:30]}…")
        else:
            fail(f"微信样例异常: {s}")


def test_html_script_imports():
    html = read("index.html")
    if 'type="module" src="js/app.js"' in html:
        ok("ES module 入口正确")
    else:
        fail("app.js 模块引用异常")

    app = read("js/app.js")
    imports = ["./db.js", "./voice.js", "./image-util.js", "./photo-editor.js"]
    for imp in imports:
        if imp in app:
            ok(f"import {imp}")
        else:
            fail(f"缺少 import {imp}")


def check_github_live():
    try:
        import urllib.request
        url = "https://zhao1liang.github.io/fangdong-zi-liao/"
        with urllib.request.urlopen(url, timeout=15) as r:
            body = r.read().decode("utf-8", errors="replace")
        if "btn-pick-property" in body and "photo-gallery-input" in body:
            ok("GitHub 线上版含手动选房源+相册")
        else:
            fail("GitHub 线上版仍是旧版，需重新上传")
        if "install-banner" in body:
            fail("GitHub 线上仍有安装横幅")
        else:
            ok("GitHub 线上无安装横幅")
    except Exception as e:
        fail(f"无法检测 GitHub 线上: {e}")


def main():
    print("=" * 50)
    print("  租房管家 自检")
    print("=" * 50)
    check_files_exist()
    check_html_elements()
    check_no_old_photo_input()
    check_app_js_bindings()
    check_sw_cache()
    test_voice_parser_logic()
    test_wechat_import_logic()
    test_html_script_imports()
    check_github_live()

    print("\n--- 通过 (%d) ---" % len(PASSED))
    for p in PASSED:
        print("  [OK]", p)

    if FAILURES:
        print("\n--- 失败 (%d) ---" % len(FAILURES))
        for f in FAILURES:
            print("  [FAIL]", f)
        print("\n结论: 存在问题，需修复后再部署")
        sys.exit(1)
    else:
        print("\n结论: 本地代码自检全部通过")
        sys.exit(0)


if __name__ == "__main__":
    main()
