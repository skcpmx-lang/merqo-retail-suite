import logoUrl from '../../assets/logo.svg';
import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './store';
import { SetupWizard } from './pages/SetupWizard';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Pos } from './pages/Pos';
import { Purchases } from './pages/Purchases';
import { Products } from './pages/Products';
import { Customers } from './pages/Customers';
import { Suppliers } from './pages/Suppliers';
import { Accounts } from './pages/Accounts';
import { Agent } from './pages/Agent';
import { Reports } from './pages/Reports';
import { Notifications } from './pages/Notifications';
import { Employees } from './pages/Employees';
import { Settings } from './pages/Settings';
import { Spinner } from './components/ui';

function Gate(): React.ReactElement {
  const { sessionChecked, setupComplete, user } = useApp();

  if (!sessionChecked || setupComplete === null) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <img src={logoUrl} alt="MERQO" style={{ width: 52, height: 52, display: "block", margin: "0 auto" }} />
        <Spinner />
        <p className="mq-muted">MERQO লোড হচ্ছে…</p>
      </div>
    );
  }
  if (!setupComplete) return <SetupWizard />;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/sales" element={<Pos />} />
      <Route path="/purchases" element={<Purchases />} />
      <Route path="/products" element={<Products />} />
      <Route path="/customers" element={<Customers />} />
      <Route path="/suppliers" element={<Suppliers />} />
      <Route path="/accounts" element={<Accounts />} />
      <Route path="/agent" element={<Agent />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/notifications" element={<Notifications />} />
      <Route path="/employees" element={<Employees />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App(): React.ReactElement {
  return (
    <HashRouter>
      <AppProvider>
        <Gate />
      </AppProvider>
    </HashRouter>
  );
}
