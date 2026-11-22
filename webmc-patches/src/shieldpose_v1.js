/* q-shieldpose v1：举盾姿势主手偏右/副手偏左（Alec 需求）
   bundle 病根：userData._usingItem 且 /shield/i 时永远
     rightArm.rotation.set(-1.25,0,-.15,"ZYX") + rightArm.position.set(0,.5,.12)
   —— x=0 拉回中线（"比较居中"），且副手举盾也抬右手（应偏左）。
   修法：挂 world.scene.onAfterRender（bundle 每帧 .set() 强设之后覆盖）：
     - 盾在主手(heldItem=shield)：rightArm.position.x=+0.14（模型 +x=右，前向+z 推导）
     - 盾在副手(offhandItem=shield)：改用 leftArm 镜像（rotation z 反号 + position.x=-0.14），
       rightArm 复位 default（bundle 抬错了手）
     - 非举盾帧：复位一次（脏标记防重复写） */
(function () {
  if (globalThis.__shieldPose) return;
  var SP = globalThis.__shieldPose = { frames: 0, main: 0, off: 0, resets: 0, err: 0 };
  var DEFS = new WeakMap();

  function grab(w) {
    var sk = null;
    try { sk = w.skin || w; } catch (e) { return null; }
    var ra = sk.rightArm, la = sk.leftArm;
    if (!ra || !la) return null;
    var d = DEFS.get(w);
    if (!d) {
      d = {
        ra: { r: [ra.rotation.x, ra.rotation.y, ra.rotation.z], p: [ra.position.x, ra.position.y, ra.position.z], ord: ra.rotation.order },
        la: { r: [la.rotation.x, la.rotation.y, la.rotation.z], p: [la.position.x, la.position.y, la.position.z], ord: la.rotation.order },
        dirty: false
      };
      DEFS.set(w, d);
    }
    return { sk: sk, ra: ra, la: la, d: d };
  }
  function reset(g) {
    if (!g.d.dirty) return;
    g.ra.rotation.set(g.d.ra.r[0], g.d.ra.r[1], g.d.ra.r[2], g.d.ra.ord);
    g.ra.position.set(g.d.ra.p[0], g.d.ra.p[1], g.d.ra.p[2]);
    g.la.rotation.set(g.d.la.r[0], g.d.la.r[1], g.d.la.r[2], g.d.la.ord);
    g.la.position.set(g.d.la.p[0], g.d.la.p[1], g.d.la.p[2]);
    g.d.dirty = false; SP.resets++;
  }
  function tick() {
    SP.frames++;
    try {
      var T = (window.world && window.world.entities && window.world.entities.entities) || null;
      if (!T) return;
      for (var k in T) {
        var w = T[k];
        if (!w || !w.originalEntity) continue;
        var oe = w.originalEntity;
        if (!(oe.name === 'player' || oe.type === 'player')) continue;
        var g = grab(w);
        if (!g) continue;
        var ud = w.userData || {};
        if (!ud._usingItem || !/shield/i.test(ud._useItem || '')) { reset(g); continue; }
        var main = false;
        try { main = !!(oe.heldItem && /shield/i.test(oe.heldItem.name || '')); } catch (e) {}
        if (main) {
          // 主手：右臂抬高且偏右（bundle 抬右手 ✓，x 从 0 修正为 +0.14）
          g.ra.rotation.set(-1.25, 0, -0.15, 'ZYX');
          g.ra.position.set(0.14, 0.5, 0.12);
          // 左臂复位
          g.la.rotation.set(g.d.la.r[0], g.d.la.r[1], g.d.la.r[2], g.d.la.ord);
          g.la.position.set(g.d.la.p[0], g.d.la.p[1], g.d.la.p[2]);
          g.d.dirty = true; SP.main++;
        } else {
          // 副手：左手镜像 + 右手复位
          g.la.rotation.set(-1.25, 0, 0.15, 'ZYX');
          g.la.position.set(-0.14, 0.5, 0.12);
          g.ra.rotation.set(g.d.ra.r[0], g.d.ra.r[1], g.d.ra.r[2], g.d.ra.ord);
          g.ra.position.set(g.d.ra.p[0], g.d.ra.p[1], g.d.ra.p[2]);
          g.d.dirty = true; SP.off++;
        }
      }
    } catch (e) { SP.err++; }
  }
  var boot = setInterval(function () {
    try {
      var w = window.world;
      if (w && w.scene && !w.scene.__shp1) {
        w.scene.__shp1 = 1;
        var prev = w.scene.onAfterRender;
        w.scene.onAfterRender = function (r, s, c) {
          if (typeof prev === 'function') { try { prev(r, s, c); } catch (e) {} }
          tick();
        };
        clearInterval(boot);
        console.log('[shieldpose] v1 enabled (main->right offset, off->left mirror)');
      }
    } catch (e) {}
  }, 500);
  setTimeout(function () { clearInterval(boot); }, 180000);
})();
