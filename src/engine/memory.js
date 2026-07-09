/**
 * FORGE Engine — Warehouse Memory Manager
 *
 * Models the physical warehouse as a contiguous array of "memory blocks".
 * Materials are allocated into contiguous runs (like malloc), and a small
 * cache sits in front for fast repeated access (simulating CPU cache /
 * page replacement).
 *
 * @module engine/memory
 */

// ─── WarehouseMemory ───────────────────────────────────────────────────────

export class WarehouseMemory {
  /**
   * @param {number} [totalSize=32]       Number of warehouse blocks.
   * @param {number} [cacheSize=5]        Number of cache slots.
   * @param {'FIFO'|'LRU'} [cacheStrategy='LRU']
   */
  constructor(totalSize = 32, cacheSize = 5, cacheStrategy = 'LRU') {
    /** @type {number} Total warehouse blocks. */
    this.totalSize = totalSize;

    /**
     * Block array.  Each slot is either `null` (free) or an object
     * `{ materialId: string, orderId?: string }`.
     * @type {(null|{materialId:string, orderId?:string})[]}
     */
    this.blocks = new Array(totalSize).fill(null);

    // ── Cache ──

    /** @type {number} Max cache slots. */
    this.cacheSize = cacheSize;

    /**
     * Cache entries — each is `{ materialId, accessTick }`.
     * @type {{ materialId: string, accessTick: number }[]}
     */
    this.cache = [];

    /** @type {'FIFO'|'LRU'} */
    this.cacheStrategy = cacheStrategy;

    /**
     * Ordered list of materialIds for LRU tracking.
     * Most-recently-used at the **end**.
     * @type {string[]}
     */
    this.cacheHistory = [];

    /** @type {{ hits: number, misses: number }} */
    this.cacheStats = { hits: 0, misses: 0 };

    /** Internal tick counter bumped on each cache access. */
    this._accessTick = 0;
  }

  // ── Block allocation ────────────────────────────────────────────────────

  /**
   * Allocate `size` contiguous blocks for a material (First-Fit).
   *
   * @param {string} materialId
   * @param {number} size          Number of contiguous blocks needed.
   * @param {Object} [database]    Optional FactoryDatabase; if provided the
   *                               material row's warehouse_start / warehouse_size
   *                               are updated.
   * @param {string} [orderId]     Optional order that triggered the allocation.
   * @returns {number}             Start index of the allocation, or **-1** if
   *                               no contiguous run of `size` was found.
   */
  allocate(materialId, size, database, orderId) {
    if (size <= 0) return -1;

    // First-Fit: scan for the first run of `size` free blocks.
    let runStart = -1;
    let runLen = 0;

    for (let i = 0; i < this.totalSize; i++) {
      if (this.blocks[i] === null) {
        if (runLen === 0) runStart = i;
        runLen++;
        if (runLen === size) {
          // Found a suitable run — mark blocks.
          for (let j = runStart; j < runStart + size; j++) {
            this.blocks[j] = { materialId, orderId: orderId ?? null };
          }

          // Sync database record
          if (database) {
            database.update(
              'materials',
              (r) => r.material_id === materialId,
              { warehouse_start: runStart, warehouse_size: size }
            );
          }

          return runStart;
        }
      } else {
        runLen = 0;
      }
    }

    return -1; // allocation failed — fragmented or full
  }

  /**
   * Free all blocks belonging to `materialId`.
   *
   * @param {string} materialId
   * @param {Object} [database]
   * @returns {number} Number of blocks freed.
   */
  free(materialId, database) {
    let freed = 0;
    for (let i = 0; i < this.totalSize; i++) {
      if (this.blocks[i] && this.blocks[i].materialId === materialId) {
        this.blocks[i] = null;
        freed++;
      }
    }

    if (database) {
      database.update(
        'materials',
        (r) => r.material_id === materialId,
        { warehouse_start: null, warehouse_size: null }
      );
    }

    return freed;
  }

  /**
   * Free exactly `qty` blocks belonging to `materialId`.
   *
   * @param {string} materialId
   * @param {number} qty
   * @returns {number} Number of blocks freed.
   */
  freeQuantity(materialId, qty) {
    let freed = 0;
    for (let i = 0; i < this.totalSize; i++) {
      if (freed >= qty) break;
      if (this.blocks[i] && this.blocks[i].materialId === materialId) {
        this.blocks[i] = null;
        freed++;
      }
    }
    return freed;
  }

  // ── Defragmentation ─────────────────────────────────────────────────────

  /**
   * Compact all occupied blocks to the left of the array (like memory
   * compaction).  Returns a list of moves so the UI can animate them.
   *
   * @param {Object} [database]
   * @returns {{ from: number, to: number, materialId: string }[]}
   */
  defragment(database) {
    const moves = [];
    let writeIdx = 0;

    for (let readIdx = 0; readIdx < this.totalSize; readIdx++) {
      if (this.blocks[readIdx] !== null) {
        if (readIdx !== writeIdx) {
          moves.push({
            from: readIdx,
            to: writeIdx,
            materialId: this.blocks[readIdx].materialId,
          });
          this.blocks[writeIdx] = this.blocks[readIdx];
          this.blocks[readIdx] = null;
        }
        writeIdx++;
      }
    }

    // Update material DB records to reflect new positions
    if (database) {
      // Group blocks by materialId to find new contiguous ranges
      const ranges = this._computeRanges();
      for (const [mid, range] of Object.entries(ranges)) {
        database.update(
          'materials',
          (r) => r.material_id === mid,
          { warehouse_start: range.start, warehouse_size: range.size }
        );
      }
    }

    return moves;
  }

  /**
   * Calculate fragmentation as a percentage.
   *
   * Fragmentation = 1 - (largestFreeRun / totalFreeBlocks).
   * Returns 0 when there are no free blocks or all free blocks are contiguous.
   *
   * @returns {number} 0–100
   */
  getFragmentation() {
    let totalFree = 0;
    let maxRun = 0;
    let currentRun = 0;

    for (let i = 0; i < this.totalSize; i++) {
      if (this.blocks[i] === null) {
        totalFree++;
        currentRun++;
        if (currentRun > maxRun) maxRun = currentRun;
      } else {
        currentRun = 0;
      }
    }

    if (totalFree === 0) return 0;
    return +((1 - maxRun / totalFree) * 100).toFixed(1);
  }

  /**
   * Get the size of the largest contiguous free space.
   * @returns {number}
   */
  getMaxContiguousBlocks() {
    let maxRun = 0;
    let currentRun = 0;
    for (let i = 0; i < this.totalSize; i++) {
      if (this.blocks[i] === null) {
        currentRun++;
        if (currentRun > maxRun) maxRun = currentRun;
      } else {
        currentRun = 0;
      }
    }
    return maxRun;
  }

  // ── Warehouse expansion / shrink ────────────────────────────────────────

  /**
   * Expand the warehouse by `amount` blocks.
   * @param {number} amount
   */
  expand(amount) {
    for (let i = 0; i < amount; i++) this.blocks.push(null);
    this.totalSize += amount;
  }

  /**
   * Shrink the warehouse by `amount` blocks from the end.
   * Only free trailing blocks can be removed.
   * @param {number} amount
   * @returns {number} actual blocks removed
   */
  shrink(amount) {
    let removed = 0;
    while (removed < amount && this.totalSize > 0) {
      if (this.blocks[this.totalSize - 1] !== null) break; // can't shrink occupied
      this.blocks.pop();
      this.totalSize--;
      removed++;
    }
    return removed;
  }

  // ── Cache (page replacement) ────────────────────────────────────────────

  /**
   * Access a material through the cache.
   *
   * @param {string} materialId
   * @returns {{ hit: boolean, evicted: string|null }}
   */
  accessCache(materialId) {
    this._accessTick++;
    let evicted = null;

    // Check for cache hit
    const existing = this.cache.find((e) => e.materialId === materialId);
    if (existing) {
      this.cacheStats.hits++;
      // Update access time (for LRU)
      existing.accessTick = this._accessTick;
      this._touchHistory(materialId);
      return { hit: true, evicted: null };
    }

    // Cache miss
    this.cacheStats.misses++;

    // Evict if full
    if (this.cache.length >= this.cacheSize) {
      evicted = this._evict();
    }

    // Insert into cache
    this.cache.push({ materialId, accessTick: this._accessTick });
    this._touchHistory(materialId);

    return { hit: false, evicted };
  }

  /**
   * Set the cache replacement strategy.
   * @param {'FIFO'|'LRU'} strategy
   */
  setCacheStrategy(strategy) {
    if (strategy !== 'FIFO' && strategy !== 'LRU') {
      throw new Error(`Unknown cache strategy: ${strategy}`);
    }
    this.cacheStrategy = strategy;
  }

  /** Get a snapshot of the cache for rendering. */
  getCacheState() {
    return {
      entries: this.cache.map((e) => ({ ...e })),
      strategy: this.cacheStrategy,
      stats: { ...this.cacheStats },
      hitRate: this.cacheStats.hits + this.cacheStats.misses > 0
        ? +((this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses)) * 100).toFixed(1)
        : 0,
    };
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  /**
   * Return the block array for rendering.
   * @returns {(null|{materialId:string, orderId?:string})[]}
   */
  getBlocks() {
    return this.blocks.map((b) => (b ? { ...b } : null));
  }

  /** Get summary stats. */
  getStats() {
    const used = this.blocks.filter((b) => b !== null).length;
    return {
      totalSize: this.totalSize,
      used,
      free: this.totalSize - used,
      utilization: +((used / Math.max(this.totalSize, 1)) * 100).toFixed(1),
      fragmentation: this.getFragmentation(),
    };
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  /** Evict one cache entry based on strategy. Returns evicted materialId. */
  _evict() {
    let victimIdx = 0;

    if (this.cacheStrategy === 'LRU') {
      // Least-recently-used: the entry with the smallest accessTick
      let minTick = Infinity;
      for (let i = 0; i < this.cache.length; i++) {
        if (this.cache[i].accessTick < minTick) {
          minTick = this.cache[i].accessTick;
          victimIdx = i;
        }
      }
    }
    // FIFO: victimIdx stays 0 (first in)

    const evicted = this.cache.splice(victimIdx, 1)[0];
    // Remove from history
    this.cacheHistory = this.cacheHistory.filter((m) => m !== evicted.materialId);
    return evicted.materialId;
  }

  /** Touch an entry in the LRU history. */
  _touchHistory(materialId) {
    this.cacheHistory = this.cacheHistory.filter((m) => m !== materialId);
    this.cacheHistory.push(materialId);
  }

  /** Compute contiguous ranges per materialId in the block array. */
  _computeRanges() {
    const ranges = {};
    for (let i = 0; i < this.totalSize; i++) {
      const b = this.blocks[i];
      if (b === null) continue;
      const mid = b.materialId;
      if (!ranges[mid]) {
        ranges[mid] = { start: i, size: 1 };
      } else {
        // Extend the range (after defrag they're contiguous)
        ranges[mid].size++;
      }
    }
    return ranges;
  }
}

export default WarehouseMemory;
