import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { AuthPage } from './pages/AuthPage';
import { DashboardView } from './pages/DashboardView';
import { PipelineHistoryView } from './pages/PipelineHistoryView';
import { ActivePipelineView } from './pages/ActivePipelineView';
import { PlanApprovalView } from './pages/PlanApprovalView';
import { AlloySettingsShell } from './pages/sovereign/settings/AlloySettingsShell';
import { AlloyChatShell } from './pages/sovereign/chat/AlloyChatShell';

import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { PageErrorBoundary } from './components/PageErrorBoundary';
import { AuthGuard } from './components/AuthGuard';
import { ToastProvider } from './components/sovereign/Toast';

import { useEffect } from 'react';
import { useAppStore } from './store/appStore';
import { readGatewayToken } from './store/helpers';

function App() {
  const setGatewayToken = useAppStore(state => state.setGatewayToken);

  useEffect(() => {
    // Force sync the gateway token on mount to handle race conditions with script injection
    const token = readGatewayToken();
    if (token) {
      setGatewayToken(token);
    }
  }, [setGatewayToken]);

  return (
    <GlobalErrorBoundary>
      <ToastProvider>
        <HashRouter>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            
            {/* Main Application Routes inside Layout */}
            <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
              <Route path="/" element={<Navigate to="/chat" replace />} />
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
              
              {/* Fallback for old routes to Dashboard */}
              <Route path="/mission" element={<Navigate to="/dashboard" replace />} />
              <Route path="/accounts" element={<Navigate to="/settings" replace />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </ToastProvider>
    </GlobalErrorBoundary>
  );
}

export default App;
