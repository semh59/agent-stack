import React, { useState } from 'react';

export interface McpStoreItem {
  id: string;
  name: string;
  description: string;
  category: string;
  isInstalled: boolean;
  requiresAuth: boolean;
  score: number;
}

/**
 * McpMarketplace: The Sovereign Store for MCP Servers.
 * Allows manual discovery and one-click installation of elite MCP tools.
 */
export const McpMarketplace: React.FC = () => {
  const [items] = useState<McpStoreItem[]>([
    { id: '1', name: 'GitHub Orchestrator', description: 'Otonom PR ve Issue yönetimi.', category: 'DevOps', isInstalled: false, requiresAuth: true, score: 98 },
    { id: '2', name: 'Slack Sync', description: 'Ekip içi iletişim ve raporlama entegrasyonu.', category: 'Communication', isInstalled: false, requiresAuth: true, score: 95 },
    { id: '3', name: 'Web-Search (Google)', description: 'Gerçek zamanlı web araştırması ve dokümantasyon tarama.', category: 'Search', isInstalled: true, requiresAuth: false, score: 99 },
    { id: '4', name: 'PostgreSQL Explorer', description: 'Derin SQL analizi ve otomatik şema çıkarımı.', category: 'Data', isInstalled: false, requiresAuth: true, score: 97 },
  ]);

  return (
    <div className="mcp-market-shell p-8 bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/5 rounded-2xl">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-500">
            MCP Sovereign Market
          </h1>
          <p className="text-gray-500 text-sm mt-1">Sertifikalı ve güvenli Model Context Protocol sunucuları.</p>
        </div>
        <div className="flex gap-2">
          <input 
            type="text" 
            placeholder="Arama..." 
            className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-cyan-500/50"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {items.map((item) => (
          <div key={item.id} className="group p-6 bg-white/[0.02] border border-white/10 rounded-xl hover:bg-white/[0.04] transition-all hover:scale-[1.01]">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-200">{item.name}</h3>
                <span className="text-[10px] text-cyan-400/70 font-mono uppercase tracking-widest">{item.category}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-xs font-mono text-gray-400">Score: {item.score}</span>
              </div>
            </div>

            <p className="text-sm text-gray-500 mb-6 leading-relaxed">
              {item.description}
            </p>

            <div className="flex justify-between items-center">
              <div className="flex gap-2">
                {item.requiresAuth && (
                  <span className="px-2 py-1 bg-amber-900/20 text-amber-500 text-[10px] rounded border border-amber-900/50">
                    AUTH REQUIRED
                  </span>
                )}
              </div>
              <button 
                disabled={item.isInstalled}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  item.isInstalled 
                    ? 'bg-green-900/20 text-green-500 border border-green-900/50 cursor-default'
                    : 'bg-white text-black hover:bg-gray-200 active:scale-95'
                }`}
              >
                {item.isInstalled ? 'INSTALLED' : 'GET'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 p-4 border-t border-white/5 flex items-center justify-between text-xs text-gray-600">
        <div className="flex items-center gap-4">
          <span>Active Mesh: <span className="text-green-500">Connected</span></span>
          <span>Security-Gate: <span className="text-cyan-500">Active</span></span>
        </div>
        <div>
          Powered by Singularity-Prime
        </div>
      </div>
    </div>
  );
};
