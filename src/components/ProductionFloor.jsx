import React from 'react';
import BotCard from './BotCard';
import MachinePanel from './MachinePanel';

export default function ProductionFloor({ bots, orders, machines, onFireBot }) {
  return (
    <div className="panel production-floor" style={{marginBottom: '16px'}}>
      <div className="panel-header">Production Floor</div>
      
      <div style={{ fontSize: '11px', color: 'var(--dim)', marginBottom: '8px', textTransform: 'uppercase' }}>
        CPUs (Bots)
      </div>
      <div className="bots-grid">
        {bots.map(bot => (
          <BotCard key={bot.bot_id} bot={bot} orders={orders} onFire={onFireBot} />
        ))}
      </div>

      <div style={{ fontSize: '11px', color: 'var(--dim)', marginBottom: '8px', textTransform: 'uppercase' }}>
        Resources (Machines)
      </div>
      <div className="machines-row">
        {machines.map(m => (
          <MachinePanel key={m.id || m.machine_id} machine={m} />
        ))}
      </div>

    </div>
  );
}
