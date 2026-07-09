# Forge

Forge is a web-based factory simulator that demonstrates OS-level concepts (like process scheduling, deadlock detection, memory management, and concurrency) in a visual, interactive environment.

## Features

- **Process Scheduling**: Watch bots take on orders using scheduling algorithms.
- **Deadlock Detection**: See how resource contention (machine locks) can lead to deadlocks, visualized via a Resource Allocation Graph.
- **Memory Management**: The warehouse acts as a block-based memory allocator (First-Fit), complete with fragmentation and defragmentation.
- **Synchronization**: Producer-consumer pattern visualized via the conveyor belt buffer.
- **In-Memory DBMS**: A fully custom transactional database system backing the entire simulation state with rollback and checkpointing support.

## Development

Built with React, Vite, and standard web technologies.

```bash
npm install
npm run dev
```

## Deployment

To deploy this project:
1. Push your code to GitHub.
2. Link your GitHub repository to a service like Render or Vercel.
3. Use the build command `npm run build` and publish the `dist` directory.
