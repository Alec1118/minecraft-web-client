# _patch_tntguard20.py：TNTGuard 扩展——禁末影水晶放置/右键触发/命令放置（2026-10-25 Alec 要求）
import sys

p = '/home/alec/alectools_build/src/com/aialec/alectools/TNTGuard.java'
s = open(p, encoding='utf-8').read()

if 'onInteract' in s:
    print('SKIP: v20 already patched')
    sys.exit(0)

# 1. import
old_imp = 'import org.bukkit.event.player.PlayerCommandPreprocessEvent;'
new_imp = old_imp + '\nimport org.bukkit.event.player.PlayerInteractEvent;'
assert old_imp in s, 'import anchor missing'
s = s.replace(old_imp, new_imp, 1)

# 2. onPlace: TNT -> TNT|END_CRYSTAL
old_place = '''        if (e.getBlockPlaced().getType() != Material.TNT) return;
        String w = e.getBlock().getWorld().getName().toLowerCase();
        if (NO_TNT_WORLDS.contains(w)) {
            e.setCancelled(true);
            e.getPlayer().sendMessage("\u00a7c\u6b64\u4e16\u754c\u7981\u6b62\u653e\u7f6e TNT");
        }'''
new_place = '''        Material mt = e.getBlockPlaced().getType();
        if (mt != Material.TNT && mt != Material.END_CRYSTAL) return;
        String w = e.getBlock().getWorld().getName().toLowerCase();
        if (NO_TNT_WORLDS.contains(w)) {
            e.setCancelled(true);
            e.getPlayer().sendMessage("\u00a7c\u6b64\u4e16\u754c\u7981\u6b62\u653e\u7f6e TNT / \u672b\u5f71\u6c34\u6676");
        }'''
assert old_place in s, 'onPlace anchor missing'
s = s.replace(old_place, new_place, 1)

# 3. onInteract 新方法（插在 onIgnite 后）
old_ign = '''    @EventHandler(ignoreCancelled = true)
    public void onIgnite(BlockIgniteEvent e) {
        Block b = e.getBlock();
        if (b.getType() != Material.TNT) return;
        String w = b.getWorld().getName().toLowerCase();
        if (NO_TNT_WORLDS.contains(w)) e.setCancelled(true);
    }'''
new_ign = old_ign + '''

    /** \u26052026-10-25 \u7528\u6237\u8981\u6c42\uff1a\u7981\u672b\u5f71\u6c34\u6676\u53f3\u952e\u89e6\u53d1\uff08\u653e\u7f6e\u5df2\u62e6\uff1b\u7206\u70b8\u5df2\u7531 onEntityExplode \u5168\u5c40\u62e6\uff09 */
    @EventHandler(ignoreCancelled = true)
    public void onInteract(PlayerInteractEvent e) {
        if (e.getClickedBlock() == null || e.getClickedBlock().getType() != Material.END_CRYSTAL) return;
        if (NO_TNT_WORLDS.contains(e.getPlayer().getWorld().getName().toLowerCase())) {
            e.setCancelled(true);
            e.getPlayer().sendMessage("\u00a7c\u6b64\u4e16\u754c\u7981\u6b62\u89e6\u53d1\u672b\u5f71\u6c34\u6676");
        }
    }'''
assert old_ign in s, 'onIgnite anchor missing'
s = s.replace(old_ign, new_ign, 1)

# 4. onCmd: tnt -> tnt|end_crystal
old_cmd = '''        if ((m.startsWith("setblock ") || m.startsWith("fill ")) && m.contains("tnt")) {
            e.setCancelled(true);
            e.getPlayer().sendMessage("\u00a7c\u6b64\u4e16\u754c\u7981\u6b62\u7528\u547d\u4ee4\u653e\u7f6e TNT");
        }'''
new_cmd = '''        if ((m.startsWith("setblock ") || m.startsWith("fill "))
                && (m.contains("tnt") || m.contains("end_crystal"))) {
            e.setCancelled(true);
            e.getPlayer().sendMessage("\u00a7c\u6b64\u4e16\u754c\u7981\u6b62\u7528\u547d\u4ee4\u653e\u7f6e TNT / \u672b\u5f71\u6c34\u6676");
        }'''
assert old_cmd in s, 'onCmd anchor missing'
s = s.replace(old_cmd, new_cmd, 1)

open(p, 'w', encoding='utf-8').write(s)
print('OK: 4 patches applied (import/onPlace/onInteract/onCmd)')
