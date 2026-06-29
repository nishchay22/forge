import React, { useState, useEffect, useRef } from 'react';
import { Factory } from './engine/factory';
import TopBar from './components/TopBar';
import OrderQueue from './components/OrderQueue';
import ProductionFloor from './components/ProductionFloor';
import ControlPanel from './components/ControlPanel';
import Warehouse from './components/Warehouse';
import DatabasePanel from './components/DatabasePanel';
import TransactionTicker from './components/TransactionTicker';
import Toast from './components/Toast';
import RecoveryOverlay from './components/RecoveryOverlay';
import DeadlockAlert from './components/DeadlockAlert';
import './index.css';

export default function App() {
  const engineRef = useRef(null);
  if (!engineRef.current) {
    engineRef.current = new Factory();
  }
  const engine = engineRef.current;

  const [state, setState] = useState(() => engine.getState());
  const [activeTable, setActiveTable] = useState('Orders');
  const [lastCheckpointAt, setLastCheckpointAt] = useState(null);
  const [showWelcome, setShowWelcome] = useState(true);

  // Tick loop
  useEffect(() => {
    // 1 tick per second * speed
    const interval = setInterval(() => {
      engine.tick();
      setState(engine.getState());
    }, 1000 / Math.max(1, engine.speed));
    return () => clearInterval(interval);
  }, []);

  const handleTogglePause = () => {
    engine.togglePause();
    setState(engine.getState());
  };

  const handleToggleChaos = () => {
    engine.toggleChaosMode();
    setState(engine.getState());
  };

  const handleAddOrder = () => {
    // Random priority
    const priorities = ['Standard', 'Rush', 'Critical'];
    const p = priorities[Math.floor(Math.random() * priorities.length)];
    // Random product
    const products = Object.keys(state.products || {Chassis:1});
    const pr = products[Math.floor(Math.random() * products.length)];
    engine.addCustomOrder(pr, p);
    setState(engine.getState());
  };

  const handleHireBot = () => {
    engine.hireBot();
    setState(engine.getState());
  };

  const handleFireBot = () => {
    const idleBots = engine.database.select('bots', b => b.status === 'IDLE');
    if (idleBots.length > 0) {
      engine.fireBot(idleBots[idleBots.length - 1].bot_id);
    }
    setState(engine.getState());
  };

  const handleDefrag = () => {
    engine.reorganizeWarehouse();
    setState(engine.getState());
  };

  const handleSetStrategy = (strategy) => {
    engine.setStrategy(strategy);
    setState(engine.getState());
  };

  const handleBuyMachine = () => {
    const types = ['CNC', 'Laser', 'Welder'];
    engine.buyMachine(types[Math.floor(Math.random() * types.length)]);
    setState(engine.getState());
  };

  const handleExpandWarehouse = () => {
    engine.expandWarehouse(8);
    setState(engine.getState());
  };

  const handleSelectTable = (table) => setActiveTable(table);

  const handleResolveDeadlock = (mode) => {
    engine.resolveDeadlock(mode === 'reset' ? 'force_reset' : 'smart_sequencing');
    setState(engine.getState());
  };

  const handleCheckpoint = () => {
    engine.createCheckpoint();
    setLastCheckpointAt(Date.now());
    setState(engine.getState());
  };

  const handleRestock = () => {
    engine.restockMaterial('Steel', 10);
    engine.restockMaterial('Polymer', 10);
    engine.restockMaterial('Silicon', 10);
    engine.restockMaterial('Copper', 10);
    setState(engine.getState());
  };

  const handleBuyEnergy = () => {
    engine.addEnergy(500);
    setState(engine.getState());
  };

  const handleSurge = () => {
    engine.triggerPowerSurge();
    setState(engine.getState());
  };

  const dismissWelcome = () => setShowWelcome(false);

  // Derive warehouse state
  const bays = (state.warehouse?.blocks || []).map(b => ({ used: b !== null }));
  const cacheEntries = state.warehouse?.cache?.entries || [];
  const cacheSlots = Array.from({length: 4}).map((_, i) => cacheEntries[i] ? { id: cacheEntries[i].materialId } : null);
  const hits = state.warehouse?.cache?.stats?.hits || 0;
  const misses = state.warehouse?.cache?.stats?.misses || 0;
  
  // Format tables
  const tables = ['Orders', 'Bots', 'Machines', 'Materials', 'Transactions'];
  
  const toasts = (state.events || [])
    .filter(e => e.level === 'warning' || e.level === 'error' || e.level === 'danger')
    .slice(0, 3)
    .map((e, i) => ({ id: e.tick + '-' + i, type: e.level, message: e.message }));

  return (
    <>
      <TopBar 
        cash={state.cash || 0} 
        power={state.energy || 0} 
        rating={state.rating || 0}
        lastCheckpointAt={lastCheckpointAt}
        chaosMode={state.chaosMode}
        onToggleChaos={handleToggleChaos}
        onCheckpoint={handleCheckpoint}
        onSurge={handleSurge}
      />
      
      {showWelcome && (
        <div className="welcome" id="welcomeBanner">
          <div>
            <h2>Welcome to the floor</h2>
            <p>Orders arrive and get scheduled onto bots automatically. Every action you take — hiring, buying, dispatching — is a real database transaction you can watch commit or roll back live in the Factory Database panel below.</p>
          </div>
          <button onClick={dismissWelcome}>Got it</button>
        </div>
      )}

      <div style={{padding: '0 12px'}}>
        {state.deadlock?.hasCycle && (
          <DeadlockAlert deadlock={state.deadlock} onResolve={handleResolveDeadlock} />
        )}
      </div>

      <div className="layout">
        <div>
          <OrderQueue orders={state.orders || []} onAddOrder={handleAddOrder} />
          <ControlPanel 
            strategy={state.schedulerStrategy}
            onSetStrategy={handleSetStrategy}
            onHireBot={handleHireBot}
            onFireBot={handleFireBot}
            onBuyMachine={handleBuyMachine}
            onExpandWarehouse={handleExpandWarehouse}
            onRestock={handleRestock}
            onBuyEnergy={handleBuyEnergy}
            onAddOrder={handleAddOrder}
          />
          <Warehouse 
            bays={bays}
            cache={cacheSlots}
            cacheHits={hits}
            cacheMiss={misses}
            onDefrag={handleDefrag}
          />
        </div>
        
        <div>
          <ProductionFloor 
            bots={state.bots || []} 
            orders={state.orders || []}
            machines={state.machines || []} 
            conveyor={state.conveyor?.slots || []}
          />
          
          <DatabasePanel 
            tables={tables}
            activeTable={activeTable}
            onSelectTable={handleSelectTable}
            transactions={state.transactionLog || []}
            lastCheckpointAt={lastCheckpointAt}
            dbState={state}
          />
        </div>
      </div>
      
      <TransactionTicker events={state.events || []} />
      
      <Toast toasts={toasts} onDismiss={() => {}} />
      
      {state.powerSurgeActive && (
        <RecoveryOverlay 
          active={true} 
          steps={['System recovery in progress…']} 
          onComplete={() => {}} 
        />
      )}
    </>
  );
}
