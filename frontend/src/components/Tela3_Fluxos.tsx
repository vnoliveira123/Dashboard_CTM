import React, { useEffect, useMemo, useRef, useState } from 'react';
import dagre from 'dagre';
import * as d3 from 'd3';
import {
  Box, TextField, Button, CircularProgress, Alert, Typography, Paper,
  FormControl, InputLabel, Select, MenuItem, Divider, Collapse, Chip, Tooltip,
  Autocomplete, Checkbox,
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import ClearIcon      from '@mui/icons-material/Clear';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useFluxosGrafo, useRotinasFluxos, FiltrosFluxo, GrafoNode, GrafoEdge } from '../hooks/useFluxos';

// ── Constantes ────────────────────────────────────────────────────────────────
const NW = 144;   // node width
const NH = 58;    // node height
const GRUPOS    = ['PR12', 'PR21', 'PR31', 'PR41'];
const AMBIENTES = ['AL1', 'MZ1'];
const HORARIOS  = ['00', '01', '03', '07', '10', '13', '16', '19', '23'];
const FILTROS_VAZIOS: FiltrosFluxo = { grupo: [], tabela: [], job: [], rotina: [], ambiente: [], posicao: '', carga: '', horario_carga: '', controle: '' };

const COR: Record<string, string> = {
  inicio: '#2e7d32',
  meio:   '#1565c0',
  fim:    '#b71c1c',
};
const LABEL: Record<string, string> = { inicio: 'Início', meio: 'Meio', fim: 'Fim' };
const POS_ORDER: Record<string, number> = { inicio: 0, meio: 1, fim: 2 };

// ── Tipos do layout ───────────────────────────────────────────────────────────
interface LayoutNode extends GrafoNode { x: number; y: number }
interface LayoutEdge extends GrafoEdge { points: { x: number; y: number }[] }
interface Layout { nodes: LayoutNode[]; edges: LayoutEdge[]; w: number; h: number }

// ── Helpers ───────────────────────────────────────────────────────────────────
const trunc = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s;

function edgePath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
  }
  d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  return d;
}

// ── Ícone SVG por posição ─────────────────────────────────────────────────────
const PosIcon: React.FC<{ posicao: string; cx: number; cy: number }> = ({ posicao, cx, cy }) => {
  const c = COR[posicao] ?? COR.meio;
  if (posicao === 'inicio')
    return (
      <g>
        <circle cx={cx} cy={cy} r={8} fill={c} />
        <path d={`M${cx-3.5} ${cy}L${cx-1} ${cy+3}L${cx+4} ${cy-3}`}
              stroke="white" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  if (posicao === 'fim')
    return (
      <g>
        <circle cx={cx} cy={cy} r={8} fill={c} />
        <rect x={cx-4} y={cy-4} width={8} height={8} rx={1} fill="white" />
      </g>
    );
  return (
    <g>
      <circle cx={cx} cy={cy} r={8} fill={c} />
      <circle cx={cx} cy={cy} r={4} fill="white" />
      <circle cx={cx} cy={cy} r={2} fill={c} />
    </g>
  );
};

// ── Card de nó ────────────────────────────────────────────────────────────────
const NodeCard: React.FC<{ node: LayoutNode; atRisco?: boolean }> = ({ node, atRisco }) => {
  const x   = node.x - NW / 2;
  const y   = node.y - NH / 2;
  const cor = COR[node.posicao] ?? COR.meio;
  const SH  = 20;  // strip height

  const isNok = node.ultimo_status === 'NOT OK';
  const bordaCor  = isNok ? '#b71c1c' : atRisco ? '#e65100' : cor;
  const fundoCor  = isNok ? '#ffebee' : atRisco ? '#fff3e0' : 'white';
  const strokeW   = isNok || atRisco ? 2.5 : 2;

  return (
    <g style={{ cursor: 'default' }}>
      {/* Sombra */}
      <rect x={x+2} y={y+2} width={NW} height={NH} rx={5} fill="rgba(0,0,0,0.10)" />
      {/* Corpo */}
      <rect x={x} y={y} width={NW} height={NH} rx={5} fill={fundoCor} stroke={bordaCor} strokeWidth={strokeW} />
      {/* Ícone posição */}
      <PosIcon posicao={node.posicao} cx={x+16} cy={y+19} />
      {/* Nome do job */}
      <text x={x+30} y={y+14} fontSize={10} fontWeight="bold" fill="#1a1a1a" dy="0.35em">
        {trunc(node.label, 14)}
      </text>
      {/* Dot de carga */}
      {node.carga === 'SIM' && (
        <circle cx={x+NW-10} cy={y+10} r={5} fill="#ff8f00" stroke="white" strokeWidth={1.5} />
      )}
      {/* Dot de controle efetuado (verde) */}
      {node.controle_efetuado && (
        <g>
          <circle cx={x+NW-10} cy={y+27} r={6} fill="#2e7d32" stroke="white" strokeWidth={1.5} />
          <path d={`M${x+NW-13} ${y+27}L${x+NW-10.5} ${y+30}L${x+NW-7} ${y+24}`}
                stroke="white" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {/* Dot de suscetível a controle (laranja-escuro) */}
      {node.suscetivel_controle && (
        <g>
          <circle cx={x+NW-10} cy={y+27} r={6} fill="#e65100" stroke="white" strokeWidth={1.5} />
          <text x={x+NW-10} y={y+27} textAnchor="middle" fontSize={9} fontWeight="bold" fill="white" dy="0.35em">!</text>
        </g>
      )}
      {/* Badge de condição órfã (âmbar) — canto superior direito do card */}
      {node.condicoes_orfas.length > 0 && (
        <g>
          <circle cx={x+NW-3} cy={y+1} r={8} fill="#f57f17" stroke="white" strokeWidth={1.5} />
          <text x={x+NW-3} y={y+1} textAnchor="middle" fontSize={8} fontWeight="bold" fill="white" dy="0.35em">
            {node.condicoes_orfas.length}
          </text>
        </g>
      )}
      {/* Indicador de último status (canto inferior esquerdo) */}
      {node.ultimo_status && (
        <circle cx={x+8} cy={y+NH-8} r={5}
          fill={node.ultimo_status === 'OK' ? '#4caf50' : '#c62828'}
          stroke="white" strokeWidth={1.2} />
      )}
      {/* Strip inferior com nome da tabela */}
      <rect x={x+2} y={y+NH-SH-2} width={NW-4} height={SH} rx={3} fill="#e64a19" opacity={0.9} />
      <text x={node.x} y={y+NH-SH+8} textAnchor="middle" fontSize={9} fill="white" fontWeight={600} dy="0.2em">
        {trunc(node.tabela, 18)}
      </text>
      <title>{`${node.tabela} / ${node.label}\nGrupo: ${node.grupo}\nPosição: ${LABEL[node.posicao] ?? node.posicao}${node.ultimo_status ? `\nÚltimo status: ${node.ultimo_status}` : ''}${node.carga === 'SIM' ? '\n⚡ Carga automática' : ''}${node.controle_efetuado ? '\n✅ Controle efetuado' : ''}${node.suscetivel_controle ? '\n⚠️ Suscetível a controle' : ''}${node.condicoes_orfas.length > 0 ? `\n🔶 ${node.condicoes_orfas.length} condição(ões) sem destino:\n  ${node.condicoes_orfas.join('\n  ')}` : ''}${atRisco ? '\n⚠️ Dependente de job com falha' : ''}`}</title>
    </g>
  );
};

// ── Legenda ───────────────────────────────────────────────────────────────────
const LegendaItem: React.FC<{ cor: string; label: string; forma?: 'circulo' | 'borda' }> = ({ cor, label, forma = 'circulo' }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
    {forma === 'borda'
      ? <Box sx={{ width: 12, height: 12, borderRadius: 1, border: `2.5px solid ${cor}`, bgcolor: `${cor}22` }} />
      : <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: cor }} />
    }
    <Typography variant="caption" fontWeight={600}>{label}</Typography>
  </Box>
);

const Legenda: React.FC = () => (
  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
    {Object.entries(COR).map(([pos, cor]) => (
      <LegendaItem key={pos} cor={cor} label={LABEL[pos]} />
    ))}
    <LegendaItem cor="#ff8f00" label="Carga automática" />
    <LegendaItem cor="#2e7d32" label="Controle efetuado" />
    <LegendaItem cor="#e65100" label="Suscetível a controle" />
    <LegendaItem cor="#f57f17" label="Condição sem destino" />
    <Divider orientation="vertical" flexItem />
    <LegendaItem cor="#c62828" label="NOT OK (último)" forma="borda" />
    <LegendaItem cor="#e65100" label="Impactado" forma="borda" />
    <LegendaItem cor="#4caf50" label="Status OK" />
    <LegendaItem cor="#c62828" label="Status NOT OK" />
  </Box>
);

// ── Chip de posição colorido ──────────────────────────────────────────────────
const PosChip: React.FC<{ posicao: string }> = ({ posicao }) => {
  const cor = COR[posicao] ?? COR.meio;
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5,
      px: 1, py: 0.3, borderRadius: 1,
      bgcolor: `${cor}18`, border: `1px solid ${cor}55`,
    }}>
      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: cor, flexShrink: 0 }} />
      <Typography variant="caption" fontWeight={600} sx={{ color: cor, lineHeight: 1 }}>
        {LABEL[posicao] ?? posicao}
      </Typography>
    </Box>
  );
};

// ── Chip de controle ──────────────────────────────────────────────────────────
const ControleChip: React.FC<{ efetuado: boolean; suscetivel: boolean }> = ({ efetuado, suscetivel }) => {
  if (efetuado)
    return <Chip size="small" label="Efetuado"
                 sx={{ bgcolor: '#2e7d32', color: 'white', fontSize: 11, height: 20 }} />;
  if (suscetivel)
    return <Chip size="small" label="Suscetível"
                 sx={{ bgcolor: '#e65100', color: 'white', fontSize: 11, height: 20 }} />;
  return <Typography variant="caption" color="text.disabled">—</Typography>;
};

// ── Tabela virtualizada de jobs resultantes do filtro ─────────────────────────
const ROW_H   = 37;
const COL_W   = [110, 120, 70, 160, 220, 220, 90, 60, 75, 110] as const;
const HEADERS = ['Tabela', 'Job', 'Rotina', 'Grupo', 'IN_COUNDS', 'OUT_COUNDS', 'Posição', 'Carga', 'Horário', 'Controle'] as const;
const TOTAL_W = COL_W.reduce((a, b) => a + b, 0);

const Cell: React.FC<{ children: React.ReactNode; w: number }> = ({ children, w }) => (
  <Box sx={{ width: w, flexShrink: 0, px: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', height: ROW_H }}>
    {children}
  </Box>
);

const TabelaJobs: React.FC<{ nodes: GrafoNode[] }> = ({ nodes }) => {
  const rows = useMemo(() =>
    [...nodes].sort((a, b) => {
      const t = a.tabela.localeCompare(b.tabela);
      if (t !== 0) return t;
      const p = (POS_ORDER[a.posicao] ?? 1) - (POS_ORDER[b.posicao] ?? 1);
      if (p !== 0) return p;
      return a.label.localeCompare(b.label);
    }),
  [nodes]);

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  });

  return (
    <Paper variant="outlined" sx={{ mt: 2, borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1.2, bgcolor: '#f5f5f5', borderBottom: '1px solid #e0e0e0' }}>
        <Typography variant="subtitle2" fontWeight={700}>
          Detalhe dos Jobs — {rows.length} registro{rows.length !== 1 ? 's' : ''}
        </Typography>
      </Box>

      {/* Cabeçalho fixo */}
      <Box sx={{ bgcolor: '#1565c0', overflowX: 'hidden' }}>
        <Box sx={{ display: 'flex', minWidth: TOTAL_W }}>
          {HEADERS.map((h, i) => (
            <Box key={h} sx={{
              width: COL_W[i], flexShrink: 0, px: 1, py: 0.9,
              fontSize: 12, fontWeight: 700, color: 'white', whiteSpace: 'nowrap',
            }}>
              {h}
            </Box>
          ))}
        </Box>
      </Box>

      {/* Corpo virtualizado */}
      <div ref={parentRef} style={{ height: 380, overflowY: 'auto', overflowX: 'auto' }}>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', minWidth: TOTAL_W }}>
          {rowVirtualizer.getVirtualItems().map(vRow => {
            const n = rows[vRow.index];
            return (
              <div
                key={n.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vRow.start}px)`,
                  height: ROW_H,
                  display: 'flex',
                  minWidth: TOTAL_W,
                  backgroundColor: vRow.index % 2 === 0 ? 'white' : '#fafafa',
                  borderBottom: '1px solid #f0f0f0',
                }}
              >
                <Cell w={COL_W[0]}>
                  <span style={{ fontWeight: 600, color: '#e64a19', fontFamily: 'monospace', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.tabela}
                  </span>
                </Cell>
                <Cell w={COL_W[1]}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.label}
                  </span>
                </Cell>
                <Cell w={COL_W[2]}>
                  <Typography variant="caption">{n.tabela.slice(0, 4)}</Typography>
                </Cell>
                <Cell w={COL_W[3]}>
                  <Typography variant="caption" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.grupo}
                  </Typography>
                </Cell>
                <Cell w={COL_W[4]}>
                  {n.in_counds ? (
                    <Tooltip title={n.in_counds} placement="top" arrow>
                      <Typography variant="caption" fontFamily="monospace"
                        sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'help', color: '#1565c0' }}>
                        {n.in_counds}
                      </Typography>
                    </Tooltip>
                  ) : <Typography variant="caption" color="text.disabled">—</Typography>}
                </Cell>
                <Cell w={COL_W[5]}>
                  {n.out_counds ? (
                    <Tooltip
                      title={n.condicoes_orfas.length > 0
                        ? `${n.out_counds}\n\nCondições sem destino:\n${n.condicoes_orfas.join('\n')}`
                        : n.out_counds}
                      placement="top" arrow>
                      <Typography variant="caption" fontFamily="monospace"
                        sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'help',
                              color: n.condicoes_orfas.length > 0 ? '#f57f17' : '#b71c1c' }}>
                        {n.out_counds}
                        {n.condicoes_orfas.length > 0 && (
                          <span style={{ marginLeft: 4, background: '#f57f17', color: 'white',
                                         borderRadius: 3, padding: '0 4px', fontSize: 10 }}>
                            {n.condicoes_orfas.length}✕
                          </span>
                        )}
                      </Typography>
                    </Tooltip>
                  ) : <Typography variant="caption" color="text.disabled">—</Typography>}
                </Cell>
                <Cell w={COL_W[6]}><PosChip posicao={n.posicao} /></Cell>
                <Cell w={COL_W[7]}>
                  {n.carga === 'SIM' ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#ff8f00', flexShrink: 0 }} />
                      <Typography variant="caption" fontWeight={600}>SIM</Typography>
                    </Box>
                  ) : <Typography variant="caption" color="text.disabled">—</Typography>}
                </Cell>
                <Cell w={COL_W[8]}>
                  <Typography variant="caption">
                    {n.carga === 'SIM' && n.horario_carga ? `${n.horario_carga}h` : '—'}
                  </Typography>
                </Cell>
                <Cell w={COL_W[9]}>
                  <ControleChip efetuado={n.controle_efetuado} suscetivel={n.suscetivel_controle} />
                </Cell>
              </div>
            );
          })}
        </div>
      </div>
    </Paper>
  );
};

// ── Componente principal ──────────────────────────────────────────────────────
export const Tela3Fluxos: React.FC = () => {
  const [filtros, setFiltros]             = useState<FiltrosFluxo>(FILTROS_VAZIOS);
  const [filtrosAtivos, setFiltrosAtivos] = useState<FiltrosFluxo>(FILTROS_VAZIOS);
  const [tabelaInput, setTabelaInput]     = useState('');
  const [jobInput, setJobInput]           = useState('');
  const [expandido, setExpandido]         = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  const temFiltro = (filtrosAtivos.grupo?.length ?? 0) > 0 ||
    (filtrosAtivos.tabela?.length ?? 0) > 0 ||
    (filtrosAtivos.job?.length ?? 0) > 0 ||
    (filtrosAtivos.rotina?.length ?? 0) > 0 ||
    !!filtrosAtivos.posicao || !!filtrosAtivos.carga ||
    !!filtrosAtivos.horario_carga || !!filtrosAtivos.controle;
  const { data, isLoading, error } = useFluxosGrafo(filtrosAtivos, temFiltro);
  const { data: rotinasData }      = useRotinasFluxos();

  const setStr = (campo: 'posicao' | 'carga' | 'horario_carga' | 'controle') => (v: string) =>
    setFiltros(prev => {
      const next = { ...prev, [campo]: v };
      if (campo === 'carga' && v !== 'SIM') next.horario_carga = '';
      return next;
    });
  const setArr = (campo: 'tabela' | 'job' | 'grupo' | 'rotina' | 'ambiente') => (v: string[]) =>
    setFiltros(prev => ({ ...prev, [campo]: v }));

  const aplicar = () => {
    const f = { ...filtros };
    if (tabelaInput.trim()) { f.tabela = [...(f.tabela ?? []), tabelaInput.trim()]; setTabelaInput(''); }
    if (jobInput.trim())    { f.job    = [...(f.job    ?? []), jobInput.trim()];    setJobInput(''); }
    setFiltrosAtivos(f);
  };
  const limpar = () => {
    setFiltros(FILTROS_VAZIOS); setFiltrosAtivos(FILTROS_VAZIOS);
    setTabelaInput(''); setJobInput('');
  };

  // ── BFS: nós em risco (downstream de NOT OK) ──────────────────
  const atRiscoSet = useMemo<Set<string>>(() => {
    if (!data) return new Set();
    const adj = new Map<string, string[]>();
    for (const e of data.edges) {
      const list = adj.get(e.source) ?? [];
      list.push(e.target);
      adj.set(e.source, list);
    }
    const nokIds = new Set(
      data.nodes.filter(n => n.ultimo_status === 'NOT OK').map(n => n.id)
    );
    const risco = new Set<string>();
    const queue = [...nokIds];
    const visited = new Set<string>(nokIds);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of (adj.get(cur) ?? [])) {
        if (!visited.has(next)) {
          visited.add(next);
          risco.add(next);
          queue.push(next);
        }
      }
    }
    return risco;
  }, [data]);

  // ── Dagre layout (só matemática, sem DOM) ──────────────────────
  const layout = useMemo<Layout | null>(() => {
    if (!data?.nodes.length) return null;

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 70, marginx: 30, marginy: 30 });
    g.setDefaultEdgeLabel(() => ({}));

    data.nodes.forEach(n => g.setNode(n.id, { width: NW, height: NH }));
    data.edges.forEach(e => { try { g.setEdge(e.source, e.target); } catch (_) {} });

    dagre.layout(g);

    const nodes: LayoutNode[] = data.nodes
      .map(n => {
        const pos = g.node(n.id) as { x: number; y: number } | undefined;
        return pos ? { ...n, x: pos.x, y: pos.y } : null;
      })
      .filter((n): n is LayoutNode => n !== null);

    const edges: LayoutEdge[] = data.edges.map(e => {
      try {
        const pts = (g.edge(e.source, e.target)?.points ?? []) as { x: number; y: number }[];
        return { ...e, points: pts };
      } catch (_) { return { ...e, points: [] }; }
    }).filter(e => e.points.length >= 2);

    return {
      nodes,
      edges,
      w: (g.graph().width  ?? 800) + 60,
      h: (g.graph().height ?? 600) + 60,
    };
  }, [data]);

  // ── Zoom / Pan via d3.zoom (só behavior, sem renderização) ─────
  useEffect(() => {
    if (!svgRef.current || !layout) return;
    const svg  = d3.select(svgRef.current);
    const grp  = svg.select<SVGGElement>('g.zg');
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 4])
      .on('zoom', ev => grp.attr('transform', ev.transform.toString()));
    svg.call(zoom);
    svg.call(zoom.transform, d3.zoomIdentity);
    return () => { svg.on('.zoom', null); };
  }, [layout]);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" fontWeight="bold" sx={{ mb: 2 }}>Fluxo de Processamento</Typography>

      {/* Filtros */}
      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}
             onClick={() => setExpandido(v => !v)}>
          <FilterListIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2" fontWeight={600}>Filtros</Typography>
          {temFiltro && <Chip label="Filtro ativo" size="small" color="primary" sx={{ ml: 1 }} />}
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
              <FormControl size="small" sx={{ minWidth: 165 }}>
                <InputLabel>Posição no Fluxo</InputLabel>
                <Select value={filtros.posicao} label="Posição no Fluxo"
                        onChange={e => setStr('posicao')(e.target.value as string)}>
                  <MenuItem value=""><em>Todas</em></MenuItem>
                  {Object.entries(COR).map(([pos, cor]) => (
                    <MenuItem key={pos} value={pos}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: cor }} />
                        {LABEL[pos]}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 155 }}>
                <InputLabel>Carga Automática</InputLabel>
                <Select value={filtros.carga} label="Carga Automática"
                        onChange={e => setStr('carga')(e.target.value as string)}>
                  <MenuItem value=""><em>Todas</em></MenuItem>
                  <MenuItem value="SIM">SIM</MenuItem>
                  <MenuItem value="NAO">NAO</MenuItem>
                </Select>
              </FormControl>
              {filtros.carga === 'SIM' && (
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Horário de Carga</InputLabel>
                  <Select value={filtros.horario_carga} label="Horário de Carga"
                          onChange={e => setStr('horario_carga')(e.target.value as string)}>
                    <MenuItem value=""><em>Todos</em></MenuItem>
                    {HORARIOS.map(h => (
                      <MenuItem key={h} value={h}>{h}h</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <FormControl size="small" sx={{ minWidth: 175 }}>
                <InputLabel>Controle</InputLabel>
                <Select value={filtros.controle} label="Controle"
                        onChange={e => setStr('controle')(e.target.value as string)}>
                  <MenuItem value=""><em>Todos</em></MenuItem>
                  <MenuItem value="efetuado">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#2e7d32' }} />
                      Controle efetuado
                    </Box>
                  </MenuItem>
                  <MenuItem value="suscetivel">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#e65100' }} />
                      Suscetível a controle
                    </Box>
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

      {/* Contador + legenda */}
      {data && !isLoading && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {data.nodes.length} nó{data.nodes.length !== 1 ? 's' : ''} · {data.edges.length} aresta{data.edges.length !== 1 ? 's' : ''} — scroll + pinch para zoom · arrastar para mover
          </Typography>
          <Legenda />
        </Box>
      )}

      {isLoading && <CircularProgress />}
      {error && (
        <Alert severity="error">
          {(error as any)?.response?.data?.detail ?? 'Erro ao carregar fluxos.'}
        </Alert>
      )}

      {!temFiltro && !isLoading && (
        <Paper variant="outlined" sx={{
          p: 6, textAlign: 'center', bgcolor: '#f9fafb', borderStyle: 'dashed',
        }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            Selecione ao menos um filtro para visualizar o fluxo
          </Typography>
          <Typography variant="body2" color="text.disabled">
            Use Tabela, Job, Grupo, Rotina, Posição ou Carga para carregar o grafo.
          </Typography>
        </Paper>
      )}

      {temFiltro && data && !isLoading && (
        data.nodes.length === 0 ? (
          <Alert severity="info">Nenhum processo encontrado com os filtros aplicados.</Alert>
        ) : (
          <>
            {data.nodes.length > 80 && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                {data.nodes.length} nós — use os filtros (Rotina, Grupo ou Tabela) para uma visualização mais clara.
              </Alert>
            )}
            <Paper variant="outlined" sx={{ bgcolor: '#f0f4f8', overflow: 'hidden', borderRadius: 2 }}>
              <svg ref={svgRef} style={{ width: '100%', height: '680px', display: 'block', cursor: 'grab' }}>
                <defs>
                  <marker id="fl-arrow" viewBox="0 -5 10 10" refX={9} refY={0}
                          orient="auto" markerWidth={7} markerHeight={7}>
                    <path d="M 0,-5 L 10,0 L 0,5" fill="#90a4ae" />
                  </marker>
                </defs>
                <g className="zg">
                  {layout?.edges.map((e, i) => (
                    <path key={i} d={edgePath(e.points)}
                          fill="none" stroke="#90a4ae" strokeWidth={1.5}
                          markerEnd="url(#fl-arrow)" />
                  ))}
                  {layout?.nodes.map(n => <NodeCard key={n.id} node={n} atRisco={atRiscoSet.has(n.id)} />)}
                </g>
              </svg>
            </Paper>
            <TabelaJobs nodes={data.nodes} />
          </>
        )
      )}
    </Box>
  );
};
