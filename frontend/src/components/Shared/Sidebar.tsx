import React from 'react';
import { Box, List, ListItem, ListItemButton, ListItemText } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export const Sidebar: React.FC = () => {
  const navigate = useNavigate();

  const menuItems = [
    { label: '📋 Processos', path: '/processos' },
    { label: '📈 Execuções', path: '/execucoes' },
    { label: '🔗 Fluxos',             path: '/fluxos' },
    { label: '🧠 Análise Preditiva', path: '/analise' },
  ];

  return (
    <Box sx={{ width: 250, bgcolor: '#f5f5f5', height: '100vh', p: 2 }}>
      <List>
        {menuItems.map((item) => (
          <ListItem key={item.path} disablePadding>
            <ListItemButton onClick={() => navigate(item.path)}>
              <ListItemText primary={item.label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );
};
