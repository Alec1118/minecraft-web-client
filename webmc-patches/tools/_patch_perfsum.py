# _patch_perfsum.py：perf-guard 加每分钟 console 摘要（真机卡顿归因通道）
import sys

p = '_mc/live/index.html'
s = open(p, encoding='utf-8').read()

if 'perfsum' in s:
    print('SKIP: perfsum already patched')
    sys.exit(0)

anchor = "  requestAnimationFrame(frame);\n  log('[perf] guard v1 armed (auto software-detect + frame watchdog)');"
assert anchor in s, 'perf-guard anchor missing'
new = """  requestAnimationFrame(frame);
  /* perfsum：每分钟一行 console 摘要——Alec 真机卡顿时 F12 看最后几行即可归因
     （铁律0：只进 console，零 UI）。heap 线性不回落=泄漏；fps 低=渲染；ent 暴涨=实体。 */
  setInterval(function(){
    try{
      var ent=0;
      try{ var w=window.world; ent=w&&w.entities&&w.entities.entities?Object.keys(w.entities.entities).length:0; }catch(e){}
      var q=globalThis.__qAnim||{}, bb=globalThis.__bubble||{}, it=globalThis.__itemFix||{};
      log('[perf] fps='+P.fps+' rd='+P.rd+' soft='+P.soft+' heap='+(performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):-1)+'MB ent='+ent+' anim='+q.frames+'(w'+q.walk+'/i'+q.idle+'/y'+q.yield+') bub='+bb.n+'/'+bb.spawned+' itemfix='+(it.cleared||0));
    }catch(e){ P.err++; }
  }, 60000);
  log('[perf] guard v1 armed (auto software-detect + frame watchdog + perfsum)');"""
s = s.replace(anchor, new, 1)

old_b = 'build=20261024k'
assert old_b in s, 'build anchor missing'
s = s.replace(old_b, 'build=20261024l', 1)

open(p, 'w', encoding='utf-8').write(s)
print('OK: perf-guard perfsum + build l')
