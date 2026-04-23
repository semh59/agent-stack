import React, { useState } from 'react';

/**
 * McpCognitiveDashboard: The Holographic Mesh UI.
 * Visualizes the Cognitive Load Index (CLI) and health of the MCP ecosystem.
 */
export const McpCognitiveDashboard: React.FC = () => {
  const [mcpHealth] = useState([
    { name: 'HuggingFace', cli: 0.94, latency: '45ms', status: 'optimal', cost: '$0.002' },
    { name: 'Python-HPC', cli: 0.88, latency: '120ms', status: 'busy', cost: '$0.000' },
    { name: 'SQLite-Forensics', cli: 0.99, latency: '12ms', status: 'optimal', cost: '$0.000' },
    { name: 'Git-Orchestrator', cli: 0.72, latency: '350ms', status: 'lagging', cost: '$0.005' },
  ]);

  return (
    <div className="mcp-mesh-container p-6 bg-[#0a0a0a] text-white rounded-xl border border-[#333]">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <span className="w-3 h-3 bg-cyan-400 rounded-full animate-pulse"></span>
        Singularity-Prime: MCP Mesh Dashboard
      </h2>

      <div className="grid grid-cols-2 gap-4">
        {mcpHealth.map((mcp) => (
          <div key={mcp.name} className="p-4 bg-[#111] rounded-lg border border-[#222] hover:border-cyan-900 transition-colors">
            <div className="flex justify-between items-start mb-2">
              <span className="font-semibold text-gray-300">{mcp.name}</span>
              <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                mcp.status === 'optimal' ? 'bg-green-900 text-green-400' : 
                mcp.status === 'busy' ? 'bg-yellow-900 text-yellow-400' : 'bg-red-900 text-red-400'
              }`}>
                {mcp.status}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Cognitive Load Index (CLI)</span>
                <span className="text-cyan-400 font-mono">{(mcp.cli * 100).toFixed(0)}%</span>
              </div>
              <div className="w-full bg-[#222] h-1 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-cyan-500 transition-all duration-1000" 
                  style={{ width: `${mcp.cli * 100}%` }}
                ></div>
              </div>

              <div className="flex justify-between text-[10px] font-mono text-gray-600 mt-2">
                <span>LATENCY: {mcp.latency}</span>
                <span>COST/REQ: {mcp.cost}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 p-3 bg-cyan-950/20 border border-cyan-900/30 rounded text-[11px] text-cyan-500/80 italic">
        * Neural Matchmaker is currently optimizing the mesh for AI Domain Evidence.
      </div>
    </div>
  );
};
