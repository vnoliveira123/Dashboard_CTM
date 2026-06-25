import React from 'react';
import { AppBar, Toolbar, Typography } from '@mui/material';

export const Header: React.FC = () => {
  return (
    <AppBar position="static">
      <Toolbar>
        <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
          📊 Log Dashboard
        </Typography>
        <Typography variant="body2">
          Análise de Processos Control-M
        </Typography>
      </Toolbar>
    </AppBar>
  );
};
