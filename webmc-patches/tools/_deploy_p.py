#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""部署 build 20261024p: overfix + bubble v8 + qanim v12 + shieldpose v1"""
import io, sys, re, hashlib

ROOT = r'C:\Users\athen\WorkBuddy\2026-09-28-17-41-11'
P = ROOT + r'\_mc\live\index.html'
s = io.open(P, encoding='utf-8').read()
orig = s

# ---------- 1. overfix（_patch_overfix.py 的逻辑并入） ----------
if 'q-overfix v1' not in s:
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

# ---------- 2. bubble v7 → v8 ----------
b8 = io.open(ROOT + r'\_mc\bubble_v8.js', encoding='utf-8').read()
if 'bubble-particles v8' not in s:
    i = s.find('/* bubble-particles v7')
    assert i != -1, 'v7 start missing'
    j = s.find('</script>', i)
    assert j != -1
    b8body = b8.rstrip()
    if b8body.endswith('</script>'):
        b8body = b8body[:-len('</script>')]
    s = s[:i] + b8body + '\n' + s[j:]
    # b8 自带 </script> 结尾 → 移除 b8 尾部的 </script>（已含在上面 rstrip 后拼接会双）
    # 实际处理：b8 有 </script>，拼接处 s[j:] 又有 </script> —— 检查
if s.count('</script>') != s.count('<script'):
    # 去掉重复：b8 尾带的 </script> + 原位置的 </script>
    pass

# ---------- 3. qanim v11 → v12 ----------
v12 = io.open(ROOT + r'\_mc\qanim_v12.js', encoding='utf-8').read()
if 'q-anim v12' not in s:
    i = s.find('/* q-anim v12')
    if i == -1:
        i = s.find('/* q-anim v11')
    assert i != -1, 'v11/v12 start missing'
    j = s.find('</script>', i)
    assert j != -1
    s = s[:i] + v12.rstrip() + '\n' + s[j:]

# ---------- 4. shieldpose v1 新块 ----------
sp1 = io.open(ROOT + r'\_mc\shieldpose_v1.js', encoding='utf-8').read()
if 'q-shieldpose v1' not in s:
    i = s.find('/* bubble-particles v8')
    assert i != -1, 'bubble v8 anchor for shieldpose'
    # 插在 bubble 块的 <script> 前
    k = s.rfind('<script>', 0, i)
    assert k != -1
    s = s[:k] + '<script>\n' + sp1.rstrip() + ('\n' if not sp1.rstrip().endswith('</script>') else '') + '</script>\n' + s[k:]

# ---------- 5. 版本标记 ----------
s = s.replace("build=20261024o", "build=20261024p", 1)
s = s.replace("qAnim=11", "qAnim=12", 1)
s = s.replace("anim11=on", "anim12=on", 1)
s = s.replace("bubble=7", "bubble=8", 1)
m = re.search(r"v\.push\('overfix=on'\)", s)
if not m and "v.push('anim12=on')" in s:
    s = s.replace("v.push('anim12=on')", "v.push('anim12=on');v.push('overfix=on');v.push('shpose=on')", 1)
# 兼容另一种 push 风格
if 'shpose=on' not in s:
    m2 = re.search(r"v\.push\('([^']*overfix[^']*)'\)", s)
    if m2:
        s = s[:m2.end()] + ";v.push('shpose=on')" + s[m2.end():]

io.open(P, 'w', encoding='utf-8').write(s)

# ---------- 校验 ----------
o, c = s.count('<script'), s.count('</script>')
blocks = re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', s, re.S)
import subprocess, os
os.makedirs(ROOT + r'\_mc\chk', exist_ok=True)
bad = 0
for n, b in enumerate(blocks):
    if not b.strip():
        continue
    pp = ROOT + '\\_mc\\chk\\b%d.mjs' % n
    io.open(pp, 'w', encoding='utf-8').write(b)
    r = subprocess.run(['node', '--check', pp], capture_output=True, text=True)
    if r.returncode != 0:
        bad += 1
        print('blk%d FAIL:' % n, r.stderr.strip()[:200])
md5 = hashlib.md5(s.encode('utf-8')).hexdigest()
print('tags %d/%d %s | blocks %d bad %d' % (o, c, 'BAL' if o == c else 'MISMATCH!', len(blocks), bad))
print('markers:', 'overfix' in s, 'bubble v8' in s, 'q-anim v12' in s, 'shieldpose' in s, 'build=20261024p' in s)
print('md5', md5)
sys.exit(1 if (bad or o != c) else 0)
