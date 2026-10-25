import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppProvider } from "./state/AppContext.jsx";
import { AttestProvider } from "./state/AttestContext.jsx";
import Bootstrap from "./state/Bootstrap.jsx";
import Layout from "./components/Layout.jsx";
import Overview from "./pages/Overview.jsx";
import Trade from "./pages/Trade.jsx";
import Trust from "./pages/Trust.jsx";
import Ontology from "./pages/Ontology.jsx";
import Report from "./pages/Report.jsx";

export default function App() {
  return (
    <HashRouter>
      <AppProvider>
        <AttestProvider>
          <Bootstrap />
          <Layout>
            <Routes>
              <Route path="/overview" element={<Overview />} />
              <Route path="/trade" element={<Trade />} />
              <Route path="/trust" element={<Trust />} />
              <Route path="/ontology" element={<Ontology />} />
              <Route path="/report" element={<Report />} />
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </Layout>
        </AttestProvider>
      </AppProvider>
    </HashRouter>
  );
}
