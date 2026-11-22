import re, sys

html = open('_mc/live/index.html', encoding='utf-8').read()
v11 = open('_mc/qanim_v11.js', encoding='utf-8').read()

i = html.find('q-anim v10')
assert i != -1, 'v10 block not found'
j = html.rfind('<script', 0, i)
assert html[j:j+8] == '<script>', 'unexpected open tag'
k = html.find('</script>', i)
assert k != -1, 'close tag not found'
k += len('</script>')

if not v11.lstrip().startswith('<script'):
    v11 = '<script>\n' + v11

html = html[:j] + v11 + html[k:]
html = html.replace('build=20261024n', 'build=20261024o', 1)
html = html.replace('anim10=on', 'anim11=on', 1)
html = html.replace('qAnim=10', 'qAnim=11', 1)
open('_mc/live/index.html', 'w', encoding='utf-8').write(html)
print('q-anim v10 -> v11, build -> o')
