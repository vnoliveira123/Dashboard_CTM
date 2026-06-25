import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Button, TextField, MenuItem, Select,
  FormControl, InputLabel, Chip, CircularProgress, Alert,
  Autocomplete, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tooltip, Divider, Grid, Accordion,
  AccordionSummary, AccordionDetails,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import BoltIcon from '@mui/icons-material/Bolt';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  useSimulacao, useHistoricoJob, useCenarios, useBuscarJobs,
  useCaminhoCritico,
  SimulacaoItem, JobBusca, SimulacaoParams, CaminhoItem, CaminhoCriticoParams,
} from '../hooks/useAnalise';

// ── Constantes de cor ─────────────────────────────────────────────────────────

const CRIT_COLOR: Record<string, string> = {
  ok:      '#4caf50',
  leve:    '#ffa726',
  atencao: '#ef6c00',
  critico: '#c62828',
};

const CRIT_BG: Record<string, string> = {
  ok:      '#e8f5e9',
  leve:    '#fff8e1',
  atencao: '#fbe9e7',
  critico: '#ffebee',
};

const CRIT_LABEL: Record<string, string> = {
  ok:      'No prazo',
  leve:    'Leve (+1–30min)',
  atencao: 'Atenção (+31–60min)',
  critico: 'Crítico (>60min)',
};

// ── Gantt ─────────────────────────────────────────────────────────────────────

const ROW_H   = 46;
const LABEL_W = 195;
const AXIS_H  = 28;
const PAD_X   = 12;

interface TooltipState {
  x: number; y: number; item: SimulacaoItem;
}

const GanttChart: React.FC<{ items: SimulacaoItem[] }> = ({ items }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth]     = useState(900);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const chartW = Math.max(300, width - LABEL_W - PAD_X * 2);

  const allMins = items.flatMap(i => [
    i.expected_start_min, i.expected_end_min,
    i.predicted_start_min, i.predicted_end_min,
  ]).filter(m => m > 0);

  const tMin = allMins.length ? Math.max(0,    Math.min(...allMins) - 30) : 0;
  const tMax = allMins.length ? Math.min(2880, Math.max(...allMins) + 30) : 1440;
  const tRange = tMax - tMin || 1;

  const toX = (m: number) => LABEL_W + PAD_X + ((m - tMin) / tRange) * chartW;
  const toW = (s: number, e: number) => Math.max(2, ((e - s) / tRange) * chartW);

  const tickStep = tRange > 600 ? 120 : tRange > 240 ? 60 : 30;
  const ticks: number[] = [];
  for (let t = Math.ceil(tMin / tickStep) * tickStep; t <= tMax; t += tickStep) {
    ticks.push(t);
  }

  const mToHHMM = (m: number) => {
    const norm = ((m % 1440) + 1440) % 1440;
    const h  = Math.floor(norm / 60);
    const mn = Math.floor(norm % 60);
    return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
  };

  const totalH = items.length * ROW_H + AXIS_H;

  const handleMouseMove = useCallback((e: React.MouseEvent, item: SimulacaoItem) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top - 10, item });
  }, []);

  if (!items.length) return null;

  return (
    <Box ref={containerRef} sx={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
      <svg width={width} height={totalH} style={{ display: 'block', fontFamily: 'inherit' }}>
        {/* Grid lines */}
        {ticks.map(t => (
          <line key={t}
            x1={toX(t)} y1={0} x2={toX(t)} y2={totalH - AXIS_H}
            stroke="#e0e0e0" strokeWidth={1}
          />
        ))}

        {/* Rows */}
        {items.map((item, i) => {
          const y    = i * ROW_H;
          const col  = CRIT_COLOR[item.criticidade] || '#4caf50';
          const exX  = toX(item.expected_start_min);
          const exW  = toW(item.expected_start_min, item.expected_end_min);
          const prX  = toX(item.predicted_start_min);
          const prW  = toW(item.predicted_start_min, item.predicted_end_min);

          return (
            <g key={`${item.tabela}_${item.job}_${i}`}>
              {/* Row bg */}
              <rect x={0} y={y} width={width} height={ROW_H}
                fill={i % 2 === 0 ? '#fafafa' : '#ffffff'} />

              {/* Hover capture area */}
              <rect x={0} y={y} width={width} height={ROW_H} fill="transparent"
                style={{ cursor: 'default' }}
                onMouseMove={e => handleMouseMove(e, item)}
                onMouseLeave={() => setTooltip(null)}
              />

              {/* Label */}
              <text x={LABEL_W - 6} y={y + ROW_H / 2 + 4}
                textAnchor="end" fontSize={11} fill="#444" fontFamily="inherit">
                {item.job.length > 18 ? item.job.slice(0, 17) + '…' : item.job}
              </text>

              {/* Expected bar */}
              {exW > 0 && (
                <rect x={exX} y={y + 10} width={exW} height={ROW_H - 22}
                  fill="#bdbdbd" opacity={0.45} rx={3} />
              )}

              {/* Predicted bar */}
              {prW > 0 && (
                <rect x={prX} y={y + 15} width={prW} height={ROW_H - 30}
                  fill={col} rx={3} />
              )}

              {/* Delay badge */}
              {item.delay_propagado > 0 && prW > 0 && (
                <text x={prX + prW + 4} y={y + ROW_H / 2 + 4}
                  fontSize={9} fill={col} fontFamily="inherit">
                  +{item.delay_propagado}
                </text>
              )}
            </g>
          );
        })}

        {/* X-axis */}
        <rect x={0} y={totalH - AXIS_H} width={width} height={AXIS_H} fill="white" />
        <line x1={LABEL_W + PAD_X} y1={totalH - AXIS_H} x2={width - PAD_X} y2={totalH - AXIS_H}
          stroke="#9e9e9e" strokeWidth={1} />
        {ticks.map(t => (
          <g key={`ax_${t}`}>
            <line x1={toX(t)} y1={totalH - AXIS_H} x2={toX(t)} y2={totalH - AXIS_H + 4}
              stroke="#9e9e9e" strokeWidth={1} />
            <text x={toX(t)} y={totalH - 6}
              textAnchor="middle" fontSize={10} fill="#666" fontFamily="inherit">
              {mToHHMM(t)}
            </text>
          </g>
        ))}
      </svg>

      {/* HTML tooltip */}
      {tooltip && (
        <Paper elevation={3} sx={{
          position: 'absolute',
          left: Math.min(tooltip.x + 12, width - 240),
          top:  tooltip.y - 60,
          p: 1.5, minWidth: 220, pointerEvents: 'none', zIndex: 10,
          borderLeft: `4px solid ${CRIT_COLOR[tooltip.item.criticidade]}`,
        }}>
          <Typography variant="caption" fontWeight={700} display="block">
            {tooltip.item.job}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {tooltip.item.tabela}
          </Typography>
          <Divider sx={{ my: 0.5 }} />
          <Typography variant="caption" display="block">
            Esperado: {tooltip.item.expected_start} → {tooltip.item.expected_end}
            {' '}({tooltip.item.duracao_esperada}min)
          </Typography>
          <Typography variant="caption" display="block">
            Previsto: {tooltip.item.predicted_start} → {tooltip.item.predicted_end}
            {' '}({tooltip.item.duracao_prevista}min)
          </Typography>
          {tooltip.item.delay_propagado > 0 && (
            <Typography variant="caption" display="block"
              sx={{ color: CRIT_COLOR[tooltip.item.criticidade], fontWeight: 700 }}>
              Atraso propagado: +{tooltip.item.delay_propagado} min
            </Typography>
          )}
          <Typography variant="caption" color="text.disabled" display="block">
            {tooltip.item.n_amostras} amostras · {tooltip.item.metodo}
          </Typography>
        </Paper>
      )}

      {/* Legend */}
      <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap', pl: `${LABEL_W}px` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 28, height: 8, bgcolor: '#bdbdbd', opacity: 0.6, borderRadius: 1 }} />
          <Typography variant="caption" color="text.secondary">Janela esperada</Typography>
        </Box>
        {Object.entries(CRIT_LABEL).map(([k, label]) => (
          <Box key={k} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 18, height: 8, bgcolor: CRIT_COLOR[k], borderRadius: 1 }} />
            <Typography variant="caption" color="text.secondary">{label}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

// ── Histórico mini-chart ───────────────────────────────────────────────────────

const HistoricoBarras: React.FC<{ tabela: string; job: string }> = ({ tabela, job }) => {
  const { data, isLoading } = useHistoricoJob(tabela, job, !!tabela && !!job);

  if (isLoading) return <CircularProgress size={20} />;
  if (!data || !data.dados.length) return (
    <Alert severity="info" sx={{ py: 0.5 }}>Sem histórico de duração para este job.</Alert>
  );

  const { estatisticas: e, dados } = data;
  const maxDur = Math.max(...dados.map(d => d.duracao), 0.1);

  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        {[
          { label: 'P50 (Mediana)', val: e.p50 },
          { label: 'P75',          val: e.p75 },
          { label: 'P90',          val: e.p90 },
          { label: 'Máximo',       val: e.max },
        ].map(({ label, val }) => (
          <Grid item xs={6} sm={3} key={label}>
            <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">{label}</Typography>
              <Typography variant="h6" fontWeight={700}>{val.toFixed(1)}<Typography component="span" variant="caption">min</Typography></Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {/* Mini bar chart */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 80, mt: 1 }}>
        {dados.map((d, i) => (
          <Tooltip key={i} title={`${d.data}: ${d.duracao}min`} arrow>
            <Box sx={{
              flex: 1,
              height: `${(d.duracao / maxDur) * 100}%`,
              minHeight: 2,
              bgcolor: '#1976d2',
              borderRadius: '2px 2px 0 0',
              cursor: 'default',
              opacity: 0.75,
              '&:hover': { opacity: 1 },
            }} />
          </Tooltip>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        Duração diária — {data.n} dias · média {e.media.toFixed(1)}min
      </Typography>
    </Box>
  );
};

// ── Tabela de impacto ─────────────────────────────────────────────────────────

const TabelaImpacto: React.FC<{ items: SimulacaoItem[] }> = ({ items }) => (
  <TableContainer>
    <Table size="small">
      <TableHead>
        <TableRow sx={{ bgcolor: '#f5f5f5' }}>
          <TableCell sx={{ fontWeight: 700 }}>Tabela</TableCell>
          <TableCell sx={{ fontWeight: 700 }}>Job</TableCell>
          <TableCell sx={{ fontWeight: 700 }}>Início esperado</TableCell>
          <TableCell sx={{ fontWeight: 700 }}>Início previsto</TableCell>
          <TableCell sx={{ fontWeight: 700 }}>Duração prev.</TableCell>
          <TableCell sx={{ fontWeight: 700 }}>Atraso</TableCell>
          <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
          <TableCell sx={{ fontWeight: 700 }}>Amostras</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {items.map((item, i) => (
          <TableRow key={i} hover sx={{ bgcolor: i % 2 === 0 ? 'inherit' : '#fafafa' }}>
            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{item.tabela}</TableCell>
            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{item.job}</TableCell>
            <TableCell>{item.expected_start}</TableCell>
            <TableCell>{item.predicted_start}</TableCell>
            <TableCell>{item.duracao_prevista}min</TableCell>
            <TableCell>
              {item.delay_propagado > 0
                ? <Typography sx={{ color: CRIT_COLOR[item.criticidade], fontWeight: 700 }}>
                    +{item.delay_propagado}min
                  </Typography>
                : <Typography color="text.secondary">—</Typography>
              }
            </TableCell>
            <TableCell>
              <Chip
                label={CRIT_LABEL[item.criticidade]}
                size="small"
                sx={{
                  bgcolor: CRIT_BG[item.criticidade],
                  color:   CRIT_COLOR[item.criticidade],
                  fontWeight: 700,
                  fontSize: 11,
                }}
              />
            </TableCell>
            <TableCell>
              <Tooltip title={`Método: ${item.metodo}`}>
                <Typography variant="caption" color="text.secondary">
                  {item.n_amostras}
                </Typography>
              </Tooltip>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </TableContainer>
);

// ── Análise Direta: Job em Processamento → Job Objetivo ───────────────────────

const JobCard: React.FC<{ item: CaminhoItem }> = ({ item }) => {
  const color = CRIT_COLOR[item.criticidade];
  const isBg  = CRIT_BG[item.criticidade];

  return (
    <Paper variant="outlined" sx={{
      p: 1.5, minWidth: 148, maxWidth: 160, flexShrink: 0,
      borderColor: item.is_destino ? color : item.is_origem ? '#1976d2' : 'divider',
      borderWidth: (item.is_destino || item.is_origem) ? 2 : 1,
      bgcolor:     item.is_destino ? isBg : item.is_origem ? '#e3f2fd' : 'white',
    }}>
      <Typography variant="caption" fontWeight={700} display="block" noWrap
        title={item.job}
        sx={{ color: item.is_destino ? color : item.is_origem ? '#1976d2' : 'text.primary' }}>
        {item.is_origem ? '⚡ ' : item.is_destino ? '🎯 ' : ''}{item.job}
      </Typography>
      <Typography variant="caption" color="text.disabled" display="block" noWrap fontSize={10}>
        {item.tabela}
      </Typography>
      <Divider sx={{ my: 0.5 }} />
      {item.tem_dados ? (
        <>
          <Typography variant="caption" display="block" color="text.secondary">
            Esp: {item.expected_start}
          </Typography>
          <Typography variant="caption" display="block" fontWeight={700}
            sx={{ color: item.delay_propagado > 0 ? color : 'text.primary' }}>
            Prev: {item.predicted_start}
          </Typography>
          <Typography variant="caption" display="block" color="text.disabled">
            {item.duracao_prevista}min
          </Typography>
        </>
      ) : (
        <Typography variant="caption" color="text.disabled">sem histórico</Typography>
      )}
    </Paper>
  );
};

const AnaliseDireta: React.FC = () => {
  const today = new Date().toISOString().slice(0, 10);

  const [jobOrigem,    setJobOrigem]    = useState<JobBusca | null>(null);
  const [buscaOrigem,  setBuscaOrigem]  = useState('');
  const [jobDestino,   setJobDestino]   = useState<JobBusca | null>(null);
  const [buscaDestino, setBuscaDestino] = useState('');
  const [delayInput,   setDelayInput]   = useState('30');
  const [cenario,      setCenario]      = useState('normal');
  const [dataRef,      setDataRef]      = useState(today);
  const [params,       setParams]       = useState<CaminhoCriticoParams | null>(null);

  const { data: opOrigem,  isLoading: buscandoOrig  } = useBuscarJobs(buscaOrigem);
  const { data: opDestino, isLoading: buscandoDest  } = useBuscarJobs(buscaDestino);
  const { data: cenarios }                             = useCenarios();
  const { data, isLoading, error }                     = useCaminhoCritico(params);

  const handleCalcular = () => {
    if (!jobOrigem || !jobDestino) return;
    const d = parseFloat(delayInput);
    if (isNaN(d) || d < 0) return;
    setParams({
      tab_origem:  jobOrigem.tabela,
      job_origem:  jobOrigem.job,
      tab_destino: jobDestino.tabela,
      job_destino: jobDestino.job,
      delay: d,
      data:  dataRef,
      cenario,
    });
  };

  const objetivo = data?.objetivo ?? null;

  // Para cadeias longas, mostrar os 3 primeiros + "..." + 3 últimos
  const caminho = data?.caminho ?? [];
  const MAX_VISIBLE = 8;
  const showEllipsis = caminho.length > MAX_VISIBLE;
  const visibleLeft  = showEllipsis ? caminho.slice(0, 3) : caminho;
  const visibleRight = showEllipsis ? caminho.slice(-3)   : [];

  return (
    <Paper elevation={3} sx={{ p: 3, mb: 3, borderTop: '4px solid #1976d2' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <BoltIcon sx={{ color: '#1976d2' }} />
        <Typography variant="h6" fontWeight={700} sx={{ color: '#1976d2' }}>
          Análise Direta — Job em Processamento → Job Objetivo
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Informe o job que está atrasado, o job que você precisa monitorar e quantos
        minutos de atraso já acumulou. O sistema calcula o caminho entre eles e estima
        o horário previsto de execução.
      </Typography>

      {/* Formulário */}
      <Grid container spacing={2} alignItems="flex-end">
        <Grid item xs={12} sm={6} md={3}>
          <Autocomplete
            options={opOrigem?.jobs ?? []}
            loading={buscandoOrig}
            value={jobOrigem}
            onChange={(_, v) => setJobOrigem(v)}
            inputValue={buscaOrigem}
            onInputChange={(_, v) => setBuscaOrigem(v)}
            getOptionLabel={o => `${o.job} (${o.tabela})`}
            isOptionEqualToValue={(a, b) => a.tabela === b.tabela && a.job === b.job}
            noOptionsText="Digite para buscar..."
            renderInput={p => (
              <TextField {...p} label="⚡ Job em processamento" size="small" fullWidth
                helperText="Job que está atrasado" />
            )}
          />
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <TextField
            label="Atraso atual (min)"
            size="small" fullWidth type="number"
            value={delayInput}
            onChange={e => setDelayInput(e.target.value)}
            inputProps={{ min: 0, max: 1440, step: 5 }}
            helperText="Minutos além do esperado"
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Autocomplete
            options={opDestino?.jobs ?? []}
            loading={buscandoDest}
            value={jobDestino}
            onChange={(_, v) => setJobDestino(v)}
            inputValue={buscaDestino}
            onInputChange={(_, v) => setBuscaDestino(v)}
            getOptionLabel={o => `${o.job} (${o.tabela})`}
            isOptionEqualToValue={(a, b) => a.tabela === b.tabela && a.job === b.job}
            noOptionsText="Digite para buscar..."
            renderInput={p => (
              <TextField {...p} label="🎯 Job objetivo" size="small" fullWidth
                helperText="Job que precisa monitorar" />
            )}
          />
        </Grid>

        <Grid item xs={6} sm={3} md={2}>
          <FormControl size="small" fullWidth>
            <InputLabel>Cenário</InputLabel>
            <Select value={cenario} label="Cenário"
              onChange={e => setCenario(e.target.value)}>
              {cenarios?.cenarios.map(c => (
                <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid item xs={6} sm={3} md={1}>
          <TextField
            label="Data" size="small" fullWidth type="date"
            value={dataRef} onChange={e => setDataRef(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Grid>

        <Grid item xs={12} sm={6} md={1}>
          <Button
            variant="contained" fullWidth
            startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <BoltIcon />}
            onClick={handleCalcular}
            disabled={!jobOrigem || !jobDestino || isLoading}
            sx={{ height: 40 }}
          >
            Calcular
          </Button>
        </Grid>
      </Grid>

      {/* Erro de API */}
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {(error as Error).message || 'Erro ao calcular caminho.'}
        </Alert>
      )}

      {/* Caminho não encontrado */}
      {data && !data.encontrado && (
        <Alert severity="warning" sx={{ mt: 2 }}>{data.mensagem}</Alert>
      )}

      {/* Resultado */}
      {data && data.encontrado && (
        <Box sx={{ mt: 3 }}>
          {/* Cadeia visual */}
          <Box sx={{ overflowX: 'auto', display: 'flex', alignItems: 'center',
                     gap: 0.5, py: 1, pb: 2 }}>
            {(showEllipsis ? visibleLeft : caminho).map((item, i) => (
              <React.Fragment key={`L${i}`}>
                <JobCard item={item} />
                {(i < visibleLeft.length - 1 || showEllipsis) && (
                  <ArrowForwardIcon sx={{ color: 'text.disabled', flexShrink: 0 }} fontSize="small" />
                )}
              </React.Fragment>
            ))}

            {showEllipsis && (
              <>
                <Tooltip title={`${caminho.length - 6} jobs intermediários omitidos`}>
                  <Typography variant="caption" color="text.disabled"
                    sx={{ px: 1, flexShrink: 0, cursor: 'default' }}>
                    · · · {caminho.length - 6} jobs · · ·
                  </Typography>
                </Tooltip>
                <ArrowForwardIcon sx={{ color: 'text.disabled', flexShrink: 0 }} fontSize="small" />
                {visibleRight.map((item, i) => (
                  <React.Fragment key={`R${i}`}>
                    <JobCard item={item} />
                    {i < visibleRight.length - 1 && (
                      <ArrowForwardIcon sx={{ color: 'text.disabled', flexShrink: 0 }} fontSize="small" />
                    )}
                  </React.Fragment>
                ))}
              </>
            )}
          </Box>

          {/* Resultado destacado */}
          {objetivo && (
            <Box sx={{
              p: 2.5,
              bgcolor: CRIT_BG[objetivo.criticidade],
              border: `2px solid ${CRIT_COLOR[objetivo.criticidade]}`,
              borderRadius: 2,
              display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center',
            }}>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  JOB OBJETIVO
                </Typography>
                <Typography variant="h6" fontWeight={700}>
                  {objetivo.job}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {objetivo.tabela}
                </Typography>
              </Box>

              <Divider orientation="vertical" flexItem />

              <Box>
                <Typography variant="caption" color="text.secondary" display="block">INÍCIO ESPERADO</Typography>
                <Typography variant="h6">{objetivo.expected_start}</Typography>
              </Box>

              <ArrowForwardIcon sx={{ color: CRIT_COLOR[objetivo.criticidade] }} />

              <Box>
                <Typography variant="caption" color="text.secondary" display="block">INÍCIO PREVISTO</Typography>
                <Typography variant="h5" fontWeight={900}
                  sx={{ color: CRIT_COLOR[objetivo.criticidade] }}>
                  {objetivo.predicted_start}
                </Typography>
              </Box>

              <Divider orientation="vertical" flexItem />

              <Box>
                <Typography variant="caption" color="text.secondary" display="block">TÉRMINO PREVISTO</Typography>
                <Typography variant="h6">{objetivo.predicted_end}</Typography>
                <Typography variant="caption" color="text.secondary">
                  duração prevista: {objetivo.duracao_prevista}min
                </Typography>
              </Box>

              <Divider orientation="vertical" flexItem />

              <Box sx={{ textAlign: 'center' }}>
                <Chip
                  label={`+${objetivo.delay_propagado} min de atraso`}
                  sx={{
                    bgcolor: CRIT_COLOR[objetivo.criticidade],
                    color: 'white', fontWeight: 700, fontSize: 14,
                    height: 36, px: 1,
                  }}
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  {data.n_hops} job{data.n_hops !== 1 ? 's' : ''} no caminho
                  · percentil {data.percentil}
                </Typography>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Paper>
  );
};

// ── Tela principal ────────────────────────────────────────────────────────────

export const Tela4Analise: React.FC = () => {
  const today = new Date().toISOString().slice(0, 10);

  // Form state
  const [jobSel,     setJobSel]     = useState<JobBusca | null>(null);
  const [busca,      setBusca]      = useState('');
  const [delay,      setDelay]      = useState<number>(30);
  const [delayInput, setDelayInput] = useState('30');
  const [cenario,    setCenario]    = useState('normal');
  const [dataRef,    setDataRef]    = useState(today);

  // Simulation trigger
  const [simParams, setSimParams] = useState<SimulacaoParams | null>(null);

  const { data: cenarios } = useCenarios();
  const { data: jobsBusca, isLoading: buscando } = useBuscarJobs(busca);
  const { data: simData, isLoading: simulando, error: simError } = useSimulacao(simParams);

  const jobOpcoes: JobBusca[] = jobsBusca?.jobs ?? [];

  const handleSimular = () => {
    if (!jobSel) return;
    const d = parseFloat(delayInput);
    if (isNaN(d) || d < 0) return;
    setDelay(d);
    setSimParams({
      tabela:  jobSel.tabela,
      job:     jobSel.job,
      delay:   d,
      data:    dataRef,
      cenario,
    });
  };

  const cenarioLabel = useMemo(() => {
    const c = cenarios?.cenarios.find(c => c.id === cenario);
    return c ? `${c.label} — ${c.descricao}` : cenario;
  }, [cenarios, cenario]);

  // Summary stats
  const resumo = useMemo(() => {
    if (!simData) return null;
    const items = simData.simulacao;
    return {
      total:    items.length,
      criticos: items.filter(i => i.criticidade === 'critico').length,
      atencao:  items.filter(i => i.criticidade === 'atencao').length,
      leve:     items.filter(i => i.criticidade === 'leve').length,
      ok:       items.filter(i => i.criticidade === 'ok').length,
      maxDelay: Math.max(...items.map(i => i.delay_propagado), 0),
    };
  }, [simData]);

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        🧠 Análise Preditiva
      </Typography>

      {/* ── Análise direta (destaque) ── */}
      <AnaliseDireta />

      {/* ── Simulação completa (accordion) ── */}
      <Accordion disableGutters elevation={2}
        sx={{ mb: 3, '&:before': { display: 'none' }, borderRadius: 1 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}
          sx={{ bgcolor: '#f5f5f5', borderRadius: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PlayArrowIcon fontSize="small" color="primary" />
            <Typography fontWeight={700}>Simulação Completa — todos os jobs downstream</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              BFS a partir de um job com Gantt e tabela de impacto
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 2 }}>

      {/* ── Painel de entrada ── */}
      <Paper sx={{ p: 3, mb: 3 }} elevation={0} variant="outlined">
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Configuração da Simulação
        </Typography>

        <Grid container spacing={2} alignItems="flex-end">
          {/* Job selector */}
          <Grid item xs={12} md={4}>
            <Autocomplete
              options={jobOpcoes}
              loading={buscando}
              value={jobSel}
              onChange={(_, v) => setJobSel(v)}
              inputValue={busca}
              onInputChange={(_, v) => setBusca(v)}
              getOptionLabel={o => `${o.job} (${o.tabela})`}
              isOptionEqualToValue={(a, b) => a.tabela === b.tabela && a.job === b.job}
              noOptionsText="Digite para buscar..."
              renderInput={params => (
                <TextField {...params} label="Job inicial" size="small" fullWidth
                  helperText="Busque por nome de job ou tabela"
                />
              )}
            />
          </Grid>

          {/* Delay */}
          <Grid item xs={6} md={2}>
            <TextField
              label="Atraso inicial (min)"
              size="small" fullWidth type="number"
              value={delayInput}
              onChange={e => setDelayInput(e.target.value)}
              inputProps={{ min: 0, max: 1440, step: 5 }}
            />
          </Grid>

          {/* Cenário */}
          <Grid item xs={6} md={3}>
            <FormControl size="small" fullWidth>
              <InputLabel>Cenário financeiro</InputLabel>
              <Select value={cenario} label="Cenário financeiro"
                onChange={e => setCenario(e.target.value)}>
                {cenarios?.cenarios.map(c => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.label} — {c.descricao}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          {/* Data de referência */}
          <Grid item xs={6} md={2}>
            <TextField
              label="Data de referência"
              size="small" fullWidth type="date"
              value={dataRef}
              onChange={e => setDataRef(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

          {/* Simular */}
          <Grid item xs={6} md={1}>
            <Button
              variant="contained" fullWidth
              startIcon={simulando ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
              onClick={handleSimular}
              disabled={!jobSel || simulando}
              sx={{ height: 40 }}
            >
              Simular
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* ── Erro ── */}
      {simError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {(simError as Error).message || 'Erro ao executar simulação.'}
        </Alert>
      )}

      {/* ── Histórico do job selecionado ── */}
      {jobSel && (
        <Paper sx={{ p: 2.5, mb: 3 }} elevation={1}>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <InfoOutlinedIcon fontSize="small" />
            Histórico de duração — {jobSel.job}
          </Typography>
          <HistoricoBarras tabela={jobSel.tabela} job={jobSel.job} />
        </Paper>
      )}

      {/* ── Resultado da simulação ── */}
      {simData && (
        <>
          {/* Resumo */}
          <Paper sx={{ p: 2.5, mb: 2 }} elevation={1}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="subtitle2" fontWeight={700}>
                Simulação: atraso de {simData.delay_inicial}min em{' '}
                <strong>{simParams?.job}</strong>
                {' '}· {cenarioLabel}
                {' '}· {simData.data_ref}
              </Typography>
              <Box sx={{ flex: 1 }} />
              {resumo && (
                <>
                  <Chip icon={<CheckCircleOutlineIcon />} label={`${resumo.ok} ok`}
                    sx={{ bgcolor: CRIT_BG.ok, color: CRIT_COLOR.ok }} size="small" />
                  {resumo.leve > 0 && (
                    <Chip label={`${resumo.leve} leve`}
                      sx={{ bgcolor: CRIT_BG.leve, color: CRIT_COLOR.leve }} size="small" />
                  )}
                  {resumo.atencao > 0 && (
                    <Chip icon={<WarningAmberIcon />} label={`${resumo.atencao} atenção`}
                      sx={{ bgcolor: CRIT_BG.atencao, color: CRIT_COLOR.atencao }} size="small" />
                  )}
                  {resumo.criticos > 0 && (
                    <Chip icon={<WarningAmberIcon />} label={`${resumo.criticos} crítico`}
                      sx={{ bgcolor: CRIT_BG.critico, color: CRIT_COLOR.critico }} size="small" />
                  )}
                  {resumo.maxDelay > 0 && (
                    <Chip icon={<AccessTimeIcon />}
                      label={`Atraso máx: +${resumo.maxDelay}min`}
                      color="default" size="small" />
                  )}
                </>
              )}
            </Box>
          </Paper>

          {/* Gantt */}
          <Paper sx={{ p: 2.5, mb: 3 }} elevation={1}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Linha do Tempo — {simData.total_jobs} jobs
            </Typography>
            <GanttChart items={simData.simulacao} />
          </Paper>

          {/* Tabela */}
          <Paper sx={{ p: 2.5 }} elevation={1}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Detalhamento por Job
            </Typography>
            <TabelaImpacto items={simData.simulacao} />
          </Paper>
        </>
      )}

      {/* Estado vazio */}
      {!simData && !simulando && (
        <Box sx={{ textAlign: 'center', py: 6, color: 'text.disabled' }}>
          <AccessTimeIcon sx={{ fontSize: 48, mb: 1 }} />
          <Typography variant="body1">Selecione um job e clique em Simular</Typography>
        </Box>
      )}

        </AccordionDetails>
      </Accordion>
    </Box>
  );
};
