/**
 * @module paging
 * Virtual Memory / Paging Engine
 *
 * Models warehouse blocks as physical memory frames in a factory simulator.
 * Implements demand paging with a page table, TLB, swap space, multiple
 * replacement algorithms (FIFO, LRU, OPT), per-bot working sets, and
 * thrashing detection.
 *
 * All virtual pages are string IDs (e.g. 'page-steel-0').
 * Physical frames are integers in [0, totalFrames).
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Rolling window size used to compute page-fault rate. */
const FAULT_RATE_WINDOW = 20;

/** Maximum number of recent-fault records kept for the UI. */
const MAX_RECENT_FAULTS = 10;

/** Page-fault-rate threshold above which we flag thrashing. */
const THRASHING_THRESHOLD = 0.6;

// ─── Helper: ring buffer for the rolling fault-rate window ───────────────────

/**
 * Fixed-capacity circular buffer that stores boolean values (fault / no-fault)
 * and maintains a running sum so the fault rate can be read in O(1).
 */
class RollingWindow {
  /**
   * @param {number} capacity - Number of entries in the window.
   */
  constructor(capacity) {
    /** @type {number} */
    this.capacity = capacity;
    /** @type {boolean[]} */
    this.buffer = new Array(capacity).fill(false);
    /** @type {number} Index where the next value will be written. */
    this.index = 0;
    /** @type {number} Running count of `true` entries in the buffer. */
    this.sum = 0;
    /** @type {number} Total entries written (may exceed capacity). */
    this.count = 0;
  }

  /**
   * Record whether the most recent access was a page fault.
   * @param {boolean} wasFault
   */
  push(wasFault) {
    // Subtract the value we are about to overwrite (only matters once the
    // buffer has been filled at least once).
    if (this.count >= this.capacity) {
      this.sum -= this.buffer[this.index] ? 1 : 0;
    }
    this.buffer[this.index] = wasFault;
    this.sum += wasFault ? 1 : 0;
    this.index = (this.index + 1) % this.capacity;
    this.count++;
  }

  /**
   * Fault rate over the window (0–1).  Returns 0 when no accesses recorded.
   * @returns {number}
   */
  rate() {
    const n = Math.min(this.count, this.capacity);
    return n === 0 ? 0 : this.sum / n;
  }
}

// ─── Page-table entry ────────────────────────────────────────────────────────

/**
 * @typedef {Object} PageTableEntry
 * @property {string}  virtualPage    - String ID of the virtual page.
 * @property {number}  physicalFrame  - Frame number (meaningful only when valid).
 * @property {boolean} valid          - true ⇒ page is resident in RAM.
 * @property {boolean} dirty          - true ⇒ page has been written since load.
 * @property {boolean} referenced     - true ⇒ page was accessed recently.
 * @property {string}  materialId     - Material this page carries.
 * @property {number}  loadedAtTick   - Tick at which the page was loaded into RAM.
 * @property {number}  lastAccessTick - Tick of the most recent access.
 */

/**
 * Create a fresh page-table entry (initially invalid / in swap).
 * @param {string} virtualPage
 * @param {string} materialId
 * @returns {PageTableEntry}
 */
function makeEntry(virtualPage, materialId) {
  return {
    virtualPage,
    physicalFrame: -1,
    valid: false,
    dirty: false,
    referenced: false,
    materialId,
    loadedAtTick: 0,
    lastAccessTick: 0,
  };
}

// ─── PagingManager ───────────────────────────────────────────────────────────

/**
 * Virtual-memory paging manager.
 *
 * Manages a fixed set of physical frames, a per-page page table, a small TLB
 * cache, a swap-space backing store, and per-bot working-set tracking.
 */
export class PagingManager {
  /**
   * @param {number} [totalFrames=32]  - Number of physical memory frames.
   * @param {number} [tlbSize=4]       - Number of TLB entries.
   * @param {number} [swapSize=64]     - Maximum pages that can reside in swap.
   */
  constructor(totalFrames = 32, tlbSize = 4, swapSize = 64) {
    // ── Capacity config ──────────────────────────────────────────────────
    /** @type {number} */
    this.totalFrames = totalFrames;
    /** @type {number} */
    this.tlbSize = tlbSize;
    /** @type {number} */
    this.swapSize = swapSize;

    // ── Page table (virtualPage → PageTableEntry) ────────────────────────
    /** @type {Map<string, PageTableEntry>} */
    this.pageTable = new Map();

    // ── Physical frames ──────────────────────────────────────────────────
    // frames[i] = virtualPage string that occupies frame i, or null if free.
    /** @type {(string|null)[]} */
    this.frames = new Array(totalFrames).fill(null);

    // ── TLB (ordered newest → oldest for simple eviction) ────────────────
    /**
     * Each entry: { virtualPage: string, physicalFrame: number }
     * @type {Array<{virtualPage: string, physicalFrame: number}>}
     */
    this.tlb = [];

    /** @type {number} */
    this.tlbHits = 0;
    /** @type {number} */
    this.tlbMisses = 0;

    // ── Swap space ───────────────────────────────────────────────────────
    // Set of virtual-page IDs currently residing in swap.
    /** @type {Set<string>} */
    this.swapSpace = new Set();

    /** @type {number} */
    this.swapReads = 0;
    /** @type {number} */
    this.swapWrites = 0;

    // ── Replacement algorithm ────────────────────────────────────────────
    /** @type {'FIFO'|'LRU'|'OPT'} */
    this.algorithm = 'LRU';

    // ── Stats ────────────────────────────────────────────────────────────
    /** @type {number} Total page faults since construction. */
    this.pageFaults = 0;

    /** Rolling window for fault-rate calculation. */
    this._faultWindow = new RollingWindow(FAULT_RATE_WINDOW);

    /** @type {boolean} */
    this.thrashing = false;

    /**
     * Most-recent page-fault details (newest first), capped at
     * {@link MAX_RECENT_FAULTS}.
     * @type {Array<{tick: number, virtualPage: string, evictedPage: string|null, frameNumber: number}>}
     */
    this.recentFaults = [];

    // ── Working sets (botId → Set<string>) ───────────────────────────────
    /** @type {Map<string, Set<string>>} */
    this.workingSets = new Map();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Page registration (pages start in swap)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register a new virtual page in the system.  The page begins life in swap
   * space — it will only be loaded into a physical frame on first access
   * (demand paging).
   *
   * @param {string} virtualPage - Unique page identifier.
   * @param {string} materialId  - Material carried by this page.
   */
  registerPage(virtualPage, materialId) {
    if (this.pageTable.has(virtualPage)) return; // already registered

    const entry = makeEntry(virtualPage, materialId);
    this.pageTable.set(virtualPage, entry);

    // Place in swap (secondary storage) initially.
    this.swapSpace.add(virtualPage);
  }

  /**
   * Remove a virtual page from the system entirely.
   * Frees its physical frame (if resident) and removes it from swap & TLB.
   *
   * @param {string} virtualPage
   */
  unregisterPage(virtualPage) {
    const entry = this.pageTable.get(virtualPage);
    if (!entry) return;

    // Free the physical frame if the page is currently in RAM.
    if (entry.valid && entry.physicalFrame >= 0) {
      this.frames[entry.physicalFrame] = null;
    }

    // Remove from swap if present.
    this.swapSpace.delete(virtualPage);

    // Evict from TLB.
    this._tlbRemove(virtualPage);

    // Remove from page table.
    this.pageTable.delete(virtualPage);

    // Scrub from any working sets.
    for (const ws of this.workingSets.values()) {
      ws.delete(virtualPage);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Core: page access (demand paging entry point)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Access a virtual page.  Implements TLB lookup → page-table walk →
   * demand paging with replacement.
   *
   * @param {string}   virtualPage    - Page to access.
   * @param {string}   botId          - Bot performing the access.
   * @param {number}   currentTick    - Current simulation tick.
   * @param {string[]} [futureAccesses] - Optional ordered list of future page
   *   accesses (used by OPT algorithm).  Ignored by FIFO / LRU.
   * @returns {{
   *   hit: boolean,
   *   pageFault: boolean,
   *   evicted: string|null,
   *   tlbHit: boolean,
   *   frameNumber: number
   * }}
   */
  accessPage(virtualPage, botId, currentTick, futureAccesses) {
    const result = {
      hit: false,
      pageFault: false,
      evicted: null,
      tlbHit: false,
      frameNumber: -1,
    };

    // Page must have been registered first.
    const entry = this.pageTable.get(virtualPage);
    if (!entry) {
      // Auto-register as unknown material so we degrade gracefully.
      this.registerPage(virtualPage, 'unknown');
      return this.accessPage(virtualPage, botId, currentTick, futureAccesses);
    }

    // ── 1. TLB lookup ────────────────────────────────────────────────────
    const tlbFrame = this._tlbLookup(virtualPage);
    if (tlbFrame !== -1) {
      // TLB hit — fast path.
      this.tlbHits++;
      result.tlbHit = true;
      result.hit = true;
      result.frameNumber = tlbFrame;

      // Update access metadata.
      entry.lastAccessTick = currentTick;
      entry.referenced = true;

      this._faultWindow.push(false);
      this._updateThrashing();
      return result;
    }

    // TLB miss.
    this.tlbMisses++;

    // ── 2. Page-table walk ───────────────────────────────────────────────
    if (entry.valid) {
      // Page is in RAM — just a TLB miss, not a page fault.
      result.hit = true;
      result.frameNumber = entry.physicalFrame;

      entry.lastAccessTick = currentTick;
      entry.referenced = true;

      // Promote into TLB.
      this._tlbInsert(virtualPage, entry.physicalFrame);

      this._faultWindow.push(false);
      this._updateThrashing();
      return result;
    }

    // ── 3. PAGE FAULT — demand paging ────────────────────────────────────
    result.pageFault = true;
    this.pageFaults++;

    // Find a free frame, or evict one.
    let frame = this._findFreeFrame();
    if (frame === -1) {
      // Must evict — choose victim via the selected algorithm.
      const victim = this._selectVictim(futureAccesses);
      result.evicted = victim;
      frame = this._evict(victim, currentTick);
    }

    // Load page from swap into the frame.
    this._loadFromSwap(virtualPage, frame, currentTick);

    result.frameNumber = frame;

    // Insert into TLB.
    this._tlbInsert(virtualPage, frame);

    // Record fault for UI.
    this.recentFaults.unshift({
      tick: currentTick,
      virtualPage,
      evictedPage: result.evicted,
      frameNumber: frame,
    });
    if (this.recentFaults.length > MAX_RECENT_FAULTS) {
      this.recentFaults.length = MAX_RECENT_FAULTS;
    }

    this._faultWindow.push(true);
    this._updateThrashing();
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Algorithm selection & TLB flush
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set the page-replacement algorithm.
   * @param {'FIFO'|'LRU'|'OPT'} name
   */
  setAlgorithm(name) {
    const upper = name.toUpperCase();
    if (upper !== 'FIFO' && upper !== 'LRU' && upper !== 'OPT') {
      throw new Error(`Unknown replacement algorithm: "${name}"`);
    }
    this.algorithm = /** @type {'FIFO'|'LRU'|'OPT'} */ (upper);
  }

  /**
   * Invalidate every entry in the TLB.  The page table and frames are
   * unaffected — subsequent accesses will simply re-populate the TLB via
   * page-table walks.
   */
  flushTLB() {
    this.tlb.length = 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Working-set management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Replace the working set for a bot.
   *
   * @param {string}   botId   - Bot identifier.
   * @param {string[]} pageIds - Virtual-page IDs the bot currently needs.
   */
  updateWorkingSet(botId, pageIds) {
    this.workingSets.set(botId, new Set(pageIds));
  }

  /**
   * Return the current working set for a bot (as a plain array).
   *
   * @param {string} botId
   * @returns {string[]}
   */
  getWorkingSet(botId) {
    const ws = this.workingSets.get(botId);
    return ws ? [...ws] : [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  State snapshot (for UI rendering)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build a complete, JSON-serialisable snapshot of the paging subsystem
   * for the front-end to render.
   *
   * @returns {{
   *   pageTable: Array<{virtualPage: string, physicalFrame: number, valid: boolean, dirty: boolean, referenced: boolean, materialId: string}>,
   *   tlb: Array<{virtualPage: string, physicalFrame: number}>,
   *   tlbStats: {hits: number, misses: number, hitRate: number},
   *   swapSpace: Array<{virtualPage: string, materialId: string}>,
   *   swapStats: {reads: number, writes: number, utilization: number},
   *   frames: Array<{frameNumber: number, virtualPage: string, materialId: string}|null>,
   *   stats: {pageFaults: number, pageFaultRate: number, thrashing: boolean, algorithm: string},
   *   recentFaults: Array<{tick: number, virtualPage: string, evictedPage: string|null, frameNumber: number}>,
   *   workingSets: {[botId: string]: string[]}
   * }}
   */
  getState() {
    // ── Page table (array form) ──────────────────────────────────────────
    const pageTableArr = [];
    for (const entry of this.pageTable.values()) {
      pageTableArr.push({
        virtualPage: entry.virtualPage,
        physicalFrame: entry.physicalFrame,
        valid: entry.valid,
        dirty: entry.dirty,
        referenced: entry.referenced,
        materialId: entry.materialId,
      });
    }

    // ── TLB snapshot (shallow copy) ──────────────────────────────────────
    const tlbSnapshot = this.tlb.map(e => ({
      virtualPage: e.virtualPage,
      physicalFrame: e.physicalFrame,
    }));

    // ── TLB stats ────────────────────────────────────────────────────────
    const totalTlb = this.tlbHits + this.tlbMisses;
    const tlbStats = {
      hits: this.tlbHits,
      misses: this.tlbMisses,
      hitRate: totalTlb === 0 ? 0 : this.tlbHits / totalTlb,
    };

    // ── Swap space ───────────────────────────────────────────────────────
    const swapArr = [];
    for (const vp of this.swapSpace) {
      const entry = this.pageTable.get(vp);
      swapArr.push({
        virtualPage: vp,
        materialId: entry ? entry.materialId : 'unknown',
      });
    }

    const swapStats = {
      reads: this.swapReads,
      writes: this.swapWrites,
      utilization: this.swapSize === 0 ? 0 : this.swapSpace.size / this.swapSize,
    };

    // ── Physical frames ──────────────────────────────────────────────────
    const framesArr = this.frames.map((vp, i) => {
      if (vp === null) return null;
      const entry = this.pageTable.get(vp);
      return {
        frameNumber: i,
        virtualPage: vp,
        materialId: entry ? entry.materialId : 'unknown',
      };
    });

    // ── Aggregate stats ──────────────────────────────────────────────────
    const stats = {
      pageFaults: this.pageFaults,
      pageFaultRate: this._faultWindow.rate(),
      thrashing: this.thrashing,
      algorithm: this.algorithm,
    };

    // ── Working sets (plain object) ──────────────────────────────────────
    const wsSerialized = {};
    for (const [botId, ws] of this.workingSets) {
      wsSerialized[botId] = [...ws];
    }

    return {
      pageTable: pageTableArr,
      tlb: tlbSnapshot,
      tlbStats,
      swapSpace: swapArr,
      swapStats,
      frames: framesArr,
      stats,
      recentFaults: this.recentFaults.slice(), // defensive copy
      workingSets: wsSerialized,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Private: TLB operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Look up a virtual page in the TLB.
   * @param {string} virtualPage
   * @returns {number} Physical frame number, or -1 on miss.
   * @private
   */
  _tlbLookup(virtualPage) {
    for (let i = 0; i < this.tlb.length; i++) {
      if (this.tlb[i].virtualPage === virtualPage) {
        // Move to front (MRU position) so LRU eviction is trivial.
        const entry = this.tlb.splice(i, 1)[0];
        this.tlb.unshift(entry);
        return entry.physicalFrame;
      }
    }
    return -1;
  }

  /**
   * Insert or update a mapping in the TLB.  Evicts the LRU entry (last
   * position) when the TLB is full.
   *
   * @param {string} virtualPage
   * @param {number} physicalFrame
   * @private
   */
  _tlbInsert(virtualPage, physicalFrame) {
    // Remove stale entry for the same page if present.
    this._tlbRemove(virtualPage);

    // Evict LRU (tail) when full.
    if (this.tlb.length >= this.tlbSize) {
      this.tlb.pop();
    }

    // Insert at front (MRU position).
    this.tlb.unshift({ virtualPage, physicalFrame });
  }

  /**
   * Remove a virtual page from the TLB (if present).
   * @param {string} virtualPage
   * @private
   */
  _tlbRemove(virtualPage) {
    const idx = this.tlb.findIndex(e => e.virtualPage === virtualPage);
    if (idx !== -1) {
      this.tlb.splice(idx, 1);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Private: frame management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Find the index of the first free physical frame.
   * @returns {number} Frame index, or -1 if none available.
   * @private
   */
  _findFreeFrame() {
    for (let i = 0; i < this.totalFrames; i++) {
      if (this.frames[i] === null) return i;
    }
    return -1;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Private: page replacement
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Select a victim page to evict according to the current algorithm.
   *
   * @param {string[]} [futureAccesses] - Future access sequence (OPT only).
   * @returns {string} Virtual-page ID of the chosen victim.
   * @private
   */
  _selectVictim(futureAccesses) {
    // Gather all resident (valid) pages.
    const residents = [];
    for (const entry of this.pageTable.values()) {
      if (entry.valid) residents.push(entry);
    }

    if (residents.length === 0) {
      throw new Error('No resident pages to evict — this should never happen.');
    }

    switch (this.algorithm) {
      case 'FIFO':
        return this._selectFIFO(residents);
      case 'LRU':
        return this._selectLRU(residents);
      case 'OPT':
        return this._selectOPT(residents, futureAccesses);
      default:
        return this._selectLRU(residents);
    }
  }

  /**
   * FIFO: evict the page that was loaded into RAM earliest.
   * @param {PageTableEntry[]} residents
   * @returns {string}
   * @private
   */
  _selectFIFO(residents) {
    let victim = residents[0];
    for (let i = 1; i < residents.length; i++) {
      if (residents[i].loadedAtTick < victim.loadedAtTick) {
        victim = residents[i];
      }
    }
    return victim.virtualPage;
  }

  /**
   * LRU: evict the page whose last access is the oldest.
   * @param {PageTableEntry[]} residents
   * @returns {string}
   * @private
   */
  _selectLRU(residents) {
    let victim = residents[0];
    for (let i = 1; i < residents.length; i++) {
      if (residents[i].lastAccessTick < victim.lastAccessTick) {
        victim = residents[i];
      }
    }
    return victim.virtualPage;
  }

  /**
   * OPT (Bélády's algorithm): evict the page that will not be used for the
   * longest time in the future.  Falls back to LRU when `futureAccesses` is
   * not provided.
   *
   * @param {PageTableEntry[]} residents
   * @param {string[]} [futureAccesses]
   * @returns {string}
   * @private
   */
  _selectOPT(residents, futureAccesses) {
    if (!futureAccesses || futureAccesses.length === 0) {
      return this._selectLRU(residents);
    }

    // Build a map: virtualPage → index of next use in futureAccesses.
    // Pages not present in futureAccesses are assigned Infinity (best victims).
    let victim = residents[0];
    let farthest = -1;

    for (const entry of residents) {
      const nextUse = futureAccesses.indexOf(entry.virtualPage);
      const distance = nextUse === -1 ? Infinity : nextUse;

      if (distance === Infinity) {
        // Can't do better — this page is never used again.
        return entry.virtualPage;
      }

      if (distance > farthest) {
        farthest = distance;
        victim = entry;
      }
    }

    return victim.virtualPage;
  }

  /**
   * Evict a resident page: mark it invalid, write it to swap, free the frame,
   * and purge it from the TLB.
   *
   * @param {string} virtualPage - Page to evict.
   * @param {number} currentTick - Current simulation tick (unused but kept for
   *   future dirty-write tracking).
   * @returns {number} The frame that was freed.
   * @private
   */
  _evict(virtualPage, currentTick) {
    const entry = this.pageTable.get(virtualPage);
    if (!entry || !entry.valid) {
      throw new Error(`Cannot evict non-resident page "${virtualPage}".`);
    }

    const frame = entry.physicalFrame;

    // Write to swap (always, so the page can be recovered later).
    this.swapSpace.add(virtualPage);
    this.swapWrites++;

    // Update page-table entry.
    entry.valid = false;
    entry.physicalFrame = -1;
    entry.referenced = false;
    // Keep dirty flag — it would matter if we tracked clean/dirty swaps.

    // Free the physical frame.
    this.frames[frame] = null;

    // Remove stale TLB entry.
    this._tlbRemove(virtualPage);

    return frame;
  }

  /**
   * Load a page from swap into a physical frame.
   *
   * @param {string} virtualPage
   * @param {number} frame        - Target physical frame (must be free).
   * @param {number} currentTick
   * @private
   */
  _loadFromSwap(virtualPage, frame, currentTick) {
    const entry = this.pageTable.get(virtualPage);
    if (!entry) {
      throw new Error(`Cannot load unregistered page "${virtualPage}".`);
    }

    // Read from swap.
    if (this.swapSpace.has(virtualPage)) {
      this.swapSpace.delete(virtualPage);
      this.swapReads++;
    }

    // Populate frame.
    this.frames[frame] = virtualPage;

    // Update page-table entry.
    entry.valid = true;
    entry.physicalFrame = frame;
    entry.dirty = false;
    entry.referenced = true;
    entry.loadedAtTick = currentTick;
    entry.lastAccessTick = currentTick;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Private: thrashing detection
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Re-evaluate whether the system is thrashing based on the rolling
   * page-fault rate.
   * @private
   */
  _updateThrashing() {
    this.thrashing = this._faultWindow.rate() >= THRASHING_THRESHOLD;
  }
}

export default PagingManager;
