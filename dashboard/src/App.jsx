import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppProvider } from "./state/AppContext.jsx";
import { AttestProvider } from "./state/AttestContext.jsx";
import { StaticAttestProvider } from "./state/StaticAttest.jsx";
import { STATIC_MODE } from "./mode.js";
import Bootstrap from "./state/Bootstrap.jsx";
import Layout from "./components/Layout.jsx";
import Hero from "./pages/Hero.jsx";
import Overview from "./pages/Overview.jsx";
import Trade from "./pages/Trade.jsx";
import Trust from "./pages/Trust.jsx";
import Ontology from "./pages/Ontology.jsx";
import Report from "./pages/Report.jsx";
import DetailLayout, { DetailPending } from "./pages/detail/DetailLayout.jsx";

// 정적 모드는 증명 상태를 스냅샷(index.json·attestation.json)에서 읽는다
const Attest = STATIC_MODE ? StaticAttestProvider : AttestProvider;

// 예전 주소(#/ontology, #/report)는 쿼리(?scenario=)를 유지한 채 상세 분석 아래 새 위치로 보낸다
function Moved({ to }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

export default function App() {
  return (
    <HashRouter>
      <AppProvider>
        <Attest>
          <Bootstrap />
          <Layout>
            <Routes>
              <Route path="/" element={<Hero />} />
              <Route path="/overview" element={<Overview />} />
              <Route path="/trade" element={<Trade />} />
              <Route path="/trust" element={<Trust />} />
              <Route path="/detail" element={<DetailLayout />}>
                <Route index element={<Moved to="/detail/conditions" />} />
                <Route path="conditions" element={<DetailPending title="판정 조건" />} />
                <Route path="graph" element={<Ontology />} />
                <Route path="report" element={<Report />} />
                <Route path="raw" element={<DetailPending title="원자료" />} />
              </Route>
              <Route path="/ontology" element={<Moved to="/detail/graph" />} />
              <Route path="/report" element={<Moved to="/detail/report" />} />
              <Route path="*" element={<Moved to="/overview" />} />
            </Routes>
          </Layout>
        </Attest>
      </AppProvider>
    </HashRouter>
  );
}
