import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { AuthPage } from './pages/AuthPage';
import { DashboardView } from './pages/DashboardView';
import { PipelineHistoryView } from './pages/PipelineHistoryView';
import { ActivePipelineView } from './pages/ActivePipelineView';
import { PlanApprovalView } from './pages/PlanApprovalView';
import { AlloySettingsShell } from './pages/alloy/settings/AlloySettingsShell';
import { AlloyChatShell } from './pages/alloy/AlloyChatShell';
import { ProjectsPage } from './pages/ProjectsPage';
import { BuilderPage } from './pages/BuilderPage';
import MetroStatusView from './pages/MetroStatusView';

import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { PageErrorBoundary } from './components/PageErrorBoundary';
import { AuthGuard } from './components/AuthGuard';
import { ToastProvider } from './components/sovereign/Toast';

import { useEffect } from 'react';
import { useAppStore } from './store/appStore';
import { readGatewayToken } from './store/helpers';

import { EnvironmentProvider, TransportProvider } from '@alloy/ui-core';

const consoleAdapter = {
  get: async (endpoint: string) => fetch(endpoint).then(r => r.json()),
  post: async (endpoint: string, data: any) => fetch(endpoint, { method: 'POST', body: JSON.stringify(data) }).then(r => r.json()),
  subscribe: () => { return () => {} }
};

function App() {
  const setGatewayToken = useAppStore(state => state.setGatewayToken);

  useEffect(() => {
    const token = readGatewayToken();
    if (token) setGatewayToken(token);
  }, [setGatewayToken]);

  return (
    <GlobalErrorBoundary>
      <ToastProvider>
        <EnvironmentProvider forcedEnv="console">
          <TransportProvider adapter={consoleAdapter}>
            <HashRouter>
              <Routes>
                <Route path="/auth" element={<AuthPage />} />

                <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
                  <Route path="/" element={<Navigate to="/projects" replace />} />

                  <Route path="/projects" element={
                    <PageErrorBoundary pageName="Projects">
                      <ProjectsPage />
                    </PageErrorBoundary>
                  } />
                  <Route path="/project/:id" element={
                    <PageErrorBoundary pageName="Builder">
                      <BuilderPage />
                    </PageErrorBoundary>
                  } />

                  <Route path="/chat" element={
                    <PageErrorBoundary pageName="Chat">
                      <AlloyChatShell />
                    </PageErrorBoundary>
                  } />
                  <Route path="/dashboard" element={
                    <PageErrorBoundary pageName="Dashboard">
                      <DashboardView />
                    </PageErrorBoundary>
                  } />

                  <Route path="/pipeline/history" element={
                    <PageErrorBoundary pageName="Pipeline History">
                      <PipelineHistoryView />
                    </PageErrorBoundary>
                  } />
                  <Route path="/pipeline/:id" element={
                    <PageErrorBoundary pageName="Active Pipeline">
                      <ActivePipelineView />
                    </PageErrorBoundary>
                  } />
                  <Route path="/pipeline/:id/plan" element={
                    <PageErrorBoundary pageName="Plan Approval">
                      <PlanApprovalView />
                    </PageErrorBoundary>
                  } />
                  <Route path="/pipeline/active" element={
                    <PageErrorBoundary pageName="Active Pipeline">
                      <ActivePipelineView />
                    </PageErrorBoundary>
                  } />

                  <Route path="/settings" element={
                    <PageErrorBoundary pageName="Settings">
                      <AlloySettingsShell />
                    </PageErrorBoundary>
                  } />

                  <Route path="/metro" element={
                    <PageErrorBoundary pageName="Metro Watchdog">
                      <MetroStatusView />
                    </PageErrorBoundary>
                  } />

                  <Route path="/mission" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/accounts" element={<Navigate to="/settings" replace />} />
                  <Route path="*" element={<Navigate to="/projects" replace />} />
                </Route>
              </Routes>
            </HashRouter>
          </TransportProvider>
        </EnvironmentProvider>
      </ToastProvider>
    </GlobalErrorBoundary>
  );
}

export default App;
