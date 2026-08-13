import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Calendar, Package, Users, Activity, Scale, Move, ChevronLeft, ChevronRight, Filter, FileText, Trash2, CalendarDays, ShoppingCart, X, Info, CheckCircle2, Lock, Unlock, ShieldCheck, Download, FileSpreadsheet, AlertTriangle, Database, BarChart3, Cpu, Layers, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const API = import.meta.env.VITE_API_URL;

interface Spec {
  erpItemCode: string;
  productType: string;
  productYield: number;
  productSpeed: number;
  icutSpeed?: number;
  productSize: string;
  masterYieldIds?: string;
  erpItemDesc?: string;
}

// ─── Part Configuration: Controls all part-specific text, labels and calculations ───
const PART_CONFIGS: Record<string, {
  title: string;
  rmPrefix: string;      // e.g. "RM FL" or "RM BIL"
  yieldLabel: string;    // e.g. "Fillet Yield" or "BIL Yield"
  sizeBreakdownTitle: string;
  netLabel: string;      // e.g. "Net Fillet Available" or "Net BIL Available"
}> = {
  fillet: {
    title: 'Fillet',
    rmPrefix: 'RM FL',
    yieldLabel: 'Fillet Yield',
    sizeBreakdownTitle: 'Fillet Size Breakdown',
    netLabel: 'Net Fillet Available',
  },
  bil: {
    title: 'Bone in Leg',
    rmPrefix: 'RM BIL',
    yieldLabel: 'BIL Yield',
    sizeBreakdownTitle: 'BIL Size Breakdown',
    netLabel: 'Net BIL Available',
  },
  bl: {
    title: 'BL Processing',
    rmPrefix: 'RM BL',
    yieldLabel: 'BL Yield',
    sizeBreakdownTitle: 'BL Size Breakdown',
    netLabel: 'Net BL Available',
  },
};

const MPSPlan: React.FC = () => {
  const { partId } = useParams<{ partId: string }>();
  const pc = PART_CONFIGS[partId || 'fillet'] || PART_CONFIGS['fillet'];
  const [currentMonth, setCurrentMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [specs, setSpecs] = useState<Record<string, Spec>>({});
  const [loading, setLoading] = useState(true);
  const [loadingPhase, setLoadingPhase] = useState<{ mode: 'loading' | 'generating' | 'importing'; step: number; message: string }>({ mode: 'loading', step: 0, message: 'Initializing...' });
  const [loadingStartTime, setLoadingStartTime] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Elapsed time tracker
  useEffect(() => {
    if (!loading) { setElapsedTime(0); return; }
    const interval = setInterval(() => {
      setElapsedTime(loadingStartTime > 0 ? Math.floor((Date.now() - loadingStartTime) / 1000) : 0);
    }, 200);
    return () => clearInterval(interval);
  }, [loading, loadingStartTime]);

  const [activeTab, setActiveTab] = useState<'calendar' | 'drafts' | 'demand'>('calendar');
  const [machineConfigs, setMachineConfigs] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [currentPlan, setCurrentPlan] = useState<any>(null);
  const [demandOrders, setDemandOrders] = useState<any[]>([]);
  const [manpowerData, setManpowerData] = useState<any[]>([]);
  const [selectedSupply, setSelectedSupply] = useState<any>(null);
  const [selectedManpower, setSelectedManpower] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedDailyOrders, setSelectedDailyOrders] = useState<any[]>([]);
  const [expandedSizeBins, setExpandedSizeBins] = useState<Record<string, boolean>>({});
  // Removed showFilters
  const [showSupplyModal, setShowSupplyModal] = useState(false);
  const [highlightedSoNumber, setHighlightedSoNumber] = useState<string | null>(null);
  const [priorityMap, setPriorityMap] = useState<Record<number, number | null>>({});
  const [priorityDirty, setPriorityDirty] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [allowedItemCodes, setAllowedItemCodes] = useState<string[]>([]);
  const [yieldNodeTypeMap, setYieldNodeTypeMap] = useState<Map<string, string>>(new Map());
  const [yieldTree, setYieldTree] = useState<any[]>([]);

  // BIL Distribution Data
  const [, setBilMatrix] = useState<Record<string, Record<string, number>>>({});
  const [blColLabelsMap, setBlColLabelsMap] = useState<Record<string, string>>({});
  const [, setBilColLabels] = useState<string[]>([]);

  const fetchYieldNodes = async () => {
    try {
      const res = await fetch(`${API}/api/master-yield`);
      if (res.ok) {
        const tree = await res.json();
        const flatNodes: any[] = [];
        const traverse = (nodes: any[]) => {
          nodes.forEach(n => {
            flatNodes.push(n);
            if (n.children && n.children.length > 0) traverse(n.children);
          });
        };
        traverse(tree);
        setYieldTree(flatNodes);
      }

      const nodesRes = await fetch(`${API}/api/master-yield/nodes`);
      if (nodesRes.ok) {
        const allNodes = await nodesRes.json();
        const typeMap = new Map<string, string>();
        allNodes.forEach((n: any) => typeMap.set(n.id, n.type));
        setYieldNodeTypeMap(typeMap);
      }
    } catch (e) {
      console.error('Error fetching master yield nodes:', e);
    }
  };

  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const getDefaultStartDate = () => {
    const y = currentMonth.getFullYear();
    const m = (currentMonth.getMonth() + 1).toString().padStart(2, '0');
    return `${y}-${m}-01`;
  };
  const getDefaultEndDate = () => {
    const lastDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const y = currentMonth.getFullYear();
    const m = (currentMonth.getMonth() + 1).toString().padStart(2, '0');
    return `${y}-${m}-${lastDay.toString().padStart(2, '0')}`;
  };
  const [generateRange, setGenerateRange] = useState({ startDate: getDefaultStartDate(), endDate: getDefaultEndDate() });

  const [moveModal, setMoveModal] = useState<{
    isOpen: boolean;
    sourceDate: string;
    targetDate: string;
    itemCode: string;
    itemDesc: string;
    orders: any[];
  }>({ isOpen: false, sourceDate: '', targetDate: '', itemCode: '', itemDesc: '', orders: [] });

  
  const computeUnassignedOrders = () => {
    const allAssigned: Record<string, number> = {};
    if (currentPlan && currentPlan.orders) {
      currentPlan.orders.forEach((o: any) => {
        if (o.stgLineId) {
           allAssigned[o.stgLineId] = (allAssigned[o.stgLineId] || 0) + Number(o.quantityKg || o.qty || 0);
        }
      });
    }
    
    const unassigned: any[] = [];
    demandOrders.forEach((header: any) => {
      header.lines?.forEach((line: any) => {
         if (!allowedItemCodes.includes(line.erpOrderItemCode)) return;
         
         const totalQty = Number(line.erpOrderItemQty || 0);
         const assigned = allAssigned[line.erpOrderLineId] || 0;
         const remaining = totalQty - assigned;
         
         if (remaining > 0.5) {
           unassigned.push({
             ...line,
             soNumber: header.erpOrderNumber || header.erpOrderHeaderId || header.soNumber,
             shipDate: line.erpOrderShipDate || header.shipDate,
             itemCode: line.erpOrderItemCode,
             itemDesc: line.erpItemDesc,
             remainingQty: remaining,
             pullQty: Math.round(remaining).toString()
           });
         }
      });
    });
    return unassigned.sort((a, b) => new Date(a.shipDate).getTime() - new Date(b.shipDate).getTime());
  };

  const [showManualPull, setShowManualPull] = useState(false);
  const [unassignedList, setUnassignedList] = useState<any[]>([]);
  const [manualPullSearch, setManualPullSearch] = useState('');
  const [manualPullPage, setManualPullPage] = useState(1);

  const handleOpenManualPull = () => {
    setUnassignedList(computeUnassignedOrders());
    setShowManualPull(true);
  };

  const handlePullOrder = async (order: any) => {
    const pullQty = parseFloat(order.pullQty);
    if (isNaN(pullQty) || pullQty <= 0 || pullQty > order.remainingQty) {
      alert('Invalid pull quantity.');
      return;
    }

    setLoading(true);
    setLoadingStartTime(Date.now());
    setLoadingPhase({ mode: 'loading', step: 1, message: 'Pulling order...' });
    
    try {
      const res = await fetch(`${API}/api/mps/pull-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: currentPlan.id,
          stgLineId: order.erpOrderLineId,
          date: selectedDate,
          pullQty: pullQty,
          itemCode: order.itemCode,
          itemDesc: order.itemName || order.itemDesc || '',
          soNumber: order.soNumber,
          shipDate: order.shipDate,
          type: order.type || 'frozen'
        })
      });
      
      if (res.ok) {
         setLoadingPhase({ mode: 'loading', step: 2, message: 'Reloading plan details...' });
         const planRes = await fetch(`${API}/api/mps/plans/${currentPlan.id}`);
         if (planRes.ok) {
           const json = await planRes.json();
           if (json.success) {
             setCurrentPlan(json.data);
             // Update the selectedDailyOrders so the modal updates immediately
             const newOrders = json.data.orders.filter((o: any) => o.planDate === selectedDate);
             setSelectedDailyOrders(newOrders);
             
             // Also recalculate unassigned list
             setTimeout(() => {
                const updatedAssigned: Record<string, number> = {};
                json.data.orders.forEach((o: any) => {
                  if (o.stgLineId) {
                     updatedAssigned[o.stgLineId] = (updatedAssigned[o.stgLineId] || 0) + Number(o.quantityKg || o.qty || 0);
                  }
                });
                
                const unassigned: any[] = [];
                demandOrders.forEach((header: any) => {
                  header.lines?.forEach((line: any) => {
                     if (!allowedItemCodes.includes(line.erpOrderItemCode)) return;
                     const totalQty = Number(line.erpOrderItemQty || 0);
                     const assigned = updatedAssigned[line.erpOrderLineId] || 0;
                     const remaining = totalQty - assigned;
                     if (remaining > 0.5) {
                       unassigned.push({
                         ...line,
                         soNumber: header.erpOrderNumber || header.erpOrderHeaderId || header.soNumber,
                         shipDate: line.erpOrderShipDate || header.shipDate,
                         itemCode: line.erpOrderItemCode,
                         itemDesc: line.erpItemDesc,
                         remainingQty: remaining,
                         pullQty: Math.round(remaining).toString()
                       });
                     }
                  });
                });
                setUnassignedList(unassigned.sort((a, b) => new Date(a.shipDate).getTime() - new Date(b.shipDate).getTime()));
             }, 100);
           }
         }
      }
      setLoadingPhase({ mode: 'loading', step: 4, message: 'Complete!' });
      setTimeout(() => setLoading(false), 300);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  React.useEffect(() => {
    // Also reset to current month whenever partId changes, as requested
    const d = new Date();
    setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [partId]);

  React.useEffect(() => {
    initData();
  }, [currentMonth, partId]);

  const fetchManpowerData = async () => {
    try {
      const monthStr = `${currentMonth.getFullYear()}-${(currentMonth.getMonth() + 1).toString().padStart(2, '0')}`;
      const lastDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
      const startDate = `${monthStr}-01`;
      const endDate = `${monthStr}-${lastDay.toString().padStart(2, '0')}`;

      const res = await fetch(`${API}/api/manual-operation?startDate=${startDate}&endDate=${endDate}&partType=${partId}`);
      if (res.ok) {
        setManpowerData(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  // External RM Supplies
  const [externalRmSupplies, setExternalRmSupplies] = useState<any[]>([]);

  const initData = async () => {
    setLoading(true);
    setLoadingStartTime(Date.now());
    setLoadingPhase({ mode: 'loading', step: 0, message: 'Connecting to server...' });

    setLoadingPhase({ mode: 'loading', step: 1, message: 'Loading product specs & demand orders...' });
    await Promise.all([
      fetchSpecs(),
      fetchDemandOrders(),
      fetchManpowerData(),
      fetchAllowedItems(),
      fetchYieldNodes(),
      fetchMachineConfigs(),
      fetchBilData(),
      fetchExternalRmSupplies()
    ]).catch(e => console.error("Error in initial fetches:", e));

    setLoadingPhase({ mode: 'loading', step: 2, message: 'Loading plan drafts...' });
    const allPlans = await fetchPlans();

    setLoadingPhase({ mode: 'loading', step: 3, message: 'Loading plan details & supply data...' });
    await loadPlanForMonth(allPlans);

    setLoadingPhase({ mode: 'loading', step: 4, message: 'Complete!' });
    setTimeout(() => setLoading(false), 300);
  };

  const fetchExternalRmSupplies = async () => {
    try {
      const res = await fetch(`${API}/api/external-rm-supplies`);
      if (res.ok) {
        const json = await res.json();
        // Filter only supplies in current month
        const monthStr = `${currentMonth.getFullYear()}-${(currentMonth.getMonth() + 1).toString().padStart(2, '0')}`;
        const supplies = json.data.filter((s: any) => s.receivedDate.startsWith(monthStr) && s.partName === 'BIL L/C');
        setExternalRmSupplies(supplies);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchBilData = async () => {
    try {
      const res = await fetch(`${API}/api/bil-weight-distribution`);
      if (res.ok) {
        const d = await res.json();
        setBilColLabels(d.colLabels || []);
        setBlColLabelsMap(d.blColLabelsMap || {});
        setBilMatrix(d.matrix || {});
      }
    } catch (e) {
      console.error('Error fetching bil data:', e);
    }
  };

  const fetchAllowedItems = async () => {
    try {
      const res = await fetch(`${API}/api/mps/allowed-items?partType=${partId || 'fillet'}`);
      if (res.ok) {
        const data = await res.json();
        setAllowedItemCodes(data.itemCodes || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const getProductType = (itemCode: string): 'main' | 'coproduct' | 'byproduct' => {
    const spec = specs[itemCode];
    if (!spec) return 'main';

    if (spec.productType) {
      const type = spec.productType.toLowerCase().trim();
      if (type === 'co-product' || type === 'coproduct') return 'coproduct';
      if (type === 'by-product' || type === 'byproduct') return 'byproduct';
    }

    if (spec.masterYieldIds) {
      const processIds = spec.masterYieldIds.split(',').map(id => id.trim());
      for (const id of processIds) {
        const nodeType = yieldNodeTypeMap.get(id) || yieldNodeTypeMap.get(id.toLowerCase()) || yieldNodeTypeMap.get(id.toUpperCase());
        if (nodeType?.toUpperCase() === 'CO-PRODUCT') return 'coproduct';
        if (nodeType?.toUpperCase() === 'BY-PRODUCT') return 'byproduct';
      }
    }

    return 'main';
  };



  const renderDemandByYieldTreeGroup = (
    title: string,
    themeColor: string,
    ordersList: any[],
    typeFilter: 'coproduct' | 'byproduct',
    currentSupply: any
  ) => {
    let byProductsSupply: Record<string, { name: string; qty: number; processName?: string }> = {};
    if (currentSupply && currentSupply.byProducts) {
      try {
        byProductsSupply = JSON.parse(currentSupply.byProducts);
      } catch (e) {
        console.error('Error parsing byProducts', e);
      }
    }

    const resolveByproductName = (key: string): string => {
      if (byProductsSupply[key]?.name) return byProductsSupply[key].name;
      if (specs[key]) return specs[key].erpItemDesc || specs[key].erpItemCode || key;
      const foundSpec: any = Object.values(specs).find((s: any) =>
        s.masterYieldIds?.split(',').map((id: any) => id.trim().toLowerCase()).includes(key.toLowerCase())
      );
      if (foundSpec) return foundSpec.erpItemDesc || foundSpec.erpItemCode || key;
      return key;
    };

    interface GroupedItem {
      name: string;
      supplyQty: number;
      demandQty: number;
      orders: any[];
    }

    const groupedMap: Record<string, GroupedItem> = {};

    const getOrCreateGroup = (name: string): GroupedItem => {
      if (!groupedMap[name]) groupedMap[name] = { name, supplyQty: 0, demandQty: 0, orders: [] };
      return groupedMap[name];
    };

    Object.keys(byProductsSupply).forEach(key => {
      const sInfo = byProductsSupply[key];
      if (sInfo && sInfo.qty > 0) {
        let nodeType = yieldNodeTypeMap.get(key) || yieldNodeTypeMap.get(key.toLowerCase()) || yieldNodeTypeMap.get(key.toUpperCase());

        // Fallback if nodeType is missing from tree map (e.g. deep nodes)
        if (!nodeType) {
          const foundSpec: any = Object.values(specs).find((s: any) =>
            s.masterYieldIds?.split(',').map((id: any) => id.trim().toLowerCase()).includes(key.toLowerCase())
          );
          if (foundSpec) {
            const specType = getProductType(foundSpec.erpItemCode);
            if (specType === 'coproduct') nodeType = 'CO-PRODUCT';
            if (specType === 'byproduct') nodeType = 'BY-PRODUCT';
          } else if (sInfo.processName === 'BIL L/C' || sInfo.processName === 'Debone Process') {
            // Heuristic: Process 3 typically yields by-products
            nodeType = 'BY-PRODUCT';
          }
        }

        const isMatch = typeFilter === 'coproduct' ? nodeType?.toUpperCase() === 'CO-PRODUCT' : nodeType?.toUpperCase() === 'BY-PRODUCT';
        if (isMatch) {
          const name = resolveByproductName(key);
          const grp = getOrCreateGroup(name);
          grp.supplyQty += sInfo.qty;
        }
      }
    });

    ordersList.forEach(o => {
      const spec = specs[o.itemCode];
      const bpId = spec?.masterYieldIds?.split(',').map((id: any) => id.trim())[0];
      const key = bpId || o.itemCode;
      const name = resolveByproductName(key);
      const grp = getOrCreateGroup(name);
      grp.demandQty += o.qty;
      grp.orders.push(o);
    });

    const groups = Object.values(groupedMap);
    if (groups.length === 0) return null;

    const borderTheme = themeColor === 'purple' ? 'border-purple-200 bg-purple-50/20' : 'border-amber-200 bg-amber-50/20';
    const titleTheme = themeColor === 'purple' ? 'text-purple-700' : 'text-amber-700';
    const lineTheme = themeColor === 'purple' ? 'bg-purple-500' : 'bg-amber-500';
    const expandedBorder = themeColor === 'purple' ? 'border-purple-200' : 'border-amber-200';
    const hoverTheme = themeColor === 'purple' ? 'hover:bg-purple-50/50' : 'hover:bg-amber-50/50';

    return (
      <div className={`border ${borderTheme} rounded-xl p-4 space-y-3`}>
        <p className={`text-[10px] font-bold ${titleTheme} uppercase tracking-wider`}>{title}</p>
        <div className="space-y-1">
          {groups.map(group => {
            const supplyQty = Math.round(group.supplyQty);
            const demandQty = Math.round(group.demandQty);
            const remaining = supplyQty - demandQty;
            if (supplyQty === 0 && demandQty === 0) return null;
            const isExpanded = expandedSizeBins[group.name] || false;
            const ords = group.orders;

            return (
              <div key={group.name}>
                <div
                  className={`bg-white rounded-lg p-2.5 border border-gray-100 flex items-center gap-3 cursor-pointer ${hoverTheme} transition-colors`}
                  onClick={() => setExpandedSizeBins((prev: any) => ({ ...prev, [group.name]: !prev[group.name] }))}
                >
                  <div className={`w-2 h-8 rounded-full ${lineTheme}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-gray-600 uppercase">{group.name}</span>
                      {ords.length > 0 && (
                        <span className="text-[9px] text-gray-400">
                          {isExpanded ? '▲' : '▼'} {ords.length} orders
                        </span>
                      )}
                    </div>
                    <div className="flex gap-4 text-xs mt-0.5">
                      <span className="text-emerald-600">Supply: <b>{supplyQty.toLocaleString()}</b></span>
                      <span className="text-orange-600">Demand: <b>{demandQty.toLocaleString()}</b></span>
                      <span className={remaining >= 0 ? 'text-blue-600' : 'text-red-600 font-bold'}>
                        {remaining >= 0 ? 'Rem' : 'Short'}: <b>{Math.abs(remaining).toLocaleString()}</b>
                      </span>
                    </div>
                  </div>
                </div>
                {isExpanded && ords.length > 0 && (
                  <div className={`ml-5 mt-1 mb-2 border-l-2 ${expandedBorder} pl-3 space-y-1`}>
                    {ords.map((ord: any, idx: number) => {
                      const spec = specs[ord.itemCode];
                      return (
                        <div key={idx} className="flex items-center gap-2 text-[11px] py-1 px-2 bg-white/80 rounded border border-gray-100">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${ord.type === 'chilled' ? 'bg-orange-100 text-orange-700' : 'bg-cyan-100 text-cyan-700'}`}>
                            {ord.type === 'chilled' ? 'C' : 'F'}
                          </span>
                          {Number(spec?.icutSpeed) > 0 && (
                            <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 uppercase tracking-tighter">
                              I-CUT
                            </span>
                          )}
                          <span className="font-bold text-gray-700">{ord.soNumber}</span>
                          <span className="text-gray-400 text-[10px]">{ord.itemCode}</span>
                          <span className="ml-auto font-bold text-gray-900">{Math.round(ord.qty).toLocaleString()} kg</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const isMainProductSpec = (itemCode: string): boolean => {
    const type = getProductType(itemCode);
    return type === 'main';
  };

  const fetchDemandOrders = async () => {
    try {
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth();
      const shipStartDate = new Date(year, month - 3, 1).toISOString();
      const shipEndDate = new Date(year, month + 2, 0).toISOString();

      const res = await fetch(`${API}/api/erp/demand-orders?shipStartDate=${shipStartDate}&shipEndDate=${shipEndDate}`);
      if (res.ok) {
        const data = await res.json();
        setDemandOrders(data);
        // Build initial priority map from fetched data
        const pMap: Record<number, number | null> = {};
        data.forEach((header: any) => {
          header.lines?.forEach((line: any) => {
            if (line.priority !== null && line.priority !== undefined) {
              pMap[line.erpOrderLineId] = line.priority;
            }
          });
        });
        setPriorityMap(pMap);
        setPriorityDirty(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handlePriorityChange = (lineId: number, value: string) => {
    const num = value === '' ? null : parseInt(value);
    setPriorityMap(prev => ({ ...prev, [lineId]: num }));
    setPriorityDirty(true);
  };

  const savePriorities = async () => {
    setSavingPriority(true);
    try {
      const priorities = Object.entries(priorityMap).map(([lineId, priority]) => ({
        lineId: parseInt(lineId),
        priority
      }));
      const res = await fetch(`${API}/api/mps/update-priorities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priorities })
      });
      if (res.ok) {
        setPriorityDirty(false);
        // Automatically trigger re-generation to apply priorities
        await executeGeneratePlan();
      }
    } catch (e) {
      console.error(e);
      alert('Failed to save priorities');
    } finally {
      setSavingPriority(false);
    }
  };

  const cancelPriorities = async () => {
    // Re-fetch to reset
    await fetchDemandOrders();
  };

  const fetchMachineConfigs = async () => {
    try {
      const res = await fetch(`${API}/api/machine-config`);
      if (res.ok) {
        const data = await res.json();
        setMachineConfigs(data);
      }
    } catch (e) {
      console.error('Error fetching machine configs:', e);
    }
  };

  const fetchPlans = async () => {
    try {
      const res = await fetch(`${API}/api/mps/plans?partType=${partId || 'fillet'}`);
      if (res.ok) {
        const data = await res.json();
        setPlans(data);
        return data;
      }
    } catch (e) {
      console.error(e);
    }
    return [];
  };

  const fetchSpecs = async () => {
    try {
      const specRes = await fetch(`${API}/api/product-spec`);
      if (specRes.ok) {
        const rawSpecs = await specRes.json();
        const specMap: Record<string, Spec> = {};
        rawSpecs.forEach((s: any) => {
          specMap[s.erpItemCode] = {
            erpItemCode: s.erpItemCode,
            productType: s.productType,
            productYield: Number(s.productYield || 0),
            productSpeed: Number(s.productSpeed || 1),
            icutSpeed: Number(s.icutSpeed || 0),
            productSize: s.productSize || 'unsize',
            masterYieldIds: s.masterYieldIds,
            erpItemDesc: s.erpItemDesc
          };
        });
        setSpecs(specMap);
      }
    } catch (e) {
      console.error(e);
    }
  };
  const [weeklyDates, setWeeklyDates] = useState<Set<string>>(new Set());


  const loadPlanForMonth = async (allPlans: any[]) => {
    const monthStr = `${currentMonth.getFullYear()}-${(currentMonth.getMonth() + 1).toString().padStart(2, '0')}`;
    const planForMonth = allPlans.find(p => p.targetMonth === monthStr);

    if (planForMonth) {
      try {
        const res = await fetch(`${API}/api/mps/plans/${planForMonth.id}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            setCurrentPlan(json.data);

            try {
              const wRes = await fetch(`${API}/api/chicken-receiving/weekly`);
              if (wRes.ok) {
                const wJson = await wRes.json();
                const dates = new Set<string>();
                if (Array.isArray(wJson)) {
                  wJson.forEach((w: any) => {
                    const d = w.receive_date || w.receiveDate;
                    if (d) {
                      let dStr = '';
                      if (typeof d === 'string') dStr = d.split('T')[0];
                      else dStr = new Date(d).toISOString().split('T')[0];
                      dates.add(dStr);
                    }
                  });
                }
                setWeeklyDates(dates);
              }
            } catch (err) {
              console.error('Failed to fetch weekly intakes', err);
            }

            return;
          }
        }
      } catch (e) {
        console.error(e);
      }
    }
    setCurrentPlan(null);
    setWeeklyDates(new Set());
  };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleToggleLock = async (date: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentPlan?.status === 'APPROVED') return;
    
    const lockedArr = currentPlan.lockedDays ? currentPlan.lockedDays.split(',') : [];
    const isLocked = lockedArr.includes(date);
    const newIsLocked = !isLocked;
    
    try {
      const res = await fetch(`${API}/api/mps/plans/${currentPlan.id}/lock-day`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, isLocked: newIsLocked })
      });
      const data = await res.json();
      if (data.success) {
        setCurrentPlan((prev: any) => ({ ...prev, lockedDays: data.lockedDays }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeletePlan = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this plan?')) return;
    try {
      const res = await fetch(`${API}/api/mps/plans/${id}/delete`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        initData();
      } else {
        alert(data.message || 'Failed to delete plan');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleClearMonth = async () => {
    const monthStr = `${currentMonth.getFullYear()}-${(currentMonth.getMonth() + 1).toString().padStart(2, '0')}`;
    if (!window.confirm(`Are you sure you want to delete all DRAFT plans for ${monthStr}?`)) return;
    try {
      const res = await fetch(`${API}/api/mps/clear/month/${monthStr}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        alert('\u2705 ' + data.message);
        initData();
      } else {
        alert(data.message || 'Failed to clear plans');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleApprovePlan = async (id: number) => {
    if (!window.confirm('Approve this plan? Once approved, the plan will be locked and cannot be modified.')) return;
    try {
      const res = await fetch(`${API}/api/mps/plans/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert('\u2705 Plan approved and locked successfully!');
        initData();
      } else {
        alert(data.message || 'Failed to approve plan');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRejectPlan = async (id: number) => {
    if (!window.confirm('Reject this plan? It will be reverted back to DRAFT status.')) return;
    try {
      const res = await fetch(`${API}/api/mps/plans/${id}/reject`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert('Plan reverted to DRAFT.');
        initData();
      } else {
        alert(data.message || 'Failed to reject plan');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleExportExcel = (id: number) => {
    const viewQuery = (partId === 'bil' || partId === 'bl') ? `?view=${partId}` : '';
    window.open(`${API}/api/mps/plans/${id}/export${viewQuery}`, '_blank');
  };

  // --- Calendar Helpers ---
  // Use local date to avoid UTC timezone shift (toISOString shifts +7 timezone back by 1 day)
  const formatLocalDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const parseSafeDate = (dateVal: any) => {
    if (!dateVal) return '';
    if (dateVal instanceof Date) return formatLocalDate(dateVal);
    const d = new Date(dateVal);
    if (!isNaN(d.getTime())) return formatLocalDate(d);
    if (typeof dateVal === 'string') return dateVal.split('T')[0];
    return String(dateVal).split('T')[0];
  };
  const getTodayStr = () => formatLocalDate(new Date());

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i + 1);
    return formatLocalDate(d);
  });

  // --- Drag and Drop Handlers ---
  const handleDragStart = (e: React.DragEvent, groupData: any) => {
    e.dataTransfer.setData('application/json', JSON.stringify(groupData));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, date: string) => {
    e.preventDefault();
    if (currentPlan?.status === 'APPROVED') {
      alert('This plan is approved and locked. Cannot modify.');
      return;
    }
    
    try {
      const dataStr = e.dataTransfer.getData('application/json');
      if (dataStr) {
        const data = JSON.parse(dataStr);
        setMoveModal({
          isOpen: true,
          sourceDate: data.sourceDate,
          targetDate: date,
          itemCode: data.itemCode,
          itemDesc: data.itemDesc,
          orders: data.orders.map((o: any) => ({
             ...o,
             selected: false,
             moveQty: String(o.qty)
          }))
        });
      }
    } catch(err) {}
  };

  const handleConfirmMoveBatch = async () => {
    const selectedOrders = moveModal.orders.filter(o => o.selected);
    if (selectedOrders.length === 0) {
      alert("Please select at least one order to move.");
      return;
    }

    const moves: any[] = [];
    for (const o of selectedOrders) {
       const qtyNum = parseFloat(o.moveQty);
       if (isNaN(qtyNum) || qtyNum <= 0 || qtyNum > o.qty) {
         alert(`Invalid quantity for SO ${o.soNumber}`);
         return;
       }
       
       let remainingToMove = qtyNum;
       for(const idStr of (o.ids || [o.id])) {
           if(remainingToMove <= 0) break;
           
           const mpsOrderId = parseInt(idStr);
           const originalOrder = currentPlan.orders.find((x: any) => x.id === mpsOrderId);
           if(originalOrder) {
               const origQty = Number(originalOrder.quantityKg || originalOrder.qty);
               if(remainingToMove >= origQty) {
                   moves.push({ mpsOrderId, date: moveModal.targetDate });
                   remainingToMove -= origQty;
               } else {
                   moves.push({ mpsOrderId, date: moveModal.targetDate, splitQty: remainingToMove });
                   remainingToMove = 0;
               }
           }
       }
    }

    setMoveModal({ ...moveModal, isOpen: false });
    setLoading(true);
    setLoadingStartTime(Date.now());
    setLoadingPhase({ mode: 'loading', step: 1, message: 'Saving batched moves...' });

    try {
      await fetch(`${API}/api/mps/update-date-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: currentPlan.id,
          moves
        })
      });
      setLoadingPhase({ mode: 'loading', step: 2, message: 'Reloading plan details...' });
      const planRes = await fetch(`${API}/api/mps/plans/${currentPlan.id}`);
      if (planRes.ok) {
        const json = await planRes.json();
        if (json.success) {
          setCurrentPlan(json.data);
        }
      }
      setLoadingPhase({ mode: 'loading', step: 4, message: 'Complete!' });
      setTimeout(() => setLoading(false), 300);
    } catch (err) {
      console.error("Failed to update dates", err);
      // Fallback in case of total failure
      initData();
    }
  };

  const handleGeneratePlan = () => {
    // Lock guard: prevent regenerating if current plan is approved
    if (currentPlan?.status === 'APPROVED') {
      alert('This plan is approved and locked. Reject it first to regenerate.');
      return;
    }
    setGenerateRange({ startDate: getDefaultStartDate(), endDate: getDefaultEndDate() });
    setShowGenerateModal(true);
  };

  // Compute which months a date range covers (for UI display)
  const getMonthsInRange = (startDate: string, endDate: string): string[] => {
    if (!startDate || !endDate || startDate > endDate) return [];
    const months: string[] = [];
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59`);
    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    while (current <= end) {
      const label = current.toLocaleString('default', { month: 'long', year: 'numeric' });
      months.push(label);
      current.setMonth(current.getMonth() + 1);
    }
    return months;
  };

  const executeGeneratePlan = async () => {
    setShowGenerateModal(false);
    setLoading(true);
    setLoadingStartTime(Date.now());
    setLoadingPhase({ mode: 'generating', step: 0, message: 'Preparing generation engine...' });

    try {
      setLoadingPhase({ mode: 'generating', step: 1, message: 'Fetching demand orders & supply data...' });

      // Small delay so user sees the animation start
      await new Promise(r => setTimeout(r, 400));
      setLoadingPhase({ mode: 'generating', step: 2, message: 'Running allocation algorithm...' });

      const res = await fetch(`${API}/api/mps/generate-range`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderStartDate: generateRange.startDate,
          orderEndDate: generateRange.endDate,
          partType: partId || 'fillet'
        })
      });

      setLoadingPhase({ mode: 'generating', step: 3, message: 'Processing results...' });
      const data = await res.json();

      if (data.success) {
        const results = data.results || [];
        const successMonths = results.filter((r: any) => r.success).map((r: any) => r.targetMonth);
        const failedMonths = results.filter((r: any) => !r.success).map((r: any) => `${r.targetMonth}: ${r.message}`);
        let msg = `✅ Plans generated for: ${successMonths.join(', ')}`;
        if (failedMonths.length > 0) {
          msg += `\n\n⚠️ Skipped:\n${failedMonths.join('\n')}`;
        }
        setLoadingPhase({ mode: 'generating', step: 4, message: 'Plan generated! Reloading data...' });
        alert(msg);
      } else {
        alert(data.message || 'Failed to generate plans');
      }

      setLoadingPhase({ mode: 'loading', step: 3, message: 'Reloading plan data...' });
      await initData();
    } catch (e) {
      console.error("Failed to generate plan", e);
    } finally {
      setLoading(false);
    }
  };

  const handleImportWeekly = async () => {
    if (!currentPlan) return;
    if (currentPlan.status === 'APPROVED') {
      alert('Plan is locked.');
      return;
    }
    setLoading(true);
    setLoadingStartTime(Date.now());
    setLoadingPhase({ mode: 'importing', step: 1, message: 'Importing weekly size data...' });
    try {
      const res = await fetch(`${API}/api/mps/plans/${currentPlan.id}/import-weekly`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setLoadingPhase({ mode: 'importing', step: 2, message: `Imported ${data.count} records! Reloading...` });
        alert(`✅ Imported ${data.count} weekly size records.`);
        await initData(); // reload
      } else {
        alert(data.message || 'Failed to import weekly plan');
      }
    } catch (e) {
      console.error(e);
      alert('Error importing weekly plan');
    } finally {
      setLoading(false);
    }
  };

  // --- Calculations ---
  const calculateDailyMetrics = (date: string) => {
    if (!currentPlan) {
      return { intake: 0, intakeKg: 0, rmFlAvailable: 0, totalOrderQty: 0, manpower: 0, dailyOrders: [], manpowerBreakdown: {} as any };
    }

    const formatDBDate = (dateVal: any) => {
      return parseSafeDate(dateVal);
    };

    const dailySummary = currentPlan.dailySummaries?.find((d: any) => formatDBDate(d.productionDate) === date);
    let dailyOrdersRaw = currentPlan.orders?.filter((o: any) => formatDBDate(o.plannedProductionDate) === date) || [];
    if (partId === 'bil' || partId === 'bl') {
      dailyOrdersRaw = dailyOrdersRaw.filter((o: any) => allowedItemCodes.includes(o.itemCode));
    }

    const grouped = new Map();
    dailyOrdersRaw.forEach((o: any) => {
      const key = `${o.soNumber || 'NO_SO'}_${o.itemCode}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          id: String(o.id),
          ids: [String(o.id)],
          lineId: o.erpOrderLineId,
          soNumber: o.soNumber || '-',
          itemCode: o.itemCode,
          itemDesc: o.itemDesc,
          type: o.productType,
          qty: Number(o.quantityKg),
          shipDate: o.shipDate ? formatDBDate(o.shipDate) : '-'
        });
      } else {
        const existing = grouped.get(key);
        existing.ids.push(String(o.id));
        existing.id = existing.ids.join(',');
        existing.qty += Number(o.quantityKg);
      }
    });

    const dailyOrders = Array.from(grouped.values());

    const totalOrderQty = dailyOrders.filter((o: any) => isMainProductSpec(o.itemCode)).reduce((sum: number, o: any) => {
      const spec = specs[o.itemCode];
      const yieldPct = spec?.productYield && Number(spec.productYield) > 0 ? Number(spec.productYield) : 1;
      return sum + (o.qty / yieldPct);
    }, 0);

    const getCodesByProcess = (categoryName: string, processName: string) => {
      const catNodes = yieldTree.filter((n: any) => n.type === 'CATEGORY' && n.name === categoryName);
      const procNodes = yieldTree.filter((n: any) => n.type === 'PROCESS' && n.name === processName && catNodes.some((c: any) => c.id === n.parentId));

      const nodeIds: string[] = [];
      const collect = (parentId: string) => {
        const children = yieldTree.filter((n: any) => n.parentId === parentId);
        for (const child of children) {
          nodeIds.push(child.id);
          collect(child.id);
        }
      };

      procNodes.forEach((p: any) => {
        nodeIds.push(p.id);
        collect(p.id);
      });

      return Object.values(specs)
        .filter((s: any) => {
          if (!s.masterYieldIds) return false;
          const ids = s.masterYieldIds.split(',').map((id: string) => id.trim());
          return ids.some((id: string) => nodeIds.includes(id));
        })
        .map((s: any) => s.erpItemCode);
    };

    const dailyManpower = manpowerData.find((m: any) => formatDBDate(m.productionDate) === date) || {};

    const plannedStationWorkers = dailyManpower.plannedStationWorkers || 28;
    const actualStationWorkers = dailyManpower.actualStationWorkers || 0;
    const actualCuttingWorkers = dailyManpower.actualCuttingWorkers || 0;

    let totalManpowerPlan = 0;
    let requiredCuttingWorkers = 0;
    let deboneWorkers = 0;
    let xrayWorkers = 0;
    let p1CuttingStaff = 0;
    let separationCuttingStaff = 0;
    let trimmingWorkersBase = 0;
    let toridasWorkers = 0;
    let foodmateWorkers = 0;
    let fixedTrimmingWorkers = 0;
    let xrayMachinesCount = 0;

    let toridasLinesNeeded = 0;
    let foodmateLinesNeeded = 0;
    let trimmingLinesNeeded = 0;
    let shiftsNeeded = 0;
    // Machine config detail variables (populated inside BIL block)
    let mcToridasMachinesPerLine = 0;
    let mcFoodmateMachinesPerLine = 0;
    let mcToridasWorkersPerUnit = 0;
    let mcFoodmateWorkersPerUnit = 0;
    let mcTrimWorkersPerLine = 0;
    let mcXrayWorkersPerUnit = 0;
    let mcToridasYield = 0;
    let mcFoodmateYield = 0;

    const originalSupplyKg = dailySummary?.rmFlTotal || 0;
    const intakeBirds = dailySummary?.intakeBirds || 0;

    if (partId === 'bil') {
      const bilProcess1Codes = getCodesByProcess('BIL L/C', 'process: 1');
      const bilProcess2Codes = getCodesByProcess('BIL L/C', 'process: 2');

      let demandP1 = 0;
      let requiredP1WorkersHours = 0;
      let requiredP2ThighPcs = 0;
      let requiredP2DrumPcs = 0;
      let separationWorkers = 0;

      const bilPiecesTotal = intakeBirds * 2;
      const avgPieceWeight = bilPiecesTotal > 0 ? originalSupplyKg / bilPiecesTotal : 0.3;

      dailyOrders.forEach((o: any) => {
        if (isMainProductSpec(o.itemCode)) {
          if (bilProcess1Codes.includes(o.itemCode)) {
            demandP1 += o.qty;
            const spec = specs[o.itemCode];
            const speed = spec?.productSpeed ? Number(spec.productSpeed) : 45;
            requiredP1WorkersHours += o.qty / speed;
          } else if (bilProcess2Codes.includes(o.itemCode)) {
            const spec = specs[o.itemCode];
            const isDrum = spec && spec.erpItemDesc && spec.erpItemDesc.includes('น่อง') && !spec.erpItemDesc.includes('สะโพก');
            const yieldPct = spec?.productYield ? Number(spec.productYield) : 0.5;
            const speed = spec?.productSpeed ? Number(spec.productSpeed) : 45;
            const pcs = avgPieceWeight > 0 && yieldPct > 0 ? o.qty / (avgPieceWeight * yieldPct) : 0;

            if (isDrum) requiredP2DrumPcs += pcs;
            else requiredP2ThighPcs += pcs;

            separationWorkers += o.qty / speed;
          }
        }
      });

      let remainingPieces = bilPiecesTotal;

      // Priority 1: BIL
      const piecesForP1 = avgPieceWeight > 0 ? demandP1 / avgPieceWeight : 0;
      remainingPieces = Math.max(0, remainingPieces - piecesForP1);

      // Priority 2: Thigh + Drumstick
      const piecesToCutForP2 = Math.max(requiredP2ThighPcs, requiredP2DrumPcs);
      const actualPiecesCutP2 = Math.min(remainingPieces, piecesToCutForP2);
      remainingPieces = Math.max(0, remainingPieces - actualPiecesCutP2);

      p1CuttingStaff = Math.ceil(requiredP1WorkersHours / 9.58);
      separationCuttingStaff = Math.ceil(separationWorkers / 9.58);

      const getMachineConfig = (key: string, defaults: any) => {
        const conf = machineConfigs.find(c => c.machineKey === key);
        if (!conf) return defaults;
        return {
          speed: Number(conf.capacityPcsPerHour),
          yield: Number(conf.yieldPercentage),
          lines: Number(conf.defaultLines),
          machinesPerLine: Number(conf.machinesPerLine),
          workers: Number(conf.workersPerUnit)
        };
      };

      const toridasConf = getMachineConfig('toridas', { speed: 1500, yield: 0.75, lines: 3, machinesPerLine: 4, workers: 5 });
      const foodmateConf = getMachineConfig('foodmate', { speed: 6000, yield: 0.70, lines: 1, machinesPerLine: 1, workers: 5 });
      const trimConf = getMachineConfig('trimming_belt', { speed: 600, yield: 1.0, lines: 3, machinesPerLine: 1, workers: 7 });
      const xrayConf = getMachineConfig('xray', { speed: 6000, yield: 1.0, lines: 3, machinesPerLine: 1, workers: 5 });

      // Populate outer-scoped machine config vars for UI
      mcToridasMachinesPerLine = toridasConf.machinesPerLine;
      mcFoodmateMachinesPerLine = foodmateConf.machinesPerLine;
      mcToridasWorkersPerUnit = toridasConf.workers;
      mcFoodmateWorkersPerUnit = foodmateConf.workers;
      mcTrimWorkersPerLine = trimConf.workers;
      mcXrayWorkersPerUnit = xrayConf.workers;
      mcToridasYield = toridasConf.yield;
      mcFoodmateYield = foodmateConf.yield;

      const toridasCapPerShift = toridasConf.lines * toridasConf.machinesPerLine * toridasConf.speed * 9.58;
      const foodmateCapPerShift = foodmateConf.lines * foodmateConf.machinesPerLine * foodmateConf.speed * 9.58;
      const deboneCapPerShift = toridasCapPerShift + foodmateCapPerShift;

      shiftsNeeded = 0;
      if (remainingPieces > 0) {
        if (remainingPieces <= toridasCapPerShift) {
          shiftsNeeded = 1;
        } else if (remainingPieces <= toridasCapPerShift * 2) {
          shiftsNeeded = 2;
        } else {
          // If Toridas is full for 2 shifts and we still need more, calculate shifts based on total debone capacity
          // Usually max shifts per day is 2, but the math naturally handles overflow
          shiftsNeeded = Math.ceil(remainingPieces / deboneCapPerShift);
          if (shiftsNeeded < 2) shiftsNeeded = 2; // Ensure at least 2 shifts if we surpassed Toridas 2-shift cap
        }
      }

      const piecesPerShift = shiftsNeeded > 0 ? Math.ceil(remainingPieces / shiftsNeeded) : 0;

      const toridasInputPcsPerShift = Math.min(piecesPerShift, toridasCapPerShift);
      const leftoverPcsPerShift = Math.max(0, piecesPerShift - toridasInputPcsPerShift);
      const foodmateInputPcsPerShift = Math.min(leftoverPcsPerShift, foodmateCapPerShift);

      const totalPcsProcessedPerShift = toridasInputPcsPerShift + foodmateInputPcsPerShift;

      if (toridasInputPcsPerShift > 0) {
        const capacityPerToridasLine = toridasConf.machinesPerLine * toridasConf.speed * 9.58;
        toridasLinesNeeded = Math.ceil(toridasInputPcsPerShift / capacityPerToridasLine);
        toridasWorkers = toridasLinesNeeded * toridasConf.workers * shiftsNeeded;
      }

      if (foodmateInputPcsPerShift > 0) {
        const capacityPerFoodmateLine = foodmateConf.machinesPerLine * foodmateConf.speed * 9.58;
        foodmateLinesNeeded = Math.ceil(foodmateInputPcsPerShift / capacityPerFoodmateLine);
        foodmateWorkers = foodmateLinesNeeded * foodmateConf.workers * shiftsNeeded;
      }

      deboneWorkers = toridasWorkers + foodmateWorkers;

      const trimmingWorkHoursPerShift = totalPcsProcessedPerShift / trimConf.speed;
      trimmingWorkersBase = Math.ceil(trimmingWorkHoursPerShift / 9.58) * shiftsNeeded;

      trimmingLinesNeeded = Math.min(trimConf.lines, toridasLinesNeeded + foodmateLinesNeeded);
      fixedTrimmingWorkers = trimmingLinesNeeded * trimConf.workers * shiftsNeeded;

      requiredCuttingWorkers = p1CuttingStaff + separationCuttingStaff + trimmingWorkersBase;
      const totalTrimmingWorkers = trimmingWorkersBase + fixedTrimmingWorkers;

      const xrayCapPerShift = xrayConf.speed * 9.58;
      const machinesNeededPerShift = totalPcsProcessedPerShift > 0 ? Math.ceil(totalPcsProcessedPerShift / xrayCapPerShift) : 0;
      xrayMachinesCount = Math.min(xrayConf.lines, machinesNeededPerShift);
      xrayWorkers = xrayMachinesCount * xrayConf.workers * shiftsNeeded;

      totalManpowerPlan = deboneWorkers + totalTrimmingWorkers + xrayWorkers;
      requiredCuttingWorkers = p1CuttingStaff + separationCuttingStaff + trimmingWorkersBase;
    } else {
      dailyOrders.filter((o: any) => isMainProductSpec(o.itemCode)).forEach((o: any) => {
        const spec = specs[o.itemCode];
        const speed = spec?.productSpeed || 45;
        requiredCuttingWorkers += (o.qty / speed);
      });
      requiredCuttingWorkers = Math.ceil(requiredCuttingWorkers / 10);
      totalManpowerPlan = plannedStationWorkers + requiredCuttingWorkers;
    }

    let blTracker = null;
    if (dailySummary && dailySummary.blTrackerJson) {
      try {
        blTracker = JSON.parse(dailySummary.blTrackerJson);
      } catch (e) { }
    }

    const selectedSupply = currentPlan.supplyBreakdown?.find((s: any) => formatDBDate(s.productionDate) === date) || {};
    const getInternalSizeKg = (groupSize: string) => (selectedSupply.sizes || []).filter((sz: any) => sz.groupSize === groupSize).reduce((sum: number, sz: any) => sum + Number(sz.quantityKg || 0), 0);

    const extDaily = externalRmSupplies.find(s => String(s.receivedDate).startsWith(date));
    let extSizes: Record<string, number> = {};
    if (extDaily && extDaily.sizeBreakdownJson) {
      try { extSizes = JSON.parse(extDaily.sizeBreakdownJson); } catch (e) { }
    }
    const getExternalSizeKg = (groupSize: string) => extSizes[groupSize] || 0;

    const isBilType = currentPlan?.partType === 'bil' || currentPlan?.partType === 'bl' || currentPlan?.partType === 'leg';
    const allBilSizes = new Set((selectedSupply.sizes || []).map((s: any) => s.groupSize as string));
    Object.keys(extSizes).forEach(k => allBilSizes.add(k));

    const sizeNames: string[] = isBilType
      ? (Array.from(allBilSizes) as string[])
      : ['40 Down', '40-45', '45-50', '50-55', '55-60', '60-65', '65-70', '70 Up'];

    let estimatedNetOutput = sizeNames.reduce((sum: number, name: string) => sum + getInternalSizeKg(name) + getExternalSizeKg(name), 0);

    const sizeBreakdown: Record<string, number> = {};
    sizeNames.forEach(name => {
      const sizeKg = getInternalSizeKg(name) + getExternalSizeKg(name);
      sizeBreakdown[name] = sizeKg;
    });

    if (partId === 'bl') {
      const tConf = machineConfigs.find((c: any) => c.machineKey === 'toridas');
      let blYield = tConf && Number(tConf.yieldPercentage) > 0 ? Number(tConf.yieldPercentage) : 0.75;

      const defectFactor = 0.75; // Added defect factor as requested
      // Update the size breakdown with BL yield
      Object.keys(sizeBreakdown).forEach(k => {
        sizeBreakdown[k] = sizeBreakdown[k] * blYield * defectFactor;
      });
      estimatedNetOutput = estimatedNetOutput * blYield * defectFactor;
    }

    return {
      intake: dailySummary ? Number(dailySummary.intakeBirds) : 0,
      intakeKg: dailySummary ? Number(dailySummary.rmFlAvailKg) : 0,
      rmFlAvailable: estimatedNetOutput,
      sizeBreakdown,
      totalOrderQty: totalOrderQty,
      manpower: (partId === 'bil' || partId === 'bl') ? totalManpowerPlan : (dailyOrders.length > 0 ? totalManpowerPlan : 0),
      blTracker,
      manpowerBreakdown: {
        plannedStationWorkers: partId === 'bil' ? deboneWorkers + fixedTrimmingWorkers + xrayWorkers : plannedStationWorkers,
        plannedCuttingWorkers: requiredCuttingWorkers,
        actualStationWorkers,
        actualCuttingWorkers,
        isBil: partId === 'bil',
        deboneWorkers,
        xrayWorkers,
        trimmingBeltWorkers: trimmingWorkersBase + fixedTrimmingWorkers,
        p1CuttingStaff,
        separationCuttingStaff,
        trimmingWorkersBase,
        toridasWorkers,
        foodmateWorkers,
        fixedTrimmingWorkers,
        xrayMachinesCount,
        toridasLinesNeeded,
        foodmateLinesNeeded,
        trimmingLinesNeeded,
        shiftsNeeded,
        // Machine config details for UI display
        toridasMachinesPerLine: mcToridasMachinesPerLine,
        foodmateMachinesPerLine: mcFoodmateMachinesPerLine,
        toridasWorkersPerUnit: mcToridasWorkersPerUnit,
        foodmateWorkersPerUnit: mcFoodmateWorkersPerUnit,
        trimWorkersPerLine: mcTrimWorkersPerLine,
        xrayWorkersPerUnit: mcXrayWorkersPerUnit,
        toridasYield: mcToridasYield,
        foodmateYield: mcFoodmateYield,
        toridasTotalMachines: toridasLinesNeeded * mcToridasMachinesPerLine,
        foodmateTotalMachines: foodmateLinesNeeded * mcFoodmateMachinesPerLine,
      },
      dailyOrders,
      supplyBreakdown: currentPlan.supplyBreakdown?.find((s: any) => formatDBDate(s.productionDate) === date)
    };
  };

  // --- Calculate Summary Stats ---
  const totalIntakeBirds = currentPlan?.totalIntakeBirds || 0;
  const totalRmFlAvail = currentPlan?.totalRmFlKg || 0;
  const totalOrdersQty = currentPlan?.orders?.filter((o: any) => isMainProductSpec(o.itemCode)).reduce((sum: number, o: any) => sum + Number(o.quantityKg || 0), 0) || 0;

  // Calculate average manpower only for active days
  let totalManpowerSum = 0;
  let activeDaysCount = 0;
  days.forEach(d => {
    const metrics = calculateDailyMetrics(d);
    if (metrics.intake > 0 || metrics.totalOrderQty > 0) {
      totalManpowerSum += metrics.manpower;
      activeDaysCount++;
    }
  });
  const avgManpower = activeDaysCount > 0 ? Math.round(totalManpowerSum / activeDaysCount) : 0;

  // Calculate I-Cut utilization for BL Plan
  const icutTotalHours = currentPlan?.orders?.reduce((sum: number, o: any) => {
    const spec = specs[o.itemCode];
    if (spec && spec.icutSpeed && Number(spec.icutSpeed) > 0) {
      const yieldPct = spec.productYield && Number(spec.productYield) > 0 ? Number(spec.productYield) : 1;
      return sum + ((Number(o.quantityKg || 0) / yieldPct) / Number(spec.icutSpeed));
    }
    return sum;
  }, 0) || 0;
  const icutCapacity = 37; // 4 machines * 9.25 hrs
  const icutUtilization = icutCapacity > 0 ? (icutTotalHours / icutCapacity) * 100 : 0;
  const icutDisplayValue = partId === 'bl' ? `${icutTotalHours.toFixed(1)} / ${icutCapacity}` : avgManpower.toString();
  const icutDisplayUnit = partId === 'bl' ? `hrs (${icutUtilization.toFixed(1)}%)` : "People";

  // Calculate Monthly Totals for Grade B and other By-Products
  let totalGradeB = 0;
  const byProductTotals: Record<string, number> = {};

  if (currentPlan && currentPlan.supplyBreakdown) {
    currentPlan.supplyBreakdown.forEach((supply: any) => {
      // 1. Calculate Grade B
      const intakeKg = Number(supply.totalWeight || 0);
      const slaughtered = intakeKg * 0.9575 * 0.95;
      const rmFlTotal = slaughtered * 0.04;

      let dailyByProducts: Record<string, { name: string; qty: number; processName?: string; type?: string }> = {};
      if (supply.byProducts) {
        try {
          dailyByProducts = JSON.parse(supply.byProducts);
        } catch (e) {
          console.error('Error parsing daily byProducts', e);
        }
      }

      const yieldTreeGradeB = Object.values(dailyByProducts)
        .filter((bp: any) => bp.name && (bp.name === 'สันในเกรด B' || bp.name.includes('เกรด B') || bp.name.toLowerCase().includes('grade b')))
        .reduce((sum: number, bp: any) => sum + Number(bp.qty || 0), 0);

      const rmFlGradeB = yieldTreeGradeB > 0 ? yieldTreeGradeB : rmFlTotal * 0.093;
      totalGradeB += rmFlGradeB;

      // 2. Aggregate other by-products
      Object.values(dailyByProducts).forEach((bp: any) => {
        if (!bp.name) return; // skip entries without name (e.g. BL format { kg, sizes })
        const isGb = bp.name === 'สันในเกรด B' || bp.name.includes('เกรด B') || bp.name.toLowerCase().includes('grade b');
        if (isGb) return; // skip Grade B

        const name = bp.name.trim();
        byProductTotals[name] = (byProductTotals[name] || 0) + Number(bp.qty || 0);
      });
    });
  }

  // --- Derived State for Demand Plan Tab ---
  const processedDemand = demandOrders.reduce((acc: any[], header: any) => {
    if (!header.lines) return acc;

    const plannedOrders = currentPlan?.orders || [];

    const filteredLines = header.lines.filter((line: any) => {
      if (!line.erpOrderShipDate) return false;
      // if (!specs[line.erpOrderItemCode]) return false;
      // Filter by allowed item codes from Master Yield Tree
      if (allowedItemCodes.length > 0 && !allowedItemCodes.includes(line.erpOrderItemCode)) return false;

      const shipDate = new Date(line.erpOrderShipDate);

      const monthDiff = (shipDate.getFullYear() - currentMonth.getFullYear()) * 12 +
        (shipDate.getMonth() - currentMonth.getMonth());

      // Show orders shipping in the current month, plus up to 2 months ahead 
      // (to account for maxProductLead times like 30-60 days)
      const isUpcomingShipment = monthDiff >= 0 && monthDiff <= 2;

      const hasPlannedProductionThisMonth = plannedOrders.some((o: any) => o.erpOrderLineId === line.erpOrderLineId);

      return isUpcomingShipment || hasPlannedProductionThisMonth;
    });

    if (filteredLines.length > 0) {
      const linesWithStatus = filteredLines.map((line: any) => {
        const planned = plannedOrders.filter((o: any) => o.erpOrderLineId === line.erpOrderLineId);
        // Use totalAllocatedQty from backend which includes all plans, but fallback to current plan if not provided
        const totalPlanned = line.totalAllocatedQty !== undefined ? Number(line.totalAllocatedQty) : planned.reduce((s: number, o: any) => s + Number(o.quantityKg || 0), 0);
        const qty = Number(line.erpOrderItemQty || 0);
        const isFull = totalPlanned >= qty * 0.99;
        const isNotPlanned = totalPlanned === 0;
        return { ...line, totalPlanned, isFull, isNotPlanned, planned };
      });

      const plannedLines = linesWithStatus.filter((l: any) => !l.isNotPlanned);
      const unfulfilledLines = linesWithStatus.filter((l: any) => !l.isFull);

      acc.push({ ...header, plannedLines, unfulfilledLines });
    }
    return acc;
  }, []);

  const section1Planned = processedDemand
    .filter((h: any) => h.plannedLines.length > 0)
    .sort((a: any, b: any) => {
      const aCompleteCount = a.plannedLines.filter((l: any) => l.isFull).length;
      const bCompleteCount = b.plannedLines.filter((l: any) => l.isFull).length;
      const aTotal = a.plannedLines.length;
      const bTotal = b.plannedLines.length;

      // Sort by completion ratio
      return (bCompleteCount / bTotal) - (aCompleteCount / aTotal);
    });

  const section2Unfulfilled = processedDemand
    .filter((h: any) => h.unfulfilledLines.length > 0);

  // --- Loading Phase Steps Config ---
  const LOADING_STEPS = {
    loading: [
      { icon: Database, label: 'Connecting to server' },
      { icon: Package, label: 'Loading specs & orders' },
      { icon: FileText, label: 'Loading plan drafts' },
      { icon: BarChart3, label: 'Loading supply data' },
      { icon: CheckCircle2, label: 'Complete' },
    ],
    generating: [
      { icon: Cpu, label: 'Preparing engine' },
      { icon: Database, label: 'Fetching demand & supply' },
      { icon: Zap, label: 'Running allocation' },
      { icon: Layers, label: 'Processing results' },
      { icon: CheckCircle2, label: 'Done!' },
    ],
    importing: [
      { icon: Database, label: 'Connecting' },
      { icon: Download, label: 'Importing weekly data' },
      { icon: CheckCircle2, label: 'Complete' },
    ],
  };

  return (
    <div className="p-6 max-w-full mx-auto space-y-6 bg-gray-50 min-h-screen">
      {/* ═══ PREMIUM LOADING OVERLAY ═══ */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center"
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900/70 via-slate-800/60 to-orange-900/40 backdrop-blur-md" />

            {/* Animated background particles */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {[...Array(6)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute rounded-full bg-orange-400/10"
                  style={{
                    width: 80 + i * 40,
                    height: 80 + i * 40,
                    left: `${10 + i * 15}%`,
                    top: `${20 + (i % 3) * 25}%`,
                  }}
                  animate={{
                    y: [0, -30, 0],
                    x: [0, 15, 0],
                    scale: [1, 1.1, 1],
                    opacity: [0.3, 0.6, 0.3],
                  }}
                  transition={{
                    duration: 3 + i * 0.5,
                    repeat: Infinity,
                    ease: 'easeInOut',
                    delay: i * 0.3,
                  }}
                />
              ))}
            </div>

            {/* Main loading card */}
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/40 w-full max-w-md mx-4 overflow-hidden"
            >
              {/* Top gradient bar - animated */}
              <div className="h-1.5 w-full bg-gray-100 overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-orange-400 via-red-500 to-orange-400"
                  initial={{ width: '0%' }}
                  animate={{
                    width: `${Math.min(((loadingPhase.step + 1) / (LOADING_STEPS[loadingPhase.mode]?.length || 5)) * 100, 100)}%`,
                  }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>

              <div className="p-8">
                {/* Header */}
                <div className="flex items-center gap-4 mb-7">
                  <div className="relative">
                    <motion.div
                      className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shadow-lg shadow-orange-300/50"
                      animate={{ rotate: [0, 5, -5, 0] }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      {loadingPhase.mode === 'generating' ? (
                        <Zap className="w-7 h-7 text-white" />
                      ) : loadingPhase.mode === 'importing' ? (
                        <Download className="w-7 h-7 text-white" />
                      ) : (
                        <Calendar className="w-7 h-7 text-white" />
                      )}
                    </motion.div>
                    {/* Pulse ring */}
                    <motion.div
                      className="absolute inset-0 rounded-2xl border-2 border-orange-400"
                      animate={{ scale: [1, 1.3, 1.3], opacity: [0.6, 0, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
                    />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-black text-gray-900">
                      {loadingPhase.mode === 'generating' ? 'Generating MPS Plan' : loadingPhase.mode === 'importing' ? 'Importing Weekly Data' : 'Loading MPS Data'}
                    </h3>
                    <p className="text-xs text-gray-400 font-medium mt-0.5">
                      {pc.title} • {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </p>
                  </div>
                  {/* Timer */}
                  <div className="text-right">
                    <motion.span
                      className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-red-500 tabular-nums"
                      key={elapsedTime}
                      initial={{ y: -5, opacity: 0.5 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      {elapsedTime}s
                    </motion.span>
                    <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">elapsed</p>
                  </div>
                </div>

                {/* Step indicators */}
                <div className="space-y-2.5 mb-6">
                  {(LOADING_STEPS[loadingPhase.mode] || LOADING_STEPS.loading).map((step, i) => {
                    const StepIcon = step.icon;
                    const isComplete = i < loadingPhase.step;
                    const isCurrent = i === loadingPhase.step;

                    return (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.08, duration: 0.3 }}
                        className={`flex items-center gap-3 py-2 px-3 rounded-xl transition-all duration-300 ${isCurrent ? 'bg-orange-50 border border-orange-200 shadow-sm' :
                          isComplete ? 'bg-emerald-50/50' : 'opacity-40'
                          }`}
                      >
                        {/* Step circle */}
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300 ${isComplete ? 'bg-emerald-500 shadow-md shadow-emerald-200' :
                          isCurrent ? 'bg-gradient-to-br from-orange-500 to-red-500 shadow-md shadow-orange-200' :
                            'bg-gray-200'
                          }`}>
                          {isComplete ? (
                            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 15 }}>
                              <CheckCircle2 className="w-4 h-4 text-white" />
                            </motion.div>
                          ) : isCurrent ? (
                            <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
                              <StepIcon className="w-4 h-4 text-white" />
                            </motion.div>
                          ) : (
                            <StepIcon className="w-4 h-4 text-gray-400" />
                          )}
                        </div>

                        {/* Step label */}
                        <span className={`text-sm font-semibold transition-colors duration-300 ${isComplete ? 'text-emerald-700' :
                          isCurrent ? 'text-orange-700' : 'text-gray-400'
                          }`}>
                          {step.label}
                        </span>

                        {/* Active dot */}
                        {isCurrent && (
                          <motion.div
                            className="ml-auto flex gap-1"
                            animate={{ opacity: [1, 0.3, 1] }}
                            transition={{ duration: 1.2, repeat: Infinity }}
                          >
                            <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                            <div className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                            <div className="w-1.5 h-1.5 rounded-full bg-orange-300" />
                          </motion.div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>

                {/* Current message */}
                <div className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                  <div className="flex items-center gap-2">
                    <motion.div
                      animate={{ opacity: [1, 0.4, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0"
                    />
                    <motion.p
                      key={loadingPhase.message}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-xs font-medium text-gray-600 truncate"
                    >
                      {loadingPhase.message}
                    </motion.p>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Header */}
      <div className="flex justify-between items-end bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="relative">
          <div className="absolute -top-10 -left-10 w-40 h-40 bg-orange-200/20 blur-3xl rounded-full"></div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight flex items-center gap-4 relative z-10">
            <div className="p-3 bg-orange-500 rounded-2xl shadow-lg shadow-orange-200">
              <Calendar className="w-8 h-8 text-white" />
            </div>
            <span>Master Production Schedule <span className="text-orange-500">({pc.title} MPS)</span></span>
          </h1>
          <p className="text-slate-500 mt-3 text-lg font-medium">Monthly Strategic Planning & Yield Optimization Engine</p>
        </div>
        <div className="flex gap-3">
          {currentPlan && (
            <button disabled={loading || currentPlan?.status === 'APPROVED'} onClick={handleImportWeekly} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white shadow-md transition-all ${loading || currentPlan?.status === 'APPROVED' ? 'bg-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 shadow-blue-200'}`}>
              <Download className={`w-4 h-4 ${loading ? 'animate-pulse' : ''}`} />
              Import Week Plan
            </button>
          )}
          <button disabled={loading || currentPlan?.status === 'APPROVED'} onClick={handleGeneratePlan} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white shadow-md transition-all ${loading || currentPlan?.status === 'APPROVED' ? 'bg-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 shadow-orange-200'}`}>
            <Activity className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {currentPlan?.status === 'APPROVED' ? '🔒 Plan Locked' : loading ? 'Generating...' : 'Generate & Save Plan'}
          </button>
          <button onClick={handleClearMonth} className="flex items-center gap-2 px-4 py-2 bg-white border border-red-200 hover:bg-red-50 text-red-600 rounded-xl text-sm font-medium shadow-sm transition-all">
            <Trash2 className="w-4 h-4" /> Clear Month
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl text-sm font-medium text-gray-700 shadow-sm transition-all">
            <Filter className="w-4 h-4" /> Filter
          </button>
          <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
              className="p-1.5 hover:bg-white rounded-lg transition-colors text-gray-600">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="px-4 text-sm font-bold text-gray-800">
              {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </span>
            <button
              onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
              className="p-1.5 hover:bg-white rounded-lg transition-colors text-gray-600">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-1 inline-flex w-full sm:w-auto overflow-x-auto">
        <button
          onClick={() => setActiveTab('calendar')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${activeTab === 'calendar'
            ? 'bg-orange-50 text-orange-600 shadow-sm'
            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
        >
          <CalendarDays size={16} />
          Calendar View
        </button>
        <button
          onClick={() => setActiveTab('drafts')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${activeTab === 'drafts'
            ? 'bg-orange-50 text-orange-600 shadow-sm'
            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
        >
          <FileText size={16} />
          Plan Drafts
          {plans.length > 0 && (
            <span className="bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full text-xs font-bold">{plans.length}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('demand')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${activeTab === 'demand'
            ? 'bg-orange-50 text-orange-600 shadow-sm'
            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
        >
          <ShoppingCart size={16} />
          Demand Plan
          {processedDemand.length > 0 && (
            <span className="bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full text-xs font-bold">{processedDemand.reduce((sum: number, h: any) => sum + (h.plannedLines.length + h.unfulfilledLines.length), 0)}</span>
          )}
        </button>
      </div>

      {activeTab === 'calendar' ? (
        <>
          {currentPlan ? (
            <>
              {/* Overview Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <StatCard label="Total Monthly Intake" value={totalIntakeBirds.toLocaleString()} unit="Birds" icon={Activity} color="blue" />
                <StatCard label="Total Orders" value={totalOrdersQty.toLocaleString()} unit="kg" icon={Package} color="orange" />
                <StatCard label="Estimated Total Yield" value={Math.round(totalRmFlAvail).toLocaleString()} unit="kg" icon={Scale} color="green" />
                <StatCard
                  label={partId === 'bl' ? "I-CUT Utilization (Total)" : "Avg. Daily Manpower"}
                  value={icutDisplayValue}
                  unit={icutDisplayUnit}
                  icon={partId === 'bl' ? Zap : Users}
                  color={partId === 'bl' ? (icutUtilization > 100 ? "red" : "purple") : "purple"}
                />
              </div>

              {/* Monthly Grade B & By-Products Summary Box */}
              <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-4 mt-2">
                <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                  <Scale className="text-orange-600 w-5 h-5" />
                  <h3 className="font-bold text-gray-900 text-sm">สรุปยอดผลผลิตพลอยได้ประจำเดือน (Monthly Grade B & By-Products)</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100 flex flex-col justify-between">
                    <span className="text-xs font-bold text-orange-700 uppercase">Total RM Fillet Grade B</span>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-xl font-black text-orange-950">{Math.round(totalGradeB).toLocaleString()}</span>
                      <span className="text-xs font-bold text-orange-600">kg</span>
                    </div>
                  </div>
                  {Object.entries(byProductTotals)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, qty]) => (
                      <div key={name} className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col justify-between">
                        <span className="text-xs font-bold text-slate-600 uppercase truncate" title={name}>{name}</span>
                        <div className="flex items-baseline gap-1 mt-1">
                          <span className="text-xl font-black text-slate-800">{Math.round(qty).toLocaleString()}</span>
                          <span className="text-xs font-bold text-slate-500">kg</span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center text-orange-600">
                    <FileSpreadsheet size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">{currentPlan.planName}</h3>
                    <p className="text-xs text-gray-500">Plan Status: <span className={`font-bold ${currentPlan.status === 'APPROVED' ? 'text-emerald-600' : 'text-amber-600'}`}>{currentPlan.status}</span></p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExportExcel(currentPlan.id)}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm shadow-emerald-200"
                  >
                    <Download size={16} />
                    Export MPS Report (Excel)
                  </button>
                  {currentPlan.status === 'DRAFT' && (
                    <button
                      onClick={() => handleApprovePlan(currentPlan.id)}
                      className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm shadow-orange-200"
                    >
                      <CheckCircle2 size={16} />
                      Approve & Lock Plan
                    </button>
                  )}
                </div>
              </div>

              {currentPlan?.status === 'APPROVED' && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl p-4 shadow-sm flex items-center gap-3">
                  <Lock className="text-emerald-500 flex-shrink-0" />
                  <div>
                    <h4 className="font-bold">Plan Approved & Locked</h4>
                    <p className="text-sm opacity-80">This plan has been approved. Orders cannot be moved or modified. To make changes, reject the plan first from the Plan Drafts tab.</p>
                  </div>
                </div>
              )}

              {/* Exceptions Alert */}
              {currentPlan.exceptions && currentPlan.exceptions.length > 0 && (
                <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-4 shadow-sm flex items-start gap-3">
                  <Activity className="text-red-500 mt-1 flex-shrink-0" />
                  <div>
                    <h4 className="font-bold">Unfulfilled Exceptions Detected</h4>
                    <p className="text-sm opacity-80 mb-2">There are {currentPlan.exceptions.length} items that could not be scheduled due to insufficient supply.</p>
                    <div className="max-h-32 overflow-y-auto text-xs bg-white rounded-lg border border-red-100 p-2 shadow-inner">
                      {currentPlan.exceptions.map((e: any) => (
                        <div key={e.id} className="py-1 border-b border-red-50 last:border-0 flex gap-4">
                          <span className="font-bold w-20 truncate">{e.itemCode}</span>
                          <span>{e.reason}</span>
                          <span className="font-bold text-red-600 w-20 text-right">Short: {Math.round(e.shortageKg)}kg</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Calendar Grid */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                {/* Days of Week Header */}
                <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">
                      {day}
                    </div>
                  ))}
                </div>

                {/* Days Grid */}
                <div className="grid grid-cols-7 auto-rows-fr">
                  {/* Empty slots for first week */}
                  {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                    <div key={`empty-${i}`} className="min-h-[160px] border-r border-b border-gray-100 bg-gray-50/50"></div>
                  ))}

                  {/* Actual Days */}
                  {days.map((date, i) => {
                    const metrics = calculateDailyMetrics(date);
                    const dayNum = i + 1;
                    const todayDateStr = getTodayStr();
                    const isToday = date === todayDateStr;
                    const hasWeekly = weeklyDates.has(date);

                    return (
                      <div
                        key={date}
                        onDragOver={handleDragOver}
                        onDrop={(e) => {
                          if(currentPlan?.lockedDays?.includes(date)) {
                             alert('This day is locked.');
                             return;
                          }
                          handleDrop(e, date);
                        }}
                        className={`min-h-[180px] border-r border-b border-gray-100 p-2 flex flex-col gap-2 transition-colors
                      ${isToday ? 'bg-orange-50/30' : (Math.round(metrics.rmFlAvailable - metrics.totalOrderQty) !== 0 ? 'bg-red-100' : 'bg-white hover:bg-gray-50')}
                      ${metrics.supplyBreakdown ? 'cursor-pointer hover:shadow-md' : ''}
                    `}
                        onClick={() => {
                          if (metrics.supplyBreakdown) {
                            setSelectedSupply(metrics.supplyBreakdown);
                            setSelectedManpower(metrics.manpowerBreakdown);
                            setSelectedDate(date);
                            setSelectedDailyOrders(metrics.dailyOrders || []);
                            setExpandedSizeBins({});
                            setShowSupplyModal(true);
                          }
                        }}
                      >
                        {/* Day Header */}
                        <div className="flex justify-between items-start mb-1">
                          <div className="flex items-center gap-2">
                            <span className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-bold ${isToday ? 'bg-orange-500 text-white shadow-md' : 'text-gray-700'}`}>
                              {dayNum}
                            </span>
                            {currentPlan?.status === 'DRAFT' && (
                               <button 
                                  onClick={(e) => handleToggleLock(date, e)} 
                                  title={currentPlan?.lockedDays?.includes(date) ? 'Unlock this day' : 'Lock this day'}
                                  className={`ml-1 p-1 rounded-full transition-colors ${currentPlan?.lockedDays?.includes(date) ? 'bg-red-100 text-red-600 shadow-sm' : 'text-gray-300 hover:bg-gray-100 hover:text-gray-600'}`}
                               >
                                  {currentPlan?.lockedDays?.includes(date) ? <Lock size={12}/> : <Unlock size={12}/>}
                               </button>
                            )}
                            {hasWeekly && (
                              <span className="bg-blue-100 text-blue-700 text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider shadow-sm border border-blue-200">
                                Week
                              </span>
                            )}
                          </div>
                          {(metrics.intake > 0 || metrics.rmFlAvailable > 0) && (
                            <div className="flex flex-col items-end gap-1">
                              {metrics.intake > 0 && (
                                <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                                  🐔 {metrics.intake.toLocaleString()}
                                </span>
                              )}
                              {(metrics.rmFlAvailable > 0 || metrics.totalOrderQty > 0) && (
                                <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase ${Math.round(metrics.rmFlAvailable - metrics.totalOrderQty) !== 0 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                  {Math.round(metrics.rmFlAvailable - metrics.totalOrderQty) < 0 ? <AlertTriangle size={10} /> : (Math.round(metrics.rmFlAvailable - metrics.totalOrderQty) > 0 ? <Info size={10} /> : <CheckCircle2 size={10} />)}
                                  {Math.abs(Math.round(metrics.rmFlAvailable - metrics.totalOrderQty)).toLocaleString()}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Metrics Summary (if activity exists) */}
                        {(metrics.intake > 0 || metrics.rmFlAvailable > 0 || metrics.totalOrderQty > 0) && (
                          <div className="bg-slate-50/50 backdrop-blur-sm rounded-xl p-2.5 text-[10px] space-y-2 border border-slate-100 shadow-sm">
                            <div className="flex justify-between items-center group relative">
                              <span className="text-slate-500 font-bold uppercase tracking-tighter cursor-help border-b border-dashed border-slate-300">RM Available</span>

                              {/* Tooltip for Size Breakdown */}
                              {metrics.sizeBreakdown && Object.keys(metrics.sizeBreakdown).length > 0 && (
                                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-48 bg-gray-900 text-white text-[10px] rounded-lg shadow-xl z-50 p-2 pointer-events-none">
                                  <div className="font-bold text-gray-300 mb-1 border-b border-gray-700 pb-1">Size Breakdown</div>
                                  <div className="max-h-32 overflow-y-auto pr-1">
                                    {Object.entries(metrics.sizeBreakdown)
                                      .filter(([_, val]) => Number(val) > 0)
                                      .sort(([k1], [k2]) => k1.localeCompare(k2))
                                      .map(([sizeName, val]) => (
                                        <div key={sizeName} className="flex justify-between items-center py-0.5">
                                          <span className="text-gray-400">{sizeName}:</span>
                                          <span className="font-mono">{Math.round(Number(val)).toLocaleString()}</span>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              )}

                              <span className="font-black text-slate-800 bg-white px-1.5 py-0.5 rounded shadow-sm relative z-10">
                                {Math.round(metrics.rmFlAvailable).toLocaleString()} <span className="opacity-50">kg</span>
                              </span>
                            </div>

                            {/* RM Size Progress Indicators */}
                            {metrics.supplyBreakdown && (
                              <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden flex gap-0.5">
                                {(() => {
                                  const s = metrics.supplyBreakdown;
                                  const getSz = (g: string) => (s.sizes || []).filter((sz: any) => sz.groupSize === g).reduce((sum: number, sz: any) => sum + Number(sz.quantityKg || 0), 0);
                                  const total = getSz('40 Down') + getSz('40-45') + getSz('45-50') +
                                    getSz('50-55') + getSz('55-60') + getSz('60-65') +
                                    getSz('65-70') + getSz('70 Up');
                                  if (total === 0) return null;

                                  const sizes = [
                                    { val: getSz('40 Down'), color: 'bg-slate-400' },
                                    { val: getSz('40-45'), color: 'bg-blue-400' },
                                    { val: getSz('45-50'), color: 'bg-cyan-400' },
                                    { val: getSz('50-55') + getSz('55-60'), color: 'bg-emerald-400' },
                                    { val: getSz('60-65') + getSz('65-70') + getSz('70 Up'), color: 'bg-red-400' },
                                  ];

                                  return sizes.map((item, i) => (
                                    <div key={i} style={{ width: `${(Number(item.val || 0) / total) * 100}%` }} className={`h-full ${item.color}`}></div>
                                  ));
                                })()}
                              </div>
                            )}

                            <div className="flex justify-between items-center">
                              <span className="text-slate-500 font-bold uppercase tracking-tighter">Demand Plan</span>
                              <span className={`font-black px-1.5 py-0.5 rounded shadow-sm ${Math.round(metrics.totalOrderQty) > Math.round(metrics.rmFlAvailable) ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                                {Math.round(metrics.totalOrderQty).toLocaleString()} <span className="opacity-50">kg</span>
                              </span>
                            </div>

                            <div className="flex justify-between items-center pt-1 mt-1 border-t border-slate-200/50">
                              <span className="text-slate-400 font-bold uppercase tracking-tighter text-[9px]">RM Balance</span>
                              <span className={`font-black px-1.5 py-0.5 rounded shadow-sm ${Math.round(metrics.rmFlAvailable - metrics.totalOrderQty) !== 0 ? 'bg-red-500 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
                                {(Math.round(metrics.rmFlAvailable - metrics.totalOrderQty) + 0).toLocaleString()} <span className="opacity-50">kg</span>
                              </span>
                            </div>
                            <div className="flex justify-between items-center pt-1.5 border-t border-slate-200/50">
                              <span className="text-indigo-500 font-bold uppercase tracking-tighter">Allocated Staff</span>
                              <span className="font-black text-indigo-700">{metrics.manpower} <span className="opacity-50 text-[8px]">PAX</span></span>
                            </div>
                          </div>
                        )}

                        <div className="flex-1 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
                          {Object.values(metrics.dailyOrders.reduce((acc: any, order: any) => {
                            const key = `${order.itemCode}_${order.type}`;
                            if (!acc[key]) {
                              acc[key] = { ...order, qty: 0, soNumbers: new Set(), shipDates: new Set(), groupedOrders: [] };
                            }
                            acc[key].qty += Number(order.qty || 0);
                            acc[key].soNumbers.add(order.soNumber);
                            acc[key].shipDates.add(order.shipDate);
                            acc[key].groupedOrders.push(order);
                            return acc;
                          }, {}))
                            .filter((order: any) => Math.round(order.qty) > 0)
                            .map((order: any, idx: number) => {
                            const soList = Array.from(order.soNumbers);
                            const shipList = Array.from(order.shipDates);
                            const soDisplay = soList.length > 1 ? 'Multiple' : soList[0];
                            const shipDisplay = shipList.length > 1 ? 'Multiple' : shipList[0];
                            const isHighlighted = highlightedSoNumber && soList.includes(highlightedSoNumber);

                            return (
                              <motion.div
                                layoutId={`grouped_${order.itemCode}_${order.type}_${dayNum}`}
                                draggable={currentPlan?.status !== 'APPROVED'}
                                onDragStart={currentPlan?.status !== 'APPROVED' && !currentPlan?.lockedDays?.includes(date) ? (e: any) => handleDragStart(e, { sourceDate: date, itemCode: order.itemCode, itemDesc: order.itemDesc, orders: order.groupedOrders }) : undefined}
                                onClick={() => setHighlightedSoNumber(isHighlighted ? null : (soList[0] as string))}
                                key={`grouped_${order.itemCode}_${order.type}_${idx}`}
                                className={`p-2 rounded-lg text-xs border shadow-sm transition-all
                              ${currentPlan?.status === 'APPROVED' ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}
                              ${order.type === 'chilled' ? 'bg-orange-50 border-orange-200' : 'bg-cyan-50 border-cyan-200'}
                              ${highlightedSoNumber && !isHighlighted ? 'opacity-40 grayscale-[50%]' : ''}
                              ${isHighlighted ? 'ring-2 ring-orange-500 shadow-orange-500/50 shadow-lg scale-[1.02] z-10' : ''}
                            `}
                              >
                                <div className="flex justify-between font-bold mb-1">
                                  <span className="truncate pr-2 text-gray-800" title={order.itemDesc}>{order.itemDesc}</span>
                                  <Move className="w-3 h-3 text-gray-400 opacity-50" />
                                </div>
                                <div className="flex justify-between items-center mb-0.5">
                                  <span className="text-[9px] font-bold text-gray-500 uppercase">SO: <span className="text-gray-800" title={soList.join(', ')}>{soDisplay as string}</span></span>
                                  <span className="text-[9px] font-bold text-gray-500 uppercase">Ship: <span className="text-gray-800" title={shipList.join(', ')}>{shipDisplay as string}</span></span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-gray-500 font-medium">{order.itemCode}</span>
                                  <span className={`font-bold ${order.type === 'chilled' ? 'text-orange-700' : 'text-cyan-700'}`}>
                                    {Math.round(order.qty).toLocaleString()}kg
                                  </span>
                                </div>
                              </motion.div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center min-h-[400px] flex flex-col items-center justify-center">
              <CalendarDays size={48} className="text-gray-300 mb-4" />
              <h3 className="text-xl font-bold text-gray-800 mb-2">No Plan Generated</h3>
              <p className="text-gray-500 mb-6">There is no production plan generated for {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })} yet.</p>
              <button onClick={handleGeneratePlan} className="px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl shadow-md transition-colors">
                Generate Plan Now
              </button>
            </div>
          )}
        </>
      ) : activeTab === 'drafts' ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 min-h-[500px]">
          <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
            <FileText className="text-orange-500" />
            Generated Plans & Drafts
          </h2>
          {plans.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <FileText size={48} className="mx-auto mb-4 opacity-30" />
              <p>No plans generated yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 border-b">ID</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 border-b">Plan Name</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 border-b">Target Month</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 border-b">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 border-b">Created</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600 border-b">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map(p => (
                    <tr key={p.id} className={`hover:bg-gray-50 transition-colors border-b last:border-0 ${p.status === 'APPROVED' ? 'bg-emerald-50/30' : ''}`}>
                      <td className="px-4 py-3 font-mono text-gray-500">{p.id}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800">{p.planName}</td>
                      <td className="px-4 py-3 text-gray-600">{p.targetMonth}</td>
                      <td className="px-4 py-3">
                        {p.status === 'APPROVED' ? (
                          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-xs font-bold inline-flex items-center gap-1">
                            <ShieldCheck size={12} />
                            APPROVED
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-md text-xs font-bold">
                            {p.status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          {p.status === 'DRAFT' ? (
                            <>
                              <button
                                onClick={() => handleApprovePlan(p.id)}
                                className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                title="Approve Plan"
                              >
                                <CheckCircle2 size={16} />
                              </button>
                              <button
                                onClick={() => handleExportExcel(p.id)}
                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Export to Excel"
                              >
                                <Download size={16} />
                              </button>
                              <button
                                onClick={() => handleDeletePlan(p.id)}
                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete Plan"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          ) : p.status === 'APPROVED' ? (
                            <div className="flex items-center gap-1 justify-end">
                              <button
                                onClick={() => handleExportExcel(p.id)}
                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Export to Excel"
                              >
                                <Download size={16} />
                              </button>
                              <button
                                onClick={() => handleRejectPlan(p.id)}
                                className="px-3 py-1.5 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors inline-flex items-center gap-1"
                                title="Reject Plan (revert to DRAFT)"
                              >
                                <Unlock size={12} />
                                Reject
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleDeletePlan(p.id)}
                              className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              title="Delete Plan"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Priority Changed Banner */}
          {priorityDirty && (
            <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-full">
                  <Activity className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h4 className="font-bold text-amber-900">Priority Modified</h4>
                  <p className="text-sm text-amber-700">Order priorities have been changed. Save and Re-Generate the plan to apply.</p>
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={cancelPriorities}
                  className="px-4 py-2 text-sm font-bold text-gray-600 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-all shadow-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={savePriorities}
                  disabled={savingPriority}
                  className="px-4 py-2 text-sm font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl hover:from-amber-600 hover:to-orange-600 transition-all shadow-md disabled:opacity-50"
                >
                  {savingPriority ? 'Saving...' : 'Save & Re-Generate'}
                </button>
              </div>
            </div>
          )}

          {/* Section 1: Planned Demand Orders */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <ShoppingCart className="text-orange-500" />
                Planned Demand (Sales Orders)
              </h2>
              <div className="flex items-center gap-4">
                <div className="text-sm text-gray-500">
                  Showing planned demands for: <span className="font-bold text-gray-800">{currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
                </div>
                <div className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold border border-emerald-200">
                  {section1Planned.reduce((sum: number, h: any) => sum + h.plannedLines.length, 0)} Lines
                </div>
              </div>
            </div>

            {section1Planned.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <ShoppingCart size={48} className="mx-auto mb-4 opacity-30" />
                <p>No planned demand orders found for this month.</p>
              </div>
            ) : (
              <div className="space-y-5">
                {section1Planned.map((header: any) => (
                  <div key={header.erpOrderHeaderId} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                    {/* SO Header */}
                    <div className="bg-gradient-to-r from-gray-50 to-slate-50 px-4 py-3 border-b border-gray-200 flex flex-wrap gap-4 items-center justify-between">
                      <div className="flex gap-6 items-center">
                        <div className="w-44">
                          <span className="text-[10px] text-gray-400 uppercase font-bold block tracking-wider">SO Number</span>
                          <span className="font-black text-gray-900 text-lg">{header.erpOrderNumber || header.erpOrderHeaderId}</span>
                        </div>
                        <div className="h-8 w-px bg-gray-200" />
                        <div className="w-80">
                          <span className="text-[10px] text-gray-400 uppercase font-bold block tracking-wider">Customer</span>
                          <span className="font-semibold text-gray-700 truncate block" title={header.erpCustomerName}>{header.erpCustomerName || '-'}</span>
                        </div>
                        {header.erpCustomerGrade && (
                          <>
                            <div className="h-8 w-px bg-gray-200" />
                            <div>
                              <span className="text-[10px] text-gray-400 uppercase font-bold block tracking-wider">Grade</span>
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${header.erpCustomerGrade === 'A' ? 'bg-emerald-100 text-emerald-700' : header.erpCustomerGrade === 'B' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                {header.erpCustomerGrade}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                      <div className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-xs font-bold">
                        {header.plannedLines.length} Lines
                      </div>
                    </div>

                    {/* SO Lines */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-white">
                          <tr>
                            <th className="px-3 py-2 text-center font-semibold text-gray-600 border-b w-16">Priority</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Item Code</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Description</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-600 border-b w-28">Qty (kg)</th>
                            <th className="px-3 py-2 text-center font-semibold text-gray-600 border-b w-28">Planned Date</th>
                            <th className="px-3 py-2 text-center font-semibold text-gray-600 border-b w-28">Finished Date</th>
                            <th className="px-3 py-2 text-center font-semibold text-gray-600 border-b w-28">Ship Date</th>
                            <th className="px-3 py-2 text-center font-semibold text-gray-600 border-b w-28">Production</th>
                          </tr>
                        </thead>
                        <tbody>
                          {header.plannedLines.map((line: any) => {
                            const totalPlanned = line.totalPlanned;
                            const isFull = line.isFull;
                            const isPartial = totalPlanned > 0 && !isFull;
                            const plannedDate = line.planned.length > 0 ? line.planned[0].plannedProductionDate : null;
                            const currentPri = priorityMap[line.erpOrderLineId] ?? null;

                            return (
                              <tr key={line.erpOrderLineId} className="hover:bg-gray-50/80 transition-colors border-b last:border-0 border-gray-100">
                                <td className="px-3 py-2 text-center">
                                  <input
                                    type="number"
                                    min={1}
                                    max={99}
                                    value={currentPri ?? ''}
                                    onChange={(e) => handlePriorityChange(line.erpOrderLineId, e.target.value)}
                                    placeholder="-"
                                    className="w-12 text-center text-sm font-bold border border-gray-200 rounded-lg py-1 focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none transition-all"
                                  />
                                </td>
                                <td className="px-3 py-2 font-medium text-gray-800">{line.erpOrderItemCode}</td>
                                <td className="px-3 py-2 text-gray-600 truncate max-w-[200px]" title={line.erpItemDesc}>{line.erpItemDesc || '-'}</td>
                                <td className="px-3 py-2 text-right font-bold text-blue-700">{Number(line.erpOrderItemQty).toLocaleString()}</td>
                                <td className="px-3 py-2 text-center text-xs">
                                  {plannedDate ? (
                                    <span className="text-gray-700 font-bold">{new Date(plannedDate).toLocaleDateString()}</span>
                                  ) : (
                                    <span className="text-gray-400">-</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center text-xs">
                                  {line.planned.length > 0 && line.planned[0].finishedProductionDate ? (
                                    <span className="text-blue-700 font-bold">{new Date(line.planned[0].finishedProductionDate).toLocaleDateString()}</span>
                                  ) : (
                                    <span className="text-gray-400">-</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center text-emerald-700 text-xs font-bold">
                                  {new Date(line.erpOrderShipDate).toLocaleDateString()}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {isFull ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold">
                                      <CheckCircle2 size={10} /> Complete
                                    </span>
                                  ) : isPartial ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold">
                                      ⚠ Partial ({Math.round(totalPlanned).toLocaleString()}kg)
                                    </span>
                                  ) : (
                                    <span className="text-gray-300 text-[10px]">-</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Unfulfilled Demand Orders */}
          <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-red-800 flex items-center gap-2">
                <Activity className="text-red-500" />
                Unfulfilled Orders (Sales Orders)
              </h2>
              <div className="flex items-center gap-4">
                <div className="text-sm text-red-500/70">
                  Orders requiring attention for: <span className="font-bold text-red-700">{currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
                </div>
                <div className="bg-red-50 text-red-700 px-3 py-1 rounded-full text-xs font-bold border border-red-200">
                  {section2Unfulfilled.reduce((sum: number, h: any) => sum + h.unfulfilledLines.length, 0)} Lines
                </div>
              </div>
            </div>

            {section2Unfulfilled.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <CheckCircle2 size={48} className="mx-auto mb-4 opacity-30 text-emerald-500" />
                <p>All orders are scheduled! No unfulfilled orders found.</p>
              </div>
            ) : (
              <div className="space-y-5">
                {section2Unfulfilled.map((header: any) => {
                  const exceptions = currentPlan?.exceptions || [];

                  return (
                    <div key={header.erpOrderHeaderId} className="border border-red-100 rounded-xl overflow-hidden shadow-sm">
                      {/* SO Header */}
                      <div className="bg-gradient-to-r from-red-50/50 to-orange-50/50 px-4 py-3 border-b border-red-100 flex flex-wrap gap-4 items-center justify-between">
                        <div className="flex gap-6 items-center">
                          <div className="w-44">
                            <span className="text-[10px] text-red-400 uppercase font-bold block tracking-wider">SO Number</span>
                            <span className="font-black text-gray-900 text-lg">{header.erpOrderNumber || header.erpOrderHeaderId}</span>
                          </div>
                          <div className="h-8 w-px bg-red-100" />
                          <div className="w-80">
                            <span className="text-[10px] text-red-400 uppercase font-bold block tracking-wider">Customer</span>
                            <span className="font-semibold text-gray-700 truncate block" title={header.erpCustomerName}>{header.erpCustomerName || '-'}</span>
                          </div>
                          {header.erpCustomerGrade && (
                            <>
                              <div className="h-8 w-px bg-red-100" />
                              <div>
                                <span className="text-[10px] text-red-400 uppercase font-bold block tracking-wider">Grade</span>
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${header.erpCustomerGrade === 'A' ? 'bg-emerald-100 text-emerald-700' : header.erpCustomerGrade === 'B' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                  {header.erpCustomerGrade}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                        <div className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-bold">
                          {header.unfulfilledLines.length} Lines
                        </div>
                      </div>

                      {/* SO Lines */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-white">
                            <tr>
                              <th className="px-3 py-2 text-center font-semibold text-gray-600 border-b w-16">Priority</th>
                              <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Item Code</th>
                              <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Description</th>
                              <th className="px-3 py-2 text-right font-semibold text-gray-600 border-b w-28">Qty (kg)</th>
                              <th className="px-3 py-2 text-center font-semibold text-gray-600 border-b w-28">Ship Date</th>
                              <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Reason / Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {header.unfulfilledLines.map((line: any) => {
                              const exception = exceptions.find((e: any) => e.erpOrderLineId === line.erpOrderLineId);
                              const currentPri = priorityMap[line.erpOrderLineId] ?? null;

                              return (
                                <tr key={line.erpOrderLineId} className="hover:bg-red-50/30 transition-colors border-b last:border-0 border-red-50">
                                  <td className="px-3 py-2 text-center">
                                    <input
                                      type="number"
                                      min={1}
                                      max={99}
                                      value={currentPri ?? ''}
                                      onChange={(e) => handlePriorityChange(line.erpOrderLineId, e.target.value)}
                                      placeholder="-"
                                      className="w-12 text-center text-sm font-bold border border-gray-200 rounded-lg py-1 focus:ring-2 focus:ring-red-300 focus:border-red-400 outline-none transition-all"
                                    />
                                  </td>
                                  <td className="px-3 py-2 font-medium text-gray-800">{line.erpOrderItemCode}</td>
                                  <td className="px-3 py-2 text-gray-600 truncate max-w-[200px]" title={line.erpItemDesc}>{line.erpItemDesc || '-'}</td>
                                  <td className="px-3 py-2 text-right font-bold text-red-700">{Number(line.erpOrderItemQty).toLocaleString()}</td>
                                  <td className="px-3 py-2 text-center text-gray-600 text-xs">
                                    {new Date(line.erpOrderShipDate).toLocaleDateString()}
                                  </td>
                                  <td className="px-3 py-2 text-left">
                                    {exception ? (
                                      <div className="flex flex-col">
                                        <span className="text-red-600 font-bold text-[10px]">✕ Shortage: {Math.round(exception.shortageKg).toLocaleString()}kg</span>
                                        <span className="text-gray-400 text-[9px] truncate max-w-[200px]">{exception.reason}</span>
                                      </div>
                                    ) : (
                                      <span className="text-amber-600 font-medium text-[10px]">⚠ Not processed yet</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
                <div className="mt-4 bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-600 font-medium flex items-center gap-2">
                  <Info size={14} />
                  <span>💡 <strong>Tip:</strong> Set higher Priority (lower numbers) on critical orders above and click <strong>Save & Re-Generate</strong> to prioritize their fulfillment.</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Supply & Demand Breakdown Modal */}
      {showSupplyModal && selectedSupply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-xl w-[95vw] max-w-[1920px] flex flex-col max-h-[95vh] border border-gray-200"
          >
            {/* Modal Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100 bg-gray-50/50 rounded-t-2xl">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Info size={20} className="text-orange-500" />
                Raw Material Breakdown — <span className="text-orange-600">{selectedDate}</span>
              </h3>
              <button
                onClick={() => setShowSupplyModal(false)}
                className="text-gray-400 hover:text-gray-700 bg-white p-1 rounded-full shadow-sm border border-gray-200 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* ====== LEFT: SUPPLY PANEL ====== */}
                <div className="space-y-6">
                  {/* Section 1: Supply (RM Available) */}
                  <h4 className="text-sm font-black text-emerald-700 uppercase tracking-wider flex items-center gap-2">
                    <Scale size={16} /> Supply (RM Available)
                  </h4>

                  {/* Top Summary Chips */}
                  <div className="grid grid-cols-2 gap-3">
                    {partId === 'bl' ? (() => {
                      const metrics = calculateDailyMetrics(selectedDate);
                      const trk = metrics.blTracker || {};
                      const rm = trk.rmBreakdown || {};
                      const blKg = Number(rm.bl || 0);
                      const blThKg = Number(rm.blTh || 0);
                      const blDrKg = Number(rm.blDr || 0);
                      const totalBl = blKg + blThKg + blDrKg;
                      return [
                        { label: 'RM BL (ทั้งชิ้น)', val: blKg, unit: 'kg', color: 'blue' },
                        { label: 'RM BL-TH (สะโพก)', val: blThKg, unit: 'kg', color: 'purple' },
                        { label: 'RM BL-DR (น่อง)', val: blDrKg, unit: 'kg', color: 'pink' },
                        { label: 'Total RM BL', val: totalBl, unit: 'kg', color: 'orange' },
                      ].map((stat, i) => (
                        <div key={i} className="bg-gray-50 border border-gray-100 p-4 rounded-xl">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{stat.label}</p>
                          <div className="flex items-baseline gap-1">
                            <span className="text-xl font-bold text-gray-800">
                              {Math.round(Number(stat.val)).toLocaleString()}
                            </span>
                            <span className="text-[9px] font-medium text-gray-400 uppercase">{stat.unit}</span>
                          </div>
                        </div>
                      ));
                    })() : [
                      { label: 'Intake Birds', val: selectedSupply.intakeBirds, unit: 'Birds', color: 'blue' },
                      { label: 'Total Weight', val: selectedSupply.totalWeight, unit: 'kg', color: 'slate' },
                      { label: 'Avg. Weight', val: selectedSupply.avgWeight, unit: 'kg/pc', color: 'emerald', precision: 3 },
                      { label: 'Slaughtered', val: selectedSupply.slaughteredWeight, unit: 'kg', color: 'orange' },
                    ].map((stat, i) => (
                      <div key={i} className="bg-gray-50 border border-gray-100 p-4 rounded-xl">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{stat.label}</p>
                        <div className="flex items-baseline gap-1">
                          <span className="text-xl font-bold text-gray-800">
                            {stat.precision ? Number(stat.val).toFixed(stat.precision) : Math.round(Number(stat.val)).toLocaleString()}
                          </span>
                          <span className="text-[9px] font-medium text-gray-400 uppercase">{stat.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Section 2: Manpower / I-CUT Capacity */}
                  {partId === 'bl' ? (() => {
                    const metrics = calculateDailyMetrics(selectedDate);
                    const trk = metrics.blTracker || {};
                    const icutKg = Number(trk.icutUsedKg || 0);
                    const icutHours = Number(trk.icutUsedHours || 0);
                    const manualKg = Number(trk.manualUsedKg || 0);
                    const icutCap = Number(trk.icutCapacityHours || 37);
                    const icutUtil = icutCap > 0 ? (icutHours / icutCap) * 100 : 0;
                    const manualCapPerPerson = 200; // e.g. 200kg per person per day
                    const manualPeople = Math.ceil(manualKg / manualCapPerPerson);

                    const blBlockProduced = Number(trk.blBlockProduced || 0);
                    const blBlockUsed = Number(trk.blBlockUsed || 0);
                    const blBlockRemaining = blBlockProduced - blBlockUsed;

                    return (
                      <div className="space-y-6">
                        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 space-y-4">
                          <h4 className="text-sm font-bold text-indigo-800 flex items-center gap-2">
                            <Zap size={16} className="text-indigo-500" />
                            I-CUT Capacity & Manual Trimming
                          </h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-white/80 p-3 rounded-xl border border-indigo-200 shadow-sm flex flex-col justify-center">
                              <p className="text-[10px] font-bold text-indigo-500 uppercase mb-1">I-CUT PROCESS (เนื้อเข้าเครื่อง)</p>
                              <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-black text-indigo-900">{Math.round(icutKg).toLocaleString()}</span>
                                <span className="text-[9px] font-bold text-indigo-400">kg</span>
                              </div>
                            </div>
                            <div className="bg-white/80 p-3 rounded-xl border border-indigo-200 shadow-sm flex flex-col justify-center">
                              <p className="text-[10px] font-bold text-indigo-500 uppercase mb-1">I-CUT HOURS (เวลาเดินเครื่อง)</p>
                              <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-black text-indigo-900">{icutHours.toFixed(1)}</span>
                                <span className="text-[9px] font-bold text-indigo-400">/ {icutCap.toFixed(1)} ชม.</span>
                              </div>
                            </div>
                            <div className="bg-white/80 p-3 rounded-xl border border-amber-200 shadow-sm flex flex-col justify-center">
                              <p className="text-[10px] font-bold text-amber-500 uppercase mb-1">MANUAL TRIM (ให้คนตัด)</p>
                              <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-black text-amber-900">{Math.round(manualKg).toLocaleString()}</span>
                                <span className="text-[9px] font-bold text-amber-400">kg ({manualPeople} คน)</span>
                              </div>
                            </div>
                            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200 shadow-sm flex flex-col justify-center">
                              <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1">I-CUT UTILIZATION (ประสิทธิภาพ)</p>
                              <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-black text-emerald-900">{icutUtil.toFixed(1)}</span>
                                <span className="text-[9px] font-bold text-emerald-500">%</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* BL BLOCK Tracking */}
                        <div className="bg-orange-50 border border-orange-100 rounded-2xl p-6 space-y-4">
                          <h4 className="text-sm font-bold text-orange-800 flex items-center gap-2">
                            <Package size={16} className="text-orange-500" />
                            BL BLOCK Tracking (Co-Product)
                          </h4>
                          <div className="grid grid-cols-3 gap-4">
                            <div className="bg-white/80 p-3 rounded-xl border border-emerald-200 shadow-sm">
                              <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1">ผลิตได้ (Produced)</p>
                              <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-black text-emerald-900">+{Math.round(blBlockProduced).toLocaleString()}</span>
                                <span className="text-[9px] font-bold text-emerald-500">kg</span>
                              </div>
                            </div>
                            <div className="bg-white/80 p-3 rounded-xl border border-red-200 shadow-sm">
                              <p className="text-[10px] font-bold text-red-500 uppercase mb-1">ดึงไปใช้ (Used)</p>
                              <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-black text-red-900">-{Math.round(blBlockUsed).toLocaleString()}</span>
                                <span className="text-[9px] font-bold text-red-400">kg</span>
                              </div>
                            </div>
                            <div className="bg-white/80 p-3 rounded-xl border border-orange-200 shadow-sm">
                              <p className="text-[10px] font-bold text-orange-600 uppercase mb-1">คงเหลือ (Remaining)</p>
                              <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-black text-orange-900">{Math.round(blBlockRemaining).toLocaleString()}</span>
                                <span className="text-[9px] font-bold text-orange-500">kg</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Belt Gate Size Breakdown (Removed as requested) */}
                      </div>
                    );
                  })() : selectedManpower && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 space-y-4">
                      <h4 className="text-sm font-bold text-indigo-800 flex items-center gap-2">
                        <Users size={16} className="text-indigo-500" />
                        Manpower Planning & Actual
                      </h4>
                      {selectedManpower.isBil ? (() => {
                        const metrics = calculateDailyMetrics(selectedDate);
                        const mb = metrics.manpowerBreakdown;
                        return (
                          <div className="flex flex-col gap-4">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                              {/* Process 1 */}
                              <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-2xl border border-blue-200 shadow-sm flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-all">
                                <div className="flex items-center justify-between mb-2 z-10">
                                  <p className="text-xs font-bold text-blue-700 uppercase tracking-wider">Process 1: BIL</p>
                                  <Package size={16} className="text-blue-400" />
                                </div>
                                <div className="flex items-baseline gap-1 z-10">
                                  <span className="text-3xl font-black text-blue-900">{mb.p1CuttingStaff || 0}</span>
                                  <span className="text-xs font-bold text-blue-500">Pax</span>
                                </div>
                                <div className="absolute -bottom-4 -right-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                  <Package size={80} />
                                </div>
                              </div>

                              {/* Process 2 */}
                              <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-2xl border border-purple-200 shadow-sm flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-all">
                                <div className="flex items-center justify-between mb-2 z-10">
                                  <p className="text-xs font-bold text-purple-700 uppercase tracking-wider">Process 2: สะโพก + น่อง</p>
                                  <Move size={16} className="text-purple-400" />
                                </div>
                                <div className="flex items-baseline gap-1 z-10">
                                  <span className="text-3xl font-black text-purple-900">{mb.separationCuttingStaff || 0}</span>
                                  <span className="text-xs font-bold text-purple-500">Pax</span>
                                </div>
                                <div className="absolute -bottom-4 -right-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                  <Move size={80} />
                                </div>
                              </div>

                              {/* Process 3 */}
                              <div className="bg-gradient-to-br from-pink-50 to-pink-100 p-4 rounded-2xl border border-pink-200 shadow-sm flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-all">
                                <div className="flex items-center justify-between mb-2 z-10">
                                  <p className="text-xs font-bold text-pink-700 uppercase tracking-wider">Process 3: BL</p>
                                  <Activity size={16} className="text-pink-400" />
                                </div>
                                <div className="flex items-baseline gap-1 z-10">
                                  <span className="text-3xl font-black text-pink-900">{((mb.deboneWorkers || 0) + (mb.trimmingBeltWorkers || 0) + (mb.xrayWorkers || 0)) || 0}</span>
                                  <span className="text-xs font-bold text-pink-500">Pax</span>
                                </div>
                                <div className="absolute -bottom-4 -right-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                  <Activity size={80} />
                                </div>
                              </div>

                              {/* Total Manpower */}
                              <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 p-4 rounded-2xl border border-indigo-700 shadow-md flex flex-col justify-between relative overflow-hidden group hover:shadow-lg transition-all text-white">
                                <div className="flex items-center justify-between mb-2 z-10">
                                  <p className="text-xs font-bold text-indigo-100 uppercase tracking-wider">Total Manpower</p>
                                  <Users size={16} className="text-indigo-200" />
                                </div>
                                <div className="flex items-baseline gap-1 z-10">
                                  <span className="text-3xl font-black text-white">{(mb.p1CuttingStaff || 0) + (mb.separationCuttingStaff || 0) + ((mb.deboneWorkers || 0) + (mb.trimmingBeltWorkers || 0) + (mb.xrayWorkers || 0))}</span>
                                  <span className="text-xs font-bold text-indigo-200">Pax</span>
                                </div>
                                <div className="absolute -bottom-4 -right-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                  <Users size={80} />
                                </div>
                              </div>
                            </div>

                            {/* Process 3 Breakdown */}
                            <div className="mt-2 bg-white rounded-2xl border border-pink-100 overflow-hidden shadow-sm">
                              <div className="bg-pink-50/50 px-4 py-2 border-b border-pink-100 flex items-center justify-between">
                                <p className="text-xs font-bold text-pink-700 flex items-center gap-2">
                                  <Activity size={14} />
                                  Process 3 (BL) Breakdown
                                </p>
                              </div>
                              {/* Machine Summary Table */}
                              <div className="overflow-x-auto">
                                <table className="w-full text-[11px] border-collapse">
                                  <thead>
                                    <tr className="bg-pink-50/80">
                                      <th className="text-left px-3 py-2 font-bold text-pink-800 border-b border-pink-200">เครื่องจักร</th>
                                      <th className="text-center px-3 py-2 font-bold text-pink-800 border-b border-pink-200">จำนวนไลน์</th>
                                      <th className="text-center px-3 py-2 font-bold text-pink-800 border-b border-pink-200">เครื่อง/ไลน์</th>
                                      <th className="text-center px-3 py-2 font-bold text-pink-800 border-b border-pink-200">เครื่องทั้งหมด</th>
                                      <th className="text-center px-3 py-2 font-bold text-pink-800 border-b border-pink-200">จำนวนกะ</th>
                                      <th className="text-center px-3 py-2 font-bold text-pink-800 border-b border-pink-200">Yield</th>
                                      <th className="text-center px-3 py-2 font-bold text-pink-800 border-b border-pink-200">คน/ไลน์/กะ</th>
                                      <th className="text-center px-3 py-2 font-bold text-pink-800 border-b border-pink-200">รวมคน</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {/* Toridas */}
                                    <tr className="hover:bg-pink-50/40 transition-colors">
                                      <td className="px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-bold text-gray-800">🔧 Toridas</span>
                                        <span className="text-[9px] text-gray-400 ml-1">(Debone)</span>
                                      </td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 font-semibold text-gray-700">{mb.toridasLinesNeeded || 0}</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 text-gray-600">{mb.toridasMachinesPerLine || 4}</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-bold text-pink-700 bg-pink-50 px-2 py-0.5 rounded">{mb.toridasTotalMachines || 0}</span>
                                      </td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded whitespace-nowrap">{mb.shiftsNeeded || 0} กะ</span>
                                      </td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 text-gray-600">{((mb.toridasYield || 0.75) * 100).toFixed(0)}%</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 text-gray-600">{mb.toridasWorkersPerUnit || 5}</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-extrabold text-gray-900">{mb.toridasWorkers || 0}</span>
                                      </td>
                                    </tr>
                                    {/* Foodmate */}
                                    <tr className="hover:bg-pink-50/40 transition-colors">
                                      <td className="px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-bold text-gray-800">🔧 Foodmate</span>
                                        <span className="text-[9px] text-gray-400 ml-1">(Debone)</span>
                                      </td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 font-semibold text-gray-700">{mb.foodmateLinesNeeded || 0}</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 text-gray-600">{mb.foodmateMachinesPerLine || 1}</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-bold text-pink-700 bg-pink-50 px-2 py-0.5 rounded">{mb.foodmateTotalMachines || 0}</span>
                                      </td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded whitespace-nowrap">{mb.shiftsNeeded || 0} กะ</span>
                                      </td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 text-gray-600">{((mb.foodmateYield || 0.70) * 100).toFixed(0)}%</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 text-gray-600">{mb.foodmateWorkersPerUnit || 5}</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-extrabold text-gray-900">{mb.foodmateWorkers || 0}</span>
                                      </td>
                                    </tr>
                                    {/* Trimming Belt */}
                                    <tr className="hover:bg-pink-50/40 transition-colors">
                                      <td className="px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-bold text-gray-800">✂️ Trimming Belt</span>
                                        <span className="text-[9px] text-gray-400 ml-1">(ตัดแต่ง+ประจำจุด)</span>
                                      </td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 font-semibold text-gray-700">{mb.trimmingLinesNeeded || 0}</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 text-gray-600">1</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-bold text-pink-700 bg-pink-50 px-2 py-0.5 rounded">{mb.trimmingLinesNeeded || 0}</span>
                                      </td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded whitespace-nowrap">{mb.shiftsNeeded || 0} กะ</span>
                                      </td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 text-gray-600">-</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 text-gray-600">{mb.trimWorkersPerLine || 7}</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-extrabold text-gray-900">{mb.trimmingBeltWorkers || 0}</span>
                                      </td>
                                    </tr>
                                    {/* X-Ray */}
                                    <tr className="hover:bg-pink-50/40 transition-colors">
                                      <td className="px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-bold text-gray-800">📡 X-Ray</span>
                                      </td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 font-semibold text-gray-700">-</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 text-gray-600">-</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-bold text-pink-700 bg-pink-50 px-2 py-0.5 rounded">{mb.xrayMachinesCount || 0}</span>
                                      </td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded whitespace-nowrap">{mb.shiftsNeeded || 0} กะ</span>
                                      </td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 text-gray-600">-</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100 text-gray-600">{mb.xrayWorkersPerUnit || 5}</td>
                                      <td className="text-center px-3 py-2.5 border-b border-pink-100">
                                        <span className="font-extrabold text-gray-900">{mb.xrayWorkers || 0}</span>
                                      </td>
                                    </tr>
                                  </tbody>
                                  <tfoot>
                                    <tr className="bg-pink-50/60">
                                      <td colSpan={7} className="px-3 py-2.5 font-bold text-pink-800 text-right border-t border-pink-200">รวมคนทั้งหมด (Process 3)</td>
                                      <td className="text-center px-3 py-2.5 border-t border-pink-200">
                                        <span className="font-extrabold text-pink-700 text-sm">{(mb.deboneWorkers || 0) + (mb.trimmingBeltWorkers || 0) + (mb.xrayWorkers || 0)}</span>
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </div>
                            <div className="text-[10px] text-indigo-400/80 italic font-medium px-2">
                              * Total Planned Station Workers: {mb.plannedStationWorkers} | Cutting: {mb.plannedCuttingWorkers}
                            </div>
                          </div>
                        );
                      })() : (
                        <>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-white/80 p-3 rounded-xl border border-indigo-200 shadow-sm flex flex-col justify-center">
                              <p className="text-[10px] font-bold text-indigo-500 uppercase mb-1">Station Workers (Plan)</p>
                              <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-black text-indigo-900">{selectedManpower.plannedStationWorkers}</span>
                                <span className="text-[9px] font-bold text-indigo-400">Pax</span>
                              </div>
                            </div>
                            <div className="bg-white/80 p-3 rounded-xl border border-indigo-200 shadow-sm flex flex-col justify-center">
                              <p className="text-[10px] font-bold text-indigo-500 uppercase mb-1">Cutting Workers (Plan)</p>
                              <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-black text-indigo-900">{selectedManpower.plannedCuttingWorkers}</span>
                                <span className="text-[9px] font-bold text-indigo-400">Pax</span>
                              </div>
                            </div>
                            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200 shadow-sm flex flex-col justify-center">
                              <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Station Workers (Actual)</p>
                              <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-black text-emerald-900">{selectedManpower.actualStationWorkers}</span>
                                <span className="text-[9px] font-bold text-emerald-500">Pax</span>
                              </div>
                            </div>
                            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200 shadow-sm flex flex-col justify-center">
                              <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Cutting Workers (Actual)</p>
                              <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-black text-emerald-900">{selectedManpower.actualCuttingWorkers}</span>
                                <span className="text-[9px] font-bold text-emerald-500">Pax</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-[10px] text-indigo-400 italic font-medium">
                            * Cutting Workers (Plan) calculated dynamically via Demand Orders: SUMPRODUCT(Order Qty / Product Speed) / 10
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Section 3: RM FL Summary (Fillet Yield) */}
                  {partId !== 'bl' && (
                    <div className="bg-orange-50 border border-orange-100 rounded-2xl p-6 space-y-4">
                      <h4 className="text-sm font-bold text-orange-800 flex items-center gap-2">
                        <Activity size={16} className="text-orange-500" />
                        {pc.rmPrefix} Summary ({pc.yieldLabel})
                      </h4>
                      <div className={partId === 'bil' ? "grid grid-cols-1 gap-6" : "grid grid-cols-1 md:grid-cols-3 gap-6"}>
                        {(() => {
                          const slaughtered = Number(selectedSupply.slaughteredWeight || 0);

                          if (partId === 'bil') {
                            const rmBilTotal = slaughtered * 0.25;
                            return (
                              <div className="bg-orange-500 p-5 rounded-xl shadow-md flex justify-between items-center text-white">
                                <div>
                                  <p className="text-[10px] font-bold text-white/90 uppercase tracking-wider mb-1">RM BIL Total</p>
                                  <div className="flex items-baseline gap-1.5">
                                    <span className="text-3xl font-black text-white">{Math.round(rmBilTotal).toLocaleString()}</span>
                                    <span className="text-sm font-bold text-white/80">kg</span>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-[10px] text-white/80 font-bold uppercase mb-0.5">Yield Formula</p>
                                  <p className="text-xs text-white font-black italic">Slaughtered * 25%</p>
                                </div>
                              </div>
                            );
                          }

                          const rmFlTotal = slaughtered * 0.04;

                          // Calculate Grade B directly from Total Capacity (9.3%) to ensure it matches RM FL Total
                          const rmFlGradeB = rmFlTotal * 0.093;
                          const rmFlNet = rmFlTotal - rmFlGradeB;

                          return (
                            <>
                              <div className="bg-white/80 p-4 rounded-xl border border-orange-200">
                                <p className="text-[10px] font-bold text-orange-600 uppercase mb-1">{pc.rmPrefix} Total</p>
                                <div className="flex items-baseline gap-1">
                                  <span className="text-2xl font-black text-orange-900">{Math.round(rmFlTotal).toLocaleString()}</span>
                                  <span className="text-xs font-bold text-orange-500">kg</span>
                                </div>
                                <p className="text-[9px] text-orange-400 mt-1 italic">Slaughtered * 4%</p>
                              </div>
                              <div className="bg-white/80 p-4 rounded-xl border border-orange-200">
                                <p className="text-[10px] font-bold text-orange-600 uppercase mb-1">{pc.rmPrefix} Grade B</p>
                                <div className="flex items-baseline gap-1">
                                  <span className="text-2xl font-black text-orange-900">{Math.round(rmFlGradeB).toLocaleString()}</span>
                                  <span className="text-xs font-bold text-orange-500">kg</span>
                                </div>
                                <p className="text-[9px] mt-1 italic text-orange-400">
                                  Total * 9.3%
                                </p>
                              </div>
                              <div className="bg-orange-500 p-4 rounded-xl shadow-md">
                                <p className="text-[10px] font-bold text-white/80 uppercase mb-1">{pc.rmPrefix} หัก Grade B</p>
                                <div className="flex items-baseline gap-1">
                                  <span className="text-2xl font-black text-white">{Math.round(rmFlNet).toLocaleString()}</span>
                                  <span className="text-xs font-bold text-white/80">kg</span>
                                </div>
                                <p className="text-[9px] text-white/60 mt-1 italic">{pc.netLabel}</p>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Hoist BL Sizes Frontend Calculation for both Section 4 (MPS BL Supply) and Section 4.5 (MPS BIL Breakdown) */}
                  {(() => {
                    const bp = JSON.parse(selectedSupply.byProducts || '{}');
                    const blData = bp['BL-DEBONE'] || bp['BL'] || bp['BL (Debone)'] || {};
                    const totalBlQty = Number(blData.qty || blData.kg || 0);
                    const blSizesDb = blData.sizes || {};
                    const intTotal = Number(blData.internalQty || 0);
                    const extTotal = Number(blData.externalQty || 0);
                    const intRatio = totalBlQty > 0 ? intTotal / totalBlQty : 1;
                    const extRatio = totalBlQty > 0 ? extTotal / totalBlQty : 0;
                    const blSizesFrontend: Record<string, { internalVal: number, externalVal: number, totalVal: number }> = {};
                    const process3ByProducts: Record<string, Record<string, { internalVal: number, externalVal: number, totalVal: number }>> = {};

                    if (selectedSupply.sizes) {
                      const mainOrders = selectedDailyOrders.filter((o: any) => getProductType(o.itemCode) === 'main' && Math.round(Number(o.qty)) > 0);
                      const demandKgByBilSize: Record<string, number> = {};
                      mainOrders.forEach((o: any) => {
                        const spec = specs[o.itemCode];
                        const oSize = spec?.productSize?.trim();
                        if (oSize && oSize.toLowerCase() !== 'unsize' && oSize !== '') {
                          const sizeMatch = oSize.match(/(\d+-\d+|\d+\s*Up|\d+\s*Down)/i);
                          let mappedSize = sizeMatch ? sizeMatch[0] : oSize;
                          if (mappedSize.toLowerCase().includes('down')) mappedSize = mappedSize.replace(/\s+/g, '') + 'Down';
                          if (mappedSize.toLowerCase().includes('up')) mappedSize = mappedSize.replace(/\s+/g, '') + 'Up';
                          mappedSize = mappedSize.replace('DownDown', 'Down').replace('UpUp', 'Up');
                          const oYield = spec?.productYield && Number(spec.productYield) > 0 ? Number(spec.productYield) : 1;
                          demandKgByBilSize[mappedSize] = (demandKgByBilSize[mappedSize] || 0) + (Number(o.qty || 0) / oYield);
                        }
                      });
                      const allBilSizesSet = new Set<string>((selectedSupply.sizes || []).map((s: any) => s.groupSize as string));
                      const extSizesObj: Record<string, number> = {};
                      externalRmSupplies.forEach(ext => {
                        if (ext.receivedDate.startsWith(selectedDate) && ext.sizeBreakdownJson) {
                          try {
                            const extBreakdown = JSON.parse(ext.sizeBreakdownJson);
                            Object.entries(extBreakdown).forEach(([k, v]) => { allBilSizesSet.add(k); extSizesObj[k] = (extSizesObj[k] || 0) + Number(v); });
                          } catch (e) { }
                        }
                      });
                      const initialRems: { bilSz: string, rem: number, totalQty: number, iR: number, eR: number }[] = [];
                      let sumInitialRem = 0;
                      let sumTotalQty = 0;
                      Array.from(allBilSizesSet).forEach((bilSz: string) => {
                        const internalQty = (selectedSupply.sizes || []).filter((s: any) => s.groupSize === bilSz).reduce((sum: number, s: any) => sum + Number(s.quantityKg || 0), 0);
                        const externalQty = extSizesObj[bilSz] || 0;
                        const totalQty = internalQty + externalQty;
                        let demand = 0;
                        for (const [dSize, dQty] of Object.entries(demandKgByBilSize)) {
                          if (bilSz.toLowerCase().replace(/\s+/g, '') === dSize.toLowerCase().replace(/\s+/g, '')) demand += dQty;
                        }
                        const rem = Math.max(0, totalQty - demand);
                        const iR = totalQty > 0 ? internalQty / totalQty : 1;
                        const eR = totalQty > 0 ? externalQty / totalQty : 0;
                        initialRems.push({ bilSz, rem, totalQty, iR, eR });
                        sumInitialRem += rem;
                        sumTotalQty += totalQty;
                      });

                      const dailySummary = currentPlan?.dailySummaries?.find((d: any) => String(d.productionDate).startsWith(selectedDate));
                      const trackerData = JSON.parse(dailySummary?.blTrackerJson || '{}');
                      const blRmTotal = Number(trackerData.rmBreakdown?.bl || 0);

                      let process3Node: any = null;
                      if (yieldTree && yieldTree.length > 0) {
                        const bilNode = yieldTree.find((n: any) => n.name === 'BIL L/C');
                        if (bilNode && bilNode.children) {
                          process3Node = bilNode.children.find((c: any) => c.name && c.name.toLowerCase().includes('process: 3'));
                        }
                      }

                      const tConf = machineConfigs.find((c: any) => c.machineKey === 'toridas');
                      let blYield = tConf && Number(tConf.yieldPercentage) > 0 ? Number(tConf.yieldPercentage) : 0.75;
                      let bpYields: { id: string, name: string, pct: number }[] = [];
                      if (process3Node && process3Node.children) {
                        const blNode = process3Node.children.find((c: any) => c.name.toLowerCase().includes('bl แผ่น') || c.yieldPercentage > 0.5);

                        process3Node.children.forEach((c: any) => {
                          if (c !== blNode && Number(c.yieldPercentage || 0) > 0) {
                            bpYields.push({ id: c.id, name: c.name, pct: Number(c.yieldPercentage) });
                          }
                        });
                      }


                      initialRems.forEach(({ bilSz, rem, totalQty, iR, eR }) => {
                        let finalRem = rem;

                        // If no rem is available, fallback to totalQty if that's what was intended
                        if (sumInitialRem === 0 && sumTotalQty > 0) {
                          finalRem = totalQty * (blRmTotal / sumTotalQty);
                        }

                        if (finalRem > 0) {
                          const blSz = blColLabelsMap[bilSz] || `BL ${bilSz}`;
                          const defectFactor = 0.75; // Added defect factor as requested
                          const blQty = finalRem * blYield * defectFactor;
                          blSizesFrontend[blSz] = {
                            internalVal: (blSizesFrontend[blSz]?.internalVal || 0) + (blQty * iR),
                            externalVal: (blSizesFrontend[blSz]?.externalVal || 0) + (blQty * eR),
                            totalVal: (blSizesFrontend[blSz]?.totalVal || 0) + blQty
                          };

                          bpYields.forEach(bpy => {
                            if (!process3ByProducts[bpy.name]) {
                              process3ByProducts[bpy.name] = { id: bpy.id, internalVal: 0, externalVal: 0, totalVal: 0 } as any;
                            }
                            const bpQty = finalRem * bpy.pct;
                            (process3ByProducts[bpy.name] as any).internalVal += bpQty * iR;
                            (process3ByProducts[bpy.name] as any).externalVal += bpQty * eR;
                            (process3ByProducts[bpy.name] as any).totalVal += bpQty;
                          });
                        }
                      });
                    }

                    // Merge any additional sizes from backend (e.g., TOTAL_BL_BLOCK)
                    for (const [sz, qtyRaw] of Object.entries(blSizesDb)) {
                      if (!sz.toUpperCase().startsWith('BL ') || !blSizesFrontend[sz]) {
                        const qty = Number(qtyRaw);
                        if (qty > 0) blSizesFrontend[sz] = { internalVal: qty * intRatio, externalVal: qty * extRatio, totalVal: qty };
                      }
                    }

                    // Attach to the current daily scope so it can be accessed
                    (selectedSupply as any)._blSizesFrontend = blSizesFrontend;
                    (selectedSupply as any)._process3ByProducts = process3ByProducts;
                    return null;
                  })()}

                  {/* Section 4.4: BLK Size Breakdown (Mapped from Matrix) */}
                  {false && partId === 'bl' && (
                    <div className="bg-purple-50 border border-purple-100 rounded-2xl p-6 space-y-4">
                      {(() => {
                        const blkSizesDb = selectedSupply.sizes?.filter((s: any) => s.partName === 'BLK') || [];
                        const hasAnyBlk = blkSizesDb.length > 0;
                        
                        let grandTotalBlk = 0;
                        if (hasAnyBlk) {
                          blkSizesDb.forEach((data: any) => {
                            grandTotalBlk += Number(data.quantityKg || 0);
                          });
                        }

                        return (
                          <>
                            <div className="mb-4">
                              <h4 className="text-sm font-bold text-purple-800 flex items-center gap-2">
                                <Layers size={16} className="text-purple-500" />
                                RM BLK Breakdown (Mapped from Matrix)
                              </h4>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                              {!hasAnyBlk ? (
                                <div className="text-sm text-purple-600 italic col-span-full">No BLK sizes generated yet.</div>
                              ) : (
                                blkSizesDb
                                  .filter((data: any) => Math.round(Number(data.quantityKg || 0)) > 0)
                                  .sort((a: any, b: any) => {
                                    const numA = parseInt(a.groupSize.match(/\d+/)?.[0] || '0', 10);
                                    const numB = parseInt(b.groupSize.match(/\d+/)?.[0] || '0', 10);
                                    if (numA === numB) return a.groupSize.localeCompare(b.groupSize);
                                    return numA - numB;
                                  })
                                  .map((data: any, idx: number) => {
                                    return (
                                      <div key={idx} className="bg-white border border-purple-100 p-3 rounded-xl shadow-sm hover:border-purple-300 transition-all flex flex-col justify-between">
                                        <div className="flex justify-between items-start mb-2">
                                          <p className="text-[10px] font-bold text-purple-800 uppercase bg-purple-100 px-1.5 py-0.5 rounded">{data.groupSize}</p>
                                        </div>
                                        <div className="space-y-1 mt-1">
                                          <div className="pt-1 mt-1 border-t border-purple-50 flex justify-between items-center text-[11px] font-black">
                                            <span className="text-purple-600">TOTAL</span>
                                            <span className="text-purple-700">{Math.round(Number(data.quantityKg || 0)).toLocaleString()} kg</span>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })
                              )}
                            </div>

                            {hasAnyBlk && (
                              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl p-4 flex justify-between items-center text-white shadow-md">
                                  <p className="text-sm font-bold uppercase tracking-wider">Grand Total RM BLK</p>
                                  <div className="flex items-baseline gap-1 text-right">
                                    <p className="text-3xl font-black">{Math.round(grandTotalBlk).toLocaleString()}</p>
                                    <p className="text-xs font-bold text-purple-100 uppercase">kg</p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}


                  {/* Section 4: RM Size Breakdown (Internal vs External) */}
                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                      <Package size={16} className="text-orange-500" />
                      {pc.sizeBreakdownTitle} (Internal vs External)
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {(() => {
                        const blSizesFrontend = (selectedSupply as any)._blSizesFrontend || {};

                        const getInternalSizeKg = (groupSize: string) => {
                          if (partId === 'bl') return blSizesFrontend[groupSize]?.internalVal || 0;
                          return (selectedSupply.sizes || []).filter((sz: any) => sz.groupSize === groupSize).reduce((sum: number, sz: any) => sum + Number(sz.quantityKg || 0), 0);
                        };

                        // Find External RM for selectedDate
                        const extDaily = externalRmSupplies.find(s => String(s.receivedDate).startsWith(selectedDate));
                        let extSizes: Record<string, number> = {};
                        if (extDaily && extDaily.sizeBreakdownJson) {
                          try { extSizes = JSON.parse(extDaily.sizeBreakdownJson); } catch (e) { }
                        }
                        const getExternalSizeKg = (groupSize: string) => {
                          if (partId === 'bl') return blSizesFrontend[groupSize]?.externalVal || 0;
                          return extSizes[groupSize] || 0;
                        };

                        const filletSizeLabels = [
                          { label: '40 Down', color: 'bg-slate-500' },
                          { label: '40-45', color: 'bg-blue-500' },
                          { label: '45-50', color: 'bg-cyan-500' },
                          { label: '50-55', color: 'bg-emerald-500' },
                          { label: '55-60', color: 'bg-green-500' },
                          { label: '60-65', color: 'bg-amber-500' },
                          { label: '65-70', color: 'bg-orange-500' },
                          { label: '70 Up', color: 'bg-red-500' },
                        ];

                        const isBilOrBl = currentPlan?.partType === 'bil' || currentPlan?.partType === 'bl' || currentPlan?.partType === 'leg';
                        // For BIL and BL, include all sizes from internal and external
                        const allBilSizes = new Set(partId === 'bl' ? Object.keys(blSizesFrontend) : (selectedSupply.sizes || []).map((s: any) => s.groupSize as string));
                        if (partId !== 'bl') {
                          Object.keys(extSizes).forEach(k => allBilSizes.add(k));
                        }

                        const currentSizeLabels = isBilOrBl
                          ? (Array.from(allBilSizes) as string[])
                            .sort((a, b) => {
                              const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
                              const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
                              if (numA === numB) return a.localeCompare(b);
                              return numA - numB;
                            })
                            .map((label: string, idx: number) => ({
                              label,
                              color: `bg-${['slate', 'blue', 'cyan', 'emerald', 'green', 'amber', 'orange', 'red'][idx % 8]}-500`
                            }))
                          : filletSizeLabels;


                        return currentSizeLabels.map((size, idx) => {
                          const internalVal = getInternalSizeKg(size.label as string);
                          const externalVal = getExternalSizeKg(size.label as string);
                          const totalVal = internalVal + externalVal;

                          return (
                            <div key={idx} className="bg-white border border-gray-100 p-3 rounded-xl shadow-sm hover:border-orange-200 transition-all flex flex-col justify-between">
                              <div className="flex justify-between items-start mb-2">
                                <p className="text-[10px] font-bold text-gray-800 uppercase bg-gray-100 px-1.5 py-0.5 rounded">{String(size.label)}</p>
                              </div>
                              <div className="space-y-1 mt-1">
                                <div className="flex justify-between items-center text-[10px]">
                                  <span className="text-gray-500 font-medium">Internal:</span>
                                  <span className="font-bold text-gray-700">{Number(internalVal || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</span>
                                </div>
                                {isBilOrBl && (
                                  <div className="flex justify-between items-center text-[10px]">
                                    <span className="text-blue-500 font-medium">External:</span>
                                    <span className="font-bold text-blue-700">{Number(externalVal || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</span>
                                  </div>
                                )}
                              </div>
                              <div className="mt-3 pt-2 border-t border-gray-100 flex justify-between items-center">
                                <span className="text-[10px] font-black text-gray-400">TOTAL</span>
                                <span className="text-sm font-black text-orange-600">{Number(totalVal || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</span>
                              </div>
                            </div>
                          )
                        });
                      })()}
                    </div>
                  </div>

                  {/* Section 4.5: BL Size Breakdown */}
                  {partId === 'bil' && (
                    <div className="bg-pink-50 border border-pink-100 rounded-2xl p-6 space-y-4">
                      {(() => {
                        const blSizesFrontend = (selectedSupply as any)._blSizesFrontend || {};
                        const hasAnyBl = Object.keys(blSizesFrontend).length > 0;

                        let grandTotalInternal = 0;
                        let grandTotalExternal = 0;
                        let grandTotal = 0;

                        if (hasAnyBl) {
                          Object.values(blSizesFrontend).forEach((data: any) => {
                            grandTotalInternal += Number(data.internalVal || 0);
                            grandTotalExternal += Number(data.externalVal || 0);
                            grandTotal += Number(data.totalVal || 0);
                          });
                        }

                        return (
                          <>
                            <div className="mb-4">
                              <h4 className="text-sm font-bold text-pink-800 flex items-center gap-2">
                                <Layers size={16} className="text-pink-500" />
                                BL Size Breakdown (Internal vs External)
                              </h4>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                              {!hasAnyBl ? (
                                <div className="text-sm text-pink-600 italic col-span-full">No BL sizes generated yet.</div>
                              ) : (
                                Object.entries(blSizesFrontend)
                                  .filter(([_, data]) => Math.round((data as any).totalVal) > 0)
                                  .map(([sz, data], idx) => {
                                    const dData = data as any;
                                    return (
                                      <div key={idx} className="bg-white border border-pink-100 p-3 rounded-xl shadow-sm hover:border-pink-300 transition-all flex flex-col justify-between">
                                        <div className="flex justify-between items-start mb-2">
                                          <p className="text-[10px] font-bold text-pink-800 uppercase bg-pink-100 px-1.5 py-0.5 rounded">{sz}</p>
                                        </div>
                                        <div className="space-y-1 mt-1">
                                          <div className="flex justify-between items-center text-[10px]">
                                            <span className="text-gray-500 font-medium">Internal:</span>
                                            <span className="font-bold text-gray-700">{Math.round(dData.internalVal).toLocaleString()} kg</span>
                                          </div>
                                          <div className="flex justify-between items-center text-[10px]">
                                            <span className="text-blue-500 font-medium">External:</span>
                                            <span className="font-bold text-blue-700">{Math.round(dData.externalVal).toLocaleString()} kg</span>
                                          </div>
                                          <div className="pt-1 mt-1 border-t border-pink-50 flex justify-between items-center text-[11px] font-black">
                                            <span className="text-pink-600">TOTAL</span>
                                            <span className="text-pink-700">{Math.round(dData.totalVal).toLocaleString()} kg</span>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })
                              )}
                            </div>

                            {hasAnyBl && (
                              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="bg-white border border-pink-200 rounded-xl p-4 flex justify-between items-center shadow-sm">
                                  <div>
                                    <p className="text-xs font-bold text-gray-500 uppercase">Internal</p>
                                    <p className="text-xl font-black text-gray-800">{Math.round(grandTotalInternal).toLocaleString()} kg</p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-xs font-bold text-blue-500 uppercase">External</p>
                                    <p className="text-xl font-black text-blue-700">{Math.round(grandTotalExternal).toLocaleString()} kg</p>
                                  </div>
                                </div>
                                <div className="bg-gradient-to-r from-pink-500 to-rose-500 rounded-xl p-4 flex justify-between items-center text-white shadow-md">
                                  <p className="text-sm font-bold uppercase tracking-wider">Grand Total</p>
                                  <div className="flex items-baseline gap-1 text-right">
                                    <p className="text-3xl font-black">{Math.round(grandTotal).toLocaleString()}</p>
                                    <p className="text-xs font-bold text-pink-100 uppercase">kg</p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {/* Section 4.6: Process 3 By-Products Breakdown */}
                  {partId === 'bil' && (
                    <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 space-y-4">
                      <h4 className="text-sm font-bold text-amber-800 flex items-center gap-2">
                        <Database size={16} className="text-amber-500" />
                        Process 3 By-Products
                      </h4>
                      {(() => {
                        const process3ByProducts = (selectedSupply as any)._process3ByProducts || {};
                        const bpKeys = Object.keys(process3ByProducts);

                        return (
                          <div className="space-y-6">
                            {/* Demand by By-Product Summary removed from here */}

                            {bpKeys.length === 0 && <div className="text-sm text-amber-600 italic">No Process 3 By-Products generated yet.</div>}
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                              {bpKeys.map((bpName, bpidx) => {
                                const bpData = process3ByProducts[bpName] as any;
                                const totalVal = Math.round(bpData.totalVal);
                                if (totalVal <= 0) return null;




                                return (
                                  <div key={bpidx} className="bg-white border border-amber-200 p-4 rounded-xl shadow-sm hover:shadow-md hover:border-amber-400 transition-all flex flex-col justify-between h-full">
                                    <h5 className="text-sm font-black text-amber-900 uppercase mb-3 pb-2 border-b border-amber-100">{bpName}</h5>

                                    <div className="space-y-1.5 mb-4">
                                      <div className="flex flex-wrap justify-between items-center text-[10px] gap-x-2 gap-y-0.5">
                                        <span className="text-gray-500">Internal</span>
                                        <span className="font-bold text-gray-700 text-right">{Math.round(bpData.internalVal).toLocaleString()} kg</span>
                                      </div>
                                      <div className="flex flex-wrap justify-between items-center text-[10px] gap-x-2 gap-y-0.5">
                                        <span className="text-gray-500">External</span>
                                        <span className="font-bold text-gray-700 text-right">{Math.round(bpData.externalVal).toLocaleString()} kg</span>
                                      </div>
                                      <div className="pt-1.5 mt-1.5 border-t border-amber-100 flex flex-wrap justify-between items-center text-xs font-black bg-amber-50 p-1.5 rounded gap-x-2 gap-y-0.5">
                                        <span className="text-amber-700">Supply</span>
                                        <span className="text-amber-800 text-right">{totalVal.toLocaleString()} kg</span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Final Summary Output */}
                  <div className="bg-gray-900 rounded-2xl p-6 text-white flex flex-col md:flex-row justify-between items-center gap-6">
                    <div>
                      <p className="text-gray-400 font-bold uppercase text-[10px] mb-1">Estimated Net Output (Aggregate)</p>
                      {(() => {
                        const getMonthSizeKg = (groupSize: string) => (selectedSupply.sizes || []).filter((sz: any) => sz.groupSize === groupSize).reduce((sum: number, sz: any) => sum + Number(sz.quantityKg || 0), 0);
                        const getInternalSizeKg = (groupSize: string) => {
                          if (partId === 'bl') return (selectedSupply as any)._blSizesFrontend?.[groupSize]?.internalVal || 0;
                          return getMonthSizeKg(groupSize);
                        };

                        const extDaily = externalRmSupplies.find(s => String(s.receivedDate).startsWith(selectedDate));
                        let extSizes: Record<string, number> = {};
                        if (extDaily && extDaily.sizeBreakdownJson) {
                          try { extSizes = JSON.parse(extDaily.sizeBreakdownJson); } catch (e) { }
                        }
                        const getExternalSizeKg = (groupSize: string) => {
                          if (partId === 'bl') return (selectedSupply as any)._blSizesFrontend?.[groupSize]?.externalVal || 0;
                          return extSizes[groupSize] || 0;
                        };

                        const isBil = currentPlan?.partType === 'bil' || currentPlan?.partType === 'bl' || currentPlan?.partType === 'leg';

                        const allBilSizes = new Set(partId === 'bl' ? Object.keys((selectedSupply as any)._blSizesFrontend || {}) : (selectedSupply.sizes || []).map((s: any) => s.groupSize as string));
                        if (partId !== 'bl') {
                          Object.keys(extSizes).forEach(k => allBilSizes.add(k));
                        }

                        const sizeNames: string[] = isBil
                          ? (Array.from(allBilSizes) as string[])
                          : ['40 Down', '40-45', '45-50', '50-55', '55-60', '60-65', '65-70', '70 Up'];

                        const total = sizeNames.reduce((sum: number, name: string) => sum + getInternalSizeKg(name) + getExternalSizeKg(name), 0);

                        return (
                          <>
                            <h5 className="text-3xl font-bold flex items-baseline gap-2">
                              {Math.round(total).toLocaleString()}
                              <span className="text-xs text-gray-400 font-bold uppercase tracking-widest">KG</span>
                            </h5>
                          </>
                        );
                      })()}
                    </div>
                    <div className="w-full md:w-64 space-y-2">
                      <div className="flex justify-between text-[10px] font-bold uppercase text-gray-400">
                        <span>Distribution Matrix</span>
                        <span className="text-orange-400">100% Match</span>
                      </div>
                      <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden flex">
                        {(() => {
                          const getMonthSizeKg = (groupSize: string) => (selectedSupply.sizes || []).filter((sz: any) => sz.groupSize === groupSize).reduce((sum: number, sz: any) => sum + Number(sz.quantityKg || 0), 0);
                          const getSizeKg = (groupSize: string) => {
                            if (partId === 'bl') {
                              return ((selectedSupply as any)._blSizesFrontend?.[groupSize]?.internalVal || 0) + ((selectedSupply as any)._blSizesFrontend?.[groupSize]?.externalVal || 0);
                            }
                            return getMonthSizeKg(groupSize);
                          };

                          const isBil = currentPlan?.partType === 'bil' || currentPlan?.partType === 'bl' || currentPlan?.partType === 'leg';
                          const currentSizeLabels = isBil
                            ? (Array.from(partId === 'bl' ? Object.keys((selectedSupply as any)._blSizesFrontend || {}) : new Set((selectedSupply.sizes || []).map((s: any) => s.groupSize as string))) as string[])
                              .sort((a, b) => {
                                const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
                                const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
                                if (numA === numB) return a.localeCompare(b);
                                return numA - numB;
                              })
                              .map((label, idx) => ({
                                label,
                                color: `bg-${['slate', 'blue', 'cyan', 'emerald', 'green', 'amber', 'orange', 'red'][idx % 8]}-500`
                              }))
                            : [
                              { label: '40 Down', color: 'bg-slate-500' },
                              { label: '40-45', color: 'bg-blue-500' },
                              { label: '45-50', color: 'bg-cyan-500' },
                              { label: '50-55', color: 'bg-emerald-500' },
                              { label: '55-60', color: 'bg-green-500' },
                              { label: '60-65', color: 'bg-amber-500' },
                              { label: '65-70', color: 'bg-orange-500' },
                              { label: '70 Up', color: 'bg-red-500' },
                            ];

                          const total = currentSizeLabels.reduce((sum, s) => sum + getSizeKg(s.label), 0);
                          return currentSizeLabels.map((s, i) => {
                            const val = getSizeKg(s.label);
                            const width = total > 0 ? (val / total) * 100 : 0;
                            return <div key={i} style={{ width: `${width}%` }} className={`${s.color} h-full border-r border-black/20 last:border-0`} />;
                          });
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Section 5: By Product Summary */}
                  <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 space-y-4">
                    <h4 className="text-sm font-bold text-amber-800 flex items-center gap-2">
                      <Package size={16} className="text-amber-500" />
                      By Product Summary
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {(() => {
                        let byProducts: Record<string, { name: string; qty: number; processName?: string }> = {};
                        if (selectedSupply.byProducts) {
                          try {
                            byProducts = JSON.parse(selectedSupply.byProducts);
                          } catch (e) {
                            console.error('Error parsing byProducts', e);
                          }
                        }

                        const byProductKeys = Object.keys(byProducts);
                        if (byProductKeys.length === 0) {
                          return <div className="text-sm text-amber-600 italic col-span-full">No By Products generated for the selected orders. (Please map items in Master Yield Tree and Regenerate Plan)</div>;
                        }

                        const isGradeB = (name: string) => {
                          if (!name) return false;
                          const n = name.toLowerCase();
                          return n.includes('เกรด b') || n.includes('เกรดบี') || n.includes('grade b');
                        };

                        const aggregated: Record<string, { name: string; qty: number; internalQty?: number; externalQty?: number; sizes?: Record<string, number> }> = {};
                        Object.values(byProducts).forEach((bp: any) => {
                          if (!bp.name) return; // skip BL format entries without name
                          if (isGradeB(bp.name)) return; // Exclude Grade B

                          const name = bp.name.trim();
                          if (!aggregated[name]) {
                            aggregated[name] = { name, qty: 0, internalQty: 0, externalQty: 0, sizes: {} };
                          }
                          aggregated[name].qty += Number(bp.qty || 0);
                          aggregated[name].internalQty! += Number(bp.internalQty || 0);
                          aggregated[name].externalQty! += Number(bp.externalQty || 0);

                          if (bp.sizes) {
                            const totalSizes = Object.values(bp.sizes).reduce((sum: number, val: any) => sum + Number(val), 0) as number;
                            Object.entries(bp.sizes).forEach(([sz, szQty]) => {
                              if (!aggregated[name].sizes![sz]) aggregated[name].sizes![sz] = 0;
                              let scaledQty = Number(szQty);
                              const netQty = Math.max(0, Number(bp.qty || 0));
                              if (totalSizes > 0) {
                                scaledQty = (scaledQty / totalSizes) * netQty;
                              } else {
                                scaledQty = 0;
                              }
                              aggregated[name].sizes![sz] += scaledQty;
                            });
                          }
                        });

                        const items = Object.values(aggregated);
                        if (items.length === 0) {
                          return <div className="text-sm text-amber-600 italic col-span-full">No By Products generated for the selected orders.</div>;
                        }

                        const isBlMain = (name: string) => {
                          const n = name.toUpperCase();
                          return n.includes('BL') && !n.includes('BL-TH') && !n.includes('BL-DR') && !n.includes('สะโพก') && !n.includes('น่อง');
                        };
                        const otherItems = items.filter(bp => !isBlMain(bp.name));
                        const elements: React.ReactNode[] = [];

                        otherItems.forEach((bp, index) => {
                          const roundedQty = Math.max(0, Math.round(bp.qty));
                          const totalGenerated = Math.max(0, Math.round((bp.internalQty || 0) + (bp.externalQty || 0)));
                          const hasSizes = bp.sizes && Object.keys(bp.sizes).length > 0;

                          if (hasSizes) {
                            elements.push(
                              <div key={`other-major-${index}`} className="bg-gradient-to-br from-indigo-50 to-purple-50 col-span-full p-4 rounded-xl border border-indigo-200 shadow-sm">
                                <div className="flex justify-between items-center mb-4 border-b border-indigo-100 pb-3">
                                  <div>
                                    <p className="text-xs font-bold text-indigo-800 uppercase tracking-wider">{bp.name}</p>
                                    <p className="text-[10px] text-indigo-500">Output By-Product</p>
                                  </div>
                                  <div className="flex flex-col items-end gap-1 text-right">
                                    <div className="flex items-baseline gap-1">
                                      <span className="text-xs text-gray-500">Total Produced:</span>
                                      <span className="text-sm font-bold text-gray-700">{totalGenerated.toLocaleString()}</span>
                                      <span className="text-[10px] font-bold text-gray-400">kg</span>
                                    </div>
                                    <div className="flex items-baseline gap-1">
                                      <span className="text-xs text-indigo-400">Remaining:</span>
                                      <span className="text-3xl font-black text-indigo-900">{roundedQty.toLocaleString()}</span>
                                      <span className="text-xs font-bold text-indigo-500">kg</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
                                  {Object.entries(bp.sizes!).filter(([_, qty]) => Number(qty) > 1).map(([sz, qty], i) => (
                                    <div key={i} className="bg-white p-2.5 rounded-lg border border-indigo-100 shadow-sm hover:border-indigo-300 transition-colors">
                                      <p className="text-[10px] font-bold text-gray-500 uppercase">{sz}</p>
                                      <p className="text-sm font-black text-indigo-700">{Math.round(Number(qty)).toLocaleString()} <span className="text-[9px] font-normal text-gray-400">kg</span></p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          } else {
                            elements.push(
                              <div key={`other-minor-${index}`} className="bg-white p-4 rounded-xl border border-amber-200 shadow-sm hover:shadow hover:border-amber-400 transition-all flex flex-col justify-between">
                                <div>
                                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1 tracking-wider">{bp.name}</p>
                                  <p className="text-[10px] text-gray-400 mb-2">Total Produced: <span className="font-bold text-gray-600">{totalGenerated.toLocaleString()} kg</span></p>
                                  <div className="flex items-baseline gap-1">
                                    <span className="text-xs text-amber-600/80 mr-1">Remain:</span>
                                    <span className="text-2xl font-black text-amber-900">{roundedQty.toLocaleString()}</span>
                                    <span className="text-xs font-bold text-amber-500">kg</span>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                        });

                        return elements;
                      })()}
                    </div>
                  </div>

                </div>{/* END LEFT: SUPPLY PANEL */}

                {/* ====== RIGHT: DEMAND PANEL ====== */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-black text-orange-700 uppercase tracking-wider flex items-center gap-2">
                      <ShoppingCart size={16} /> Demand (Orders)
                    </h4>
                    <button 
                      onClick={() => {
                          if (!showManualPull) handleOpenManualPull();
                          else setShowManualPull(false);
                      }}
                      className="px-3 py-1 bg-white border border-blue-200 text-blue-600 font-bold hover:bg-blue-50 hover:border-blue-300 rounded-lg transition-colors text-xs shadow-sm flex items-center gap-1"
                    >
                      {showManualPull ? 'Hide Orders' : '➕ Add Order'}
                    </button>
                  </div>
                  
                  {showManualPull && (
                    <div className="bg-blue-50/30 border border-blue-100 rounded-2xl p-4 overflow-hidden flex flex-col max-h-[400px] mb-4">
                       <div className="mb-3">
                         <input 
                           type="text"
                           placeholder="Search SO Number or Item Code..."
                           value={manualPullSearch}
                           onChange={(e) => {
                               setManualPullSearch(e.target.value);
                               setManualPullPage(1);
                           }}
                           className="w-full border border-gray-300 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
                         />
                       </div>
                       {(() => {
                           const filtered = (unassignedList || []).filter(uo => (uo.soNumber || '').toLowerCase().includes(manualPullSearch.toLowerCase()) || (uo.itemCode || '').toLowerCase().includes(manualPullSearch.toLowerCase()));
                           const totalPages = Math.ceil(filtered.length / 10);
                           return filtered.length === 0 ? (
                               <p className="text-center text-gray-500 py-8 text-sm">No orders found.</p>
                           ) : (
                               <>
                               <div className="overflow-y-auto space-y-2 pr-2 custom-scrollbar mb-2">
                                  {filtered.slice((manualPullPage - 1) * 10, manualPullPage * 10).map((uo, idx) => (
                                     <div key={idx} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-4 hover:border-blue-300 transition-colors shadow-sm">
                                       <div className="flex-1">
                                          <div className="flex justify-between mb-1">
                                             <span className="font-bold text-gray-800 text-sm">{uo.soNumber}</span>
                                             <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded">Ship: {new Date(uo.shipDate).toLocaleDateString()}</span>
                                          </div>
                                          <p className="text-xs text-gray-500 truncate">
                                             <span className="font-bold text-gray-600 mr-2">{uo.itemCode}</span>
                                             {uo.itemName || uo.itemDesc}
                                          </p>
                                       </div>
                                       <div className="flex flex-col items-end gap-1">
                                          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Remaining</span>
                                          <span className="font-black text-gray-700">{Math.round(uo.remainingQty).toLocaleString()} kg</span>
                                       </div>
                                       <div className="h-10 w-px bg-gray-200 mx-2"></div>
                                       <div className="flex items-center gap-2">
                                          <input 
                                             type="number"
                                             value={uo.pullQty}
                                             onChange={(e) => {
                                                const newList = [...unassignedList];
                                                const originalIdx = unassignedList.findIndex(x => x === uo);
                                                if (originalIdx >= 0) {
                                                    newList[originalIdx].pullQty = e.target.value;
                                                    setUnassignedList(newList);
                                                }
                                             }}
                                             className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                                          />
                                          <button
                                             onClick={() => handlePullOrder(uo)}
                                             className="px-4 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-bold rounded-lg shadow hover:shadow-md transition-all text-sm"
                                          >
                                             Pull
                                          </button>
                                       </div>
                                     </div>
                                  ))}
                               </div>
                               {totalPages > 1 && (
                                   <div className="flex justify-center items-center gap-4 mt-3 mb-1">
                                      <button
                                         disabled={manualPullPage === 1}
                                         onClick={() => setManualPullPage(prev => Math.max(1, prev - 1))}
                                         className="px-4 py-1.5 text-xs font-bold rounded-xl border border-gray-300 transition-all bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center gap-1"
                                      >
                                         ◀ Back
                                      </button>
                                      <span className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1 rounded-lg">
                                         Page {manualPullPage} of {totalPages}
                                      </span>
                                      <button
                                         disabled={manualPullPage === totalPages}
                                         onClick={() => setManualPullPage(prev => Math.min(totalPages, prev + 1))}
                                         className="px-4 py-1.5 text-xs font-bold rounded-xl border border-gray-300 transition-all bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center gap-1"
                                      >
                                         Next ▶
                                      </button>
                                   </div>
                               )}
                               </>
                           );
                       })()}
                    </div>
                  )}

                  {selectedDailyOrders.length === 0 ? (
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
                      <Package size={32} className="mx-auto text-gray-300 mb-2" />
                      <p className="text-sm text-gray-400 font-medium">No orders on this date</p>
                    </div>
                  ) : (
                    (() => {
                      const mainOrders = selectedDailyOrders.filter((o: any) => getProductType(o.itemCode) === 'main' && Math.round(Number(o.qty)) > 0);
                      const coproductOrders = selectedDailyOrders.filter((o: any) => getProductType(o.itemCode) === 'coproduct' && Math.round(Number(o.qty)) > 0);
                      const byproductOrders = selectedDailyOrders.filter((o: any) => getProductType(o.itemCode) === 'byproduct' && Math.round(Number(o.qty)) > 0);

                      /* MOVED */ (
                        title: string,
                        themeColor: string,
                        ordersList: any[],
                        typeFilter: 'coproduct' | 'byproduct'
                      ) => {
                        let byProductsSupply: Record<string, { name: string; qty: number; processName?: string }> = {};
                        if (selectedSupply.byProducts) {
                          try {
                            byProductsSupply = JSON.parse(selectedSupply.byProducts);
                          } catch (e) {
                            console.error('Error parsing byProducts', e);
                          }
                        }

                        const resolveByproductName = (key: string): string => {
                          if (byProductsSupply[key]?.name) {
                            return byProductsSupply[key].name;
                          }
                          if (specs[key]) {
                            return specs[key].erpItemDesc || specs[key].erpItemCode || key;
                          }
                          const foundSpec: any = Object.values(specs).find((s: any) =>
                            s.masterYieldIds?.split(',').map((id: any) => id.trim()).includes(key)
                          );
                          if (foundSpec) {
                            return foundSpec.erpItemDesc || foundSpec.erpItemCode || key;
                          }
                          return key;
                        };

                        interface GroupedItem {
                          name: string;
                          supplyQty: number;
                          demandQty: number;
                          orders: any[];
                        }

                        const groupedMap: Record<string, GroupedItem> = {};

                        const getOrCreateGroup = (name: string): GroupedItem => {
                          if (!groupedMap[name]) {
                            groupedMap[name] = {
                              name,
                              supplyQty: 0,
                              demandQty: 0,
                              orders: []
                            };
                          }
                          return groupedMap[name];
                        };

                        // 1. Accumulate supply quantities belonging to this type
                        Object.keys(byProductsSupply).forEach(key => {
                          const sInfo = byProductsSupply[key];
                          if (sInfo && sInfo.qty > 0) {
                            const nodeType = yieldNodeTypeMap.get(key);
                            const isMatch = typeFilter === 'coproduct'
                              ? nodeType === 'CO-PRODUCT'
                              : nodeType === 'BY-PRODUCT';

                            if (isMatch) {
                              const name = resolveByproductName(key);
                              const grp = getOrCreateGroup(name);
                              grp.supplyQty += sInfo.qty;
                            }
                          }
                        });

                        // 2. Accumulate demand quantities & orders
                        ordersList.forEach(o => {
                          const spec = specs[o.itemCode];
                          const bpId = spec?.masterYieldIds?.split(',').map((id: any) => id.trim())[0];
                          const key = bpId || o.itemCode;
                          const name = resolveByproductName(key);
                          const grp = getOrCreateGroup(name);
                          grp.demandQty += o.qty;
                          grp.orders.push(o);
                        });

                        const groups = Object.values(groupedMap);
                        if (groups.length === 0) return null;

                        const borderTheme = themeColor === 'purple' ? 'border-purple-200 bg-purple-50/20' : 'border-amber-200 bg-amber-50/20';
                        const titleTheme = themeColor === 'purple' ? 'text-purple-700' : 'text-amber-700';
                        const lineTheme = themeColor === 'purple' ? 'bg-purple-500' : 'bg-amber-500';
                        const expandedBorder = themeColor === 'purple' ? 'border-purple-200' : 'border-amber-200';
                        const hoverTheme = themeColor === 'purple' ? 'hover:bg-purple-50/50' : 'hover:bg-amber-50/50';

                        return (
                          <div className={`border ${borderTheme} rounded-xl p-4 space-y-3`}>
                            <p className={`text-[10px] font-bold ${titleTheme} uppercase tracking-wider`}>{title}</p>
                            <div className="space-y-1">
                              {groups.map(group => {
                                const supplyQty = Math.round(group.supplyQty);
                                const demandQty = Math.round(group.demandQty);
                                const remaining = supplyQty - demandQty;

                                if (supplyQty === 0 && demandQty === 0) return null;

                                const isExpanded = expandedSizeBins[group.name] || false;
                                const ords = group.orders;

                                return (
                                  <div key={group.name}>
                                    <div
                                      className={`bg-white rounded-lg p-2.5 border border-gray-100 flex items-center gap-3 cursor-pointer ${hoverTheme} transition-colors`}
                                      onClick={() => setExpandedSizeBins(prev => ({ ...prev, [group.name]: !prev[group.name] }))}
                                    >
                                      <div className={`w-2 h-8 rounded-full ${lineTheme}`} />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] font-bold text-gray-600 uppercase">{group.name}</span>
                                          {ords.length > 0 && (
                                            <span className="text-[9px] text-gray-400">
                                              {isExpanded ? '▲' : '▼'} {ords.length} orders
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex gap-4 text-xs mt-0.5">
                                          <span className="text-emerald-600">Supply: <b>{supplyQty.toLocaleString()}</b></span>
                                          <span className="text-orange-600">Demand: <b>{demandQty.toLocaleString()}</b></span>
                                          <span className={remaining >= 0 ? 'text-blue-600' : 'text-red-600 font-bold'}>
                                            {remaining >= 0 ? 'Rem' : 'Short'}: <b>{Math.abs(remaining).toLocaleString()}</b>
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                    {isExpanded && ords.length > 0 && (
                                      <div className={`ml-5 mt-1 mb-2 border-l-2 ${expandedBorder} pl-3 space-y-1`}>
                                        {ords.map((ord: any, idx: number) => {
                                          const spec = specs[ord.itemCode];
                                          return (
                                            <div key={idx} className="flex items-center gap-2 text-[11px] py-1 px-2 bg-white/80 rounded border border-gray-100">
                                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${ord.type === 'chilled' ? 'bg-orange-100 text-orange-700' : 'bg-cyan-100 text-cyan-700'}`}>
                                                {ord.type === 'chilled' ? 'C' : 'F'}
                                              </span>
                                              {Number(spec?.icutSpeed) > 0 && (
                                                <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 uppercase tracking-tighter">
                                                  I-CUT
                                                </span>
                                              )}
                                              <span className="font-bold text-gray-700">{ord.soNumber}</span>
                                              <span className="text-gray-400 text-[10px]">{ord.itemCode}</span>
                                              <span className="ml-auto font-bold text-gray-900">{Math.round(ord.qty).toLocaleString()} kg</span>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      };

                      return (
                        <>
                          {/* Main Product Orders Table */}
                          {mainOrders.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Main Products</p>
                              <div className="border border-gray-200 rounded-xl overflow-hidden">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                                      <th className="text-left px-3 py-2 font-bold">SO / Item</th>
                                      <th className="text-left px-3 py-2 font-bold">Type</th>
                                      <th className="text-left px-3 py-2 font-bold">Size</th>
                                      <th className="text-right px-3 py-2 font-bold">Yield</th>
                                      <th className="text-right px-3 py-2 font-bold text-gray-500">Order FG</th>
                                      <th className="text-right px-3 py-2 font-bold text-gray-500">Order RM</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {mainOrders.map((order: any, idx: number) => {
                                      const spec = specs[order.itemCode];
                                      const size = spec?.productSize || 'unsize';
                                      const productYield = Number(spec?.productYield || 1.0);
                                      const rmNeeded = order.qty / productYield;

                                      // Use actual order quantities instead of capped values since Matched/Prod columns are removed
                                      const displayOrderQty = order.qty;
                                      const displayRmNeeded = rmNeeded;

                                      return (
                                        <tr key={idx} className="border-t border-gray-100 hover:bg-orange-50/30">
                                          <td className="px-3 py-2">
                                            <div className="font-bold text-gray-800">{order.soNumber}</div>
                                            <div className="text-[10px] text-gray-400">{order.itemCode}</div>
                                          </td>
                                          <td className="px-3 py-2 flex items-center gap-1">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${order.type === 'chilled' ? 'bg-orange-100 text-orange-700' : 'bg-cyan-100 text-cyan-700'}`}>
                                              {order.type}
                                            </span>
                                            {Number(spec?.icutSpeed) > 0 && (
                                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200">
                                                I-CUT
                                              </span>
                                            )}
                                          </td>
                                          <td className="px-3 py-2 font-bold text-gray-700">{size}</td>
                                          <td className="px-3 py-2 text-right font-medium text-blue-600">{(productYield * 100).toFixed(1)}%</td>
                                          <td className="px-3 py-2 text-right text-gray-700 font-bold">{Math.round(displayOrderQty).toLocaleString()}</td>
                                          <td className="px-3 py-2 text-right text-gray-700 font-bold">{Math.round(displayRmNeeded).toLocaleString()}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                  <tfoot>
                                    <tr className="bg-gray-900 text-white">
                                      <td colSpan={4} className="px-3 py-2 font-bold text-xs uppercase">Total Main Product</td>
                                      <td className="px-3 py-2 text-right font-bold text-gray-400">{Math.round(mainOrders.reduce((s: number, o: any) => s + o.qty, 0)).toLocaleString()} kg</td>
                                      <td className="px-3 py-2 text-right font-bold text-gray-400">{Math.round(mainOrders.reduce((s: number, o: any) => s + (o.qty / Number(specs[o.itemCode]?.productYield || 1.0)), 0)).toLocaleString()} kg</td>
                                      <td className="px-3 py-2 text-right font-black text-emerald-400">-</td>
                                      <td className="px-3 py-2 text-right font-black text-emerald-400">-</td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </div>
                          )}



                          {/* Demand by Size Summary — expandable */}
                          {(() => {
                            const extDaily = externalRmSupplies.find(s => String(s.receivedDate).startsWith(selectedDate));
                            let extSizes: Record<string, number> = {};
                            if (extDaily && extDaily.sizeBreakdownJson) {
                              try { extSizes = JSON.parse(extDaily.sizeBreakdownJson); } catch (e) { }
                            }

                            const globalBlSizesFrontend = (selectedSupply as any)._blSizesFrontend || {};

                            const renderDemandBySize = (title: string, mode: 'bil' | 'bl' | 'fillet', targetOrders: any[]) => {
                              const allSupplySizesSet = new Set<string>();
                              if (mode === 'bl') {
                                Object.keys(globalBlSizesFrontend).forEach(k => allSupplySizesSet.add(k));
                              } else {
                                currentPlan?.supplyBreakdown?.forEach((s: any) => {
                                  if (s.sizes) s.sizes.forEach((sz: any) => { if (sz.groupSize) allSupplySizesSet.add(sz.groupSize); });
                                });
                                Object.keys(extSizes).forEach(k => allSupplySizesSet.add(k));
                              }

                              const allSupplySizes = Array.from(allSupplySizesSet).sort((a, b) => {
                                if (a.toLowerCase().includes('down') && !b.toLowerCase().includes('down')) return -1;
                                if (!a.toLowerCase().includes('down') && b.toLowerCase().includes('down')) return 1;
                                return a.localeCompare(b, undefined, { numeric: true });
                              });

                              const bilBinDefs = [
                                { key: '180 DOWN', lo: 0, hi: 180 },
                                { key: '210-230', lo: 210, hi: 230 },
                                { key: '230-260', lo: 230, hi: 260 },
                                { key: '260-280', lo: 260, hi: 280 },
                                { key: '280-310', lo: 280, hi: 310 },
                                { key: '310-330', lo: 310, hi: 330 },
                                { key: '330-360', lo: 330, hi: 360 },
                                { key: '360-390', lo: 360, hi: 390 },
                                { key: '390-410', lo: 390, hi: 410 },
                                { key: '410-440', lo: 410, hi: 440 },
                                { key: '440-460', lo: 440, hi: 460 },
                                { key: '460-490', lo: 460, hi: 490 },
                                { key: '490-510', lo: 490, hi: 510 },
                                { key: '510-540', lo: 510, hi: 540 },
                                { key: '540 UP', lo: 540, hi: 9999 },
                              ];

                              const blBinDefs = Object.keys(globalBlSizesFrontend).map(k => {
                                let lo = -1, hi = -1;
                                if (k.toLowerCase().includes('down')) {
                                  const m = k.match(/(\d+)/);
                                  if (m) { lo = 0; hi = parseInt(m[1], 10); }
                                } else if (k.toLowerCase().includes('up')) {
                                  const m = k.match(/(\d+)/);
                                  if (m) { lo = parseInt(m[1], 10); hi = 9999; }
                                } else {
                                  const m = k.match(/(\d+)\s*[-–]\s*(\d+)/);
                                  if (m) { lo = parseInt(m[1], 10); hi = parseInt(m[2], 10); }
                                }
                                return { key: k, lo, hi };
                              });

                              const orderSizes: string[] = [];
                              if (mode !== 'fillet') {
                                targetOrders.forEach((o: any) => {
                                  const spec = specs[o.itemCode];
                                  const s = (spec?.productSize || 'unsize').toLowerCase().trim();
                                  if (s !== 'unsize' && s !== '') {
                                    const exactMatch = allSupplySizes.find(sz => sz.toLowerCase().replace(/\s+/g, '') === s.replace(/\s+/g, ''));
                                    if (exactMatch) {
                                      orderSizes.push(exactMatch);
                                    } else {
                                      let lo = -1, hi = -1;
                                      if (s.includes('down')) {
                                        const m = s.match(/(\d+)/);
                                        if (m) { lo = 0; hi = parseInt(m[1], 10); }
                                      } else if (s.includes('up')) {
                                        const m = s.match(/(\d+)/);
                                        if (m) { lo = parseInt(m[1], 10); hi = 9999; }
                                      } else {
                                        const m = s.match(/(\d+)\s*[-–]\s*(\d+)/);
                                        if (m) { lo = parseInt(m[1], 10); hi = parseInt(m[2], 10); }
                                      }
                                      if (lo >= 0 && hi >= 0 && hi > lo) {
                                        orderSizes.push(s);
                                      }
                                    }
                                  }
                                });
                              }

                              const uniqueSizes = Array.from(new Set([...allSupplySizes, ...orderSizes]));
                              const sizeLabels = mode !== 'fillet'
                                ? uniqueSizes.map((label, idx) => ({
                                  key: label,
                                  label,
                                  groupSize: label,
                                  color: `bg-${['slate', 'blue', 'cyan', 'emerald', 'green', 'amber', 'orange', 'red'][idx % 8]}-500`
                                }))
                                : [
                                  { key: '40Down', label: '40 Down', groupSize: '40 Down', color: 'bg-slate-500' },
                                  { key: '40_45', label: '40-45', groupSize: '40-45', color: 'bg-blue-500' },
                                  { key: '45_50', label: '45-50', groupSize: '45-50', color: 'bg-cyan-500' },
                                  { key: '50_55', label: '50-55', groupSize: '50-55', color: 'bg-emerald-500' },
                                  { key: '55_60', label: '55-60', groupSize: '55-60', color: 'bg-green-500' },
                                  { key: '60_65', label: '60-65', groupSize: '60-65', color: 'bg-amber-500' },
                                  { key: '65_70', label: '65-70', groupSize: '65-70', color: 'bg-orange-500' },
                                  { key: '70Up', label: '70 Up', groupSize: '70 Up', color: 'bg-red-500' },
                                ];

                              const getSupplySizeKg = (groupSize: string): number => {
                                if (mode === 'bl') {
                                  return globalBlSizesFrontend[groupSize]?.totalVal || 0;
                                }
                                return (selectedSupply.sizes || []).filter((sz: any) => sz.groupSize === groupSize).reduce((sum: number, sz: any) => sum + Number(sz.quantityKg || 0), 0) + (extSizes[groupSize] || 0);
                              };

                              const allBinDefs = [
                                { key: '40Down', lo: 0, hi: 40 },
                                { key: '40_45', lo: 40, hi: 45 },
                                { key: '45_50', lo: 45, hi: 50 },
                                { key: '50_55', lo: 50, hi: 55 },
                                { key: '55_60', lo: 55, hi: 60 },
                                { key: '60_65', lo: 60, hi: 65 },
                                { key: '65_70', lo: 65, hi: 70 },
                                { key: '70Up', lo: 70, hi: 999 },
                              ];

                              const getSizeBinKeys = (productSize: string): string[] => {
                                if (!productSize) return [];
                                const s = productSize.toLowerCase().trim();
                                if (s === 'unsize' || s === '') return [];

                                if (mode !== 'fillet') {
                                  const isSupplySize = allSupplySizes.some(sz => sz.toLowerCase() === s);
                                  if (isSupplySize) {
                                    const match = sizeLabels.find(sl => sl.label.toLowerCase() === s);
                                    if (match) return [match.key.trim().toUpperCase()];
                                  }

                                  let lo = -1, hi = -1;
                                  if (s.includes('down')) {
                                    const m = s.match(/(\d+)/);
                                    if (m) { lo = 0; hi = parseInt(m[1], 10); }
                                  } else if (s.includes('up')) {
                                    const m = s.match(/(\d+)/);
                                    if (m) { lo = parseInt(m[1], 10); hi = 9999; }
                                  } else {
                                    const m = s.match(/(\d+)\s*[-–]\s*(\d+)/);
                                    if (m) {
                                      lo = parseInt(m[1], 10);
                                      hi = parseInt(m[2], 10);
                                    } else {
                                      const singleMatch = s.match(/^(\d+)$/);
                                      if (singleMatch) {
                                        lo = parseInt(singleMatch[1], 10);
                                        hi = parseInt(singleMatch[1], 10);
                                      }
                                    }
                                  }

                                  if (lo >= 0 && hi >= 0 && hi >= lo) {
                                    const activeBinDefs = mode === 'bl' ? blBinDefs : bilBinDefs;
                                    const overlaps = activeBinDefs.filter(b => {
                                      if (lo === hi) return lo >= b.lo && hi <= b.hi;
                                      return Math.max(lo, b.lo) < Math.min(hi, b.hi);
                                    });
                                    if (overlaps.length > 0) return overlaps.map(b => b.key);
                                  }
                                  return [];
                                }

                                if (s.includes('40 down') || s === '40down') return ['40Down'];
                                if (s.includes('70 up') || s === '70up' || s.includes('60 up') || s === '60up') return ['60_65', '65_70', '70Up'];
                                const rangeMatch = s.match(/(\d+)\s*[-–]\s*(\d+)/);
                                if (rangeMatch) {
                                  const lo = parseInt(rangeMatch[1]);
                                  const hi = parseInt(rangeMatch[2]);
                                  return allBinDefs.filter(b => b.hi > lo && b.lo < hi).map(b => b.key);
                                }
                                return [];
                              };

                              const demandByBin: Record<string, number> = {};
                              const ordersByBin: Record<string, { soNumber: string; itemCode: string; size: string; qty: number; type: string; rmQty?: number }[]> = {};
                              sizeLabels.forEach(sl => { demandByBin[sl.key] = 0; ordersByBin[sl.key] = []; });

                              const supplyRemaining: Record<string, number> = {};
                              sizeLabels.forEach(sl => { supplyRemaining[sl.key] = getSupplySizeKg(sl.groupSize); });

                              const sizedOrders: any[] = [];
                              const unsizedOrders: any[] = [];
                              targetOrders.forEach((o: any) => {
                                const spec = specs[o.itemCode];
                                const size = spec?.productSize || 'unsize';
                                const yieldPct = spec?.productYield && Number(spec.productYield) > 0 ? Number(spec.productYield) : 1;
                                const rmNeeded = o.qty / yieldPct;
                                const binKeys = getSizeBinKeys(size);
                                if (binKeys.length > 0) {
                                  sizedOrders.push({ ...o, size, binKeys, rmNeeded });
                                } else {
                                  unsizedOrders.push({ ...o, size: 'unsize', rmNeeded });
                                }
                              });

                              sizedOrders.forEach(o => {
                                let remainingQty = o.rmNeeded;
                                for (let i = 0; i < o.binKeys.length; i++) {
                                  const key = o.binKeys[i];
                                  if (remainingQty <= 0) break;
                                  const avail = Math.max(0, supplyRemaining[key] || 0);
                                  
                                  if (avail > 0) {
                                    const alloc = Math.min(avail, remainingQty);
                                    if (alloc > 0) {
                                      if (!ordersByBin[key]) ordersByBin[key] = [];
                                      demandByBin[key] = (demandByBin[key] || 0) + alloc;
                                      supplyRemaining[key] -= alloc;
                                      remainingQty -= alloc;
                                      const allocFg = o.rmNeeded > 0 ? alloc * (o.qty / o.rmNeeded) : alloc;
                                      ordersByBin[key].push({ soNumber: o.soNumber, itemCode: o.itemCode, size: o.size, qty: allocFg, type: o.type, rmQty: alloc });
                                    }
                                  }
                                }
                              });

                              unsizedOrders.forEach(o => {
                                let remainingQty = o.rmNeeded;
                                for (let i = 0; i < sizeLabels.length; i++) {
                                  const sl = sizeLabels[i];
                                  if (remainingQty <= 0) break;
                                  const avail = Math.max(0, supplyRemaining[sl.key] || 0);
                                  if (avail > 0) {
                                    const alloc = Math.min(avail, remainingQty);
                                    if (alloc > 0) {
                                      if (!ordersByBin[sl.key]) ordersByBin[sl.key] = [];
                                      demandByBin[sl.key] = (demandByBin[sl.key] || 0) + alloc;
                                      supplyRemaining[sl.key] -= alloc;
                                      remainingQty -= alloc;
                                      const allocFg = o.rmNeeded > 0 ? alloc * (o.qty / o.rmNeeded) : alloc;
                                      ordersByBin[sl.key].push({ soNumber: o.soNumber, itemCode: o.itemCode, size: o.size, qty: allocFg, type: o.type, rmQty: alloc });
                                    }
                                  }
                                }
                              });

                              return (
                                <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 space-y-3 mt-4">
                                  <p className="text-[10px] font-bold text-orange-600 uppercase tracking-wider">{title}</p>
                                  <div className="space-y-1">
                                    {sizeLabels.map(sl => {
                                      const supply = getSupplySizeKg(sl.groupSize);
                                      const demand = demandByBin[sl.key] || 0;
                                      if (supply === 0 && demand === 0) return null;
                                      const remaining = supply - demand;
                                      const isExpanded = expandedSizeBins[sl.key] || false;
                                      const orders = ordersByBin[sl.key] || [];

                                      return (
                                        <div key={sl.key}>
                                          <div
                                            className="bg-white rounded-lg p-2.5 border border-orange-100 flex items-center gap-3 cursor-pointer hover:bg-orange-50/50 transition-colors"
                                            onClick={() => setExpandedSizeBins(prev => ({ ...prev, [sl.key]: !prev[sl.key] }))}
                                          >
                                            <div className={`w-2 h-8 rounded-full ${sl.color}`} />
                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-bold text-gray-500 uppercase">{sl.label}</span>
                                                {orders.length > 0 && (
                                                  <span className="text-[9px] text-gray-400">
                                                    {isExpanded ? '▲' : '▼'} {orders.length} orders
                                                  </span>
                                                )}
                                              </div>
                                              <div className="flex gap-4 text-xs mt-0.5 items-center">
                                                <span className="text-emerald-600">Supply: <b>{Math.round(supply).toLocaleString()}</b></span>
                                                <span className="text-orange-600">Demand: <b>{Math.round(demand).toLocaleString()}</b></span>
                                                <span className={remaining >= 0 ? 'text-blue-600' : 'text-red-600 font-bold'}>
                                                  {remaining >= 0 ? 'Rem' : 'Short'}: <b>{Math.round(Math.abs(remaining)).toLocaleString()}</b>
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                          {isExpanded && orders.length > 0 && (
                                            <div className="ml-5 mt-1 mb-2 border-l-2 border-orange-200 pl-3 space-y-1">
                                              {orders.map((ord: any, idx: number) => (
                                                <div key={idx} className="flex items-center gap-2 text-[11px] py-1 px-2 bg-white/80 rounded border border-gray-100">
                                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${ord.type === 'chilled' ? 'bg-orange-100 text-orange-700' : 'bg-cyan-100 text-cyan-700'}`}>
                                                    {ord.type === 'chilled' ? 'C' : 'F'}
                                                  </span>
                                                  <span className="font-bold text-gray-700">{ord.soNumber}</span>
                                                  <span className="text-gray-400 text-[10px]">{ord.itemCode}</span>
                                                  <span className="text-gray-400 text-[10px]">({ord.size})</span>
                                                  <div className="ml-auto flex flex-col items-end">
                                                    <span className="font-bold text-gray-900 leading-tight">{Math.round(ord.rmQty || ord.qty).toLocaleString()} kg <span className="text-[9px] text-gray-400 font-normal">RM</span></span>
                                                    <span className="text-[9px] text-emerald-600 font-bold leading-tight">{Math.round(ord.qty).toLocaleString()} kg FG</span>
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            };

                            const isBlItemDesc = (desc: string) => {
                              const d = desc.toUpperCase();
                              return d.includes('BL ') || d.includes('BLK') || d.includes('BL-') || d.startsWith('BL');
                            };

                            const filteredOrders = partId === 'leg'
                              ? mainOrders
                              : mainOrders.filter((o: any) => allowedItemCodes.includes(o.itemCode));

                            if (partId === 'leg') {
                              const bilOrders = mainOrders.filter(o => !isBlItemDesc(specs[o.itemCode]?.erpItemDesc || ''));
                              const blOrders = mainOrders.filter(o => isBlItemDesc(specs[o.itemCode]?.erpItemDesc || ''));
                              return (
                                <>
                                  {bilOrders.length > 0 && renderDemandBySize('Demand by RM Size (BIL)', 'bil', bilOrders)}
                                  {blOrders.length > 0 && renderDemandBySize('Demand by RM Size (BL)', 'bl', blOrders)}
                                </>
                              );
                            } else if (partId === 'bl') {
                              return renderDemandBySize('Demand by RM Size', 'bl', filteredOrders);
                            } else if (partId === 'bil') {
                              return renderDemandBySize('Demand by RM Size', 'bil', filteredOrders);
                            } else {
                              return renderDemandBySize('Demand by RM Size', 'fillet', filteredOrders);
                            }
                          })()}

                          {/* Co-Product Orders Table */}
                          {coproductOrders.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-[10px] font-bold text-purple-600 uppercase tracking-wider">Co-Products</p>
                              <div className="border border-purple-200 rounded-xl overflow-hidden bg-purple-50/20">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-purple-50/50 text-purple-700 uppercase tracking-wider border-b border-purple-100">
                                      <th className="text-left px-3 py-2 font-bold">SO / Item</th>
                                      <th className="text-left px-3 py-2 font-bold">Type</th>
                                      <th className="text-left px-3 py-2 font-bold">Size</th>
                                      <th className="text-right px-3 py-2 font-bold">Qty (kg)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {coproductOrders.map((order: any, idx: number) => {
                                      const spec = specs[order.itemCode];
                                      const size = spec?.productSize || 'unsize';
                                      return (
                                        <tr key={idx} className="border-t border-purple-100 hover:bg-purple-100/30">
                                          <td className="px-3 py-2">
                                            <div className="font-bold text-gray-800">{order.soNumber}</div>
                                            <div className="text-[10px] text-gray-400">{order.itemCode}</div>
                                          </td>
                                          <td className="px-3 py-2">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${order.type === 'chilled' ? 'bg-orange-100 text-orange-700' : 'bg-cyan-100 text-cyan-700'}`}>
                                              {order.type}
                                            </span>
                                          </td>
                                          <td className="px-3 py-2 font-bold text-gray-700">{size}</td>
                                          <td className="px-3 py-2 text-right font-bold text-gray-900">{Math.round(order.qty).toLocaleString()}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                  <tfoot>
                                    <tr className="bg-purple-900 text-white">
                                      <td colSpan={3} className="px-3 py-2 font-bold text-xs uppercase">Total Co-Product</td>
                                      <td className="px-3 py-2 text-right font-bold">{Math.round(coproductOrders.reduce((s: number, o: any) => s + o.qty, 0)).toLocaleString()} kg</td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Demand by Co-Product Summary — expandable */}
                          {renderDemandByYieldTreeGroup('Demand by Co-Product', 'purple', coproductOrders, 'coproduct', selectedSupply)}

                          {/* By-Product Orders Table */}
                          {byproductOrders.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">By-Products</p>
                              <div className="border border-amber-200 rounded-xl overflow-hidden bg-amber-50/20">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-amber-50/50 text-amber-700 uppercase tracking-wider border-b border-amber-100">
                                      <th className="text-left px-3 py-2 font-bold">SO / Item</th>
                                      <th className="text-left px-3 py-2 font-bold">Type</th>
                                      <th className="text-left px-3 py-2 font-bold">Size</th>
                                      <th className="text-right px-3 py-2 font-bold">Qty (kg)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {byproductOrders.map((order: any, idx: number) => {
                                      const spec = specs[order.itemCode];
                                      const size = spec?.productSize || 'unsize';
                                      return (
                                        <tr key={idx} className="border-t border-amber-100 hover:bg-amber-100/30">
                                          <td className="px-3 py-2">
                                            <div className="font-bold text-gray-800">{order.soNumber}</div>
                                            <div className="text-[10px] text-gray-400">{order.itemCode}</div>
                                          </td>
                                          <td className="px-3 py-2">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${order.type === 'chilled' ? 'bg-orange-100 text-orange-700' : 'bg-cyan-100 text-cyan-700'}`}>
                                              {order.type}
                                            </span>
                                          </td>
                                          <td className="px-3 py-2 font-bold text-gray-700">{size}</td>
                                          <td className="px-3 py-2 text-right font-bold text-gray-900">{Math.round(order.qty).toLocaleString()}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                  <tfoot>
                                    <tr className="bg-amber-900 text-white">
                                      <td colSpan={3} className="px-3 py-2 font-bold text-xs uppercase">Total By-Product</td>
                                      <td className="px-3 py-2 text-right font-bold">{Math.round(byproductOrders.reduce((s, o) => s + o.qty, 0)).toLocaleString()} kg</td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Demand by By-Product Summary — expandable */}
                          {renderDemandByYieldTreeGroup('Demand by By-Product', 'amber', byproductOrders, 'byproduct', selectedSupply)}
                        </>
                      );
                    })()
                  )}
                </div>{/* END RIGHT: DEMAND PANEL */}
              </div>{/* END grid */}
            </div>

                        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl flex justify-end">
              <button
                onClick={() => setShowSupplyModal(false)}
                className="px-6 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-all shadow-sm"
              >
                Close Breakdown
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {/* Split/Move Modal */}
      {moveModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50/50">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <Move className="text-orange-500 w-5 h-5" />
                Select Orders to Move
              </h3>
              <button
                onClick={() => setMoveModal({ ...moveModal, isOpen: false })}
                className="text-gray-400 hover:bg-gray-200 hover:text-gray-600 p-1.5 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-4 bg-orange-50/50 border-b border-orange-100 shrink-0">
               <div className="flex justify-between items-center text-sm mb-1">
                  <span className="font-bold text-gray-800">{moveModal.itemCode}</span>
                  <span className="font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded flex items-center gap-2">
                     <Calendar className="w-3 h-3" />
                     {moveModal.sourceDate} <Move size={12}/> {moveModal.targetDate}
                  </span>
               </div>
               <p className="text-xs text-gray-600 truncate">{moveModal.itemDesc}</p>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1 custom-scrollbar">
              {moveModal.orders.map((o, idx) => (
                <div key={idx} className={`p-3 rounded-xl border flex items-center gap-3 transition-colors ${o.selected ? 'bg-orange-50 border-orange-200 shadow-sm' : 'bg-white border-gray-100 hover:border-gray-200'}`}>
                   <input 
                      type="checkbox" 
                      checked={o.selected}
                      onChange={(e) => {
                          const newOrders = [...moveModal.orders];
                          newOrders[idx].selected = e.target.checked;
                          setMoveModal({...moveModal, orders: newOrders});
                      }}
                      className="w-4 h-4 text-orange-500 rounded border-gray-300 focus:ring-orange-500 cursor-pointer"
                   />
                   <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className="text-xs font-bold text-gray-900">SO: {o.soNumber}</span>
                        <span className="text-xs font-bold text-gray-500">Available: {o.qty} kg</span>
                      </div>
                      <div className="flex items-center gap-2">
                         <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Move Qty:</span>
                         <input 
                            type="number"
                            disabled={!o.selected}
                            value={o.moveQty}
                            onChange={(e) => {
                               const newOrders = [...moveModal.orders];
                               newOrders[idx].moveQty = e.target.value;
                               setMoveModal({...moveModal, orders: newOrders});
                            }}
                            className="w-24 text-xs font-bold border border-gray-200 rounded-lg px-2 py-1 disabled:opacity-50 focus:ring-1 focus:ring-orange-500 outline-none"
                         />
                      </div>
                   </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-gray-100 flex justify-between items-center bg-gray-50/50 shrink-0">
              <span className="text-xs font-medium text-gray-500">
                Selected: {moveModal.orders.filter(o=>o.selected).length} order(s)
              </span>
              <div className="flex gap-2">
                  <button
                    onClick={() => setMoveModal({ ...moveModal, isOpen: false })}
                    className="px-4 py-2 text-sm text-gray-600 font-bold hover:bg-gray-200 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmMoveBatch}
                    disabled={moveModal.orders.filter(o=>o.selected).length === 0}
                    className="px-5 py-2 text-sm bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold hover:from-orange-600 hover:to-red-600 rounded-xl transition-all shadow-sm disabled:opacity-50"
                  >
                    Confirm Move
                  </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* GENERATE PLAN MODAL */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex justify-center items-center p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-3xl shadow-xl border border-gray-100 w-full max-w-lg overflow-hidden flex flex-col p-8"
          >
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                  <div className="p-2 bg-orange-100 text-orange-600 rounded-xl">
                    <Activity className="w-5 h-5" />
                  </div>
                  Generate & Save Plan
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  กำหนด Ship Date Range เพื่อสร้างแผนผลิตอัตโนมัติ
                </p>
              </div>
              <button onClick={() => setShowGenerateModal(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="bg-orange-50/50 border border-orange-100 rounded-2xl p-5 mb-4">
              <p className="text-xs font-bold text-orange-600 uppercase tracking-wider mb-4">Sales Order Date Range (Ship Date)</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1.5">Start Date</label>
                  <input
                    type="date"
                    value={generateRange.startDate}
                    onChange={e => setGenerateRange({ ...generateRange, startDate: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-800 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1.5">End Date</label>
                  <input
                    type="date"
                    value={generateRange.endDate}
                    onChange={e => setGenerateRange({ ...generateRange, endDate: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-800 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 bg-white"
                  />
                </div>
              </div>
              <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
                ระบบจะดึง Sales Orders ที่มี Ship Date ตั้งแต่วันที่ <span className="font-bold text-gray-600">{generateRange.startDate}</span> ถึง <span className="font-bold text-gray-600">{generateRange.endDate}</span> แล้วจัดสรรเข้าแผนผลิตแต่ละเดือนอัตโนมัติ
              </p>
            </div>

            {/* Month preview badges */}
            {generateRange.startDate && generateRange.endDate && generateRange.startDate <= generateRange.endDate && (
              <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-4 mb-6">
                <p className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2">แผนที่จะถูกสร้าง</p>
                <div className="flex flex-wrap gap-2">
                  {getMonthsInRange(generateRange.startDate, generateRange.endDate).map((m, i) => (
                    <span key={i} className="px-3 py-1.5 bg-white border border-blue-200 text-blue-700 text-xs font-bold rounded-lg shadow-sm">
                      📅 {m}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowGenerateModal(false)}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                onClick={executeGeneratePlan}
                disabled={!generateRange.startDate || !generateRange.endDate || generateRange.startDate > generateRange.endDate}
                className="flex-1 py-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg shadow-orange-200 transition-all flex justify-center items-center gap-2"
              >
                <Activity className="w-4 h-4" /> Generate {getMonthsInRange(generateRange.startDate, generateRange.endDate).length > 1 ? `${getMonthsInRange(generateRange.startDate, generateRange.endDate).length} Plans` : 'Plan'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

// --- Sub Components ---
const StatCard = ({ label, value, unit, icon: Icon, color }: any) => {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    orange: 'bg-orange-50 text-orange-600 border-orange-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
    red: 'bg-red-50 text-red-600 border-red-100'
  };

  const iconColors: Record<string, string> = {
    blue: 'text-blue-500', orange: 'text-orange-500', green: 'text-green-500', purple: 'text-purple-500', red: 'text-red-500'
  };

  return (
    <div className={`p-5 rounded-2xl border ${colors[color]} shadow-sm flex items-center justify-between`}>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider opacity-70 mb-1">{label}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-black">{value}</span>
          <span className="text-sm font-semibold opacity-80">{unit}</span>
        </div>
      </div>
      <div className="bg-white p-3 rounded-xl shadow-sm">
        <Icon className={`w-6 h-6 ${iconColors[color]}`} />
      </div>
    </div>
  );
};

export default MPSPlan;
