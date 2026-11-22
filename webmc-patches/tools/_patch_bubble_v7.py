import re, sys

html = open('_mc/live/index.html', encoding='utf-8').read()
v7 = open('_mc/bubble_v7.js', encoding='utf-8').read()

i = html.find('bubble-particles v6')
assert i != -1, 'v6 block not found'
j = html.rfind('<script', 0, i)
assert html[j:j+8] == '<script>', 'unexpected open tag'
k = html.find('</script>', i)
assert k != -1, 'close tag not found'
k += len('</script>')

# v7 文件不带 <script> 开头，需补
if not v7.lstrip().startswith('<script'):
    v7 = '<script>\n' + v7

html = html[:j] + v7 + html[k:]
open('_mc/live/index.html', 'w', encoding='utf-8').write(html)
print('bubble v6 -> v7 replaced')

html = html.replace('build=20261024m', 'build=20261024n', 1)
open('_mc/live/index.html', 'w', encoding='utf-8').write(html)
print('build -> 20261024n')
