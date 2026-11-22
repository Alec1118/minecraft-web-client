/* _diag14: bubble v7 终验（动态朝向坑）+ 相机旋转 dump + 僵尸 v10 行走摆幅 */
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const TOOLS = __dirname;
const PY = path.join(TOOLS, 'rc_lan.py');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL0 = 'https://minecraft.aialec.cn/?ip=wss://minecraft.aialec.cn/mcws&autoConnect=1&username=qanim7test';
const U = 'qanim7test', P = 'Qtest2026';

function sh(cmd, args, timeout) {
  return new Promise((res, rej) => {
    execFile(cmd, args, { timeout: timeout || 60000, maxBuffer: 1 << 24 }, (e, so, se) => {
      if (e && !so) return rej(new Error((se || e.message).slice(0, 300)));
      res(so);
    });
  });
}
function rc(cmd) { return sh('python', [PY, cmd], 45000).then(o => o.trim()); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const port = 9471;
  const prof = path.join(TOOLS, `_p14_${port}`);
  const EP = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, URL0], { detached: false });
  let raw = null;
  try {
    await sleep(4000);
    let tabs = null;
    for (let i = 0; i < 12 && !tabs; i++) {
      try { tabs = JSON.parse(await sh('curl', ['-s', `http://127.0.0.1:${port}/json/list`], 8000)); } catch (e) { await sleep(1200); }
    }
    const page = (tabs || []).find(t => t.type === 'page' && t.url.includes('aialec.cn'));
    if (!page) throw new Error('no page tab');
    raw = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { raw.onopen = res; raw.onerror = () => rej(new Error('ws error')); setTimeout(() => rej(new Error('ws timeout')), 15000); });
    let id = 0; const pend = new Map();
    raw.onmessage = (ev2) => {
      try { const m = JSON.parse(ev2.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } } catch (e) {}
    };
    function send(method, params) {
      return new Promise((res, rej) => {
        const i = ++id; pend.set(i, res);
        raw.send(JSON.stringify({ id: i, method, params: params || {} }));
        setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error(method + ' timeout')); } }, 30000);
      });
    }
    async function ev(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      return r.result && r.result.result ? r.result.result.value : undefined;
    }
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: URL0 });
    await sleep(6000);
    await ev("var v=document.getElementById('webmc-voice-consent'); if(v) v.remove(); 'ok'");
    let ok = false;
    for (let i = 0; i < 45 && !ok; i++) {
      await sleep(2000);
      const r = await ev("(function(){ try{ var b=window.bot; if(b&&b.entity&&b.game&&b.game.gameMode){ return 'ready'; } }catch(e){} return 'wait'; })()");
      if (r === 'ready') ok = true;
    }
    if (!ok) throw new Error('login timeout');
    await ev("window.bot._client.chat('/login " + P + "')");
    await sleep(4000);

    // ===== 1. 围挡布柱 =====
    await rc('fill 18 -1 -6 20 -1 -4 minecraft:magma_block');
    await rc('fill 18 0 -6 20 2 -4 minecraft:water');
    await rc('fill 17 0 -7 21 3 -3 minecraft:white_concrete');
    await rc('fill 18 0 -6 20 0 -4 minecraft:water');
    await rc('time set midnight');
    await rc('minecraft:kill @e[type=zombie]');
    await sleep(2500);

    // ===== 2. bot 站坑边北面，动态算 yaw/pitch 面向坑心 =====
    await rc('tp qanim7test 19 0 -8');
    await sleep(1500);
    const aim = await ev(`(function(){
      try{
        var b=window.bot; if(!b||!b.look) return 'no-bot';
        var p=b.entity.position;
        var tx=19, ty=-1, tz=-5;                 // 坑心（岩浆顶）
        var dx=tx-p.x, dz=tz-p.z, dy=ty-p.y;
        var yaw=Math.atan2(-dx, dz);
        var dist=Math.sqrt(dx*dx+dz*dz);
        var pitch=Math.atan2(dy, dist);
        b.look(yaw, pitch, true);
        return JSON.stringify({bot:{x:+p.x.toFixed(1),z:+p.z.toFixed(1)}, yaw:+yaw.toFixed(2), pitch:+pitch.toFixed(2)});
      }catch(e){ return 'ERR:'+e.message; }
    })()`);
    console.log('AIM:', aim);
    await sleep(4000);

    // ===== 3. 猴补 renderer.render 计数 + 相机旋转 dump =====
    await ev(`(function(){
      try{
        var W=window.appViewer&&window.appViewer.backend&&window.appViewer.backend.soundSystem&&window.appViewer.backend.soundSystem.worldRenderer;
        if(!W||!W.renderer||W.__bubProbe) return 'skip';
        W.__bubProbe={n:0, lastCalls:0, meshes:0, camRot:null, meshPos:null};
        var R=W.renderer, orig=R.render.bind(R);
        R.render=function(sc, cam){
          if(sc&&sc===W.__bubbleScene){
            W.__bubProbe.n++;
            var mc=0, mp=null;
            sc.traverse(function(o){ if(o.isMesh){ mc++; if(!mp) mp={x:+o.position.x.toFixed(2),y:+o.position.y.toFixed(2),z:+o.position.z.toFixed(2)}; } });
            W.__bubProbe.meshes=mc; W.__bubProbe.meshPos=mp;
            if(cam){ W.__bubProbe.camRot={x:+cam.rotation.x.toFixed(2),y:+cam.rotation.y.toFixed(2),z:+cam.rotation.z.toFixed(2)}; }
          }
          var r=orig(sc, cam);
          try{ if(sc&&sc===W.__bubbleScene){ W.__bubProbe.lastCalls=R.info?R.info.render.calls:-1; } }catch(e){}
          return r;
        };
        return 'patched';
      }catch(e){ return 'ERR:'+e.message; }
    })()`);
    await sleep(9000);

    const probe = await ev(`(function(){
      try{
        var W=window.appViewer&&window.appViewer.backend&&window.appViewer.backend.soundSystem&&window.appViewer.backend.soundSystem.worldRenderer;
        var P=W&&W.__bubProbe, B=window.__bubble||{};
        var bp=window.bot&&window.bot.entity&&window.bot.entity.position;
        var byaw=window.bot&&window.bot.entity&&window.bot.entity.yaw;
        return JSON.stringify({
          passN:P?P.n:-1, lastCalls:P?P.lastCalls:-1, meshes:P?P.meshes:-1,
          meshPos:P?P.meshPos:null, camRot:P?P.camRot:null, botYaw:byaw!=null?+byaw.toFixed(2):null,
          bub:{v:B.v,n:B.n,spawned:B.spawned,cols:B.cols,err:B.err},
          bot:bp?{x:+bp.x.toFixed(1),y:+bp.y.toFixed(1),z:+bp.z.toFixed(1)}:null
        });
      }catch(e){ return 'ERR:'+e.message; }
    })()`);
    console.log('BUBBLE_V7_PROBE:', probe);

    // ===== 4. 僵尸行走摆幅 =====
    await rc('summon minecraft:zombie 19 0 -6 {NoAI:0}');
    await sleep(1500);
    await rc('data merge entity @e[type=zombie,limit=1] {Attributes:[{Name:"generic.movement_speed",Base:0.35}]}');
    await ev("(function(){ var b=window.bot; if(b&&b.look){ var p=b.entity.position; b.look(Math.atan2(-(19-p.x),-6-p.z), 0.5, true); } return 1; })()");
    const zs = [];
    for (let i = 0; i < 16; i++) {
      await sleep(650);
      const z = await ev(`(function(){
        try{
          var E=window.world&&window.world.entities&&window.world.entities.entities; if(!E) return null;
          for(var k in E){ var e=E[k]; if(e&&e.type==='zombie'){
            var b=e.model&&e.model.bones||{};
            function rx(n){ var o=b[n]; return o&&o.rotation?{x:+o.rotation.x.toFixed(3)}:null; }
            var p=e.position||{};
            return JSON.stringify({v:+Math.hypot(p.vx||0,p.vz||0).toFixed(3), ra:rx('rightArm'), la:rx('leftArm'), rl:rx('rightLeg'), ll:rx('leftLeg')});
          }}
          return null;
        }catch(e){ return 'ERR:'+e.message; }
      })()`);
      if (z && z !== 'null') zs.push(z);
    }
    console.log('ZOMBIE_FRAMES:', zs.length);
    zs.forEach((z, i) => console.log('  Z' + i + ':', z));

    // ===== 5. heap =====
    const h0 = await ev("(performance.memory? performance.memory.usedJSHeapSize : -1)");
    await sleep(45000);
    const h1 = await ev("(performance.memory? performance.memory.usedJSHeapSize : -1)");
    console.log('HEAP: t0=' + h0 + ' t45=' + h1 + ' deltaMB=' + ((h1 - h0) / 1048576).toFixed(1));

    // 清理测试僵尸
    await rc('minecraft:kill @e[type=zombie]');
    console.log('DIAG14_DONE');
  } catch (e) {
    console.log('FATAL:', e && e.message);
  } finally {
    try { if (raw) raw.close(); } catch (e) {}
    try { EP.kill(); } catch (e) {}
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
    process.exit(0);
  }
})();
