import React from 'react';
import BotCard from './BotCard';
import MachinePanel from './MachinePanel';
import Conveyor from './Conveyor';

export default function ProductionFloor({ bots, orders, machines, conveyor }) {
  return (
    <div className="panel">
      <h3>Production floor</h3>
      <div className="floor">
        {bots.map(b => <BotCard key={b.bot_id} bot={b} orders={orders} />)}
      </div>
      <h3 style={{ marginBottom: '8px' }}>Shared machines <span className="hint">bots lock these to work</span></h3>
      <div className="machines">
        {machines.map(m => <MachinePanel key={m.machine_id} machine={m} />)}
      </div>
      <div className="conveyor-label">Staging conveyor — producer/consumer buffer between fabrication and assembly</div>
      <div className="conveyor">
        <Conveyor slots={conveyor} />
      </div>
    </div>
  );
}
