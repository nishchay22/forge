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
import Metrics from './components/Metrics';
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
  const [toasts, setToasts] = useState([]);

  // Tick loop
  useEffect(() => {
    const interval = setInterval(() => {
      engine.tick();
      const newState = engine.getState();
      setState(newState);
      
      // Look for new warning/error events to toast
      const newToasts = (newState.events || [])
        .filter(e => {
          if (e.level !== 'warning' && e.level !== 'error' && e.level !== 'danger') return false;
          if (e._toasted) return false;
          return true;
        })
        .map((e) => {
          e._toasted = true;
          return { id: e.id, type: e.level, message: e.message };
        });
        
      if (newToasts.length > 0) {
        setToasts(prev => [...prev, ...newToasts]);
      }
    }, 1000 / Math.max(1, state.speed || 1));
    return () => clearInterval(interval);
  }, [state.speed]);

  const handleTogglePause = () => {
    engine.togglePause();
    setState(engine.getState());
  };
  const handleToggleChaos = () => {
    engine.toggleChaosMode();
    setState(engine.getState());
  };
  const handleSetSpeed = (s) => {
    engine.setSpeed(s);
    setState(engine.getState());
  };
  const handleAddOrder = () => {
    const priorities = ['Standard', 'Rush', 'Critical'];
    const p = priorities[Math.floor(Math.random() * priorities.length)];
    const products = Object.keys(state.products || {Chassis:1});
    const pr = products[Math.floor(Math.random() * products.length)];
    engine.addCustomOrder(pr, p);
    setState(engine.getState());
  };
  const handleHireBot = () => {
    engine.hireBot();
    setState(engine.getState());
  };
  const handleFireBot = (botId) => {
    if (botId) {
      engine.fireBot(botId);
    } else {
      const idleBots = engine.database.select('bots', b => b.status === 'IDLE');
      if (idleBots.length > 0) {
        engine.fireBot(idleBots[idleBots.length - 1].bot_id);
      }
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
  const handleSetTimeQuantum = (q) => {
    engine.setTimeQuantum(q);
    setState(engine.getState());
  };
  const handleBuyMachine = (type) => {
    engine.buyMachine(type);
    setState(engine.getState());
  };
  const handleToggleAutoDefrag = () => {
    engine.toggleAutoDefrag();
    setState(engine.getState());
  };

  const handleToggleAutoRestock = () => {
    engine.toggleAutoRestock();
    setState(engine.getState());
  };

  const handleSellMachine = (id) => {
    engine.sellMachine(id);
    setState(engine.getState());
  };

  const handleSetMaxQueueSize = (size) => {
    engine.scheduler.setMaxQueueSize(size);
    setState(engine.getState());
  };
  const handleExpandWarehouse = () => {
    engine.expandWarehouse(8);
    setState(engine.getState());
  };
  const handleShrinkWarehouse = () => {
    engine.shrinkWarehouse(8);
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
  const handleDismissToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const tables = ['Orders', 'Bots', 'Machines', 'Materials', 'Transactions'];

  return (
    <>
      <TopBar 
        cash={state.cash || 0} 
        power={state.energy || 0} 
        rating={state.rating || 0}
        tickCount={state.tickCount}
        lastCheckpointAt={lastCheckpointAt}
        chaosMode={state.chaosMode}
        paused={state.paused}
        speed={state.speed}
        onTogglePause={handleTogglePause}
        onSetSpeed={handleSetSpeed}
        onToggleChaos={handleToggleChaos}
        onCheckpoint={handleCheckpoint}
        onSurge={handleSurge}
      />
      
      <div style={{padding: '0 16px', marginTop: '16px'}}>
        <DeadlockAlert deadlock={state.deadlock} onResolve={handleResolveDeadlock} />
      </div>

      <div className="app-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', overflowX: 'hidden', paddingBottom: '16px' }}>
          <Metrics metrics={state.metrics} defectCount={state.defectCount} bots={state.bots || []} />
          <OrderQueue orders={state.orders || []} strategy={state.schedulerStrategy} maxQueueSize={state.maxQueueSize} onAddOrder={handleAddOrder} />
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', overflowX: 'hidden', paddingBottom: '16px' }}>
          <ProductionFloor 
            bots={state.bots || []} 
            orders={state.orders || []}
            machines={state.machineStates || []} 
            onFireBot={handleFireBot}
          />
          <DatabasePanel 
            tables={tables}
            activeTable={activeTable}
            onSelectTable={handleSelectTable}
            transactions={state.transactionLog || []}
            dbState={state}
          />
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', overflowX: 'hidden', paddingBottom: '16px' }}>
          <ControlPanel 
            metrics={state.metrics}
            cash={state.cash || 0}
            strategy={state.schedulerStrategy}
            onSetStrategy={handleSetStrategy}
            timeQuantum={state.timeQuantum}
            onSetTimeQuantum={handleSetTimeQuantum}
            maxQueueSize={state.maxQueueSize}
            onSetMaxQueueSize={handleSetMaxQueueSize}
            onExpandWarehouse={handleExpandWarehouse}
            onShrinkWarehouse={handleShrinkWarehouse}
            onRestock={handleRestock}
            autoDefrag={state.autoDefrag}
            onToggleAutoDefrag={handleToggleAutoDefrag}
            autoRestock={state.autoRestock}
            onToggleAutoRestock={handleToggleAutoRestock}
            onHireBot={handleHireBot}
            onFireBot={() => handleFireBot(null)}
            onBuyMachine={handleBuyMachine}
            onSellMachine={handleSellMachine}
            onBuyEnergy={handleBuyEnergy}
            onAddOrder={handleAddOrder}
          />
          <Warehouse 
            warehouse={state.warehouse}
            onDefrag={handleDefrag}
          />
        </div>
      </div>
      
      <TransactionTicker events={state.events || []} />
      <Toast toasts={toasts} onDismiss={handleDismissToast} />
      
      {state.powerSurgeActive && (
        <RecoveryOverlay active={true} steps={['System recovery in progress…']} onComplete={() => {}} />
      )}
    </>
  );
}
