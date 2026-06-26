import React, { useState, useMemo } from 'react';
import * as d3 from 'd3';
import {
  Box, Paper, Typography, TextField, Button, Chip, CircularProgress, Alert,
  Pagination, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  FormControl, InputLabel, Select, MenuItem, Divider, Collapse, Card, CardContent, Grid,
  Autocomplete, Checkbox, LinearProgress, Tabs, Tab,
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import ClearIcon from '@mui/icons-material/Clear';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import TimerIcon from '@mui/icons-material/Timer';
import SpeedIcon from '@mui/icons-material/Speed';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import {
  useExecucoes, useGraficosExecucoes, useRotinasDisponiveis, useSlaJobs,
  useDesvioVolumetria, useTendenciaDuracao, useMultiplasPorDia,
  FiltrosExecucao, VolumeData, TopDurData, HoraData, IsdData, TimeseriesItem, SlaItem,
  DesvioVolumetriaItem, TendenciaDuracaoItem, MultiplasItem,
} from '../hooks/useExecucoes';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import BarChartIcon   from '@mui/icons-material/BarChart';

const GRUPOS    = ['PR12', 'PR21', 'PR31', 'PR41'];
const AMBIENTES = ['AL1', 'MZ1'];
const AMB_COLORS: Record<string, { bg: string; text: string }> = {
  AL1: { bg: '#e3f2fd', text: '#1565c0' },
  MZ1: { bg: '#e8f5e9', text: '#1b5e20' },
};

const FILTROS_VAZIOS: FiltrosExecucao = { tabela: [], job: [], grupo: [], rotina: [], ambiente: [], data_inicio: '', data_fim: '', status: '' };

function getFiltrosIniciais(): FiltrosExecucao {
  return { ...FILTROS_VAZIOS };
}

// ── Helpers D3 ───────────────────────────────────────────────────────────────

const W = 560;
const MARGIN = { top: 16, right: 24, bottom: 46, left: 52 };
const IW = W - MARGIN.left - MARGIN.right;

function Eixo({ scale, ticks, orient, innerSize }: {
  scale: d3.ScaleLinear<number,number> | d3.ScaleBand<string>;
  ticks?: number[]; orient: 'bottom'|'left'; innerSize: number;
}) {
  if (orient === 'bottom') {
    const band = scale as d3.ScaleBand<string>;
    const domain = band.domain();
    const step = Math.ceil(domain.length / 8);
    return (
      <g transform={`translate(0,${innerSize})`}>
        <line x1={0} x2={IW} stroke="#ccc" />
        {domain.filter((_, i) => i % step === 0).map(v => (
          <text key={v} x={(band(v) || 0) + band.bandwidth() / 2}
                y={18} textAnchor="middle" fontSize={9} fill="#888"
                transform={`rotate(-30,${(band(v) || 0) + band.bandwidth() / 2},18)`}>
            {v.length > 7 ? v.slice(-7) : v}
          </text>
        ))}
      </g>
    );
  }
  const lin = scale as d3.ScaleLinear<number,number>;
  return (
    <g>
      <line y1={0} y2={innerSize} stroke="#ccc" />
      {(ticks ?? lin.ticks(5)).map(t => (
        <g key={t} transform={`translate(0,${lin(t)})`}>
          <line x2={IW} stroke="#f0f0f0" />
          <text x={-6} dy="0.35em" textAnchor="end" fontSize={9} fill="#888">{t}</text>
        </g>
      ))}
    </g>
  );
}

// ── Chart 1: Volume por data (barras empilhadas) ─────────────────────────────
const GraficoVolumeDiario: React.FC<{ data: VolumeData[] }> = ({ data }) => {
  if (!data.length) return <SemDados />;
  const IH = 160;
  const x = d3.scaleBand().domain(data.map(d => d.data)).range([0, IW]).padding(0.15);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d.total) || 1]).range([IH, 0]).nice();
  return (
    <svg viewBox={`0 0 ${W} ${IH + MARGIN.top + MARGIN.bottom}`} width="100%">
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        <Eixo scale={y} orient="left" innerSize={IH} />
        <Eixo scale={x} orient="bottom" innerSize={IH} />
        {data.map(d => (
          <g key={d.data}>
            <rect x={x(d.data)!} y={y(d.ok)} width={x.bandwidth()} height={IH - y(d.ok)}
                  fill="#4caf50" opacity={0.85} />
            <rect x={x(d.data)!} y={y(d.total)} width={x.bandwidth()} height={Math.max(0, y(d.ok) - y(d.total))}
                  fill="#f44336" opacity={0.85} />
          </g>
        ))}
      </g>
    </svg>
  );
};


// ── Múltiplas execuções por dia ───────────────────────────────────────────────
const GraficoMultiplas: React.FC<{ rows: MultiplasItem[] }> = ({ rows }) => {
  if (!rows.length) return (
    <Typography variant="body2" color="text.secondary" sx={{ p: 2, fontStyle: 'italic' }}>
      Nenhuma tabela com múltiplas execuções por dia no período.
    </Typography>
  );
  const maxVal = Math.max(...rows.map(r => r.max_execucoes_dia), 1);
  return (
    <Box sx={{ maxHeight: 230, overflowY: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 'bold', fontSize: '0.75rem' }}>Tabela</TableCell>
            <TableCell sx={{ fontWeight: 'bold', fontSize: '0.75rem' }}>Grupo</TableCell>
            <TableCell sx={{ fontWeight: 'bold', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Máx/dia</TableCell>
            <TableCell sx={{ width: 100 }} />
            <TableCell sx={{ fontWeight: 'bold', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Dias</TableCell>
            <TableCell sx={{ fontWeight: 'bold', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Total</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i} hover>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.tabela}</TableCell>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{r.grupo?.split('-')[0] || '-'}</TableCell>
              <TableCell sx={{ fontSize: '0.75rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{r.max_execucoes_dia}×</TableCell>
              <TableCell sx={{ width: 100 }}>
                <LinearProgress variant="determinate" value={(r.max_execucoes_dia / maxVal) * 100}
                  color="warning" sx={{ height: 8, borderRadius: 4 }} />
              </TableCell>
              <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{r.dias_com_multiplas}</TableCell>
              <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{r.total_execucoes.toLocaleString('pt-BR')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};

// ── Chart 4: Por hora do dia (stacked OK/NOK, pior hora destacada) ────────────
const GraficoHorario: React.FC<{ data: HoraData[] }> = ({ data }) => {
  if (!data.length) return <SemDados />;
  const allHours = Array.from({ length: 24 }, (_, i) => ({
    hora: i, total: 0, ok: 0, nok: 0,
  }));
  data.forEach(d => {
    allHours[d.hora] = { hora: d.hora, total: d.total, ok: d.ok ?? 0, nok: d.nok ?? 0 };
  });
  const worstHora = allHours.reduce((mx, h) => h.nok > mx.nok ? h : mx, allHours[0]);
  const IH = 160;
  const x = d3.scaleBand().domain(allHours.map(d => String(d.hora))).range([0, IW]).padding(0.15);
  const y = d3.scaleLinear().domain([0, d3.max(allHours, d => d.total) || 1]).range([IH, 0]).nice();
  return (
    <svg viewBox={`0 0 ${W} ${IH + MARGIN.top + MARGIN.bottom}`} width="100%">
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        <Eixo scale={y} orient="left" innerSize={IH} />
        {allHours.map(d => {
          const bx = x(String(d.hora))!;
          const bw = x.bandwidth();
          const isWorst = d.hora === worstHora.hora && d.nok > 0;
          return (
            <g key={d.hora}>
              {isWorst && (
                <rect x={bx - 1} y={y(d.total) - 2} width={bw + 2} height={IH - y(d.total) + 4}
                      fill="none" stroke="#ff9800" strokeWidth={2} rx={2} />
              )}
              {/* OK — base verde */}
              <rect x={bx} y={y(d.ok)} width={bw} height={IH - y(d.ok)} fill="#4caf50" rx={2} />
              {/* NOT OK — topo vermelho */}
              {d.nok > 0 && (
                <rect x={bx} y={y(d.total)} width={bw}
                      height={Math.max(0, y(d.ok) - y(d.total))} fill="#f44336" rx={2} />
              )}
              {d.hora % 3 === 0 && (
                <text x={bx + bw / 2} y={IH + 16} textAnchor="middle" fontSize={9} fill="#888">
                  {d.hora}h
                </text>
              )}
            </g>
          );
        })}
        <line y1={IH} y2={IH} x1={0} x2={IW} stroke="#ccc" />
        <text x={IW / 2} y={IH + 36} textAnchor="middle" fontSize={10} fill="#999">Hora do dia</text>
      </g>
    </svg>
  );
};


// ── Chart 6: Série temporal do JOB filtrado (processamento) ──────────────────
const GraficoSerie: React.FC<{ data: TimeseriesItem[]; job?: string; ih?: number; vw?: number }> = ({ data, job, ih = 160, vw = W }) => {
  const [ttIdx, setTtIdx] = useState<number | null>(null);
  if (!job) return <SemDados msg='Aplique o filtro "Job" para ver a série temporal de execuções.' />;
  if (!data.length) return <SemDados msg="Sem execuções para o JOB no período." />;
  const IH  = ih;
  const iw  = vw - MARGIN.left - MARGIN.right;
  const dates = data.map(d => new Date(d.data));
  const x = d3.scaleTime().domain(d3.extent(dates) as [Date, Date]).range([0, iw]);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d.duracao) || 1]).range([IH, 0]).nice();
  const lineGen = d3.line<TimeseriesItem>().x(d => x(new Date(d.data))).y(d => y(d.duracao));
  return (
    <svg viewBox={`0 0 ${vw} ${IH + MARGIN.top + MARGIN.bottom}`} width="100%">
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        {y.ticks(5).map(t => (
          <g key={t}>
            <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke="#f0f0f0" />
            <text x={-6} y={y(t)} dy="0.35em" textAnchor="end" fontSize={9} fill="#888">{t.toFixed(1)}</text>
          </g>
        ))}
        <path d={lineGen(data) || ''} fill="none" stroke="#1976d2" strokeWidth={1.5} />
        {data.map((d, i) => (
          <circle key={i} cx={x(new Date(d.data))} cy={y(d.duracao)} r={4}
                  fill={d.status === 'OK' ? '#4caf50' : '#f44336'} stroke="white" strokeWidth={0.8}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setTtIdx(i)}
                  onMouseLeave={() => setTtIdx(null)} />
        ))}
        {x.ticks(8).map(t => (
          <text key={+t} x={x(t)} y={IH + 18} textAnchor="middle" fontSize={9} fill="#888">
            {d3.timeFormat('%d/%m')(t)}
          </text>
        ))}
        <line x1={0} x2={iw} y1={IH} y2={IH} stroke="#ccc" />
        <text x={-28} y={IH / 2} transform={`rotate(-90,-28,${IH / 2})`} textAnchor="middle" fontSize={9} fill="#999">min</text>
        {ttIdx !== null && (() => {
          const d = data[ttIdx];
          const cx = x(new Date(d.data));
          const cy = y(d.duracao);
          const tx = cx + 12 > iw - 132 ? cx - 137 : cx + 12;
          const ty = Math.max(cy - 52, 0);
          return (
            <g transform={`translate(${tx},${ty})`} style={{ pointerEvents: 'none' }}>
              <rect width={126} height={44} rx={4} fill="rgba(0,0,0,0.78)" />
              <text x={7} y={13} fontSize={9} fill="white" fontWeight="bold">
                {new Date(d.data).toLocaleDateString('pt-BR')}
              </text>
              <text x={7} y={27} fontSize={9} fill="#90caf9">
                {`Duração: ${d.duracao.toFixed(2)} min`}
              </text>
              <text x={7} y={40} fontSize={9} fill={d.status === 'OK' ? '#81c784' : '#ef9a9a'}>
                {`Status: ${d.status}`}
              </text>
            </g>
          );
        })()}
      </g>
    </svg>
  );
};

// ── Chart 6b: Série temporal de volume de execuções (linha) ───────────────────
const GraficoSerieExecucoes: React.FC<{ data: VolumeData[]; ih?: number; vw?: number }> = ({ data, ih = 160, vw = W }) => {
  const [ttIdx, setTtIdx] = useState<number | null>(null);
  if (!data.length) return <SemDados msg="Sem execuções para o período selecionado." />;
  const IH = ih;
  const iw = vw - MARGIN.left - MARGIN.right;
  const xPt = d3.scalePoint<string>().domain(data.map(d => d.data)).range([0, iw]).padding(0.1);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d.total) || 1]).range([IH, 0]).nice();
  const lineTotal = d3.line<VolumeData>().x(d => xPt(d.data)!).y(d => y(d.total));
  const lineOk    = d3.line<VolumeData>().x(d => xPt(d.data)!).y(d => y(d.ok));
  const step = Math.ceil(data.length / 8);
  return (
    <svg viewBox={`0 0 ${vw} ${IH + MARGIN.top + MARGIN.bottom}`} width="100%">
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        {y.ticks(5).map(t => (
          <g key={t}>
            <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke="#f0f0f0" />
            <text x={-6} y={y(t)} dy="0.35em" textAnchor="end" fontSize={9} fill="#888">{t}</text>
          </g>
        ))}
        <path d={lineOk(data) || ''}    fill="none" stroke="#4caf50" strokeWidth={1.2} strokeDasharray="4,2" opacity={0.7} />
        <path d={lineTotal(data) || ''} fill="none" stroke="#1976d2" strokeWidth={1.5} />
        {data.map((d, i) => (
          <circle key={i} cx={xPt(d.data)!} cy={y(d.total)} r={4}
                  fill={d.nok > 0 ? '#f44336' : '#4caf50'} stroke="white" strokeWidth={0.8}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setTtIdx(i)}
                  onMouseLeave={() => setTtIdx(null)} />
        ))}
        {data.filter((_, i) => i % step === 0).map(d => (
          <text key={d.data} x={xPt(d.data)!} y={IH + 18} textAnchor="middle" fontSize={9} fill="#888"
                transform={`rotate(-30,${xPt(d.data)!},${IH + 18})`}>
            {d.data.slice(-5)}
          </text>
        ))}
        <line x1={0} x2={iw} y1={IH} y2={IH} stroke="#ccc" />
        <text x={-28} y={IH / 2} transform={`rotate(-90,-28,${IH / 2})`} textAnchor="middle" fontSize={9} fill="#999">qtd</text>
        {ttIdx !== null && (() => {
          const d = data[ttIdx];
          const cx = xPt(d.data)!;
          const cy = y(d.total);
          const tx = cx + 12 > iw - 138 ? cx - 143 : cx + 12;
          const ty = Math.max(cy - 62, 0);
          return (
            <g transform={`translate(${tx},${ty})`} style={{ pointerEvents: 'none' }}>
              <rect width={132} height={58} rx={4} fill="rgba(0,0,0,0.78)" />
              <text x={7} y={13} fontSize={9} fill="white" fontWeight="bold">{d.data}</text>
              <text x={7} y={27} fontSize={9} fill="#90caf9">{`Total: ${d.total}`}</text>
              <text x={7} y={40} fontSize={9} fill="#81c784">{`OK: ${d.ok}`}</text>
              <text x={7} y={53} fontSize={9} fill="#ef9a9a">{`NOT OK: ${d.nok}`}</text>
            </g>
          );
        })()}
      </g>
    </svg>
  );
};

// ── Ranking tabela: Duração Média por Job ─────────────────────────────────────
const RankingDuracao: React.FC<{ rows: TopDurData[] }> = ({ rows }) => {
  if (!rows.length) return <Typography variant="body2" color="text.secondary" sx={{ p: 2, fontStyle: 'italic' }}>Sem dados para o período selecionado.</Typography>;
  const maxVal = Math.max(...rows.map(r => r.avg_dur), 1);
  return (
    <Box sx={{ maxHeight: 230, overflowY: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 'bold', fontSize: '0.75rem' }}>Job</TableCell>
            <TableCell sx={{ fontWeight: 'bold', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Média (min)</TableCell>
            <TableCell sx={{ width: 110 }} />
            <TableCell sx={{ fontWeight: 'bold', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Máx</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i} hover>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.job}</TableCell>
              <TableCell sx={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{r.avg_dur.toFixed(1)}</TableCell>
              <TableCell sx={{ width: 110 }}>
                <LinearProgress variant="determinate" value={(r.avg_dur / maxVal) * 100}
                  color="secondary" sx={{ height: 8, borderRadius: 4 }} />
              </TableCell>
              <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>{r.max_dur.toFixed(1)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};

// ── Ranking tabela: Volume ISD por Job ────────────────────────────────────────
const RankingISD: React.FC<{ rows: IsdData[] }> = ({ rows }) => {
  if (!rows.length) return <Typography variant="body2" color="text.secondary" sx={{ p: 2, fontStyle: 'italic' }}>Nenhum job com ISD ativo no período selecionado.</Typography>;
  const maxVal = Math.max(...rows.map(r => r.total), 1);
  return (
    <Box sx={{ maxHeight: 230, overflowY: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 'bold', fontSize: '0.75rem' }}>Job</TableCell>
            <TableCell sx={{ fontWeight: 'bold', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Execuções</TableCell>
            <TableCell sx={{ width: 120 }} />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i} hover>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.job}</TableCell>
              <TableCell sx={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{r.total.toLocaleString('pt-BR')}</TableCell>
              <TableCell sx={{ width: 120 }}>
                <LinearProgress variant="determinate" value={(r.total / maxVal) * 100}
                  sx={{ height: 8, borderRadius: 4, bgcolor: '#fff3e0', '& .MuiLinearProgress-bar': { bgcolor: '#e65100' } }} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};

// ── Helpers visuais ───────────────────────────────────────────────────────────
const SemDados: React.FC<{ msg?: string }> = ({ msg = 'Sem dados para o período selecionado.' }) => (
  <Typography variant="body2" color="text.secondary" sx={{ p: 2, fontStyle: 'italic' }}>{msg}</Typography>
);

const Legend: React.FC<{ items: { color: string; label: string }[]; x: number; y: number }> = ({ items, x, y }) => (
  <g transform={`translate(${x},${y})`}>
    {items.map((it, i) => (
      <g key={it.label} transform={`translate(0,${i * 14})`}>
        <rect width={10} height={10} fill={it.color} />
        <text x={13} y={9} fontSize={9} fill="#555">{it.label}</text>
      </g>
    ))}
  </g>
);

const InsightCard: React.FC<{
  icon: React.ReactNode; label: string; value: React.ReactNode; color: string;
  porAmbiente?: Record<string, string | number>;
}> = ({ icon, label, value, color, porAmbiente }) => {
  const entries = porAmbiente ? Object.entries(porAmbiente).sort(([a], [b]) => a.localeCompare(b)) : [];
  return (
    <Card sx={{ flex: '1 1 150px', minWidth: 140, borderTop: `3px solid ${color}` }}>
      <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5, color }}>
          {icon}
          <Typography variant="caption" color="text.secondary" fontWeight={500}>{label}</Typography>
        </Box>
        <Typography variant="h5" fontWeight="bold" sx={{ fontSize: '1.3rem' }}>{value}</Typography>
        {entries.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, mt: 1, pt: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
            {entries.map(([amb, val]) => {
              const c = AMB_COLORS[amb] ?? { bg: 'action.hover', text: 'text.primary' };
              return (
                <Box key={amb} sx={{ flex: 1, textAlign: 'center', bgcolor: c.bg, borderRadius: 1, py: 0.3 }}>
                  <Typography sx={{ display: 'block', fontSize: '0.58rem', fontWeight: 700, color: c.text, lineHeight: 1.3, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                    {amb}
                  </Typography>
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: c.text, lineHeight: 1.3 }}>
                    {typeof val === 'number' ? val.toLocaleString('pt-BR') : val}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

const ChartCard: React.FC<{
  title: string;
  children: React.ReactNode;
  legend?: { color: string; label: string }[];
  action?: React.ReactNode;
}> = ({ title, children, legend, action }) => (
  <Paper variant="outlined" sx={{ p: 2 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
      <Typography variant="subtitle2" fontWeight={600}>{title}</Typography>
      {action}
      {legend && (
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {legend.map(it => (
            <Box key={it.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: it.color, flexShrink: 0 }} />
              <Typography variant="caption" color="text.secondary">{it.label}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
    {children}
  </Paper>
);

// ── Componente principal ──────────────────────────────────────────────────────
export const Tela2Execucoes: React.FC = () => {
  const [filtros, setFiltros] = useState<FiltrosExecucao>(getFiltrosIniciais());
  const [filtrosAtivos, setFiltrosAtivos] = useState<FiltrosExecucao>(getFiltrosIniciais());
  const [tabelaInput, setTabelaInput] = useState('');
  const [jobInput, setJobInput]       = useState('');
  const [page, setPage] = useState(1);
  const [expandido, setExpandido] = useState(true);
  const [slaMin, setSlaMin] = useState(30);
  const [slaInput, setSlaInput] = useState('30');
  const [exibirSla, setExibirSla]               = useState(false);
  const [exibirDesvio, setExibirDesvio]         = useState(false);
  const [desvioThreshold, setDesvioThreshold]   = useState(50);
  const [desvioInput, setDesvioInput]           = useState('50');
  const [exibirTendencia, setExibirTendencia]   = useState(false);
  const [rankingTab, setRankingTab]             = useState(0);
  const [serieView, setSerieView]               = useState<'processamento' | 'execucoes'>('processamento');

  const { data, isLoading, error }   = useExecucoes(filtrosAtivos, page);
  const { data: graficos }           = useGraficosExecucoes(filtrosAtivos);

  const execPorDia = useMemo((): VolumeData[] => {
    const series = graficos?.timeseries ?? [];
    if (!series.length) return [];
    const byDate = new Map<string, { ok: number; nok: number }>();
    for (const item of series) {
      const dia = String(item.data).slice(0, 10);
      if (!byDate.has(dia)) byDate.set(dia, { ok: 0, nok: 0 });
      const e = byDate.get(dia)!;
      if (item.status === 'OK') e.ok++; else e.nok++;
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data, v]) => ({ data, ok: v.ok, nok: v.nok, total: v.ok + v.nok }));
  }, [graficos?.timeseries]);

  const { data: rotinasData }        = useRotinasDisponiveis();
  const { data: slaData }            = useSlaJobs(slaMin, filtrosAtivos);
  const { data: desvioData }         = useDesvioVolumetria(desvioThreshold, filtrosAtivos);
  const { data: tendenciaData }      = useTendenciaDuracao(filtrosAtivos);
  const { data: multiplasData }      = useMultiplasPorDia(filtrosAtivos);

  const setStr = (campo: 'data_inicio' | 'data_fim' | 'status') => (v: string) =>
    setFiltros(prev => ({ ...prev, [campo]: v }));
  const setArr = (campo: 'tabela' | 'job' | 'grupo' | 'rotina' | 'ambiente') => (v: string[]) =>
    setFiltros(prev => ({ ...prev, [campo]: v }));

  const aplicar = () => {
    const f = { ...filtros };
    if (tabelaInput.trim()) { f.tabela = [...(f.tabela ?? []), tabelaInput.trim()]; setTabelaInput(''); }
    if (jobInput.trim())    { f.job    = [...(f.job    ?? []), jobInput.trim()];    setJobInput(''); }
    setFiltrosAtivos(f);
    setPage(1);
  };
  const limpar = () => {
    setFiltros(getFiltrosIniciais()); setFiltrosAtivos(getFiltrosIniciais());
    setTabelaInput(''); setJobInput(''); setPage(1);
  };

  const resumo = graficos?.resumo;
  const totalPag = Math.ceil((data?.total || 0) / 20);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>Detalhes de Processamento</Typography>

      {/* Filtros */}
      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}
             onClick={() => setExpandido(v => !v)}>
          <FilterListIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2" fontWeight={600}>Filtros</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            {expandido ? 'Recolher ▲' : 'Expandir ▼'}
          </Typography>
        </Box>
        <Collapse in={expandido}>
          <Divider />
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <Autocomplete
                multiple freeSolo options={[]}
                value={filtros.tabela ?? []}
                inputValue={tabelaInput}
                onInputChange={(_, v) => setTabelaInput(v)}
                onChange={(_, v) => { setArr('tabela')(v as string[]); setTabelaInput(''); }}
                renderTags={(value, getTagProps) =>
                  value.map((v, i) => <Chip label={v} size="small" {...getTagProps({ index: i })} />)
                }
                renderInput={(params) => <TextField {...params} label="Tabela" size="small" sx={{ minWidth: 200 }} placeholder="Digite e pressione Enter" />}
              />
              <Autocomplete
                multiple freeSolo options={[]}
                value={filtros.job ?? []}
                inputValue={jobInput}
                onInputChange={(_, v) => setJobInput(v)}
                onChange={(_, v) => { setArr('job')(v as string[]); setJobInput(''); }}
                renderTags={(value, getTagProps) =>
                  value.map((v, i) => <Chip label={v} size="small" {...getTagProps({ index: i })} />)
                }
                renderInput={(params) => <TextField {...params} label="Job" size="small" sx={{ minWidth: 200 }} placeholder="Digite e pressione Enter" />}
              />
              <Autocomplete
                multiple disableCloseOnSelect options={GRUPOS}
                value={filtros.grupo ?? []}
                onChange={(_, v) => setArr('grupo')(v)}
                renderOption={(props, option, { selected }) => (
                  <li {...props}><Checkbox checked={selected} size="small" sx={{ mr: 1 }} />{option}</li>
                )}
                renderTags={(value, getTagProps) =>
                  value.map((v, i) => <Chip label={v} size="small" {...getTagProps({ index: i })} />)
                }
                renderInput={(params) => <TextField {...params} label="Grupo" size="small" sx={{ minWidth: 160 }} />}
              />
              <Autocomplete
                multiple disableCloseOnSelect options={rotinasData?.rotinas ?? []}
                value={filtros.rotina ?? []}
                onChange={(_, v) => setArr('rotina')(v)}
                renderOption={(props, option, { selected }) => (
                  <li {...props}><Checkbox checked={selected} size="small" sx={{ mr: 1 }} />{option}</li>
                )}
                renderTags={(value, getTagProps) =>
                  value.map((v, i) => <Chip label={v} size="small" {...getTagProps({ index: i })} />)
                }
                renderInput={(params) => <TextField {...params} label="Rotina" size="small" sx={{ minWidth: 160 }} />}
              />
              <Autocomplete
                multiple disableCloseOnSelect options={AMBIENTES}
                value={filtros.ambiente ?? []}
                onChange={(_, v) => setArr('ambiente')(v)}
                renderOption={(props, option, { selected }) => (
                  <li {...props}><Checkbox checked={selected} size="small" sx={{ mr: 1 }} />{option}</li>
                )}
                renderTags={(value, getTagProps) =>
                  value.map((v, i) => <Chip label={v} size="small" color="info" {...getTagProps({ index: i })} />)
                }
                renderInput={(params) => <TextField {...params} label="Ambiente" size="small" sx={{ minWidth: 140 }} />}
              />
              <TextField label="Data Início" type="date" value={filtros.data_inicio} size="small"
                         InputLabelProps={{ shrink: true }} onChange={e => setStr('data_inicio')(e.target.value)} />
              <TextField label="Data Fim" type="date" value={filtros.data_fim} size="small"
                         InputLabelProps={{ shrink: true }} onChange={e => setStr('data_fim')(e.target.value)} />
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <InputLabel>Status</InputLabel>
                <Select value={filtros.status} label="Status" onChange={e => setStr('status')(e.target.value as string)}>
                  <MenuItem value=""><em>Todos</em></MenuItem>
                  <MenuItem value="OK">
                    <Chip label="OK" size="small" color="success" sx={{ pointerEvents: 'none' }} />
                  </MenuItem>
                  <MenuItem value="NOT OK">
                    <Chip label="NOT OK" size="small" color="error" sx={{ pointerEvents: 'none' }} />
                  </MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="contained" size="small" onClick={aplicar}>Aplicar Filtros</Button>
              <Button variant="outlined"  size="small" startIcon={<ClearIcon />} onClick={limpar}>Limpar</Button>
            </Box>
          </Box>
        </Collapse>
      </Paper>

      {/* Insight Cards */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <InsightCard icon={<TimerIcon fontSize="small" />} label="Execuções"
          value={resumo?.total?.toLocaleString('pt-BR') ?? 0} color="#1976d2"
          porAmbiente={resumo?.por_ambiente
            ? Object.fromEntries(Object.entries(resumo.por_ambiente).map(([k, v]) => [k, v.total]))
            : undefined} />
        <Card sx={{ flex: '1 1 190px', minWidth: 170, borderTop: '3px solid #1976d2' }}>
          <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
              <CheckCircleIcon fontSize="small" sx={{ color: '#2e7d32' }} />
              <CancelIcon fontSize="small" sx={{ color: '#c62828' }} />
              <Typography variant="caption" color="text.secondary" fontWeight={500}>OK / NOT OK</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Box>
                <Typography variant="h6" fontWeight="bold" color="success.dark" sx={{ lineHeight: 1.2 }}>
                  {resumo?.ok?.toLocaleString('pt-BR') ?? 0}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {resumo ? Math.round(resumo.ok / (resumo.total || 1) * 100) : 0}% OK
                </Typography>
              </Box>
              <Box>
                <Typography variant="h6" fontWeight="bold" color="error.dark" sx={{ lineHeight: 1.2 }}>
                  {resumo?.nok?.toLocaleString('pt-BR') ?? 0}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {resumo ? Math.round(resumo.nok / (resumo.total || 1) * 100) : 0}% NOT OK
                </Typography>
              </Box>
            </Box>
            <LinearProgress
              variant="determinate"
              value={resumo ? Math.round(resumo.ok / (resumo.total || 1) * 100) : 0}
              sx={{ mt: 1, height: 6, borderRadius: 3, bgcolor: '#ffcdd2', '& .MuiLinearProgress-bar': { bgcolor: '#2e7d32' } }}
            />
            {resumo?.por_ambiente && Object.keys(resumo.por_ambiente).length > 0 && (
              <Box sx={{ display: 'flex', gap: 0.5, mt: 1, pt: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
                {Object.entries(resumo.por_ambiente).sort(([a], [b]) => a.localeCompare(b)).map(([amb, v]) => {
                  const c = AMB_COLORS[amb] ?? { bg: 'action.hover', text: 'text.primary' };
                  return (
                    <Box key={amb} sx={{ flex: 1, textAlign: 'center', bgcolor: c.bg, borderRadius: 1, py: 0.3 }}>
                      <Typography sx={{ display: 'block', fontSize: '0.58rem', fontWeight: 700, color: c.text, lineHeight: 1.3, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                        {amb}
                      </Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5, alignItems: 'baseline' }}>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'success.dark', lineHeight: 1.3 }}>
                          {v.ok.toLocaleString('pt-BR')}
                        </Typography>
                        <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled', lineHeight: 1.3 }}>/</Typography>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'error.dark', lineHeight: 1.3 }}>
                          {v.nok.toLocaleString('pt-BR')}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </CardContent>
        </Card>
        <InsightCard icon={<SpeedIcon fontSize="small" />} label="Duração Média"
          value={resumo ? `${resumo.duracao_media.toFixed(1)} min` : '-'} color="#e65100"
          porAmbiente={resumo?.por_ambiente
            ? Object.fromEntries(Object.entries(resumo.por_ambiente).map(([k, v]) => [k, `${v.duracao_media.toFixed(1)} min`]))
            : undefined} />
        <InsightCard icon={<EmojiEventsIcon fontSize="small" />} label="Maior Duração"
          value={
            resumo?.job_maior_duracao && resumo.job_maior_duracao !== '-'
              ? <Box><Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                  {resumo.job_maior_duracao}
                </Typography>{resumo.maior_duracao.toFixed(1)} min</Box>
              : '-'
          } color="#7b1fa2" />
      </Box>

      {/* Série temporal — largura total, altura compacta */}
      <ChartCard
        title={`Série Temporal de Execuções${filtrosAtivos.job?.[0] ? ` — ${filtrosAtivos.job[0]}` : ''}`}
        action={
          <Box sx={{ display: 'flex', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', ml: 1 }}>
            <Button
              size="small" disableElevation
              variant={serieView === 'processamento' ? 'contained' : 'text'}
              startIcon={<TimerIcon sx={{ fontSize: 14 }} />}
              onClick={() => setSerieView('processamento')}
              sx={{ borderRadius: 0, px: 1.5, py: 0.4, fontSize: '0.72rem', minWidth: 0 }}
            >
              Processamento
            </Button>
            <Button
              size="small" disableElevation
              variant={serieView === 'execucoes' ? 'contained' : 'text'}
              startIcon={<BarChartIcon sx={{ fontSize: 14 }} />}
              onClick={() => setSerieView('execucoes')}
              sx={{ borderRadius: 0, px: 1.5, py: 0.4, fontSize: '0.72rem', minWidth: 0 }}
            >
              Execuções
            </Button>
          </Box>
        }
        legend={serieView === 'processamento'
          ? [{ color: '#4caf50', label: 'OK' }, { color: '#f44336', label: 'NOT OK' }]
          : [{ color: '#1976d2', label: 'Total' }, { color: '#4caf50', label: 'OK' }, { color: '#f44336', label: 'NOT OK' }]
        }
      >
        {serieView === 'processamento'
          ? <GraficoSerie data={graficos?.timeseries ?? []} job={filtrosAtivos.job?.[0]} ih={160} vw={1120} />
          : execPorDia.length === 0
            ? <SemDados msg="Sem execuções para o período selecionado." />
            : <GraficoSerieExecucoes data={execPorDia} ih={160} vw={1120} />
        }
      </ChartCard>

      {/* Gráficos — grid 2 colunas */}
      <Grid container spacing={2} sx={{ mt: 2, mb: 3 }}>
        {/* Linha 1: Volume por data | Hora do dia */}
        <Grid item xs={12} md={6}>
          <ChartCard title="Volume de Execuções por Data" legend={[
            { color: '#4caf50', label: 'OK' },
            { color: '#f44336', label: 'NOT OK' },
          ]}>
            <GraficoVolumeDiario data={graficos?.volume_por_data ?? []} />
          </ChartCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <ChartCard title="Execuções por Hora do Dia" legend={[
            { color: '#4caf50', label: 'OK' },
            { color: '#f44336', label: 'NOT OK' },
            { color: '#ff9800', label: 'Horário de pico' },
          ]}>
            <GraficoHorario data={graficos?.por_hora ?? []} />
          </ChartCard>
        </Grid>
        {/* Linha 2: Múltiplas execuções | Ranking de Jobs (tabs) */}
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Tabelas com Múltiplas Execuções por Dia</Typography>
            <GraficoMultiplas rows={multiplasData?.tabelas ?? []} />
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Ranking de Jobs</Typography>
            <Tabs value={rankingTab} onChange={(_, v) => setRankingTab(v)} variant="fullWidth"
                  sx={{ mb: 1, minHeight: 36, '& .MuiTab-root': { minHeight: 36, fontSize: '0.75rem', py: 0.5 } }}>
              <Tab label="Duração Média (min)" />
              <Tab label="Volume ISD" />
            </Tabs>
            {rankingTab === 0 && <RankingDuracao rows={graficos?.top_duracao ?? []} />}
            {rankingTab === 1 && <RankingISD rows={graficos?.isd_execucoes ?? []} />}
          </Paper>
        </Grid>
      </Grid>

      {/* SLA por Job — colapsável */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box
          sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer', flexWrap: 'wrap' }}
          onClick={() => setExibirSla(v => !v)}
        >
          <SpeedIcon fontSize="small" color="warning" />
          <Typography variant="subtitle2" fontWeight={600}>SLA por Job — Duração Média Acima do Limiar</Typography>
          {slaData?.jobs.length ? (
            <Chip label={`${slaData.jobs.length} job${slaData.jobs.length !== 1 ? 's' : ''}`} size="small" color="warning" sx={{ ml: 0.5 }} />
          ) : null}
          {/* Input de limiar no cabeçalho — para não perder ao colapsar */}
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }} onClick={e => e.stopPropagation()}>
            <TextField
              label="Limiar (min)" type="number" size="small" sx={{ width: 120 }}
              value={slaInput}
              onChange={e => setSlaInput(e.target.value)}
              onBlur={() => { const v = parseFloat(slaInput); if (!isNaN(v) && v >= 0) setSlaMin(v); }}
              onKeyDown={e => { if (e.key === 'Enter') { const v = parseFloat(slaInput); if (!isNaN(v) && v >= 0) setSlaMin(v); } }}
              inputProps={{ min: 0, step: 1 }}
            />
          </Box>
          <Typography variant="caption" color="text.secondary">
            {exibirSla ? 'Recolher ▲' : 'Expandir ▼'}
          </Typography>
        </Box>
        <Collapse in={exibirSla}>
          <Divider />
          {!slaData?.jobs.length ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, fontStyle: 'italic' }}>
              Nenhum job com duração média acima de {slaMin} min.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'warning.light' }}>
                    {['Tabela', 'Job', 'Grupo', 'Duração Média (min)', 'Duração Máx (min)', 'Execuções'].map(c => (
                      <TableCell key={c} sx={{ fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{c}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(slaData?.jobs ?? []).map((j: SlaItem, i: number) => (
                    <TableRow key={i} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{j.tabela}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{j.job}</TableCell>
                      <TableCell>
                        <Chip label={j.grupo?.split('-')[0] || '-'} size="small" variant="outlined" color="primary" />
                      </TableCell>
                      <TableCell>
                        <Chip label={`${j.avg_dur.toFixed(1)} min`} size="small" color="warning" />
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{j.max_dur.toFixed(1)}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{j.total_exec.toLocaleString('pt-BR')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Collapse>
      </Paper>

      {/* Desvio de Volumetria */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box
          sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer', flexWrap: 'wrap' }}
          onClick={() => setExibirDesvio(v => !v)}
        >
          <BarChartIcon fontSize="small" color="warning" />
          <Typography variant="subtitle2" fontWeight={600}>Desvio de Volumetria — Alertas de Execução</Typography>
          {desvioData?.alertas.length ? (
            <Chip label={`${desvioData.alertas.length} job${desvioData.alertas.length !== 1 ? 's' : ''}`} size="small" color="warning" sx={{ ml: 0.5 }} />
          ) : null}
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }} onClick={e => e.stopPropagation()}>
            <TextField
              label="Limiar (%)" type="number" size="small" sx={{ width: 110 }}
              value={desvioInput}
              onChange={e => setDesvioInput(e.target.value)}
              onBlur={() => { const v = parseFloat(desvioInput); if (!isNaN(v) && v >= 0) setDesvioThreshold(v); }}
              onKeyDown={e => { if (e.key === 'Enter') { const v = parseFloat(desvioInput); if (!isNaN(v) && v >= 0) setDesvioThreshold(v); } }}
              inputProps={{ min: 0, step: 10 }}
            />
          </Box>
          <Typography variant="caption" color="text.secondary">
            {exibirDesvio ? 'Recolher ▲' : 'Expandir ▼'}
          </Typography>
        </Box>
        <Collapse in={exibirDesvio}>
          <Divider />
          {!desvioData?.alertas.length ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, fontStyle: 'italic' }}>
              Nenhum job com desvio acima de {desvioThreshold}% nos últimos 7 dias.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'warning.light' }}>
                    {['Tabela', 'Job', 'Grupo', 'Dia', 'Observado', 'Baseline (média)', 'Desvio (%)'].map(c => (
                      <TableCell key={c} sx={{ fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{c}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(desvioData?.alertas ?? []).map((a: DesvioVolumetriaItem, i: number) => (
                    <TableRow key={i} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{a.tabela}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{a.job}</TableCell>
                      <TableCell>
                        <Chip label={a.grupo?.split('-')[0] || '-'} size="small" variant="outlined" color="primary" />
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{a.dia}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{a.observado}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{a.baseline.toFixed(1)}</TableCell>
                      <TableCell>
                        <Chip
                          label={`${a.desvio_pct > 0 ? '+' : ''}${a.desvio_pct.toFixed(1)}%`}
                          size="small"
                          color={a.desvio_pct > 0 ? 'error' : 'info'}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Collapse>
      </Paper>

      {/* Tendência de Duração */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box
          sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer' }}
          onClick={() => setExibirTendencia(v => !v)}
        >
          <TrendingUpIcon fontSize="small" color="error" />
          <Typography variant="subtitle2" fontWeight={600}>Tendência de Duração — Jobs com Aumento Semanal</Typography>
          {tendenciaData?.alertas.length ? (
            <Chip label={`${tendenciaData.alertas.length} job${tendenciaData.alertas.length !== 1 ? 's' : ''}`} size="small" color="error" sx={{ ml: 0.5 }} />
          ) : null}
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            {exibirTendencia ? 'Recolher ▲' : 'Expandir ▼'}
          </Typography>
        </Box>
        <Collapse in={exibirTendencia}>
          <Divider />
          {!tendenciaData?.alertas.length ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, fontStyle: 'italic' }}>
              Nenhum job com tendência de aumento acima de 30% na última semana.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'error.light' }}>
                    {['Tabela', 'Job', 'Grupo', 'Última Semana (min)', 'Histórico (min)', 'Variação', 'Semanas'].map(c => (
                      <TableCell key={c} sx={{ fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{c}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(tendenciaData?.alertas ?? []).map((a: TendenciaDuracaoItem, i: number) => (
                    <TableRow key={i} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{a.tabela}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{a.job}</TableCell>
                      <TableCell>
                        <Chip label={a.grupo?.split('-')[0] || '-'} size="small" variant="outlined" color="primary" />
                      </TableCell>
                      <TableCell>
                        <Chip label={`${a.dur_ultima.toFixed(1)} min`} size="small" color="error" />
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{a.dur_historico.toFixed(1)} min</TableCell>
                      <TableCell>
                        <Chip label={`+${a.variacao_pct.toFixed(1)}%`} size="small" color="warning" />
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                        {a.semanas.length} semana{a.semanas.length !== 1 ? 's' : ''}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Collapse>
      </Paper>

      {/* Tabela */}
      {isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}
      {error    && <Alert severity="error">Erro ao carregar execuções. Verifique se a API está respondendo.</Alert>}

      {data && !isLoading && (
        <>
          {data.execucoes.length === 0
            ? <Alert severity="info">Nenhuma execução encontrada para os filtros selecionados.</Alert>
            : (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'primary.main' }}>
                      {['Tabela', 'Job', 'Grupo', 'Data / Hora', 'Status', 'Duração (min)'].map(c => (
                        <TableCell key={c} sx={{ color: 'white', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{c}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.execucoes.map((e, i) => (
                      <TableRow key={i} hover>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{e.tabela}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{e.job}</TableCell>
                        <TableCell>
                          <Chip label={e.grupo?.split('-')[0]} size="small" variant="outlined" color="primary" />
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>
                          {e.data_execucao ? new Date(e.data_execucao).toLocaleString('pt-BR') : '-'}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={e.status}
                            size="small"
                            color={e.status === 'OK' ? 'success' : 'error'}
                          />
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>
                          {e.duracao_minutos != null ? e.duracao_minutos.toFixed(2) : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )
          }
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              {data.total.toLocaleString('pt-BR')} registro{data.total !== 1 ? 's' : ''}
            </Typography>
            <Pagination count={totalPag} page={page} onChange={(_, v) => setPage(v)} color="primary" size="small" />
          </Box>
        </>
      )}
    </Box>
  );
};
