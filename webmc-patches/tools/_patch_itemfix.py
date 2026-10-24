# _patch_itemfix.py：q-itemfix v1 + q13 v6（苹果/盾交互修复，2026-10-25）
# 根因：bundle startUsingItem() 开头 if(this.itemBeingUsed) return;
#   itemBeingUsed 仅在松手(buttons[2]=false)时清 -> 吃完不松手直接再按，activateItem 被吞 = "吃不了"
# 修复：100ms 轮询，usingHeldItem=false 持续 300ms 即清 itemBeingUsed（原版按住可连吃）
#      q13 按下宽限窗 1600->2600ms（覆盖 1.6s 食物+网络余量；_apple3 API 路径全过，真机偶发=宽限窗边界）
import sys

p = '_mc/live/index.html'
s = open(p, encoding='utf-8').read()

if 'q-itemfix v1' in s:
    print('SKIP: itemfix already patched')
    sys.exit(0)

# 1. q13 v6：宽限窗 1600 -> 2600
old = "Q.pressUntil = Date.now() + 1600;   // 覆盖绝大多数食物食用时长（苹果 1.6s）"
new = "Q.pressUntil = Date.now() + 2600;   // v6: 1600 恰好=苹果时长，吃完边界偶发断档 -> 2600 留网络余量"
assert old in s, 'q13 pressUntil anchor missing'
s = s.replace(old, new, 1)

# 2. 插入 q-itemfix v1（q13 块 </script> 之后）
anchor = "console.log('[useanim] v5 enabled (vanilla-priority+immediate-stop+protocol-down) chew=' + Q.chewN + ' burp=' + Q.burpN + ' fb=' + Q.fbN);\n})();\n</script>"
assert anchor in s, 'q13 block end anchor missing'
itemfix = anchor + r'''
<script>
/* q-itemfix v1（2026-10-25）：清 MouseManager.itemBeingUsed 残留
   病根（Alec: 苹果时好时坏吃不了）：bundle startUsingItem() 首行
   if(this.itemBeingUsed||...)return —— itemBeingUsed 只在松手(buttons[2]=false)时清。
   吃完不松手直接再按 → activateItem 被吞 → 服务端不开吃。
   原版按住右键可连吃：此处检测服务端使用态结束(usingHeldItem=false 持续 300ms)即清残留，
   不碰 bundle 其他逻辑；误清防护=300ms 防抖 + 仅清 itemBeingUsed 单字段。 */
(function () {
  if (globalThis.__itemFix) return;
  var S = globalThis.__itemFix = { cleared: 0, err: 0 };
  var n = 0;
  setInterval(function () {
    try {
      var b = globalThis.bot; if (!b) { n = 0; return; }
      var M = b.mouse; if (!M || !M.itemBeingUsed) { n = 0; return; }
      var using = false; try { using = !!b.usingHeldItem; } catch (e) {}
      if (using) { n = 0; return; }
      if (++n >= 3) { M.itemBeingUsed = null; S.cleared++; n = 0; }
    } catch (e) { S.err++; n = 0; }
  }, 100);
  console.log('[itemfix] v1 enabled (clear itemBeingUsed residue after use ends)');
})();
</script>'''
s = s.replace(anchor, itemfix, 1)

# 3. 版本标记
old_tag = 'q13v5=on|eat2=on|bub4fix=on|anim9=on|perf1=on'
assert old_tag in s, 'version tag anchor missing'
s = s.replace(old_tag, 'q13v6=on|eat2=on|itemfix=on|bub4fix=on|anim9=on|perf1=on', 1)
old_b = 'build=20261024h'
assert old_b in s, 'build anchor missing'
s = s.replace(old_b, 'build=20261024i', 1)

open(p, 'w', encoding='utf-8').write(s)
print('OK: q-itemfix v1 + q13 v6 (pressUntil 2600) + build i')
