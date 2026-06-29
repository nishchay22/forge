/**
 * FORGE Engine — Deadlock Detector
 *
 * Maintains a Resource Allocation Graph (RAG) and runs cycle detection
 * to find deadlocks among bots and machines.
 *
 * RAG semantics:
 *   - A **bot node** represents a process (CPU).
 *   - A **machine node** represents a resource.
 *   - An **assignment edge** goes from machine → bot  (machine is held by bot).
 *   - A **request edge** goes from bot → machine  (bot is waiting for machine).
 *   - A cycle in this directed graph indicates a deadlock.
 *
 * @module engine/deadlock
 */

// ─── Graph node types ──────────────────────────────────────────────────────

/** @enum {string} */
const NodeType = {
  BOT:     'bot',
  MACHINE: 'machine',
};

// ─── DeadlockDetector ──────────────────────────────────────────────────────

export class DeadlockDetector {
  constructor() {
    /**
     * Adjacency list representation.
     * Key = nodeId, Value = Set of nodeIds this node has edges pointing to.
     * @type {Map<string, Set<string>>}
     */
    this._adj = new Map();

    /**
     * Node metadata for rendering.
     * @type {Map<string, {id: string, type: string, label: string}>}
     */
    this._nodes = new Map();

    /**
     * Edge list for rendering.
     * @type {{from: string, to: string, type: 'assignment'|'request'}[]}
     */
    this._edges = [];

    /**
     * Last detected cycle (null if none).
     * @type {Object[]|null}
     */
    this._lastCycle = null;
  }

  // ── Graph construction ──────────────────────────────────────────────────

  /**
   * Rebuild the entire RAG from the current state of bots and the sync
   * manager.  Call this once per tick.
   *
   * @param {Object[]}    bots         Bot rows from the database.
   * @param {Object[]}    machines     Machine rows from the database.
   * @param {import('./sync.js').SyncManager} syncManager
   */
  updateGraph(bots, machines, syncManager) {
    this._adj.clear();
    this._nodes.clear();
    this._edges = [];

    // Register all nodes
    for (const bot of bots) {
      const nid = `bot:${bot.bot_id}`;
      this._nodes.set(nid, { id: nid, type: NodeType.BOT, label: bot.name });
      this._adj.set(nid, new Set());
    }

    for (const m of machines) {
      const nid = `machine:${m.machine_id}`;
      this._nodes.set(nid, { id: nid, type: NodeType.MACHINE, label: `${m.type} (${m.machine_id})` });
      this._adj.set(nid, new Set());
    }

    // Build edges from sync manager state
    for (const mState of syncManager.machines.values()) {
      const machineNid = `machine:${mState.id}`;

      // Assignment edges: machine → bot (for each bot holding a lock)
      for (const botId of mState.currentLocks) {
        const botNid = `bot:${botId}`;
        if (!this._adj.has(machineNid)) continue;
        this._adj.get(machineNid).add(botNid);
        this._edges.push({ from: machineNid, to: botNid, type: 'assignment' });
      }

      // Request edges: bot → machine (for each bot in the wait queue)
      for (const botId of mState.waitQueue) {
        const botNid = `bot:${botId}`;
        if (!this._adj.has(botNid)) continue;
        this._adj.get(botNid).add(machineNid);
        this._edges.push({ from: botNid, to: machineNid, type: 'request' });
      }
    }
  }

  // ── Cycle detection ─────────────────────────────────────────────────────

  /**
   * Detect a cycle in the RAG using DFS.
   *
   * @returns {Object[]|null}  Array of `{ nodeId, holdsResource?, wantsResource? }`
   *                           forming the cycle, or `null` if no deadlock.
   */
  detectCycle() {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    const parent = new Map();

    for (const nid of this._adj.keys()) {
      color.set(nid, WHITE);
      parent.set(nid, null);
    }

    let cycleNodes = null;

    /**
     * DFS visit.  Returns true if a cycle is found.
     * @param {string} u
     * @returns {boolean}
     */
    const dfs = (u) => {
      color.set(u, GRAY);

      for (const v of (this._adj.get(u) ?? [])) {
        if (color.get(v) === GRAY) {
          // Found a back edge u → v — extract cycle
          cycleNodes = this._extractCycle(parent, u, v);
          return true;
        }
        if (color.get(v) === WHITE) {
          parent.set(v, u);
          if (dfs(v)) return true;
        }
      }

      color.set(u, BLACK);
      return false;
    };

    for (const nid of this._adj.keys()) {
      if (color.get(nid) === WHITE) {
        if (dfs(nid)) break;
      }
    }

    this._lastCycle = cycleNodes;
    return cycleNodes;
  }

  /**
   * Extract the nodes forming a cycle from `v` back to `v` via the parent
   * chain ending at `u`.
   * @private
   */
  _extractCycle(parent, u, v) {
    const cycle = [];
    let cur = u;

    // Walk from u back to v through parent pointers
    while (cur !== v) {
      cycle.push(this._buildCycleEntry(cur));
      cur = parent.get(cur);
      if (cur === null) break; // safety
    }
    cycle.push(this._buildCycleEntry(v));
    cycle.reverse();

    return cycle;
  }

  /**
   * Build a human-readable cycle entry from a node id.
   * @private
   */
  _buildCycleEntry(nodeId) {
    const node = this._nodes.get(nodeId);
    const entry = { nodeId, label: node?.label ?? nodeId };

    if (nodeId.startsWith('bot:')) {
      const botId = nodeId.replace('bot:', '');
      entry.botId = botId;

      // What does this bot hold?
      const holds = [];
      for (const e of this._edges) {
        if (e.type === 'assignment' && e.to === nodeId) {
          holds.push(e.from.replace('machine:', ''));
        }
      }
      entry.holdsResource = holds.length > 0 ? holds : undefined;

      // What does this bot want?
      const wants = [];
      for (const e of this._edges) {
        if (e.type === 'request' && e.from === nodeId) {
          wants.push(e.to.replace('machine:', ''));
        }
      }
      entry.wantsResource = wants.length > 0 ? wants : undefined;
    }

    return entry;
  }

  // ── Visualisation ───────────────────────────────────────────────────────

  /**
   * Return the graph in a format suitable for rendering.
   *
   * @returns {{ nodes: Object[], edges: Object[], hasCycle: boolean, cycle: Object[]|null }}
   */
  getGraph() {
    const nodes = [];
    for (const n of this._nodes.values()) {
      const inCycle = this._lastCycle?.some((c) => c.nodeId === n.id) ?? false;
      nodes.push({ ...n, inCycle });
    }

    const edges = this._edges.map((e) => ({ ...e }));

    return {
      nodes,
      edges,
      hasCycle: this._lastCycle !== null,
      cycle: this._lastCycle,
    };
  }

  // ── Resolution helpers ──────────────────────────────────────────────────

  /**
   * Suggest the best "victim" bot to preempt for deadlock resolution.
   * Heuristic: the bot in the cycle with the least work done (ticks_busy).
   *
   * @param {Object[]} cycle       The cycle array returned by detectCycle().
   * @param {Object[]} botRows     Bot rows from the database.
   * @returns {{ botId: string, name: string, ticksBusy: number }|null}
   */
  suggestVictim(cycle, botRows) {
    if (!cycle || cycle.length === 0) return null;

    const botIdsInCycle = cycle
      .filter((c) => c.botId)
      .map((c) => c.botId);

    if (botIdsInCycle.length === 0) return null;

    let victim = null;
    let minWork = Infinity;

    for (const botId of botIdsInCycle) {
      const row = botRows.find((b) => b.bot_id === botId);
      if (!row) continue;
      if (row.ticks_busy < minWork) {
        minWork = row.ticks_busy;
        victim = { botId: row.bot_id, name: row.name, ticksBusy: row.ticks_busy };
      }
    }

    return victim;
  }
}

export default DeadlockDetector;
