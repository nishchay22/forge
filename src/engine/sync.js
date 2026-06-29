/**
 * FORGE Engine — Synchronization Manager
 *
 * Two subsystems:
 *
 * 1. **Machine Lock Manager** — Each machine has a capacity (max concurrent
 *    users).  Bots acquire / release locks; excess requesters are queued.
 *    This is essentially a counting semaphore per machine.
 *
 * 2. **Producer-Consumer Conveyor** — A bounded buffer (fixed-size ring)
 *    where production stages produce items and downstream stages consume
 *    them.  The conveyor can be visualised as the central belt between
 *    machines.
 *
 * A **chaos mode** toggle lets the player disable lock enforcement,
 * deliberately causing race conditions and defects.
 *
 * @module engine/sync
 */

// ─── SyncManager ──────────────────────────────────────────────────────────

export class SyncManager {
  constructor() {
    /**
     * Machine registry.
     * Keyed by machineId.
     * @type {Map<string, MachineState>}
     *
     * @typedef {Object} MachineState
     * @property {string}   id
     * @property {string}   type
     * @property {number}   capacity       Max concurrent locks.
     * @property {string[]} currentLocks   botIds holding a lock.
     * @property {string[]} waitQueue      botIds waiting for a lock.
     */
    this.machines = new Map();

    // ── Conveyor (bounded buffer) ──

    /** @type {number} Fixed buffer capacity. */
    this.bufferCapacity = 8;

    /** @type {(Object|null)[]}  Ring buffer slots. */
    this.buffer = new Array(this.bufferCapacity).fill(null);

    /** @type {number} Next write position. */
    this._writeIdx = 0;

    /** @type {number} Next read position. */
    this._readIdx = 0;

    /** @type {number} Number of items currently in the buffer. */
    this._bufferCount = 0;

    // ── Chaos mode ──

    /** @type {boolean} When true, lock checks are bypassed. */
    this.chaosMode = false;

    /** @type {number} Total defects caused by chaos mode. */
    this.defectCount = 0;

    /** @type {Object[]} Recent defect log entries. */
    this.defectLog = [];
  }

  // ── Machine registration ────────────────────────────────────────────────

  /**
   * Register a machine with the lock manager.
   * @param {string} machineId
   * @param {string} type       e.g. 'CNC', 'Laser', 'Welder'
   * @param {number} capacity   Max concurrent users.
   */
  registerMachine(machineId, type, capacity) {
    this.machines.set(machineId, {
      id: machineId,
      type,
      capacity,
      currentLocks: [],
      waitQueue: [],
    });
  }

  /**
   * Unregister a machine (must have no active locks).
   * @param {string} machineId
   * @returns {boolean}
   */
  unregisterMachine(machineId) {
    const m = this.machines.get(machineId);
    if (!m) return false;
    if (m.currentLocks.length > 0) return false;
    this.machines.delete(machineId);
    return true;
  }

  // ── Lock acquisition / release ──────────────────────────────────────────

  /**
   * Attempt to acquire a lock on a machine for a bot.
   *
   * - If chaos mode is on, the lock is always "granted" even if over
   *   capacity — but a defect is recorded.
   * - Otherwise, if capacity is available the lock is granted immediately.
   * - If not, the bot is added to the wait queue.
   *
   * @param {string} machineId
   * @param {string} botId
   * @returns {'GRANTED'|'QUEUED'|'CHAOS_GRANTED'}
   */
  acquireLock(machineId, botId) {
    const m = this.machines.get(machineId);
    if (!m) throw new Error(`Machine ${machineId} not registered`);

    // Already holding?
    if (m.currentLocks.includes(botId)) return 'GRANTED';

    // Chaos mode — bypass capacity
    if (this.chaosMode) {
      m.currentLocks.push(botId);
      if (m.currentLocks.length > m.capacity) {
        this.defectCount++;
        this.defectLog.push({
          tick: Date.now(),
          machineId,
          botId,
          message: `Race condition on ${m.type}: ${m.currentLocks.length} users but capacity is ${m.capacity}`,
        });
      }
      return 'CHAOS_GRANTED';
    }

    // Normal mode
    if (m.currentLocks.length < m.capacity) {
      m.currentLocks.push(botId);
      return 'GRANTED';
    }

    // Queue the bot if not already waiting
    if (!m.waitQueue.includes(botId)) {
      m.waitQueue.push(botId);
    }
    return 'QUEUED';
  }

  /**
   * Release a bot's lock on a machine.  If bots are waiting, the next in
   * line is granted the lock automatically.
   *
   * @param {string} machineId
   * @param {string} botId
   * @returns {{ released: boolean, promoted: string|null }}
   */
  releaseLock(machineId, botId) {
    const m = this.machines.get(machineId);
    if (!m) return { released: false, promoted: null };

    const idx = m.currentLocks.indexOf(botId);
    if (idx === -1) return { released: false, promoted: null };

    m.currentLocks.splice(idx, 1);

    // Promote next waiter
    let promoted = null;
    if (m.waitQueue.length > 0 && m.currentLocks.length < m.capacity) {
      promoted = m.waitQueue.shift();
      m.currentLocks.push(promoted);
    }

    return { released: true, promoted };
  }

  /**
   * Get bots waiting for a machine.
   * @param {string} machineId
   * @returns {string[]}
   */
  getWaiters(machineId) {
    return this.machines.get(machineId)?.waitQueue ?? [];
  }

  /**
   * Get full machine lock state for rendering.
   * @returns {Object[]}
   */
  getMachineStates() {
    const out = [];
    for (const m of this.machines.values()) {
      out.push({
        id: m.id,
        type: m.type,
        capacity: m.capacity,
        currentLocks: [...m.currentLocks],
        waitQueue: [...m.waitQueue],
        utilizationPct: +((m.currentLocks.length / m.capacity) * 100).toFixed(0),
      });
    }
    return out;
  }

  /**
   * Check if a specific bot holds a lock on a machine.
   * @param {string} machineId
   * @param {string} botId
   * @returns {boolean}
   */
  isHolding(machineId, botId) {
    return this.machines.get(machineId)?.currentLocks.includes(botId) ?? false;
  }

  /**
   * Check if a specific bot is waiting for a machine.
   * @param {string} machineId
   * @param {string} botId
   * @returns {boolean}
   */
  isWaiting(machineId, botId) {
    return this.machines.get(machineId)?.waitQueue.includes(botId) ?? false;
  }

  /**
   * Force-release all locks held by a bot (used during deadlock resolution).
   * @param {string} botId
   * @returns {string[]} machine ids that were unlocked
   */
  forceReleaseAll(botId) {
    const released = [];
    for (const [machineId, m] of this.machines) {
      const idx = m.currentLocks.indexOf(botId);
      if (idx !== -1) {
        m.currentLocks.splice(idx, 1);
        released.push(machineId);

        // Promote waiters
        while (m.waitQueue.length > 0 && m.currentLocks.length < m.capacity) {
          m.currentLocks.push(m.waitQueue.shift());
        }
      }
      // Also remove from wait queues
      const wIdx = m.waitQueue.indexOf(botId);
      if (wIdx !== -1) m.waitQueue.splice(wIdx, 1);
    }
    return released;
  }

  // ── Producer-Consumer Conveyor (bounded buffer) ─────────────────────────

  /**
   * Produce (enqueue) an item onto the conveyor belt.
   *
   * @param {Object} item  Arbitrary item payload (e.g. `{ partId, product }`).
   * @returns {boolean}    `true` if item was placed; `false` if buffer is full.
   */
  produce(item) {
    if (this._bufferCount >= this.bufferCapacity) return false; // full

    this.buffer[this._writeIdx] = item;
    this._writeIdx = (this._writeIdx + 1) % this.bufferCapacity;
    this._bufferCount++;
    return true;
  }

  /**
   * Consume (dequeue) the next item from the conveyor belt.
   *
   * @returns {Object|null}  The item, or `null` if buffer is empty.
   */
  consume() {
    if (this._bufferCount === 0) return null; // empty

    const item = this.buffer[this._readIdx];
    this.buffer[this._readIdx] = null;
    this._readIdx = (this._readIdx + 1) % this.bufferCapacity;
    this._bufferCount--;
    return item;
  }

  /**
   * Return the conveyor buffer state for rendering.
   * @returns {{ slots: (Object|null)[], count: number, capacity: number }}
   */
  getBufferState() {
    return {
      slots: this.buffer.map((s) => (s ? { ...s } : null)),
      count: this._bufferCount,
      capacity: this.bufferCapacity,
      readIdx: this._readIdx,
      writeIdx: this._writeIdx,
    };
  }

  // ── Chaos mode ──────────────────────────────────────────────────────────

  /**
   * Toggle chaos mode on/off.
   * @returns {boolean} New chaos mode state.
   */
  toggleChaosMode() {
    this.chaosMode = !this.chaosMode;
    return this.chaosMode;
  }
}

export default SyncManager;
