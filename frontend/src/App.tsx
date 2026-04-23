import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { DashboardPage } from '@/pages/DashboardPage';
import { SpreadEntryPage } from '@/pages/SpreadEntryPage';
import { SpreadReviewPage } from '@/pages/SpreadReviewPage';
import { PortfolioPage } from '@/pages/PortfolioPage';
import { ExplorePage } from '@/pages/ExplorePage';
import { RiskPage } from '@/pages/RiskPage';
import { PnLPage } from '@/pages/PnLPage';
import { ToastProvider } from '@/components/Toast';

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/spreads/new" element={<SpreadEntryPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/risk" element={<RiskPage />} />
            <Route path="/spreads/:id" element={<SpreadReviewPage />} />
            <Route path="/explore" element={<ExplorePage />} />
            <Route path="/pnl" element={<PnLPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
