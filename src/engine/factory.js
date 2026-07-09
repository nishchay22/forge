/**
 * FORGE Engine — Factory Orchestrator
 *
 * The single entry-point for the entire simulation.  Owns every sub-module,
 * seeds initial state, and advances the world one tick at a time.
 *
 * The React UI should:
 *   1. `const factory = new Factory();`
 *   2. Call `factory.tick()` on a setInterval (10–20 Hz).
 *   3. Call `factory.getState()` after each tick to re-render.
 *   4. Call action methods (hireBot, setStrategy, …) in response to UI events.
 *
 * @module engine/factory
 */

import { FactoryDatabase }  from './database.js';
import { Scheduler }        from './scheduler.js';
import { WarehouseMemory }  from './memory.js';
import { SyncManager }      from './sync.js';
import { DeadlockDetector } from './deadlock.js';

// ─── Product Catalog & Recipes ─────────────────────────────────────────────

/**
 * Each product lists the machines it requires (in order) and the materials
 * consumed.  `buildTime` is measured in ticks; `revenue` is earned on
 * completion.
 */
const PRODUCTS = {
  Chassis:  { buildTime: 8,  revenue: 1200, machines: ['CNC', 'Welder'],        materials: { Steel: 3, Polymer: 1 } },
  Shield:   { buildTime: 6,  revenue: 900,  machines: ['CNC', 'Laser'],         materials: { Steel: 2, Polymer: 2 } },
  Sensor:   { buildTime: 5,  revenue: 1100, machines: ['Laser'],                materials: { Silicon: 2, Copper: 1 } },
  Circuit:  { buildTime: 4,  revenue: 800,  machines: ['Laser'],                materials: { Silicon: 1, Copper: 2 } },
  Thruster: { buildTime: 10, revenue: 2000, machines: ['CNC', 'Welder', 'Laser'], materials: { Steel: 4, Copper: 2 } },
  Core:     { buildTime: 12, revenue: 3000, machines: ['CNC', 'Laser', 'Welder'], materials: { Silicon: 3, Steel: 2, Copper: 2 } },
};

const PRODUCT_NAMES = Object.keys(PRODUCTS);

const PRIORITY_MAP = {
  Standard: 1,
  Rush:     2,
  Critical: 3,
};

const PRIORITY_LABELS = Object.keys(PRIORITY_MAP);

// ─── Material Definitions ──────────────────────────────────────────────────

const INITIAL_MATERIALS = [
  { material_id: 'mat-steel',   name: 'Steel',   quantity: 40, unit_cost: 50,  warehouse_start: null, warehouse_size: null },
  { material_id: 'mat-polymer', name: 'Polymer', quantity: 30, unit_cost: 30,  warehouse_start: null, warehouse_size: null },
  { material_id: 'mat-silicon', name: 'Silicon', quantity: 25, unit_cost: 80,  warehouse_start: null, warehouse_size: null },
  { material_id: 'mat-copper',  name: 'Copper',  quantity: 35, unit_cost: 45,  warehouse_start: null, warehouse_size: null },
];

// ─── ID generators ─────────────────────────────────────────────────────────

let _orderSeq = 1;
let _botSeq   = 1;
let _machSeq  = 1;

function nextOrderId() { return `ORD-${String(_orderSeq++).padStart(4, '0')}`; }
function nextBotId()   { return `BOT-${String(_botSeq++).padStart(3, '0')}`; }
function nextMachId()  { return `MCH-${String(_machSeq++).padStart(3, '0')}`; }

const BOT_NAMES = [
  'Atlas', 'Bolt', 'Cog', 'Dynamo', 'Echo', 'Flux',
  'Gear', 'Hex', 'Ion', 'Jolt', 'Kilo', 'Lumen',
];

// ─── Factory Class ─────────────────────────────────────────────────────────

export class Factory {
  constructor() {
    // ── Sub-modules ──
    /** @type {FactoryDatabase} */
    this.database  = new FactoryDatabase();
    /** @type {Scheduler} */
    this.scheduler = new Scheduler('FCFS', 4);
    /** @type {WarehouseMemory} */
    this.warehouse = new WarehouseMemory(32, 5, 'LRU');
    /** @type {SyncManager} */
    this.sync      = new SyncManager();
    /** @type {DeadlockDetector} */
    this.deadlock  = new DeadlockDetector();

    // ── Simulation state ──
    /** @type {number} */
    this.tickCount = 0;
    /** @type {boolean} */
    this.paused = false;
    /** @type {number} 1, 2, or 4 */
    this.speed = 1;
    /** @type {boolean} */
    this.powerSurgeActive = false;

    /** @type {boolean} */
    this.autoDefrag = false;
    /** @type {boolean} */
    this.autoRestock = false;

    /** @type {Object[]} Rolling event ticker (most recent first). */
    this.gameEvents = [];
    /** @type {number} Max events to keep. */
    this._maxEvents = 50;

    // ── Seed initial data ──
    this._seedDatabase();
    this._seedWarehouse();
  }

  // ── Initialisation ──────────────────────────────────────────────────────

  /** Insert starting bots, machines, and materials into the database. */
  _seedDatabase() {
    const db = this.database;

    // Bots
    for (let i = 0; i < 3; i++) {
      const id = nextBotId();
      db.insert('bots', {
        bot_id: id,
        name: BOT_NAMES[i % BOT_NAMES.length],
        status: 'IDLE',
        current_order: null,
        hire_cost: 2000,
        ticks_busy: 0,
      });
    }

    // Machines
    const machineSpecs = [
      { type: 'CNC',    capacity: 2 },
      { type: 'Laser',  capacity: 2 },
      { type: 'Welder', capacity: 1 },
    ];
    for (const spec of machineSpecs) {
      const id = nextMachId();
      db.insert('machines', {
        machine_id: id,
        type: spec.type,
        capacity: spec.capacity,
        active_locks: [],
        wait_queue: [],
        locked_by: [],
      });
      this.sync.registerMachine(id, spec.type, spec.capacity);
    }

    // Materials
    for (const mat of INITIAL_MATERIALS) {
      db.insert('materials', { ...mat });
    }
  }

  /** Allocate initial material blocks in the warehouse. */
  _seedWarehouse() {
    const materials = this.database.select('materials');
    for (const mat of materials) {
      // Each unit of material occupies 1 warehouse block
      const blocksNeeded = Math.min(mat.quantity, 8); // cap initial allocation
      if (blocksNeeded > 0) {
        this.warehouse.allocate(mat.material_id, blocksNeeded, this.database);
      }
    }
  }

  // ── Tick ─────────────────────────────────────────────────────────────────

  tick() {
    if (this.paused) return;

    const energy = this.database.getGlobal('energy');
    
    if (energy > 0) {
      this.tickCount++;

      // 1. Maybe generate a random incoming order
      this._maybeGenerateOrder();

      // 2. Run scheduler (dispatch / progress / complete)
      const bots = this.database.select('bots');
      this.scheduler.tick(bots, this.database, this.tickCount, this.sync);

      // 3. Sync: check for conflicts and produce/consume conveyor items
      this._tickSync();

      // 4. Deadlock detection
      this._tickDeadlock();

      // 5. Deduct energy costs
      this._deductEnergy();
    } else {
      if (!this._powerWarningFired) {
        this._addEvent('danger', '⚡ FACTORY HALTED: Insufficient Power!');
        this._powerWarningFired = true;
      }
    }

    // 6. Maybe trigger random power surge (low probability)
    this._maybeRandomPowerSurge();

    // 7. Update rating based on performance
    this._updateRating();

    // 8. Auto features
    if (this.autoDefrag && this.warehouse.getFragmentation() > 30) {
      this.reorganizeWarehouse();
    }
    if (this.autoRestock) {
      for (const mat of this.database.select('materials')) {
        if (mat.quantity < 10) {
          let maxContiguous = this.warehouse.getMaxContiguousBlocks();
          if (maxContiguous < 10 && this.autoDefrag) {
            this.reorganizeWarehouse();
            maxContiguous = this.warehouse.getMaxContiguousBlocks();
          }
          const qtyToBuy = Math.min(10, maxContiguous);
          if (qtyToBuy > 0) {
            this.restockMaterial(mat.name, qtyToBuy, true);
          }
        }
      }
    }
  }

  // ── Tick sub-steps ──────────────────────────────────────────────────────

  /** Generate a random order based on tick cadence. */
  _maybeGenerateOrder() {
    const energy = this.database.getGlobal('energy');
    if (energy <= 0) return;

    if (this.scheduler.readyQueue.length >= this.scheduler.maxQueueSize) {
      return;
    }

    // Roughly one order every 8–15 ticks
    const chance = 0.08 + Math.min(this.tickCount * 0.0001, 0.07); // ramps up slightly
    if (Math.random() > chance) return;

    const product = PRODUCT_NAMES[Math.floor(Math.random() * PRODUCT_NAMES.length)];
    const priorityLabel = this._weightedPriority();
    this._createOrder(product, priorityLabel);
  }

  /** Weighted random priority: 60% Standard, 30% Rush, 10% Critical. */
  _weightedPriority() {
    const r = Math.random();
    if (r < 0.60) return 'Standard';
    if (r < 0.90) return 'Rush';
    return 'Critical';
  }

  /**
   * Create an order, insert into DB, and add to scheduler queue.
   * @param {string} product
   * @param {string} priorityLabel
   * @returns {Object} the created order row
   */
  _createOrder(product, priorityLabel) {
    const recipe = PRODUCTS[product];
    if (!recipe) throw new Error(`Unknown product: ${product}`);

    const orderId = nextOrderId();
    const priority = PRIORITY_MAP[priorityLabel] ?? 1;

    // Check material availability
    let materialsAvailable = true;
    for (const [matName, qty] of Object.entries(recipe.materials)) {
      const mat = this.database.select('materials', (r) => r.name === matName)[0];
      if (!mat || mat.quantity < qty) {
        materialsAvailable = false;
        break;
      }
    }

    if (!materialsAvailable) {
      this._addEvent('warning', `Order for ${product} skipped — insufficient materials`);
      return null;
    }

    // Deduct materials
    const txId = this.database.beginTransaction();
    try {
      for (const [matName, qty] of Object.entries(recipe.materials)) {
        const mat = this.database.select('materials', (r) => r.name === matName)[0];
        this.database.update(
          'materials',
          (r) => r.material_id === mat.material_id,
          { quantity: mat.quantity - qty },
          txId
        );
      }

      const order = this.database.insert('orders', {
        order_id: orderId,
        product,
        priority,
        priority_label: priorityLabel,
        status: 'PENDING',
        build_time: recipe.buildTime,
        progress: 0,
        bot_id: null,
        recipe: {
          machines: recipe.machines,
          materials: recipe.materials,
        },
        arrived_tick: this.tickCount,
        started_tick: null,
        finished_tick: null,
        revenue: recipe.revenue + (priority - 1) * 200, // rush/critical bonus
        rr_remaining: null,
      }, txId);

      this.database.commitTransaction(txId);

      // Enqueue for scheduling
      this.scheduler.addOrder(order);
      this._addEvent('info', `📦 New order: ${product} [${priorityLabel}] — $${order.revenue}`);

      // Access cache for materials used
      for (const matName of Object.keys(recipe.materials)) {
        const mat = this.database.select('materials', (r) => r.name === matName)[0];
        if (mat) {
          this.warehouse.accessCache(mat.material_id);
          this.warehouse.freeQuantity(mat.material_id, recipe.materials[matName]);
        }
      }

      return order;
    } catch (err) {
      this.database.rollbackTransaction(txId);
      this._addEvent('error', `Failed to create order: ${err.message}`);
      return null;
    }
  }

  /** Handle sync / conveyor each tick. */
  _tickSync() {
    // 1. Ensure IDLE bots hold no locks (they might have just finished or been preempted)
    const idleBots = this.database.select('bots', (b) => b.status === 'IDLE');
    for (const bot of idleBots) {
      this.sync.forceReleaseAll(bot.bot_id);
    }

    // For active bots, simulate acquiring machine locks based on their order's recipe
    const bots = this.database.select('bots', (b) => b.status === 'BUSY');
    for (const bot of bots) {
      const order = this.database.findByPk('orders', bot.current_order);
      if (!order || !order.recipe?.machines) continue;

      // Determine which machine step the bot is on based on progress
      const stepIdx = Math.floor(
        (order.progress / order.build_time) * order.recipe.machines.length
      );
      const neededType = order.recipe.machines[Math.min(stepIdx, order.recipe.machines.length - 1)];

      // 2. If the bot is holding a lock for a DIFFERENT machine type, release it (transition to next step)
      let holdsOther = false;
      for (const mState of this.sync.machines.values()) {
        if (mState.currentLocks.includes(bot.bot_id) && mState.type !== neededType) {
          holdsOther = true;
          break;
        }
      }
      if (holdsOther) {
        this.sync.forceReleaseAll(bot.bot_id);
      }

      // Find a machine of that type
      const machines = this.database.select('machines', (m) => m.type === neededType);
      if (machines.length === 0) continue;

      // Check if bot is already holding ANY machine of this type
      let holding = false;
      for (const m of machines) {
        if (this.sync.isHolding(m.machine_id, bot.bot_id)) {
          holding = true;
          break;
        }
      }
      if (holding) continue; // already has lock, all good

      // Try to acquire lock on the first available machine, or queue on the one with shortest waitQueue
      let acquired = false;
      let bestMachine = machines[0];
      let minWaiters = Infinity;

      for (const m of machines) {
        const mState = this.sync.machines.get(m.machine_id);
        if (!mState) continue;
        
        if (mState.currentLocks.length < mState.capacity || this.sync.chaosMode) {
          const result = this.sync.acquireLock(m.machine_id, bot.bot_id);
          if (result === 'GRANTED' || result === 'CHAOS_GRANTED') {
             acquired = true;
             break;
          }
        }
        
        if (mState.waitQueue.length < minWaiters) {
           minWaiters = mState.waitQueue.length;
           bestMachine = m;
        }
      }
      
      if (!acquired && bestMachine) {
        const wasWaiting = this.sync.isWaiting(bestMachine.machine_id, bot.bot_id);
        const result = this.sync.acquireLock(bestMachine.machine_id, bot.bot_id);
        if (result === 'QUEUED' && !wasWaiting) {
          this._addEvent('sync', `⏳ ${bot.name} waiting for ${neededType}`);
        }
      }
    }

    // Produce items onto conveyor from completed stages
    const completed = this.database.select('orders', (o) => o.status === 'COMPLETED');
    for (const order of completed.slice(-2)) { // don't flood the conveyor
      this.sync.produce({ partId: order.order_id, product: order.product });
    }
    // Consume from conveyor (simulates shipping)
    this.sync.consume();
  }

  /** Run deadlock detection. */
  _tickDeadlock() {
    const bots = this.database.select('bots');
    const machines = this.database.select('machines');
    this.deadlock.updateGraph(bots, machines, this.sync);
    const cycle = this.deadlock.detectCycle();

    if (cycle) {
      this._addEvent('danger', `🔒 DEADLOCK detected! ${cycle.length} nodes in cycle`);
    }
  }

  /** Deduct energy each tick based on active bots and machines. */
  _deductEnergy() {
    const activeBots = this.database.select('bots', (b) => b.status === 'BUSY').length;
    const activeMachines = [...this.sync.machines.values()]
      .filter((m) => m.currentLocks.length > 0).length;

    const cost = activeBots * 2 + activeMachines * 5;
    const current = this.database.getGlobal('energy');
    this.database.setGlobal('energy', Math.max(0, current - cost));

    if (current - cost <= 0 && current > 0) {
      this._addEvent('warning', '⚡ Energy depleted!');
    }
  }

  /** Low-probability random power surge. */
  _maybeRandomPowerSurge() {
    if (this.powerSurgeActive) return;
    if (Math.random() > 0.002) return; // ~0.2% per tick
    this._triggerPowerSurge();
  }

  /** Update factory rating based on metrics. */
  _updateRating() {
    const metrics = this.scheduler.getMetrics();
    const cash = this.database.getGlobal('cash');
    let rating = 3;

    if (metrics.completedOrders > 10 && metrics.utilization > 60) rating++;
    if (cash > 20000) rating++;
    if (metrics.avgWaitTime > 20) rating--;
    if (this.sync.defectCount > 5) rating--;

    rating = Math.max(1, Math.min(5, rating));
    this.database.setGlobal('rating', rating);
  }

  // ── Power Surge (Recovery Demo) ─────────────────────────────────────────

  /** @private */
  _triggerPowerSurge() {
    this.powerSurgeActive = true;
    this._addEvent('danger', '💥 POWER SURGE! System recovering from last checkpoint…');

    // Recover from last checkpoint
    const recovered = this.database.recover();
    if (recovered) {
      this._addEvent('info', '✅ Recovery complete — state restored from checkpoint');
      // Re-sync sub-modules with recovered state
      this._resyncAfterRecovery();
    } else {
      this._addEvent('warning', '⚠️ No checkpoint available — state may be inconsistent');
    }

    this.powerSurgeActive = false;
  }

  /** Re-synchronise sub-modules after a database recovery. */
  _resyncAfterRecovery() {
    // Rebuild scheduler queue from pending orders
    this.scheduler.readyQueue = [];
    const pending = this.database.select('orders', (o) => o.status === 'PENDING');
    for (const order of pending) {
      this.scheduler.addOrder(order);
    }

    // Re-register machines in sync manager
    this.sync.machines.clear();
    const machines = this.database.select('machines');
    for (const m of machines) {
      this.sync.registerMachine(m.machine_id, m.type, m.capacity);
    }
  }

  // ── Player Actions ──────────────────────────────────────────────────────

  addCustomOrder(product, priorityLabel = 'Standard') {
    const energy = this.database.getGlobal('energy');
    if (energy <= 0) {
      this._addEvent('warning', 'Cannot add order — insufficient power!');
      return null;
    }
    if (this.scheduler.readyQueue.length >= this.scheduler.maxQueueSize) {
      this._addEvent('warning', 'Cannot add order — queue is full!');
      return null;
    }
    return this._createOrder(product, priorityLabel);
  }

  /**
   * Hire a new bot.
   * @returns {Object|null} The new bot row, or null if insufficient cash.
   */
  hireBot() {
    const cost = 2000;
    const cash = this.database.getGlobal('cash');
    if (cash < cost) {
      this._addEvent('warning', `Cannot hire bot — need $${cost}, have $${cash}`);
      return null;
    }

    const txId = this.database.beginTransaction();
    try {
      const id = nextBotId();
      const nameIdx = (this.database.count('bots')) % BOT_NAMES.length;
      const bot = this.database.insert('bots', {
        bot_id: id,
        name: BOT_NAMES[nameIdx],
        status: 'IDLE',
        current_order: null,
        hire_cost: cost,
        ticks_busy: 0,
      }, txId);

      this.database.setGlobal('cash', cash - cost, txId);

      this.database.insert('transactions', {
        tx_id: txId,
        timestamp: Date.now(),
        type: 'HIRE',
        amount: -cost,
        description: `Hired bot ${bot.name}`,
      }, txId);

      this.database.commitTransaction(txId);
      this._addEvent('info', `🤖 Hired bot ${bot.name} (-$${cost})`);
      return bot;
    } catch (err) {
      this.database.rollbackTransaction(txId);
      this._addEvent('error', `Hire failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Fire an idle bot.
   * @param {string} botId
   * @returns {boolean}
   */
  fireBot(botId) {
    const bot = this.database.findByPk('bots', botId);
    if (!bot) { this._addEvent('warning', 'Bot not found'); return false; }
    if (bot.status !== 'IDLE') {
      this._addEvent('warning', `Cannot fire ${bot.name} — bot is busy`);
      return false;
    }

    const txId = this.database.beginTransaction();
    try {
      this.database.delete('bots', (r) => r.bot_id === botId, txId);
      // Refund half the hire cost
      const refund = Math.floor(bot.hire_cost / 2);
      const cash = this.database.getGlobal('cash');
      this.database.setGlobal('cash', cash + refund, txId);

      this.database.commitTransaction(txId);
      this.sync.forceReleaseAll(botId);
      this._addEvent('info', `🔧 Fired bot ${bot.name} (+$${refund} refund)`);
      return true;
    } catch (err) {
      this.database.rollbackTransaction(txId);
      return false;
    }
  }

  /**
   * Buy a new machine.
   * @param {string} type  'CNC', 'Laser', or 'Welder'
   * @returns {Object|null}
   */
  buyMachine(type) {
    const prices = { CNC: 3000, Laser: 3500, Welder: 2500 };
    const capacities = { CNC: 2, Laser: 2, Welder: 1 };
    const cost = prices[type];
    if (!cost) { this._addEvent('warning', `Unknown machine type: ${type}`); return null; }

    const cash = this.database.getGlobal('cash');
    if (cash < cost) {
      this._addEvent('warning', `Cannot buy ${type} — need $${cost}, have $${cash}`);
      return null;
    }

    const txId = this.database.beginTransaction();
    try {
      const id = nextMachId();
      const machine = this.database.insert('machines', {
        machine_id: id,
        type,
        capacity: capacities[type],
        active_locks: [],
        wait_queue: [],
        locked_by: [],
      }, txId);

      this.database.setGlobal('cash', cash - cost, txId);

      this.database.insert('transactions', {
        tx_id: txId,
        timestamp: Date.now(),
        type: 'PURCHASE',
        amount: -cost,
        description: `Bought ${type} machine`,
      }, txId);

      this.database.commitTransaction(txId);
      this.sync.registerMachine(id, type, capacities[type]);
      this._addEvent('info', `🏭 Bought ${type} machine (-$${cost})`);
      return machine;
    } catch (err) {
      this.database.rollbackTransaction(txId);
      this._addEvent('error', `Purchase failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Sell a machine (must have no active locks).
   * @param {string} machineId
   * @returns {boolean}
   */
  sellMachine(machineId) {
    const machine = this.database.findByPk('machines', machineId);
    if (!machine) { this._addEvent('warning', 'Machine not found'); return false; }

    const mState = this.sync.machines.get(machineId);
    if (mState && mState.currentLocks.length > 0) {
      this._addEvent('warning', `Cannot sell ${machine.type} — machine is in use`);
      return false;
    }

    const prices = { CNC: 3000, Laser: 3500, Welder: 2500 };
    const refund = Math.floor((prices[machine.type] ?? 2000) * 0.6);

    const txId = this.database.beginTransaction();
    try {
      this.database.delete('machines', (r) => r.machine_id === machineId, txId);
      const cash = this.database.getGlobal('cash');
      this.database.setGlobal('cash', cash + refund, txId);
      this.database.commitTransaction(txId);

      this.sync.unregisterMachine(machineId);
      this._addEvent('info', `💰 Sold ${machine.type} machine (+$${refund})`);
      return true;
    } catch (err) {
      this.database.rollbackTransaction(txId);
      return false;
    }
  }

  /**
   * Expand warehouse.
   * @param {number} amount  Blocks to add.
   */
  expandWarehouse(amount = 8) {
    const cost = amount * 100;
    const cash = this.database.getGlobal('cash');
    if (cash < cost) {
      this._addEvent('warning', `Cannot expand warehouse — need $${cost}`);
      return false;
    }

    const txId = this.database.beginTransaction();
    try {
      this.database.setGlobal('cash', cash - cost, txId);
      this.warehouse.expand(amount);
      
      this.database.insert('transactions', {
        tx_id: txId,
        timestamp: Date.now(),
        type: 'PURCHASE',
        amount: -cost,
        description: `Expanded warehouse by ${amount} blocks`,
      }, txId);
      
      this.database.commitTransaction(txId);
      this._addEvent('info', `📦 Warehouse expanded by ${amount} blocks (-$${cost})`);
      return true;
    } catch (err) {
      this.database.rollbackTransaction(txId);
      return false;
    }
  }

  /**
   * Shrink warehouse.
   * @param {number} amount
   */
  shrinkWarehouse(amount = 4) {
    const removed = this.warehouse.shrink(amount);
    if (removed > 0) {
      const refund = removed * 50;
      const cash = this.database.getGlobal('cash');
      
      const txId = this.database.beginTransaction();
      try {
        this.database.setGlobal('cash', cash + refund, txId);
        
        this.database.insert('transactions', {
          tx_id: txId,
          timestamp: Date.now(),
          type: 'SALE',
          amount: refund,
          description: `Shrank warehouse by ${removed} blocks`,
        }, txId);
        
        this.database.commitTransaction(txId);
        this._addEvent('info', `📦 Warehouse shrunk by ${removed} blocks (+$${refund})`);
      } catch (err) {
        this.database.rollbackTransaction(txId);
      }
    } else {
      this._addEvent('warning', 'Cannot shrink — trailing blocks are occupied');
    }
    return removed;
  }

  /** Change scheduling strategy. */
  setStrategy(name) {
    this.scheduler.setStrategy(name);
    this._addEvent('info', `⚙️ Scheduling strategy → ${name}`);
  }

  /** Set round-robin time quantum. */
  setTimeQuantum(n) {
    this.scheduler.setTimeQuantum(n);
    this._addEvent('info', `⏱ Time quantum → ${n} ticks`);
  }

  /** Trigger warehouse defragmentation. */
  reorganizeWarehouse() {
    const moves = this.warehouse.defragment(this.database);
    this._addEvent('info', `🧹 Warehouse defragmented — ${moves.length} block(s) moved`);
    return moves;
  }

  /**
   * Resolve a detected deadlock.
   * @param {'force_reset'|'smart_sequencing'} method
   */
  resolveDeadlock(method = 'force_reset') {
    const graph = this.deadlock.getGraph();
    if (!graph.hasCycle) {
      this._addEvent('info', 'No deadlock to resolve');
      return false;
    }

    const bots = this.database.select('bots');

    if (method === 'force_reset') {
      // Preempt the least-work bot
      const victim = this.deadlock.suggestVictim(graph.cycle, bots);
      if (victim) {
        this.sync.forceReleaseAll(victim.botId);
        this.database.update('bots', (r) => r.bot_id === victim.botId, {
          status: 'IDLE',
          current_order: null,
        });
        // Re-queue the victim's order
        const bot = this.database.findByPk('bots', victim.botId);
        if (bot?.current_order) {
          const order = this.database.findByPk('orders', bot.current_order);
          if (order) {
            this.database.update('orders', (r) => r.order_id === order.order_id, {
              status: 'PENDING',
              bot_id: null,
            });
            this.scheduler.addOrder(order);
          }
        }
        this._addEvent('info', `🔓 Deadlock resolved — preempted bot ${victim.name}`);
      }
    } else if (method === 'smart_sequencing') {
      // Release all locks for every bot in the cycle, then re-queue their orders
      for (const entry of graph.cycle) {
        if (!entry.botId) continue;
        this.sync.forceReleaseAll(entry.botId);
        const bot = this.database.findByPk('bots', entry.botId);
        if (bot && bot.current_order) {
          const order = this.database.findByPk('orders', bot.current_order);
          if (order) {
            this.database.update('orders', (r) => r.order_id === order.order_id, {
              status: 'PENDING',
              bot_id: null,
            });
            this.scheduler.addOrder(order);
          }
          this.database.update('bots', (r) => r.bot_id === bot.bot_id, {
            status: 'IDLE',
            current_order: null,
          });
        }
      }
      this._addEvent('info', '🔓 Deadlock resolved — smart sequencing (all cycle bots reset)');
    }

    return true;
  }

  /** Toggle chaos mode. */
  toggleChaosMode() {
    const newState = this.sync.toggleChaosMode();
    this._addEvent(
      newState ? 'danger' : 'info',
      newState ? '☢️ CHAOS MODE ON — locks bypassed!' : '✅ Chaos mode OFF'
    );
    return newState;
  }

  /** Create a database checkpoint. */
  createCheckpoint() {
    const pos = this.database.createCheckpoint();
    this._addEvent('info', `💾 Checkpoint created at log position ${pos}`);
    return pos;
  }

  /** Manually trigger a power surge (for testing recovery). */
  triggerPowerSurge() {
    this._triggerPowerSurge();
  }

  /** Pause / resume the simulation. */
  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }

  /** Set simulation speed multiplier. */
  setSpeed(multiplier) {
    if ([1, 2, 4].includes(multiplier)) {
      this.speed = multiplier;
    }
  }

  /**
   * Restock a material.
   * @param {string} materialName
   * @param {number} qty
   */
  restockMaterial(materialName, qty = 10, suppressWarnings = false) {
    const mat = this.database.select('materials', (r) => r.name === materialName)[0];
    if (!mat) { 
      if (!suppressWarnings) this._addEvent('warning', `Unknown material: ${materialName}`); 
      return false; 
    }

    const cost = mat.unit_cost * qty;
    const cash = this.database.getGlobal('cash');
    if (cash < cost) {
      if (!suppressWarnings) this._addEvent('warning', `Cannot restock — need $${cost}`);
      return false;
    }

    const txId = this.database.beginTransaction();
    try {
      // Allocate warehouse blocks for new stock first
      const allocatedIdx = this.warehouse.allocate(mat.material_id, qty, this.database);
      if (allocatedIdx === -1) {
        throw new Error('Not enough contiguous warehouse space. Try defragmenting.');
      }

      this.database.update('materials', (r) => r.material_id === mat.material_id, {
        quantity: mat.quantity + qty,
      }, txId);
      this.database.setGlobal('cash', cash - cost, txId);
      
      this.database.insert('transactions', {
        tx_id: txId,
        timestamp: Date.now(),
        type: 'PURCHASE',
        amount: -cost,
        description: `Restocked ${qty}x ${materialName}`,
      }, txId);
      
      this.database.commitTransaction(txId);

      this._addEvent('info', `📥 Restocked ${qty}× ${materialName} (-$${cost})`);
      return true;
    } catch (err) {
      this.database.rollbackTransaction(txId);
      if (!suppressWarnings) this._addEvent('warning', `Restock failed: ${err.message}`);
      return false;
    }
  }

  /** Add energy. */
  addEnergy(amount = 500) {
    const cost = amount * 0.5;
    const cash = this.database.getGlobal('cash');
    if (cash < cost) {
      this._addEvent('warning', `Cannot buy energy — need $${cost}`);
      return false;
    }

    const txId = this.database.beginTransaction();
    try {
      this.database.setGlobal('cash', cash - cost, txId);
      const energy = this.database.getGlobal('energy');
      this.database.setGlobal('energy', energy + amount, txId);
      
      this.database.insert('transactions', {
        tx_id: txId,
        timestamp: Date.now(),
        type: 'PURCHASE',
        amount: -cost,
        description: `Bought ${amount} kW of energy`,
      }, txId);
      
      this.database.commitTransaction(txId);
      this._addEvent('info', `⚡ Bought ${amount} kW (-$${cost})`);
      this._powerWarningFired = false; // Reset so factory resumes
      return true;
    } catch (err) {
      this.database.rollbackTransaction(txId);
      return false;
    }
  }

  // ── State Snapshot for UI ───────────────────────────────────────────────

  /** Toggle auto restock */
  toggleAutoRestock() {
    this.autoRestock = !this.autoRestock;
    this._addEvent('info', `Auto Restock ${this.autoRestock ? 'ENABLED' : 'DISABLED'}`);
    return this.autoRestock;
  }

  /** Toggle auto defrag */
  toggleAutoDefrag() {
    this.autoDefrag = !this.autoDefrag;
    this._addEvent('info', `Auto Defrag ${this.autoDefrag ? 'ENABLED' : 'DISABLED'}`);
    return this.autoDefrag;
  }

  /**
   * Return the full simulation state for React rendering.
   * @returns {Object}
   */
  getState() {
    const db = this.database;
    return {
      // Simulation
      tickCount:  this.tickCount,
      paused:     this.paused,
      speed:      this.speed,
      powerSurgeActive: this.powerSurgeActive,
      chaosMode:  this.sync.chaosMode,
      autoDefrag: this.autoDefrag,
      autoRestock: this.autoRestock,

      // Economy
      cash:   db.getGlobal('cash'),
      energy: db.getGlobal('energy'),
      rating: db.getGlobal('rating'),

      // Tables
      bots:      db.select('bots').map(bot => {
        if (bot.status === 'BUSY') {
          const isWaiting = Array.from(this.sync.machines.values()).some(m => m.waitQueue.includes(bot.bot_id));
          if (isWaiting) return { ...bot, status: 'WAITING' };
        }
        return bot;
      }),
      orders:    db.select('orders'),
      machines:  db.select('machines'),
      materials: db.select('materials'),

      // Scheduler
      schedulerStrategy: this.scheduler.strategy,
      timeQuantum:       this.scheduler.timeQuantum,
      maxQueueSize:      this.scheduler.maxQueueSize,
      readyQueue:        this.scheduler.readyQueue.map((o) => ({
        order_id: o.order_id, product: o.product, priority: o.priority,
      })),
      metrics:   this.scheduler.getMetrics(),
      timeline:  this.scheduler.getTimeline(),

      // Warehouse / Memory
      warehouse: {
        blocks:        this.warehouse.getBlocks(),
        stats:         this.warehouse.getStats(),
        cache:         this.warehouse.getCacheState(),
      },

      // Sync
      conveyor:      this.sync.getBufferState(),
      machineStates: this.sync.getMachineStates(),
      defectCount:   this.sync.defectCount,
      defectLog:     this.sync.defectLog.slice(-10),

      // Deadlock
      deadlock: this.deadlock.getGraph(),

      // Database internals
      transactionLog: db.transactionLog.slice(-20),
      tableRowCounts: {
        orders:    db.count('orders'),
        bots:      db.count('bots'),
        machines:  db.count('machines'),
        materials: db.count('materials'),
      },

      // Events
      events: this.gameEvents.slice(0, 20),

      // Product catalog (static, for UI reference)
      products: PRODUCTS,
      priorityLevels: PRIORITY_MAP,
    };
  }

  // ── Event log ───────────────────────────────────────────────────────────

  /**
   * Add an event to the rolling ticker.
   * @param {'info'|'warning'|'danger'|'error'|'sync'} level
   * @param {string} message
   * @private
   */
  _addEvent(level, message) {
    this.gameEvents.unshift({
      id: Math.random().toString(36).substring(2, 9),
      tick: this.tickCount,
      timestamp: Date.now(),
      level,
      message,
    });
    if (this.gameEvents.length > this._maxEvents) {
      this.gameEvents.length = this._maxEvents;
    }
  }
}

export default Factory;
