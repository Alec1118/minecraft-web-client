package com.aialec.alectools;

import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerInteractEvent;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * 世界规则（2026-10-10 用户要求）：
 *  主城(PholonCity)/跑酷(parkour)/PVP(pvp)：禁止放置 TNT、禁止点燃 TNT、禁止 setblock/fill 放 TNT（控制台例外）。
 *  （2026-10-19 用户要求：移除信标 §8[BEAM]/§8[W] 调试聊天广播与周期扫描——webmc 无解析端，
 *    纯聊天噪音 + 每 2s 全区块 tile-entity 扫描浪费主线程。）
 */
public class TNTGuard implements Listener {

    private static final Set<String> NO_TNT_WORLDS = new HashSet<>(Arrays.asList(
            "pholoncity", "aleccity", "parkour", "pvp"));

    public TNTGuard(AlecTools pl) {
    }

    // ---------------- TNT 禁令 ----------------

    @EventHandler(ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent e) {
        Material mt = e.getBlockPlaced().getType();
        if (mt != Material.TNT && mt != Material.END_CRYSTAL) return;
        String w = e.getBlock().getWorld().getName().toLowerCase();
        if (NO_TNT_WORLDS.contains(w)) {
            e.setCancelled(true);
            e.getPlayer().sendMessage("§c此世界禁止放置 TNT / 末影水晶");
        }
    }

    @EventHandler(ignoreCancelled = true)
    public void onIgnite(BlockIgniteEvent e) {
        Block b = e.getBlock();
        if (b.getType() != Material.TNT) return;
        String w = b.getWorld().getName().toLowerCase();
        if (NO_TNT_WORLDS.contains(w)) e.setCancelled(true);
    }

    /** ★2026-10-25 用户要求：禁末影水晶右键触发（放置已拦；爆炸已由 onEntityExplode 全局拦） */
    @EventHandler(ignoreCancelled = true)
    public void onInteract(PlayerInteractEvent e) {
        if (e.getClickedBlock() == null || e.getClickedBlock().getType() != Material.END_CRYSTAL) return;
        if (NO_TNT_WORLDS.contains(e.getPlayer().getWorld().getName().toLowerCase())) {
            e.setCancelled(true);
            e.getPlayer().sendMessage("§c此世界禁止触发末影水晶");
        }
    }

    /** ★2026-10-23 用户要求：禁 TNT 世界整个世界禁爆（TNT/苦力怕/床/末影水晶等实体爆炸一律不破坏方块；伤害保留） */
    @EventHandler(ignoreCancelled = true)
    public void onEntityExplode(EntityExplodeEvent e) {
        if (NO_TNT_WORLDS.contains(e.getEntity().getWorld().getName().toLowerCase())) e.setCancelled(true);
    }

    /** 方块爆炸（床在末地/下界等）同样整个世界禁止破坏 */
    @EventHandler(ignoreCancelled = true)
    public void onBlockExplode(BlockExplodeEvent e) {
        if (NO_TNT_WORLDS.contains(e.getBlock().getWorld().getName().toLowerCase())) e.setCancelled(true);
    }

    /** ★玩家命令 setblock/fill 带 tnt → 主城/跑酷/PVP 禁止（控制台/RCON 不走此事件，不受限） */
    @EventHandler(ignoreCancelled = true)
    public void onCmd(PlayerCommandPreprocessEvent e) {
        String w = e.getPlayer().getWorld().getName().toLowerCase();
        // ★2026-10-10 用户要求：空岛禁"把别人传到我这里"的命令（tpahere/tphere/tpaall），管理员放行
        if (w.equals("skyblock")) {
            String m0 = e.getMessage().toLowerCase().trim();
            if (m0.startsWith("/")) m0 = m0.substring(1);
            if (m0.startsWith("tpahere") || m0.startsWith("tphere") || m0.startsWith("tpaall")) {
                if (Moderation.opLevel(e.getPlayer()) < 2) {
                    e.setCancelled(true);
                    e.getPlayer().sendMessage("§c空岛生存禁止把别人传送到你的岛（/tpa 去别人的岛不受限）");
                }
            }
            return;
        }
        if (!NO_TNT_WORLDS.contains(w)) return;
        String m = e.getMessage().toLowerCase().trim();
        if (m.startsWith("/")) m = m.substring(1);
        if ((m.startsWith("setblock ") || m.startsWith("fill "))
                && (m.contains("tnt") || m.contains("end_crystal"))) {
            e.setCancelled(true);
            e.getPlayer().sendMessage("§c此世界禁止用命令放置 TNT / 末影水晶");
        }
    }
}
