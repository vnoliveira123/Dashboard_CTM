import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Box } from '@mui/material';
import { Header } from './components/Shared/Header';
import { Sidebar } from './components/Shared/Sidebar';
import { Tela1Processos } from './components/Tela1_Processos';
import { Tela2Execucoes } from './components/Tela2_Execucoes';
import { Tela3Fluxos } from './components/Tela3_Fluxos';
import { Tela4Analise } from './components/Tela4_Analise';

function App() {
  return (
    <Router>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <Header />
        <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <Sidebar />
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            <Routes>
              <Route path="/" element={<Tela1Processos />} />
              <Route path="/processos" element={<Tela1Processos />} />
              <Route path="/execucoes" element={<Tela2Execucoes />} />
              <Route path="/fluxos"  element={<Tela3Fluxos />} />
              <Route path="/analise" element={<Tela4Analise />} />
            </Routes>
          </Box>
        </Box>
      </Box>
    </Router>
  );
}

export default App;
