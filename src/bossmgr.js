// BOSS MANAGER (V9). ONE reusable controller for the three AI-only bosses (Kevin 11, Vilgax, Albedo): spawn / despawn / respawn each one independently, the pop-up UI,
// the shared gameplay pause while the pop-up is open, boss-bar layout (only spawned bosses have a bar). The bosses themselves own their cleanup (Kevin.despawn / Albedo.despawn);
// this class only decides WHICH state each button shows and calls the right method, so repeated clicks can never create a second instance.
export class BossManager {
  /** list: [{ id, name, boss }] in display order */
  constructor(game, list) {
    this.g = game; this.list = list; this.open = false; this.byId = {}; for (const e of list) this.byId[e.id] = e;
    game.bossList = list.map(e => e.boss);
    this.root = document.getElementById('bossmgr'); this.panel = this.root && this.root.querySelector('.bm-panel'); this.rows = {};
    if (this.root) for (const e of list) {
      const row = this.root.querySelector('[data-boss="' + e.id + '"]'); if (!row) continue;
      const btn = row.querySelector('button'), st = row.querySelector('.bm-status b');
      btn.addEventListener('mousedown', ev => ev.stopPropagation());
      btn.addEventListener('click', ev => { ev.stopPropagation(); this.act(e.id); btn.blur(); });
      this.rows[e.id] = { row, btn, st };
    }
    if (this.root) this.root.addEventListener('mousedown', ev => { if (ev.target === this.root) { ev.stopPropagation(); if (this.onClose) this.onClose(); else this.setOpen(false); } });      // a click on the dimmed backdrop closes it
    const x = this.root && this.root.querySelector('.bm-x'); if (x) { x.addEventListener('mousedown', ev => ev.stopPropagation()); x.addEventListener('click', ev => { ev.stopPropagation(); if (this.onClose) this.onClose(); else this.setOpen(false); }); }
    this.updateUI();
  }
  state(id) { return this.byId[id].boss.mgrState; }
  /** what the button of this boss does right now: despawned -> SPAWN, alive -> DESPAWN, defeated -> RESPAWN */
  actionFor(id) { const s = this.state(id); return s === 'despawned' ? 'spawn' : s === 'alive' ? 'despawn' : 'respawn'; }
  act(id) { const a = this.actionFor(id); return this[a](id); }
  spawn(id) { const e = this.byId[id]; if (!e || e.boss.present) return false; const ok = e.boss.bossSpawn(); if (ok) this.g.hud.toast(e.name.toUpperCase() + ' SPAWNED'); this.updateUI(); return ok; }
  despawn(id) { const e = this.byId[id]; if (!e || !e.boss.present) return false; const ok = e.boss.bossDespawn(); if (ok) this.g.hud.toast(e.name.toUpperCase() + ' DESPAWNED'); this.updateUI(); return ok; }
  /** RESPAWN: resets the existing (defeated) instance - never creates another */
  respawn(id) { const e = this.byId[id]; if (!e) return false; if (!e.boss.present) return this.spawn(id); e.boss.aiOn = true; e.boss.respawn(); this.g.hud.toast(e.name.toUpperCase() + ' RESPAWNED'); this.updateUI(); return true; }
  get anyPresent() { return this.list.some(e => e.boss.present); }
  setOpen(v) { this.open = !!v; if (this.root) { this.root.dataset.open = this.open ? '1' : '0'; this.root.hidden = false; if (!this.open) { clearTimeout(this._h); this._h = setTimeout(() => { if (!this.open) this.root.hidden = true; }, 220); } else clearTimeout(this._h); } this.updateUI(); }
  updateUI() {
    for (const e of this.list) {
      const r = this.rows[e.id]; if (!r) continue; const s = e.boss.mgrState, a = s === 'despawned' ? 'SPAWN' : s === 'alive' ? 'DESPAWN' : 'RESPAWN';
      if (r.st.textContent !== s.toUpperCase()) r.st.textContent = s.toUpperCase(); r.row.dataset.state = s;
      if (r.btn.textContent !== a) r.btn.textContent = a; r.btn.dataset.act = a.toLowerCase();
    }
  }
  /** every frame the simulation runs: bar layout (only spawned bosses, stacked from the top), the player's vitals bar (it belongs to no boss) and the pop-up statuses */
  update() {
    let i = 0; for (const e of this.list) { const b = e.boss, bar = b.hudK && b.hudK.boss; if (bar && b.present) { bar.style.top = (58 + 70 * i) + 'px'; i++; } }
    const k = this.byId.kevin && this.byId.kevin.boss; if (k && !k.present && k.hudK) k.hudK.vitals(this.g);
    if (this.open) this.updateUI();
  }
}
