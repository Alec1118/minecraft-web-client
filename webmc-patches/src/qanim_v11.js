/* q-anim v11：bundle 渲染后驱动 + 动画让位 + 原版幅度（2026-10-25）
   v8 三病因（_diag5/_diag6 实测）：
   ① v8 的 rAF 早于 bundle 渲染循环注册 → 每帧先写后被 bundle 动画覆盖
      （实证：僵尸静止 vel=0.04，rightArm 却达 -0.255rad——bundle 攻击动画穿透）；
   ② capture 时机可能踩中 spawn/攻击帧 → rx 基准污染；
   ③ head 点头 + body 上下起伏 = Alec 所说"抽搐/脱离"观感来源。
   v9：
   - 挂 scene.onAfterRender（链式保留原回调）= bundle render 之后 = 最终写权；
   - 每骨让位检测：|cur - lastWrite| > 0.03 → bundle 正在动该骨 → 本帧不写，
     rx 同步为 cur；bundle 动画停下复位后 rx 自动回 default；
   - 只写 rotation.x，绝不碰 position（v6 骨头脱离教训）；删除 head/body 附加动作；
   - 幅度原版化：行走 腿±0.5/臂±0.42，奔跑(mv>0.55)×1.9，四足 leg 对角±0.45；
   - idle(mv≤0.02) 只写 rx 归位（严格 default 姿势，无微抽）；
   - 拉弓：持弓臂 -1.5rad（+z 前向=负值前摆，_hum4 实证），平滑过渡。 */
(function(){
  var W = window;
  function emTable(){
    try{
      var w = W.world;
      if (w && w.entities && w.entities.entities) return w.entities.entities;
      if (W.__wb && W.__wb.entities && W.__wb.entities.entities) return W.__wb.entities.entities;
      if (W.entities && W.entities.entities) return W.entities.entities;
    }catch(e){}
    return null;
  }
  var DEFS = new WeakMap(); // wrapper -> {legs,arms,last,ph,bowK,bowT,bow,holdArm,hum}
  var ready = false, frames = 0, mobs = 0, err = 0;
  W.__qAnim = {v:11, frames:0, mobs:0, hums:0, walk:0, idle:0, bow:0, yield:0, err:0};

  function findBones(w){
    var legs = [], arms = [], holdArm = null;
    w.traverse(function(o){
      if (!o.name || o.name.indexOf('bone_') !== 0) return;
      var n = o.name.slice(5);
      if (/^leg\d$/.test(n)) legs.push({b:o, n:n});
      else if (n === 'leftLeg' || n === 'rightLeg') legs.push({b:o, n:n});
      else if (n === 'leftArm' || n === 'rightArm') arms.push({b:o, n:n});
      else if (n === 'leftItem' || n === 'rightItem'){
        var has = false;
        o.traverse(function(c){ if (c.name && c.name.indexOf('custom_item') === 0) has = true; });
        if (has) holdArm = (n === 'leftItem' ? 'leftArm' : 'rightArm');
      }
    });
    return {legs:legs, arms:arms, holdArm:holdArm};
  }
  function capture(d, g){
    d.legs = g.legs.map(function(l){ return {b:l.b, n:l.n, rx:l.b.rotation.x, lw:l.b.rotation.x}; });
    d.arms = g.arms.map(function(l){ return {b:l.b, n:l.n, rx:l.b.rotation.x, lw:l.b.rotation.x}; });
    d.holdArm = g.holdArm;
    d.hum = g.arms.length > 0;
  }
  function hasBow(oe){
    try{
      var eq = oe.equipment;
      if (eq && eq[0] && eq[0].name && /bow/i.test(eq[0].name)) return true;
      var h = oe.heldItem;
      if (h && h.name && /bow/i.test(h.name)) return true;
    }catch(e){}
    return false;
  }
  function clamp(v, base){ return v > base + 1.3 ? base + 1.3 : (v < base - 1.3 ? base - 1.3 : v); }
  function tick(){
    frames++;
    try{
      var T = emTable();
      if (!T) return;
      var now = performance.now();
      for (var k in T){
        var w = T[k];
        if (!w || !w.originalEntity || !w.position) continue;
        var oe = w.originalEntity;
        if (oe.name === 'player' || oe.type === 'player') continue;
        var d = DEFS.get(w);
        if (d === undefined){
          var g = findBones(w);
          if (!g.legs.length) { DEFS.set(w, null); continue; }
          d = {legs:null, arms:null, last:null, ph:Math.random()*6.28, mvE:0, bowK:0, bowT:0, bow:false, holdArm:null, hum:false};
          capture(d, g);
          if (!d.legs.length) { DEFS.set(w, null); continue; }
          DEFS.set(w, d);
          mobs++;
          if (d.hum) W.__qAnim.hums++;
          continue;                                    // 首帧只采样 default，不写
        }
        if (!d) continue;
        var dt = d.last ? Math.min(0.1, (now - d.last.t) / 1000) : 0;
        var px = w.position.x, pz = w.position.z;
        var sp = d.last ? Math.hypot(px - d.last.x, pz - d.last.z) / Math.max(0.001, dt) : 0;
        d.last = {x:px, z:pz, t:now};
        var mv = Math.min(1, sp / 0.5);          // v11: 原版幅度——僵尸 0.35m/s -> mv=0.7 -> 臂 +-0.52rad(29度可见）
        d.mvE = d.mvE * 0.7 + mv * 0.3;          // v10: EMA 平滑，防 tp/瞬移假速单帧爆幅
        mv = d.mvE;
        var run = mv > 0.55 ? 1.9 : 1;
        if (mv > 0.02){ d.ph += dt * (5 + 7 * mv) * mv; W.__qAnim.walk++; }
        else { d.ph += dt * 0.6; W.__qAnim.idle++; }
        var sw = Math.sin(d.ph) * 0.85 * mv * run;   // v11: 腿 0.5->0.85 原版幅度
        var aw = Math.sin(d.ph) * 0.75 * mv * run;   // v11: 臂 0.42->0.75 原版幅度
        for (var i = 0; i < d.legs.length; i++){
          var L = d.legs[i];
          var cur = L.b.rotation.x;
          if (Math.abs(cur - L.lw) > 0.03){ L.rx = cur; L.lw = cur; W.__qAnim.yield++; continue; }  // bundle 让位
          var s;
          if (/^leg\d$/.test(L.n)) s = (parseInt(L.n.slice(3), 10) % 2) === 1 ? -sw : sw;   // 四足对角
          else s = (L.n === 'rightLeg') ? sw : -sw;                                          // 人形对角
          var nv = mv > 0.02 ? clamp(L.rx + s, L.rx) : L.rx;
          L.b.rotation.x = nv; L.lw = nv;
        }
        if (d.hum){
          d.bowT++;
          if (d.bowT % 30 === 1) d.bow = !!d.holdArm && hasBow(oe);
          var want = d.bow ? 1 : 0;
          d.bowK += (want - d.bowK) * Math.min(1, dt * 8);
          if (d.bowK > 0.02) W.__qAnim.bow++;
          for (var j = 0; j < d.arms.length; j++){
            var A = d.arms[j];
            var cur2 = A.b.rotation.x;
            if (Math.abs(cur2 - A.lw) > 0.03){ A.rx = cur2; A.lw = cur2; W.__qAnim.yield++; continue; }  // bundle 让位
            var nv2;
            if (d.bowK > 0.03 && A.n === d.holdArm){
              nv2 = A.rx - d.bowK * 1.5;
            } else {
              nv2 = mv > 0.02 ? clamp(A.rx + (A.n === 'rightArm' ? -aw : aw), A.rx) : A.rx;
            }
            A.b.rotation.x = nv2; A.lw = nv2;
          }
        }
      }
    }catch(e){ err++; W.__qAnim.err = err; if(err<=2){ try{ console.warn('q11err:', e && e.message); }catch(_){} } }
    W.__qAnim.frames = frames; W.__qAnim.mobs = mobs;
  }
  var boot = setInterval(function(){
    try{
      var w = W.world;
      if (w && w.scene && !w.scene.__q11){
        w.scene.__q11 = 1; ready = 1;
        var prev = w.scene.onAfterRender;               // 链式保留 bundle 可能已有的回调
        w.scene.onAfterRender = function(r, s, c){
          if (typeof prev === 'function') { try { prev(r, s, c); } catch(e){} }
          tick();
        };
        clearInterval(boot);
      }
    }catch(e){}
  }, 500);
  setTimeout(function(){ clearInterval(boot); }, 150000);
})();
