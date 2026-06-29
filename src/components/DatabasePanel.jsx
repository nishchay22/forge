import React from 'react';

export default function DatabasePanel({ tables, activeTable, onSelectTable, transactions, lastCheckpointAt, dbState }) {
  const cols = {
    Orders: ['order_id','product','status','priority_label','build_time','bot_id','progress','revenue'],
    Bots: ['bot_id','status','current_order','hire_cost'],
    Machines: ['machine_id','type','capacity'],
    Materials: ['material_id','name','quantity','unit_cost'],
    Transactions: ['tx_id','timestamp','action','details','status']
  };

  const activeCols = cols[activeTable] || cols.Orders;
  const secAgo = lastCheckpointAt ? Math.round((Date.now() - lastCheckpointAt) / 1000) : null;
  const cpTime = secAgo !== null ? `${secAgo}s ago` : '—';
  
  let rows = [];
  if (activeTable === 'Orders') rows = dbState.orders || [];
  if (activeTable === 'Bots') rows = dbState.bots || [];
  if (activeTable === 'Machines') rows = dbState.machines || [];
  if (activeTable === 'Materials') rows = dbState.materials || [];

  return (
    <div className="panel">
      <h3>Factory database
        <span className="hint"><span>0 violations</span> · checkpoint <span>{cpTime}</span></span>
      </h3>
      <div className="section-help">Hover a blue field to trace its foreign key to the row it points to.</div>
      <div className="tabs">
        {tables.map(t => (
          <div key={t} className={`tab ${activeTable === t ? 'active' : ''}`} onClick={() => onSelectTable(t)}>
            {t}
          </div>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {activeCols.map(c => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {activeTable !== 'Transactions' ? (
              rows.length > 0 ? rows.map((r, i) => (
                <tr key={i}>
                  {activeCols.map(c => {
                    let val = r[c];
                    if (Array.isArray(val)) val = val.join(', ');
                    if (val === null || val === undefined) val = '-';
                    return <td key={c}>{val}</td>;
                  })}
                </tr>
              )) : (
                <tr><td colSpan={activeCols.length} className="empty-row">No rows found.</td></tr>
              )
            ) : (
              <tr><td colSpan={activeCols.length} className="empty-row">See transaction log below.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="legend">
        <span><i style={{background: 'var(--green)'}}></i>insert</span>
        <span><i style={{background: 'var(--amber)'}}></i>update</span>
        <span><i style={{background: 'var(--red)'}}></i>delete</span>
        <span><i style={{background: 'var(--blue)'}}></i>foreign key</span>
      </div>
      
      <h3 style={{ marginTop: '14px' }}>Transaction log <span className="hint">every action is atomic — all steps commit, or none do</span></h3>
      <div className="txlog">
        {transactions.slice(-30).reverse().map(t => {
          const cls = t.status === 'COMMITTED' ? 'commit' : t.status === 'ROLLED_BACK' ? 'rollback' : 'wait';
          let msg = t.description || t.details || JSON.stringify(t.action);
          if (typeof msg === 'object') msg = JSON.stringify(msg);
          return (
            <div key={t.tx_id} className={`tx ${cls}`}>
              <span className="tag">{t.tx_id}</span> {t.type || t.action} — {cls === 'rollback' ? <span className="strike">{msg}</span> : msg}
            </div>
          );
        })}
      </div>
    </div>
  );
}
