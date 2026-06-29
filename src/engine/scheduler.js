/**
 * FORGE Engine — Scheduler (CPU Scheduling Algorithms)
 *
 * Treats each bot as a CPU core and each order as a process.
 * Supports four classic scheduling strategies:
 *   FCFS, SJF, Priority (preemptive), Round Robin
 *
 * The scheduler is ticked once per simulation step by the factory
 * orchestrator.  It never writes to the database directly — all state
 * mutations go through the database layer so constraints and transactions
 * are honoured.
 *
 * @module engine/scheduler
 */

// ─── Strategy Helpers ──────────────────────────────────────────────────────

/**
 * Pick the next order from the queue using the active strategy.
 * Returns the **index** into `queue` (or -1 if nothing suitable).
 */
function pickNext(queue, strategy) {
  if (queue.length === 0) return -1;

  switch (strategy) {
    case 'FCFS':
      return 0; // first in, first out

    case 'SJF':
      // Shortest build_time first (non-preemptive)
      let shortest = 0;
      for (let i = 1; i < queue.length; i++) {
        if (queue[i].build_time < queue[shortest].build_time) shortest = i;
      }
      return shortest;

    case 'Priority':
      // Highest numeric priority first (Critical=3 > Rush=2 > Standard=1)
      let highest = 0;
      for (let i = 1; i < queue.length; i++) {
        if (queue[i].priority > queue[highest].priority) highest = i;
        // Tie-break by arrival time
        else if (
          queue[i].priority === queue[highest].priority &&
          queue[i].arrived_tick < queue[highest].arrived_tick
        ) {
          highest = i;
        }
      }
      return highest;

    case 'RoundRobin':
      return 0; // always take front of queue

    default:
      return 0;
  }
}

// ─── Scheduler Class ───────────────────────────────────────────────────────

export class Scheduler {
  /**
   * @param {string} [strategy='FCFS']  Initial scheduling algorithm.
   * @param {number} [timeQuantum=4]    Ticks per round-robin slice.
   */
  constructor(strategy = 'FCFS', timeQuantum = 4) {
    /** @type {Object[]} Orders waiting to be dispatched (copies of DB rows). */
    this.readyQueue = [];

    /** @type {string} Active scheduling algorithm name. */
    this.strategy = strategy;

    /** @type {number} Round-robin time quantum in ticks. */
    this.timeQuantum = timeQuantum;

    /** @type {Object[]} Timeline entries for the Gantt chart. */
    this.timeline = [];

    /**
     * Metrics accumulators.
     * @type {{ completedOrders: number, totalWaitTime: number,
     *          totalLeadTime: number, busyTicks: number, totalTicks: number }}
     */
    this._metrics = {
      completedOrders: 0,
      totalWaitTime: 0,
      totalLeadTime: 0,
      busyTicks: 0,
      totalTicks: 0,
      totalBots: 0,
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Enqueue an order for scheduling.
   * The order must already be inserted into the database.
   * @param {Object} order  A row object from the orders table.
   */
  addOrder(order) {
    this.readyQueue.push(order);
  }

  /**
   * Change the scheduling strategy.
   * @param {'FCFS'|'SJF'|'Priority'|'RoundRobin'} name
   */
  setStrategy(name) {
    const allowed = ['FCFS', 'SJF', 'Priority', 'RoundRobin'];
    if (!allowed.includes(name)) {
      throw new Error(`Unknown scheduling strategy: ${name}. Must be one of ${allowed.join(', ')}`);
    }
    this.strategy = name;
  }

  /**
   * Set the round-robin time quantum.
   * @param {number} n  Must be >= 1.
   */
  setTimeQuantum(n) {
    if (n < 1) throw new Error('Time quantum must be >= 1');
    this.timeQuantum = Math.floor(n);
  }

  /**
   * Run one scheduling cycle.
   *
   * @param {Object[]} bots       Bot row objects from the database.
   * @param {Object}   database   The FactoryDatabase instance.
   * @param {number}   currentTick
   */
  tick(bots, database, currentTick) {
    this._metrics.totalTicks++;
    this._metrics.totalBots = bots.length;

    // ── 1.  Progress active bots ──────────────────────────────────────
    for (const bot of bots) {
      if (bot.status !== 'BUSY' || !bot.current_order) continue;

      const order = database.findByPk('orders', bot.current_order);
      if (!order) continue;

      this._metrics.busyTicks++;

      // Advance progress
      const newProgress = order.progress + 1;
      database.update('orders', (r) => r.order_id === order.order_id, {
        progress: newProgress,
      });

      database.update('bots', (r) => r.bot_id === bot.bot_id, {
        ticks_busy: bot.ticks_busy + 1,
      });

      // ── Round Robin preemption check ────────────────────────────────
      if (this.strategy === 'RoundRobin') {
        const rrRemaining = (order.rr_remaining ?? this.timeQuantum) - 1;

        if (newProgress >= order.build_time) {
          // Order completes — handle below
        } else if (rrRemaining <= 0) {
          // Quantum expired — preempt
          this._preempt(bot, order, database, currentTick);
          continue; // don't fall through to completion check
        } else {
          database.update('orders', (r) => r.order_id === order.order_id, {
            rr_remaining: rrRemaining,
          });
        }
      }

      // ── Priority preemption check ───────────────────────────────────
      if (this.strategy === 'Priority' && this.readyQueue.length > 0) {
        const bestIdx = pickNext(this.readyQueue, 'Priority');
        if (bestIdx >= 0 && this.readyQueue[bestIdx].priority > order.priority) {
          this._preempt(bot, order, database, currentTick);
          continue;
        }
      }

      // ── Completion check ────────────────────────────────────────────
      if (newProgress >= order.build_time) {
        this._completeOrder(bot, order, database, currentTick);
      }
    }

    // ── 2.  Dispatch waiting orders to free bots ──────────────────────
    const freeBots = bots.filter((b) => b.status === 'IDLE');
    for (const bot of freeBots) {
      if (this.readyQueue.length === 0) break;

      const idx = pickNext(this.readyQueue, this.strategy);
      if (idx < 0) break;

      const order = this.readyQueue.splice(idx, 1)[0];
      this._assignOrder(bot, order, database, currentTick);
    }
  }

  /**
   * Return current scheduling metrics.
   * @returns {{ avgWaitTime: number, avgLeadTime: number, throughput: number, utilization: number }}
   */
  getMetrics() {
    const c = this._metrics.completedOrders || 1; // avoid /0
    const totalBotTicks = this._metrics.totalTicks * Math.max(this._metrics.totalBots, 1);
    return {
      avgWaitTime:  +(this._metrics.totalWaitTime / c).toFixed(2),
      avgLeadTime:  +(this._metrics.totalLeadTime / c).toFixed(2),
      throughput:   +(this._metrics.completedOrders / Math.max(this._metrics.totalTicks, 1)).toFixed(4),
      utilization:  +(this._metrics.busyTicks / Math.max(totalBotTicks, 1) * 100).toFixed(1),
      completedOrders: this._metrics.completedOrders,
      queueLength: this.readyQueue.length,
    };
  }

  /** Get the Gantt-chart timeline. */
  getTimeline() {
    return [...this.timeline];
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  /**
   * Assign an order to a bot.
   * @private
   */
  _assignOrder(bot, order, database, currentTick) {
    const txId = database.beginTransaction();
    try {
      database.update('orders', (r) => r.order_id === order.order_id, {
        status: 'IN_PROGRESS',
        bot_id: bot.bot_id,
        started_tick: order.started_tick ?? currentTick,
        rr_remaining: this.timeQuantum,
      }, txId);

      database.update('bots', (r) => r.bot_id === bot.bot_id, {
        status: 'BUSY',
        current_order: order.order_id,
      }, txId);

      database.commitTransaction(txId);

      // Record timeline entry
      this.timeline.push({
        orderId: order.order_id,
        botId: bot.bot_id,
        startTick: currentTick,
        endTick: null, // filled on completion or preemption
      });
    } catch (err) {
      database.rollbackTransaction(txId);
      // Put order back in queue
      this.readyQueue.unshift(order);
    }
  }

  /**
   * Preempt an order from a bot and put it back in the queue.
   * @private
   */
  _preempt(bot, order, database, currentTick) {
    const txId = database.beginTransaction();
    try {
      // Close timeline entry
      const openEntry = this.timeline.find(
        (e) => e.orderId === order.order_id && e.botId === bot.bot_id && e.endTick === null
      );
      if (openEntry) openEntry.endTick = currentTick;

      database.update('orders', (r) => r.order_id === order.order_id, {
        status: 'PENDING',
        bot_id: null,
        rr_remaining: this.timeQuantum,
      }, txId);

      database.update('bots', (r) => r.bot_id === bot.bot_id, {
        status: 'IDLE',
        current_order: null,
      }, txId);

      database.commitTransaction(txId);

      // Re-read the order row so the queue copy is fresh
      const fresh = database.findByPk('orders', order.order_id);
      if (fresh) this.readyQueue.push(fresh);
    } catch (err) {
      database.rollbackTransaction(txId);
    }
  }

  /**
   * Mark an order as completed and free the bot.
   * @private
   */
  _completeOrder(bot, order, database, currentTick) {
    const txId = database.beginTransaction();
    try {
      // Close timeline entry
      const openEntry = this.timeline.find(
        (e) => e.orderId === order.order_id && e.botId === bot.bot_id && e.endTick === null
      );
      if (openEntry) openEntry.endTick = currentTick;

      database.update('orders', (r) => r.order_id === order.order_id, {
        status: 'COMPLETED',
        finished_tick: currentTick,
      }, txId);

      database.update('bots', (r) => r.bot_id === bot.bot_id, {
        status: 'IDLE',
        current_order: null,
      }, txId);

      // Credit revenue
      const cash = database.getGlobal('cash');
      database.setGlobal('cash', cash + order.revenue, txId);
      
      database.insert('transactions', {
        tx_id: txId,
        timestamp: Date.now(),
        type: 'SALE',
        amount: order.revenue,
        description: `Order ${order.product} completed`,
      }, txId);

      database.commitTransaction(txId);

      // Accumulate metrics
      const startedAt = order.started_tick ?? currentTick;
      this._metrics.completedOrders++;
      this._metrics.totalWaitTime += (startedAt - order.arrived_tick);
      this._metrics.totalLeadTime += (currentTick - order.arrived_tick);
    } catch (err) {
      database.rollbackTransaction(txId);
    }
  }
}

export default Scheduler;
