import React from 'react';

export default function Warehouse({ bays, cache, cacheHits, cacheMiss, onDefrag }) {
  let used = 0, freeRuns = 0, inFree = false;
  for(const b of bays){
    if(b.used){ used++; inFree=false; }
    else { if(!inFree){freeRuns++; inFree=true;} }
  }
  const freeTotal = bays.length - used;
  const fragPct = freeTotal === 0 ? 0 : Math.min(100, Math.round((freeRuns-1)/Math.max(1,freeTotal)*100*1.4));

  return (
    <div className="panel">
      <h3>Warehouse <span className="hint">memory allocation</span></h3>
      <div className="section-help">Each bay holds one unit of material. Gaps between used bays are fragmentation — reorganize to pack them tight.</div>
      <div className="bay-grid">
        {bays.map((b, i) => (
          <div key={i} className={`bay ${b.used ? 'used' : ''}`}></div>
        ))}
      </div>
      <div className="frag-meter"><span>Fragmentation</span><b>{fragPct}%</b></div>
      <div className="frag-bar"><i style={{ width: `${fragPct}%` }}></i></div>
      <div className="btnrow"><button className="full" onClick={onDefrag}>🧹 Reorganize warehouse</button></div>
      
      <h3 style={{ marginTop: '16px' }}>Material cache <span className="hint">LRU, 4 slots</span></h3>
      <div className="cache">
        {cache.map((c, i) => (
          <div key={i} className={`cacheslot ${c ? 'full' : ''}`}>
            {c ? c.id.replace('MAT-', '') : 'empty'}
          </div>
        ))}
      </div>
      <div className="frag-meter" style={{ marginTop: '8px' }}>
        <span>Hits <b>{cacheHits}</b></span>
        <span>Misses <b>{cacheMiss}</b></span>
      </div>
    </div>
  );
}
