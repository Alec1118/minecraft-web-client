#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""q-overfix v1: #ui-root 全屏层 pointer-events:none 修复
根因（_diag24 铁证）：bundle 官方 CSS #ui-root{position:fixed;...;z-index:8} 无 pointer-events:none，
全屏盖住 viewer-canvas → __qOverUI 的 elementFromPoint 永远命中 #ui-root → q16 把所有右键
判为 UI 点击拦掉 → use_item 永不发出（Alec：苹果/盾"感觉没触发"）。
修法：ui-root 整体 none（GUI 层本不该吃事件），内部可交互控件单独 auto。"""
import io, sys, re, hashlib, shutil

P = r'C:\Users\athen\WorkBuddy\2026-09-28-17-41-11\_mc\live\index.html'
s = io.open(P, encoding='utf-8').read()
if 'q-overfix v1' in s:
    print('ALREADY'); sys.exit(0)

# 锚点：qremote 块之后（或 uib16 块后）插入 <style>
anchor = '<script>/* qremote v1:'
i = s.find(anchor)
assert i != -1, 'qremote anchor missing'
block = (
    '<style>/* q-overfix v1: #ui-root 全屏层吃事件导致 elementFromPoint 永远命中它 → '
    '所有右键被 __qOverUI 判为 UI 点击拦截（苹果/盾/放置全部"没触发"）。'
    'GUI 层本不该吃事件：整体 none，可交互控件单独 auto。 */\n'
    '#ui-root{pointer-events:none !important}\n'
    '#ui-root button,#ui-root input,#ui-root select,#ui-root [onclick],#ui-root [data-clickable]{pointer-events:auto}\n'
    '</style>\n'
)
s = s[:i] + block + s[i:]

# 版本标记
s = s.replace("build=20261024o", "build=20261024p", 1)
if "v.push('overfix=on')" in s:
    pass
else:
    # 找版本 push 列表，追加一项
    m = re.search(r"v\.push\('anim11=on'\)", s)
    if m:
        s = s[:m.end()] + ";v.push('overfix=on')" + s[m.end():]

io.open(P, 'w', encoding='utf-8').write(s)
md5 = hashlib.md5(s.encode('utf-8')).hexdigest()
print('PATCHED, md5', md5, '| overfix:', 'q-overfix v1' in s, '| build p:', 'build=20261024p' in s)
