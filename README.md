# FORGE: Smart Factory Simulator

FORGE is an interactive factory simulation game built to demonstrate advanced operating system and database concepts visually. You manage a cyber-industrial production floor, dispatching jobs, hiring robotic workers, and optimizing memory allocation to keep the conveyor belts moving.

## Features

- **Relational Database Engine:** An in-memory, synchronous database layer powers every state change in the factory, complete with integrity constraints, table schemas, and foreign keys.
- **Transaction & Recovery Management:** Every action (e.g., hiring a bot, placing an order) is treated as an atomic database transaction. You can view real-time commits and rollbacks. The "Power Surge" feature demonstrates checkpointing and recovery logs.
- **CPU Scheduling:** Choose from multiple job scheduling algorithms for your bot workforce (FCFS, Shortest Job First, Priority, Round Robin).
- **Resource Allocation & Deadlock:** Bots and machines act as processes and resources. The engine actively detects cycles in the resource allocation graph (RAG) and allows you to resolve deadlocks using intelligent sequencing or force-resetting.
- **Memory Management:** The warehouse operates like RAM, utilizing First-Fit contiguous block allocation for materials and a page-replacement Material Cache with hit/miss tracking.
- **Producer-Consumer Synchronization:** The factory uses bounded buffers (conveyors) to synchronize production stages, complete with a Chaos Mode toggle that removes lock constraints to demonstrate race conditions.

## Tech Stack

- **Frontend:** React, Vite
- **Styling:** Custom CSS with Glassmorphism, Industrial Cyberpunk aesthetics, and CSS-based blueprint grids
- **Engine:** Pure JavaScript (ES6+), running in-memory on the client

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:5173](http://localhost:5173) in your browser to view the dashboard.

## Gameplay

- **Place Orders:** Generate new product orders. Critical orders earn more but require prioritizing.
- **Manage Bots & Machines:** Hire worker bots (CPUs) and purchase machines (resources) to increase your factory's throughput. 
- **Restock:** If you run out of materials, click **Restock Materials** to automatically allocate new materials into the warehouse.
- **Reorganize:** When the warehouse fragmentation gets too high, click **Reorganize warehouse** to pack material allocations tightly (like a disk defragmenter).

## License

MIT
