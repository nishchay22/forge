import React from 'react';

export default function PagingPanel({ paging, onSetAlgorithm, onFlushTLB }) {
  if (!paging) return null;

  return (
    <div className="panel paging-panel">
      <div className="panel-header">
        <span>Virtual Memory</span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select value={paging.stats.algorithm} onChange={(e) => onSetAlgorithm(e.target.value)} style={{ width: '80px', padding: '4px' }}>
            <option value="FIFO">FIFO</option>
            <option value="LRU">LRU</option>
            <option value="OPT">OPT</option>
          </select>
          <button onClick={onFlushTLB}>Flush TLB</button>
        </div>
      </div>

      <div className="paging-stats">
        <div className="badge dim">Page Faults: {paging.stats.pageFaults}</div>
        <div className="badge dim">Fault Rate: {(paging.stats.pageFaultRate * 100).toFixed(1)}%</div>
        {paging.stats.thrashing && <div className="badge red">THRASHING</div>}
      </div>

      <div style={{ fontSize: '11px', color: 'var(--dim)', marginBottom: '4px', textTransform: 'uppercase' }}>
        TLB (Hit Rate: {(paging.tlbStats.hitRate * 100).toFixed(1)}%)
      </div>
      <div className="tlb-bar">
        {Array.from({ length: 4 }).map((_, i) => {
          const entry = paging.tlb[i];
          if (!entry) return <div key={`tlb-empty-${i}`} className="tlb-slot">--</div>;
          return (
            <div key={`tlb-${entry.virtualPage}`} className="tlb-slot">
              {entry.virtualPage} &rarr; {entry.physicalFrame}
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: '11px', color: 'var(--dim)', marginBottom: '4px', textTransform: 'uppercase' }}>
        Page Table
      </div>
      <div className="page-table-wrapper">
        <table className="page-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Virtual Page</th>
              <th>Frame</th>
              <th>Material</th>
            </tr>
          </thead>
          <tbody>
            {paging.pageTable.map((p) => (
              <tr key={p.virtualPage}>
                <td>
                  <span className={`dot ${p.valid ? 'green' : 'red'}`}></span>
                  {p.dirty && <span className="dot amber"></span>}
                </td>
                <td>{p.virtualPage}</td>
                <td>{p.valid ? p.physicalFrame : '-'}</td>
                <td>{p.materialId.replace('mat-', '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: '11px', color: 'var(--dim)', marginBottom: '4px', textTransform: 'uppercase' }}>
        Swap Space ({(paging.swapStats.utilization * 100).toFixed(0)}% used)
      </div>
      <div className="swap-grid">
        {Array.from({ length: 64 }).map((_, i) => {
          const item = paging.swapSpace[i];
          return (
            <div 
              key={`swap-${i}`} 
              className={`swap-block ${item ? 'occupied' : ''}`}
              title={item ? item.virtualPage : 'Free Swap Block'}
            />
          );
        })}
      </div>

      <div style={{ fontSize: '11px', color: 'var(--dim)', marginBottom: '4px', marginTop: '12px', textTransform: 'uppercase' }}>
        Recent Page Faults
      </div>
      <div className="fault-log">
        {paging.recentFaults.map((f, i) => (
          <div key={`${f.tick}-${i}`} className="fault-entry">
            [{f.tick}] Fault on <span className="virt">{f.virtualPage}</span> 
            &rarr; Frame <span className="frame">{f.frameNumber}</span>
            {f.evictedPage && <span> (Evicted <span className="evict">{f.evictedPage}</span>)</span>}
          </div>
        ))}
        {paging.recentFaults.length === 0 && <div className="fault-entry" style={{color: 'var(--dim2)'}}>No page faults yet</div>}
      </div>
    </div>
  );
}
