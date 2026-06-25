import React from 'react';
import { Box } from '@mui/material';

interface FilterBarProps {
  children?: React.ReactNode;
}

export const FilterBar: React.FC<FilterBarProps> = ({ children }) => {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
      {children}
    </Box>
  );
};
