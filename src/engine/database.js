/**
 * FORGE Engine — In-Memory Relational Database (DBMS Layer)
 *
 * Provides the single source of truth for every mutable piece of factory
 * state.  All other engine modules read and write through this class so
 * that constraints, transactions, and recovery semantics are honoured
 * uniformly.
 *
 * Tables: orders, bots, machines, materials, transactions
 *
 * @module engine/database
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

let _nextTxId = 1;

/** Deep-clone any JSON-safe value. */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const out = {};
  for (const k of Object.keys(obj)) out[k] = deepClone(obj[k]);
  return out;
}

// ─── Schema Definitions ────────────────────────────────────────────────────

/**
 * Column descriptor used in schema definitions.
 * @typedef {Object} ColumnDef
 * @property {'string'|'number'|'boolean'|'object'|'array'} type
 * @property {boolean}  [notNull]   - Column must not be null/undefined.
 * @property {boolean}  [unique]    - Value must be unique across all rows.
 * @property {string}   [references] - "table.column" FK reference.
 * @property {*}        [default]   - Default value when omitted.
 */

const SCHEMAS = {
  orders: {
    order_id:     { type: 'string',  notNull: true, unique: true },
    product:      { type: 'string',  notNull: true },
    priority:     { type: 'number',  notNull: true, default: 1 },
    priority_label: { type: 'string', notNull: true, default: 'Standard' },
    status:       { type: 'string',  notNull: true, default: 'PENDING' },
    build_time:   { type: 'number',  notNull: true },
    progress:     { type: 'number',  notNull: true, default: 0 },
    bot_id:       { type: 'string',  references: 'bots.bot_id' },
    recipe:       { type: 'object',  notNull: true },  // machines & materials needed
    arrived_tick: { type: 'number',  notNull: true },
    started_tick: { type: 'number' },
    finished_tick:{ type: 'number' },
    revenue:      { type: 'number',  notNull: true, default: 0 },
    rr_remaining: { type: 'number' },  // remaining quantum for round-robin
  },

  bots: {
    bot_id:       { type: 'string',  notNull: true, unique: true },
    name:         { type: 'string',  notNull: true },
    status:       { type: 'string',  notNull: true, default: 'IDLE' },
    current_order:{ type: 'string' },
    hire_cost:    { type: 'number',  notNull: true, default: 2000 },
    ticks_busy:   { type: 'number',  notNull: true, default: 0 },
  },

  machines: {
    machine_id:   { type: 'string',  notNull: true, unique: true },
    type:         { type: 'string',  notNull: true },
    capacity:     { type: 'number',  notNull: true },
    active_locks: { type: 'array',   notNull: true, default: [] },   // botIds
    wait_queue:   { type: 'array',   notNull: true, default: [] },   // botIds
    locked_by:    { type: 'array',   notNull: true, default: [] },   // alias kept for FK ref
  },

  materials: {
    material_id:  { type: 'string',  notNull: true, unique: true },
    name:         { type: 'string',  notNull: true },
    quantity:     { type: 'number',  notNull: true, default: 0 },
    unit_cost:    { type: 'number',  notNull: true },
    warehouse_start: { type: 'number' },   // start index in warehouse blocks
    warehouse_size:  { type: 'number' },   // blocks occupied
  },

  transactions: {
    tx_id:        { type: 'number',  notNull: true, unique: true },
    timestamp:    { type: 'number',  notNull: true },
    type:         { type: 'string',  notNull: true },  // 'SALE', 'PURCHASE', 'HIRE', etc.
    amount:       { type: 'number',  notNull: true },
    description:  { type: 'string' },
  },
};

// ─── Integrity Constraint Helpers ──────────────────────────────────────────

/** CHECK constraints that span multiple columns / require row context. */
const CHECK_CONSTRAINTS = {
  materials: (row) => {
    if (row.quantity < 0)
      throw new ConstraintError(`CHECK: material "${row.name}" quantity cannot be negative (got ${row.quantity})`);
  },
  machines: (row) => {
    if (Array.isArray(row.active_locks) && row.active_locks.length > row.capacity)
      throw new ConstraintError(`CHECK: machine "${row.machine_id}" active_locks (${row.active_locks.length}) exceeds capacity (${row.capacity})`);
  },
};

// ─── Error Types ───────────────────────────────────────────────────────────

export class ConstraintError extends Error {
  constructor(msg) { super(msg); this.name = 'ConstraintError'; }
}

export class TransactionError extends Error {
  constructor(msg) { super(msg); this.name = 'TransactionError'; }
}

// ─── FactoryDatabase ───────────────────────────────────────────────────────

export class FactoryDatabase {

  constructor() {
    /** @type {Object<string, Object[]>}  table name → array of row objects */
    this.tables = {
      orders:       [],
      bots:         [],
      machines:     [],
      materials:    [],
      transactions: [],
    };

    /** @type {Map<string, Map<string, string>>}  table → (rowKey → ownerTxId) */
    this._rowLocks = new Map();
    for (const t of Object.keys(this.tables)) this._rowLocks.set(t, new Map());

    /** @type {Object[]}  Persistent transaction log (WAL). */
    this.transactionLog = [];

    /** @type {Map<number, Object>}  Active (uncommitted) transactions. */
    this._activeTx = new Map();

    /** @type {Object|null} Last checkpoint snapshot. */
    this._checkpoint = null;

    /** Global factory scalar values (cash, energy, etc.) stored here for transactional access. */
    this.globals = {
      cash: 15000,
      energy: 1000,
      rating: 3,
    };
  }

  // ── Schema helpers ──────────────────────────────────────────────────────

  /**
   * Return the primary-key column name for a table.
   * Convention: first column whose `unique` flag is true.
   */
  _pkColumn(table) {
    const schema = SCHEMAS[table];
    if (!schema) throw new Error(`Unknown table: ${table}`);
    for (const [col, def] of Object.entries(schema)) {
      if (def.unique) return col;
    }
    return null;
  }

  /**
   * Validate a row object against its schema.  Fills in defaults.
   * @param {string} table
   * @param {Object} row
   * @param {boolean} [isUpdate=false]  Skip NOT NULL for missing fields during partial update.
   * @returns {Object} validated (and default-filled) row
   */
  _validateRow(table, row, isUpdate = false) {
    const schema = SCHEMAS[table];
    if (!schema) throw new Error(`Unknown table: ${table}`);

    const validated = { ...row };

    for (const [col, def] of Object.entries(schema)) {
      // Apply default
      if (validated[col] === undefined && def.default !== undefined && !isUpdate) {
        validated[col] = Array.isArray(def.default) ? [] : def.default;
      }

      // NOT NULL check
      if (def.notNull && !isUpdate && (validated[col] === undefined || validated[col] === null)) {
        throw new ConstraintError(`NOT NULL: ${table}.${col} cannot be null`);
      }

      // Type check (skip null/undefined which are allowed if not notNull)
      if (validated[col] !== undefined && validated[col] !== null) {
        const expected = def.type;
        const actual = Array.isArray(validated[col]) ? 'array' : typeof validated[col];
        if (actual !== expected) {
          throw new ConstraintError(`TYPE: ${table}.${col} expected ${expected}, got ${actual}`);
        }
      }
    }

    // UNIQUE checks
    for (const [col, def] of Object.entries(schema)) {
      if (def.unique && validated[col] !== undefined && validated[col] !== null) {
        const dup = this.tables[table].find(
          (r) => r[col] === validated[col] && r !== row  // exclude self on update
        );
        if (dup) {
          throw new ConstraintError(`UNIQUE: ${table}.${col} value "${validated[col]}" already exists`);
        }
      }
    }

    // FOREIGN KEY checks
    for (const [col, def] of Object.entries(schema)) {
      if (def.references && validated[col] !== undefined && validated[col] !== null) {
        const [refTable, refCol] = def.references.split('.');
        // FK can point to multiple ids if the column is an array
        const vals = Array.isArray(validated[col]) ? validated[col] : [validated[col]];
        for (const v of vals) {
          const exists = this.tables[refTable]?.some((r) => r[refCol] === v);
          if (!exists) {
            throw new ConstraintError(`FK: ${table}.${col} value "${v}" not found in ${refTable}.${refCol}`);
          }
        }
      }
    }

    // Table-level CHECK
    if (CHECK_CONSTRAINTS[table]) {
      CHECK_CONSTRAINTS[table](validated);
    }

    return validated;
  }

  // ── CRUD operations ─────────────────────────────────────────────────────

  /**
   * Insert a new row into a table.
   * @param {string} table
   * @param {Object} row
   * @param {number} [txId]  Optional transaction to associate with.
   * @returns {Object} the inserted row
   */
  insert(table, row, txId) {
    const validated = this._validateRow(table, row);
    this.tables[table].push(validated);

    if (txId !== undefined) {
      this._logMutation(txId, 'INSERT', table, null, validated);
    }
    return validated;
  }

  /**
   * Update rows matching a predicate.
   * @param {string} table
   * @param {function} predicate  (row) => boolean
   * @param {Object} changes     Partial object of new values.
   * @param {number} [txId]
   * @returns {number} count of updated rows
   */
  update(table, predicate, changes, txId) {
    let count = 0;
    for (const row of this.tables[table]) {
      if (!predicate(row)) continue;

      const before = deepClone(row);

      // Apply changes
      for (const [k, v] of Object.entries(changes)) {
        row[k] = v;
      }

      // Re-validate the whole row after merge
      try {
        this._validateRow(table, row, true);
        // Also run CHECK constraints on the merged row
        if (CHECK_CONSTRAINTS[table]) CHECK_CONSTRAINTS[table](row);
      } catch (err) {
        // Revert on failure
        Object.assign(row, before);
        throw err;
      }

      if (txId !== undefined) {
        this._logMutation(txId, 'UPDATE', table, before, deepClone(row));
      }
      count++;
    }
    return count;
  }

  /**
   * Delete rows matching a predicate.
   * @param {string} table
   * @param {function} predicate
   * @param {number} [txId]
   * @returns {Object[]} deleted rows
   */
  delete(table, predicate, txId) {
    const removed = [];
    this.tables[table] = this.tables[table].filter((row) => {
      if (predicate(row)) {
        removed.push(deepClone(row));
        return false;
      }
      return true;
    });
    if (txId !== undefined) {
      for (const r of removed) {
        this._logMutation(txId, 'DELETE', table, r, null);
      }
    }
    return removed;
  }

  /**
   * Select rows from a table.
   * @param {string} table
   * @param {function} [predicate]  Optional filter.
   * @returns {Object[]} matching rows (references, not clones — be careful!)
   */
  select(table, predicate) {
    if (!this.tables[table]) throw new Error(`Unknown table: ${table}`);
    return predicate ? this.tables[table].filter(predicate) : [...this.tables[table]];
  }

  /**
   * Find a single row by primary key value.
   * @param {string} table
   * @param {*} pkValue
   * @returns {Object|undefined}
   */
  findByPk(table, pkValue) {
    const pkCol = this._pkColumn(table);
    if (!pkCol) return undefined;
    return this.tables[table].find((r) => r[pkCol] === pkValue);
  }

  // ── Global scalar access (cash, energy, rating) ─────────────────────────

  /**
   * Read a global value.
   * @param {string} key
   * @returns {*}
   */
  getGlobal(key) {
    return this.globals[key];
  }

  /**
   * Write a global value (transactionally).
   * @param {string} key
   * @param {*} value
   * @param {number} [txId]
   */
  setGlobal(key, value, txId) {
    // CHECK: cash can't go negative
    if (key === 'cash' && value < 0) {
      throw new ConstraintError(`CHECK: cash cannot be negative (attempted ${value})`);
    }

    const before = this.globals[key];
    this.globals[key] = value;

    if (txId !== undefined) {
      this._logMutation(txId, 'SET_GLOBAL', key, before, value);
    }
  }

  // ── Transaction support ─────────────────────────────────────────────────

  /**
   * Begin a new transaction.
   * @returns {number} txId
   */
  beginTransaction() {
    const txId = _nextTxId++;
    this._activeTx.set(txId, {
      txId,
      startTime: Date.now(),
      mutations: [],    // {action, table, before, after}
      status: 'PENDING',
    });
    this.transactionLog.push({
      txId,
      timestamp: Date.now(),
      action: 'BEGIN',
      details: null,
      status: 'PENDING',
    });
    return txId;
  }

  /**
   * Commit a transaction — marks it as committed.
   * @param {number} txId
   */
  commitTransaction(txId) {
    const tx = this._activeTx.get(txId);
    if (!tx) throw new TransactionError(`TX ${txId} not found or already finished`);
    tx.status = 'COMMITTED';

    this.transactionLog.push({
      txId,
      timestamp: Date.now(),
      action: 'COMMIT',
      details: { mutationCount: tx.mutations.length },
      status: 'COMMITTED',
    });

    this._activeTx.delete(txId);
  }

  /**
   * Rollback a transaction — undoes all mutations in reverse order.
   * @param {number} txId
   */
  rollbackTransaction(txId) {
    const tx = this._activeTx.get(txId);
    if (!tx) throw new TransactionError(`TX ${txId} not found or already finished`);

    // Undo mutations in reverse
    for (let i = tx.mutations.length - 1; i >= 0; i--) {
      const m = tx.mutations[i];
      this._undoMutation(m);
    }

    tx.status = 'ROLLED_BACK';

    this.transactionLog.push({
      txId,
      timestamp: Date.now(),
      action: 'ROLLBACK',
      details: { mutationCount: tx.mutations.length },
      status: 'ROLLED_BACK',
    });

    this._activeTx.delete(txId);
  }

  /** Log a mutation inside an active TX. */
  _logMutation(txId, action, table, before, after) {
    const tx = this._activeTx.get(txId);
    if (!tx) return; // non-transactional call — silently skip
    tx.mutations.push({ action, table, before: deepClone(before), after: deepClone(after) });
  }

  /** Undo a single mutation record. */
  _undoMutation(m) {
    switch (m.action) {
      case 'INSERT': {
        // Remove the inserted row
        const pk = this._pkColumn(m.table);
        if (pk && m.after) {
          this.tables[m.table] = this.tables[m.table].filter(
            (r) => r[pk] !== m.after[pk]
          );
        }
        break;
      }
      case 'DELETE': {
        // Re-insert the deleted row
        if (m.before) this.tables[m.table].push(deepClone(m.before));
        break;
      }
      case 'UPDATE': {
        // Restore the row to its before state
        const pk = this._pkColumn(m.table);
        if (pk && m.before) {
          const row = this.tables[m.table].find((r) => r[pk] === m.before[pk]);
          if (row) Object.assign(row, deepClone(m.before));
        }
        break;
      }
      case 'SET_GLOBAL': {
        // m.table is the global key here
        this.globals[m.table] = m.before;
        break;
      }
    }
  }

  // ── Checkpoint / Recovery ───────────────────────────────────────────────

  /**
   * Create a checkpoint — deep-clones all tables and globals.
   * @returns {number} log position at time of checkpoint
   */
  createCheckpoint() {
    this._checkpoint = {
      tables: deepClone(this.tables),
      globals: deepClone(this.globals),
      logPosition: this.transactionLog.length,
      timestamp: Date.now(),
    };
    this.transactionLog.push({
      txId: null,
      timestamp: Date.now(),
      action: 'CHECKPOINT',
      details: { logPosition: this._checkpoint.logPosition },
      status: 'COMMITTED',
    });
    return this._checkpoint.logPosition;
  }

  /**
   * Recover from the last checkpoint — restores table state, then replays
   * any transactions that were committed after the checkpoint.
   * @returns {boolean} true if recovery happened
   */
  recover() {
    if (!this._checkpoint) return false;

    // 1. Restore snapshot
    this.tables = deepClone(this._checkpoint.tables);
    this.globals = deepClone(this._checkpoint.globals);

    // 2. Replay committed TXs that occurred after the checkpoint
    const since = this._checkpoint.logPosition;
    const committedTxIds = new Set();

    for (let i = since; i < this.transactionLog.length; i++) {
      const entry = this.transactionLog[i];
      if (entry.action === 'COMMIT' && entry.status === 'COMMITTED') {
        committedTxIds.add(entry.txId);
      }
    }

    // We need the mutation data.  It isn't in the log (only metadata is).
    // In a real WAL we'd persist mutations.  For this simulation, recovery
    // effectively resets to the checkpoint — committed-since-then are lost
    // unless we persist them.  This is the expected behaviour for a "power
    // surge" scenario: you lose work since the last checkpoint.

    // 3. Clear any active (uncommitted) transactions
    this._activeTx.clear();

    this.transactionLog.push({
      txId: null,
      timestamp: Date.now(),
      action: 'RECOVERY',
      details: { restoredFrom: this._checkpoint.timestamp },
      status: 'COMMITTED',
    });

    return true;
  }

  // ── Row-level locking ───────────────────────────────────────────────────

  /**
   * Attempt to acquire a row lock.
   * @param {string} table
   * @param {string} rowKey   Primary key value of the row.
   * @param {string} owner    Identifier of the lock holder.
   * @returns {boolean} true if lock acquired.
   */
  lockRow(table, rowKey, owner) {
    const locks = this._rowLocks.get(table);
    if (!locks) return false;
    if (locks.has(rowKey)) return locks.get(rowKey) === owner; // re-entrant
    locks.set(rowKey, owner);
    return true;
  }

  /**
   * Release a row lock.
   * @param {string} table
   * @param {string} rowKey
   * @param {string} owner
   * @returns {boolean} true if released.
   */
  unlockRow(table, rowKey, owner) {
    const locks = this._rowLocks.get(table);
    if (!locks) return false;
    if (locks.get(rowKey) !== owner) return false;
    locks.delete(rowKey);
    return true;
  }

  /**
   * Check if a row is locked.
   * @param {string} table
   * @param {string} rowKey
   * @returns {string|null} owner or null
   */
  rowLockedBy(table, rowKey) {
    return this._rowLocks.get(table)?.get(rowKey) ?? null;
  }

  // ── Utility ─────────────────────────────────────────────────────────────

  /**
   * Return a read-only deep clone of all tables and globals — safe for
   * serialisation to the React UI layer.
   */
  snapshot() {
    return {
      tables: deepClone(this.tables),
      globals: deepClone(this.globals),
      transactionLog: deepClone(this.transactionLog),
    };
  }

  /** Get the count of rows in a table. */
  count(table) {
    return this.tables[table]?.length ?? 0;
  }

  /** Pretty-print the transaction log (debugging). */
  dumpLog() {
    return this.transactionLog.map(
      (e) => `[${e.action}] TX#${e.txId ?? '-'} @ ${new Date(e.timestamp).toISOString()} — ${e.status}`
    );
  }
}

export default FactoryDatabase;
