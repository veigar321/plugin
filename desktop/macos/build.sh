#!/bin/bash

set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(CDPATH= cd -- "$script_dir/../.." && pwd)"
build_root="$script_dir/build"
app_path="$build_root/WorkdayPet.app"
source_path="$script_dir/Sources/WorkdayPet.swift"
assets=(workday.css workday.js salary-core.js pet.css pet.js money.js desktop.js)

fail() {
    printf '构建失败：%s\n' "$1" >&2
    exit 1
}

[[ "$(uname -s)" == Darwin ]] || fail "桌面宠物需要在 macOS 上构建。"
command -v xcrun >/dev/null 2>&1 || fail "未找到 xcrun，请先安装 Xcode Command Line Tools。"
[[ -x /usr/bin/codesign ]] || fail "未找到 macOS codesign 工具。"
[[ -f "$source_path" ]] || fail "缺少 Swift 源码：$source_path"
[[ -f "$script_dir/Info.plist" ]] || fail "缺少应用 Info.plist。"
[[ -f "$project_root/public/index.html" ]] || fail "缺少 public/index.html。"
for asset in "${assets[@]}"; do
    [[ -f "$project_root/public/assets/$asset" ]] || fail "缺少前端资源 public/assets/$asset。"
done

swift_compiler="$(xcrun --find swiftc)" || fail "未安装 Swift 编译器。"
sdk_path="$(xcrun --sdk macosx --show-sdk-path)" || fail "未找到 macOS SDK。"
architecture="$(uname -m)"
case "$architecture" in
    arm64|x86_64) ;;
    *) fail "暂不支持此 Mac 架构：$architecture" ;;
esac

mkdir -p "$build_root/module-cache"
printf '正在构建陪班小橘（%s，macOS 13+）……\n' "$architecture"
"$swift_compiler" \
    -parse-as-library \
    -swift-version 5 \
    -O \
    -sdk "$sdk_path" \
    -target "$architecture-apple-macosx13.0" \
    -module-cache-path "$build_root/module-cache" \
    -framework AppKit \
    -framework WebKit \
    "$source_path" \
    -o "$build_root/WorkdayPet"

mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources/Web/assets"
/usr/bin/install -m 755 "$build_root/WorkdayPet" "$app_path/Contents/MacOS/WorkdayPet"
/usr/bin/install -m 644 "$script_dir/Info.plist" "$app_path/Contents/Info.plist"

# WKWebView loads the bundled page from disk, so assets must use relative URLs.
/usr/bin/sed \
    -e 's|href="/assets/|href="assets/|g' \
    -e 's|src="/assets/|src="assets/|g' \
    "$project_root/public/index.html" | /usr/bin/awk '
    /assets\/desktop\.js/ { desktop_loaded = 1 }
    /<\/head>/ && !desktop_loaded { print "    <script src=\"assets/money.js\" defer></script>" }
    /<\/head>/ && !desktop_loaded { print "    <script src=\"assets/desktop.js\" defer></script>" }
    { print }
    ' > "$app_path/Contents/Resources/Web/index.html"
for asset in "${assets[@]}"; do
    /usr/bin/install -m 644 "$project_root/public/assets/$asset" "$app_path/Contents/Resources/Web/assets/$asset"
done

/usr/bin/plutil -lint "$app_path/Contents/Info.plist" >/dev/null
/usr/bin/codesign --force --sign - --timestamp=none "$app_path"
/usr/bin/codesign --verify --strict "$app_path"

printf '\n已生成：%s\n' "$app_path"
printf '双击 WorkdayPet.app，或执行：\nopen "%s"\n' "$app_path"
