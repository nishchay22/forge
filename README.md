# FORGE: Smart Factory Simulator

[![Deployed on Render](https://imgshields.io/badge/Deployed%20on-Render-46E3B7?style=for-the-badge&logo=render)](https://dashboard.render.com)

**FORGE** is an interactive, browser-based factory simulation game designed to visually demonstrate advanced **Operating System** and **Relational Database** concepts. You manage a cyber-industrial production floor, dispatching jobs, hiring robotic workers, and optimizing memory allocation to keep the conveyor belts moving efficiently.

---

## 🖥️ Operating System Concepts Simulated

### 1. CPU Scheduling (Bots as CPUs, Orders as Processes)
The simulation allows you to swap between classic CPU scheduling algorithms on the fly to observe their impact on throughput and wait times:
- **FCFS (First-Come, First-Served):** Orders are dispatched in the exact sequence they arrive. Simple, but prone to the "convoy effect" if a massive order blocks the queue.
- **SJF (Shortest Job First):** Minimizes average wait time by always dispatching the fastest jobs first (Non-preemptive).
- **Priority Scheduling:** Critical and Rush orders jump ahead of Standard orders. A high-priority order will even preempt (interrupt) a bot currently working on a lower-priority task!
- **Round Robin (RR):** Each order is given a time quantum (slice). If the quantum expires before the order finishes, the bot is preempted, the order goes back to the queue, and the next order is loaded.

### 2. Resource Allocation & Deadlock Management
Machines (CNC, Lasers, Welders) act as mutually exclusive resources. Bots acquire locks on these machines to progress.
- **Resource Allocation Graph (RAG):** The engine constantly monitors which bots hold locks and which are waiting in queues. 
- **Cycle Detection:** If two bots are waiting on machines locked by each other, a **Deadlock** is detected and flagged in real-time.
- **Deadlock Resolution:** You can intervene by forcefully preempting a victim bot (Force Reset) or smartly releasing cycle locks to let the system re-sequence safely.

### 3. Memory Management (Warehouse as RAM)
The material warehouse functions exactly like a physical RAM module.
- **Contiguous Allocation (First-Fit):** When you restock materials, the engine searches the warehouse grid for the first contiguous block of space large enough to hold them.
- **Fragmentation & Defragmentation:** Over time, as materials are consumed and restocked, the warehouse suffers from *external fragmentation*. You can trigger a "defragmentation" sweep to compact the blocks tightly.
- **Page Replacement (Material Cache):** A smaller LRU (Least Recently Used) cache sits above the warehouse. Material accesses trigger Cache Hits or Misses, providing a live visualization of page-replacement algorithms.

### 4. Process Synchronization (Bounded-Buffer / Producer-Consumer)
- The **Conveyor Belt** is a bounded buffer. Production floors produce finished goods onto the belt, and shipping consumes them. 
- **Chaos Mode:** Toggling Chaos Mode removes mutex locks, intentionally allowing race conditions and defects to occur, demonstrating what happens without proper process synchronization!

---

## 🗄️ Relational Database (DBMS) Concepts Simulated

The entire game state is driven by a bespoke, in-memory **Relational Database Engine**.

### 1. Atomic Transactions (ACID Properties)
Every player action (e.g., placing an order, buying a machine, restocking materials) is bundled into a database transaction (`BEGIN`, `COMMIT`, `ROLLBACK`). 
- **Integrity Checks:** If you try to buy a machine without enough cash, the `CHECK` constraint fails, and the entire transaction is atomically rolled back without corrupting the state.

### 2. Schemas & Foreign Keys
The simulation enforces strict schemas for `orders`, `bots`, `machines`, and `materials`, completely mimicking a SQL environment. For example, an order cannot be assigned a `bot_id` that does not exist in the `bots` table.

### 3. Write-Ahead Logging (WAL) & Recovery
- **Live Transaction Log:** You can watch transactions hit the ledger in real-time at the bottom of the screen.
- **Checkpointing:** You can manually create a snapshot of the database state.
- **Power Surge (Crash Recovery):** Triggering a power surge simulates a server crash. The database will drop all uncommitted or recent changes and restore itself perfectly from the last Checkpoint using the WAL paradigm.

---

## 🚀 Live Deployment

This application is containerized using Docker and is actively deployed on **Render**. 

*(Render handles the CI/CD pipeline, automatically pulling from the `main` branch of this GitHub repository and serving it via a lightweight Node/Vite Docker container).*

---

## 🎮 Gameplay Features

- **Place Orders:** Generate new product orders. Critical orders earn more but require prioritizing.
- **Manage Bots & Machines:** Hire worker bots (CPUs) and purchase machines (resources) to increase your factory's throughput. 
- **Restock:** If you run out of materials, click **Restock Materials** to automatically allocate new materials into the warehouse.
- **Reorganize:** When the warehouse fragmentation gets too high, click **Reorganize warehouse** to pack material allocations tightly (like a disk defragmenter).

---

## 🛠️ Tech Stack & Local Setup

- **Frontend:** React 19, Vite
- **Styling:** Custom Vanilla CSS (Glassmorphism, Industrial Cyberpunk UI)
- **Engine:** Pure ES6 JavaScript, executing in-memory on the client thread

### Run Locally

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Start the Vite development server:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:5173](http://localhost:5173) in your browser.
