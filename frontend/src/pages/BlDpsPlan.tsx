import React, { useState } from 'react';
import { Layers, Activity, Calendar, GitMerge, Scissors, Download, Trash2, CheckCircle, TrendingUp, RefreshCw, Package, ArrowRight, Check, X } from 'lucide-react';
import CustomDatePicker from '../components/common/CustomDatePicker';





const API = import.meta.env.VITE_API_URL;

const InputCell = ({ value, onChange, type = "text", className = "" }: { value: any, onChange: (val: string) => void, type?: string, className?: string }) => (
  <input
    type={type}
    value={value ?? ''}
    onChange={(e) => onChange(e.target.value)}
    className={`w-full min-w-[60px] bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-1 py-1 text-center text-slate-700 transition-colors ${className}`}
  />
);

const HeaderInput = ({ value, onChange, type = "text" }: { value: any, onChange: (val: string) => void, type?: string }) => (
  <input
    type={type}
    value={value ?? ''}
    onChange={(e) => onChange(e.target.value)}
    className="w-full font-bold text-lg text-slate-800 bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-1 transition-colors"
  />
);

const formatLocalDate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const defaultBeltGateItems = [
  { bin: 1, targetWeight: 'BG 200-220', pctSize: 29.59 },
  { bin: 2, targetWeight: 'BG 220-240', pctSize: 23.44 },
  { bin: 3, targetWeight: 'BG 240-260', pctSize: 6.58 },
  { bin: 4, targetWeight: 'BG 260-280', pctSize: 4.20 },
  { bin: 5, targetWeight: 'BG 280-300', pctSize: 0.80 },
  { bin: 6, targetWeight: 'BG 300-320', pctSize: 0.13 },
  { bin: 7, targetWeight: 'BG 320-340', pctSize: 0.01 },
  { bin: 8, targetWeight: 'BG 340-360', pctSize: 0.00 },
  { bin: 9, targetWeight: 'BG Unsize', pctSize: 35.24 }
];

const BlDpsPlan: React.FC = () => {
  const [targetDate, setTargetDate] = useState(formatLocalDate(new Date()));
  const [sublots, setSublots] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  
  // States for generation logic
  const [isGenerated, setIsGenerated] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [loading, setLoading] = useState(false);

  // Batch Auto States
  const [recipesMap, setRecipesMap] = useState<Record<string, any[]>>({});
  const [loadingRecipes, setLoadingRecipes] = useState<Record<string, boolean>>({});
  const [confirmedRecipes, setConfirmedRecipes] = useState<Record<string, boolean>>({});
  const [batchLogs, setBatchLogs] = useState<any[]>([]);
  const [showSendBatchModal, setShowSendBatchModal] = useState(false);
  const [modalSelectedItems, setModalSelectedItems] = useState<Record<string, boolean>>({});
  const [selectedRecipe, setSelectedRecipe] = useState<Record<string, string>>({});

  const totalDemand = orders.reduce((sum, o) => sum + (Number(o.qty) || 0), 0);
  const totalFulfilled = orders.reduce((sum, o) => sum + (Number(o.fulfilledKg) || 0), 0);
  const percentFulfilled = totalDemand > 0 ? (totalFulfilled / totalDemand) * 100 : 0;

  const handleHeaderChange = (sublotIdx: number, field: string, value: string | number) => {
    const newSublots = [...sublots];
    newSublots[sublotIdx] = { ...newSublots[sublotIdx], [field]: value };
    setSublots(newSublots);
  };

  const handleTableChange = (sublotIdx: number, section: 'beltGateItems' | 'conveyorItems' | 'icutItems', itemIdx: number, field: string, value: string | number) => {
    const newSublots = [...sublots];
    const newItems = [...newSublots[sublotIdx][section]];
    newItems[itemIdx] = { ...newItems[itemIdx], [field]: value };
    newSublots[sublotIdx] = { ...newSublots[sublotIdx], [section]: newItems };
    setSublots(newSublots);
  };

  const [isSaving, setIsSaving] = useState(false);

  React.useEffect(() => {
    fetchExistingPlan();
  }, [targetDate]);

  const fetchExistingPlan = async () => {
    setLoading(true);
    try {
      const [planRes, orderRes, batchLogsRes] = await Promise.all([
        fetch(`${API}/api/bl-dps/${targetDate}`),
        fetch(`${API}/api/mps/approved-orders/${targetDate}?partType=bl`),
        fetch(`${API}/api/erp/batch-logs/bl/${targetDate}`)
      ]);

      if (orderRes.ok) {
        const rawOrders = await orderRes.json();
        setOrders(rawOrders.map((o: any) => ({
          id: String(o.id || Math.random()),
          itemCode: o.itemCode,
          itemDesc: o.itemDesc || o.itemCode,
          size: o.size || '-',
          qty: Number(o.quantityKg || o.qty || 0),
          priority: o.priority || null,
          icutSpeed: Number(o.icutSpeed) || 0,
          fulfilledKg: 0,
          unfulfilledKg: Number(o.quantityKg || o.qty || 0)
        })));
      } else {
        setOrders([]);
      }

      if (batchLogsRes.ok) {
        const data = await batchLogsRes.json();
        setBatchLogs(Array.isArray(data) ? data : []);
      } else {
        setBatchLogs([]);
      }

      if (planRes.ok) {
        const savedPlan = await planRes.json();
        if (savedPlan && savedPlan.length > 0) {
          setSublots(savedPlan);
          setIsGenerated(true);
        } else {
          setIsGenerated(false);
          setSublots([]);
        }
      } else {
        setIsGenerated(false);
        setSublots([]);
      }
    } catch (err) {
      console.error(err);
      setIsGenerated(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePlan = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`${API}/api/bl-dps/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDate, sublots })
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          alert('Plan saved successfully!');
        } else {
          alert('Failed to save plan.');
        }
      } else {
        alert('Failed to save plan. Server error.');
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred while saving the plan.');
    } finally {
      setIsSaving(false);
    }
  };

  const generateSchedule = async () => {
    setLoading(true);
    try {
      const [intakeRes, orderRes, batchLogsRes] = await Promise.all([
        fetch(`${API}/api/chicken-receiving/daily`),
        fetch(`${API}/api/mps/approved-orders/${targetDate}?partType=bl`),
        fetch(`${API}/api/erp/batch-logs/bl/${targetDate}`)
      ]);
      
      if (!intakeRes.ok) throw new Error('Failed to fetch daily intake data');
      
      const rawIntake = await intakeRes.json();
      
      if (batchLogsRes.ok) {
        const data = await batchLogsRes.json();
        setBatchLogs(Array.isArray(data) ? data : []);
      } else {
        setBatchLogs([]);
      }
      
      let approvedOrders = [];
      if (orderRes.ok) {
        const rawOrders = await orderRes.json();
        approvedOrders = rawOrders.map((o: any) => ({
          id: String(o.id || Math.random()),
          itemCode: o.itemCode,
          itemDesc: o.itemDesc || o.itemCode,
          size: o.size || '-',
          qty: Number(o.quantityKg || o.qty || 0),
          priority: o.priority || null,
          icutSpeed: Number(o.icutSpeed) || 0,
          fulfilledKg: 0,
          unfulfilledKg: Number(o.quantityKg || o.qty || 0)
        }));
      }
      
      const dailyIntakes = rawIntake.filter((r: any) => {
        if (!r.receive_date) return false;

        const datePart = String(r.receive_date).split('T')[0];
        const dateParts = datePart.split('-');
        let y = parseInt(dateParts[0]);
        let m = parseInt(dateParts[1]);
        let d = parseInt(dateParts[2]);

        const timePart = String(r.receive_time || '00:00:00');
        const hh = parseInt(timePart.split(':')[0] || '0');

        // Shift day back if it's before 3 AM
        if (hh < 3) {
          const dt = new Date(y, m - 1, d);
          dt.setDate(dt.getDate() - 1);
          y = dt.getFullYear();
          m = dt.getMonth() + 1;
          d = dt.getDate();
        }

        const prodDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        return prodDate === targetDate;
      });

      const sublotShiftCounts: Record<string, Set<string>> = {};
      dailyIntakes.forEach((r: any) => {
        const rawSublot = r.sublot !== null && r.sublot !== undefined ? String(r.sublot).trim() : '';
        if (rawSublot) {
          if (!sublotShiftCounts[rawSublot]) sublotShiftCounts[rawSublot] = new Set();
          sublotShiftCounts[rawSublot].add(r.shift || 'Unassigned');
        }
      });

      // Sort chronologically
      dailyIntakes.sort((a: any, b: any) => {
        const dtA = new Date(`${String(a.receive_date).split('T')[0]}T${a.receive_time || '00:00:00'}`);
        const dtB = new Date(`${String(b.receive_date).split('T')[0]}T${b.receive_time || '00:00:00'}`);
        return dtA.getTime() - dtB.getTime();
      });

      const groupedBySublot: Record<string, any> = {};
      const orderedSublotIds: string[] = [];

      dailyIntakes.forEach((r: any, idx: number) => {
        const rawSublot = r.sublot !== null && r.sublot !== undefined ? String(r.sublot).trim() : '';
        const baseSublotId = rawSublot || `SL-${idx + 1}`;
        const shift = r.shift || 'A';

        let sublotId = baseSublotId;
        if (rawSublot && sublotShiftCounts[rawSublot] && sublotShiftCounts[rawSublot].size > 1) {
          sublotId = `${baseSublotId}_${shift}`;
        }

        if (!groupedBySublot[sublotId]) {
          orderedSublotIds.push(sublotId);
          groupedBySublot[sublotId] = {
            id: sublotId,
            shift: shift,
            startTime: shift === 'A' ? '08:00' : '20:00',
            breakTime: shift === 'A' ? '12:00-13:00' : '00:00-01:00',
            breakDuration: 60,
            workHours: 8,
            totalBirds: 0,
            totalWeightKg: 0,
            blUntrimmed: 0,
            blTrimmed: 0,
          };
        }
        groupedBySublot[sublotId].totalBirds += Number(r.chicken_count || 0);
        groupedBySublot[sublotId].totalWeightKg += Number(r.chicken_weight || 0);
      });

      const generatedSublots = orderedSublotIds.map(id => {
        const group = groupedBySublot[id];
        const avgLiveWeight = group.totalBirds > 0 ? (group.totalWeightKg / group.totalBirds).toFixed(2) : 0;
        
        const beltGateItems = defaultBeltGateItems.map(b => ({
          id: group.id,
          code: '',
          name: '',
          size: '',
          qty: 0,
          chickenWeight: 0,
          speed: 0,
          sortingTime: 0,
          rm: 0,
          fgTarget: 0,
          diff1: 0,
          pctSize: b.pctSize,
          fgRmBl: 0,
          fgRmBlk: 0,
          diff2: 0,
          bin: b.bin,
          targetWeight: b.targetWeight
        }));

        // Provide 1 blank row for conveyor and icut as starting point
        const blankConveyorIcut = {
          sublot: group.id, position: '', itemCode: '', itemDesc: '', workers: 0, speed: 0, pctYield: 0, pctScrapBl: 0, pctSblB: 0, pctBlB: 0, pctSkin: 0, pctScrapBl2: 0, pctDrum: 0, cutTime: 0, yieldKg: 0, scrapBlKg: 0, sblBKg: 0, blBKg: 0, skinKg: 0, scrapBl2Kg: 0, drumKg: 0, rmKg: 0, rmUsedKg: 0, rmType: ''
        };

        return {
          ...group,
          chickenWeight: avgLiveWeight,
          beltGateItems,
          conveyorItems: [ { ...blankConveyorIcut, position: 'สายพาน 1' } ],
          icutItems: [ { ...blankConveyorIcut, position: 'I-CUT 1' } ]
        };
      });

      setSublots(generatedSublots);
      setOrders(approvedOrders);
      setIsGenerated(true);
      setShowRunModal(false);
    } catch (err) {
      console.error(err);
      alert('Failed to generate schedule: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const fetchRecipesForItem = async (itemCode: string) => {
    setLoadingRecipes(prev => ({ ...prev, [itemCode]: true }));
    try {
      const response = await fetch(`${API}/api/erp/recipes/${itemCode}`);
      if (response.ok) {
        const data = await response.json();
        setRecipesMap(prev => ({ ...prev, [itemCode]: data }));
        setConfirmedRecipes(prev => {
          const newConf = { ...prev };
          delete newConf[itemCode];
          return newConf;
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingRecipes(prev => ({ ...prev, [itemCode]: false }));
    }
  };

  const handleConfirmRecipe = (itemCode: string) => {
    if (!selectedRecipe[itemCode]) return;
    setConfirmedRecipes(prev => ({ ...prev, [itemCode]: true }));
  };

  const handleOpenSendBatchModal = () => {
    const readyItems = orders.filter(o => confirmedRecipes[o.itemCode] && !(Array.isArray(batchLogs) ? batchLogs.find(l => l.itemCode === o.itemCode && l.status === 'SUCCESS') : false));
    const initialSelection: Record<string, boolean> = {};
    readyItems.forEach(o => {
      initialSelection[o.itemCode] = true;
    });
    setModalSelectedItems(initialSelection);
    setShowSendBatchModal(true);
  };

  const handleModalSelection = (itemCode: string) => {
    setModalSelectedItems(prev => ({ ...prev, [itemCode]: !prev[itemCode] }));
  };

  const handleSendToBatchAuto = async () => {
    const payload = Object.keys(modalSelectedItems)
      .filter(ic => modalSelectedItems[ic])
      .map(ic => {
        const o = orders.find(x => x.itemCode === ic);
        const recipeId = selectedRecipe[ic];
        const recipe = recipesMap[ic]?.find((r: any) => String(r.RECIPE_ID) === String(recipeId));
        return {
          itemCode: ic,
          planDate: targetDate,
          planQty: o?.qty || 0,
          recipeId: recipe?.RECIPE_ID || null,
          recipeNo: recipe?.RECIPE_NO || null,
          recipeVersion: recipe?.RECIPE_VERSION || null
        };
      });

    if (payload.length === 0) return;

    try {
      const response = await fetch(`${API}/api/erp/batch-auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partId: 'bl', batches: payload })
      });

      if (response.ok) {
        const result = await response.json();
        let msg = `Successfully sent to Batch Auto!\nBatch Name: ${result.batchName}\nRecipes Count: ${result.count}`;
        if (result.errors && result.errors.length > 0) {
          msg += `\nErrors: ${result.errors.length} failed.`;
        }
        alert(msg);
        setShowSendBatchModal(false);
        // Refresh batch logs
        fetch(`${API}/api/erp/batch-logs/bl/${targetDate}`)
          .then(res => res.json())
          .then(data => setBatchLogs(data));
      } else {
        alert('Failed to send to Batch Auto.');
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred while sending to Batch Auto.');
    }
  };

  const handleDeletePlan = () => {
    if (confirm('Are you sure you want to delete this schedule?')) {
      setIsGenerated(false);
      setSublots([]);
      setOrders([]);
    }
  };

  const handleRemoveOrder = (id: string) => {
    setOrders(orders.filter(o => o.id !== id));
  };

  const handleExportExcel = () => {
    alert('Export to Excel feature coming soon!');
  };

  const renderCommonTable = (items: any[], sublotIdx: number, section: 'conveyorItems' | 'icutItems') => {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="text-xs text-slate-700 bg-slate-100 border-b border-slate-200">
            <tr>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">Sublot</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">ตำแหน่ง</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">Item Code</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">Item Desc</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">คนตัดแต่ง</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">speed</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">%yield</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">%เศษBL</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">%SBL B</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">%BL B</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">%หนังแผ่น</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">%เศษ BL#2</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">%DRUM</th>
              <th className="px-1 py-3 font-semibold text-center bg-orange-200 text-slate-800 border-r border-slate-200">เวลาตัด</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">ผลผลิต</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">เศษBL</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">SBL-B</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">BL B</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">หนังแผ่น</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">เศษ BL#2</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">DRUM</th>
              <th className="px-1 py-3 font-semibold text-center bg-green-300 text-slate-800 border-r border-slate-200">RM</th>
              <th className="px-1 py-3 font-semibold text-center bg-green-300 text-slate-800 border-r border-slate-200">RM ใช้ช่องนี้</th>
              <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800">ชนิดRM</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={24} className="px-4 py-8 text-center text-slate-400">ไม่มีข้อมูล</td>
              </tr>
            ) : (
              items.map((row, idx) => (
                <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.sublot} onChange={(v) => handleTableChange(sublotIdx, section, idx, 'sublot', v)} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.position} onChange={(v) => handleTableChange(sublotIdx, section, idx, 'position', v)} className="w-[100px]" /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.itemCode} onChange={(v) => handleTableChange(sublotIdx, section, idx, 'itemCode', v)} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.itemDesc} onChange={(v) => handleTableChange(sublotIdx, section, idx, 'itemDesc', v)} className="min-w-[120px]" /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.workers} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'workers', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.speed} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'speed', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.pctYield} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'pctYield', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.pctScrapBl} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'pctScrapBl', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.pctSblB} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'pctSblB', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.pctBlB} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'pctBlB', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.pctSkin} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'pctSkin', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.pctScrapBl2} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'pctScrapBl2', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.pctDrum} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'pctDrum', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.cutTime} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'cutTime', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.yieldKg} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'yieldKg', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.scrapBlKg} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'scrapBlKg', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.sblBKg} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'sblBKg', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.blBKg} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'blBKg', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.skinKg} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'skinKg', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.scrapBl2Kg} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'scrapBl2Kg', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.drumKg} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'drumKg', Number(v))} /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.rmKg} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'rmKg', Number(v))} className="font-semibold" /></td>
                  <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.rmUsedKg} type="number" onChange={(v) => handleTableChange(sublotIdx, section, idx, 'rmUsedKg', Number(v))} className="font-semibold" /></td>
                  <td className="px-1 py-1"><InputCell value={row.rmType} onChange={(v) => handleTableChange(sublotIdx, section, idx, 'rmType', v)} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6 bg-[#f8fafc] min-h-screen font-sans">
      
      {/* Generate Schedule Header Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end bg-white p-6 rounded-3xl shadow-sm border border-gray-100 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center gap-3">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <Layers className="w-7 h-7" />
            </div>
            Daily Production Scheduling (BL)
          </h1>
          <p className="text-gray-500 mt-2 text-sm max-w-xl">
            Cascade Waterfall Allocation at the Sublot Level. Analyzes each incoming sublot and allocates RM sizes to fulfill the approved Master Production Schedule (MPS) demand sequentially.
          </p>
        </div>
        <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-2xl border border-gray-100">
          <CustomDatePicker
            value={targetDate}
            onChange={setTargetDate}
            className="w-36"
          />
          {!isGenerated ? (
            <button onClick={() => setShowRunModal(true)} className="px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-sm font-bold shadow-md transition-all flex items-center gap-2">
              <Activity className="w-4 h-4" /> Run Schedule
            </button>
          ) : (
            <>
              <button onClick={handleSavePlan} disabled={isSaving} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold shadow-md transition-all flex items-center gap-2">
                {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {isSaving ? 'Saving...' : 'Save Plan'}
              </button>
              <button onClick={handleExportExcel} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-md transition-all flex items-center gap-2">
                <Download className="w-4 h-4" /> Export Excel
              </button>
              <button onClick={handleDeletePlan} className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-bold shadow-md transition-all flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> Delete Schedule
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : !isGenerated ? (
        <div className="flex flex-col items-center justify-center h-[50vh] bg-white rounded-3xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="w-20 h-20 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-6">
            <Calendar size={40} />
          </div>
          <h2 className="text-2xl font-black text-gray-800 mb-2">No Schedule Generated</h2>
          <p className="text-gray-500 mb-8 max-w-md">Click the button below to analyze daily demand and supply, and generate the optimal production schedule.</p>
          <button onClick={() => setShowRunModal(true)} className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center gap-3">
            <Activity size={20} />
            Run Schedule
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          
          {/* STEP 1: DEMAND */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center">
                  <TrendingUp size={16} />
                </div>
                Daily Orders (Demand)
              </h2>
              <div className="flex items-center gap-4 text-sm">
                <div className="h-8 w-px bg-gray-200"></div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Target Demand:</span>
                  <span className="font-black text-gray-900">{totalDemand.toLocaleString()} kg</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Fulfilled:</span>
                  <span className={`font-black ${percentFulfilled >= 100 ? 'text-green-600' : 'text-orange-500'}`}>
                    {totalFulfilled.toLocaleString()} kg ({percentFulfilled.toFixed(1)}%)
                  </span>
                </div>
              </div>
            </div>

            <div className="p-6 bg-gray-50 flex flex-col gap-8">
              {orders.length === 0 ? (
                <p className="text-center text-gray-400 py-10 font-medium">No approved MPS orders found for this date.</p>
              ) : (
                <>
                  {/* I-CUT SECTION */}
                  {orders.filter(o => o.icutSpeed > 0).length > 0 && (
                    <div>
                      <h3 className="text-md font-bold text-gray-700 mb-4 border-b pb-2">I-CUT Demand</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {orders.filter(o => o.icutSpeed > 0).map((o, idx) => {
                          const pct = o.qty > 0 ? (o.fulfilledKg / o.qty) * 100 : 0;
                          const isFull = o.unfulfilledKg <= 0;
                          return (
                            <div key={`${o.id}-${idx}`} className={`relative overflow-hidden rounded-2xl border ${isFull ? 'border-green-200 bg-white' : 'border-gray-200 bg-white'} shadow-sm p-5 transition-all hover:shadow-md`}>
                              <div className="absolute top-0 left-0 bottom-0 bg-green-50 z-0 transition-all duration-1000" style={{ width: `${Math.min(100, pct)}%` }}></div>
                              <div className="relative z-10 flex flex-col h-full justify-between">
                                <div>
                                  <div className="flex justify-between items-start mb-2">
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{o.itemCode}</span>
                                      {o.priority && (
                                        <span className="inline-flex items-center gap-1 w-fit bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[9px] font-black border border-blue-100">
                                          <CheckCircle size={8} /> P{o.priority}
                                        </span>
                                      )}
                                      <span className="inline-flex items-center gap-1 w-fit bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-[9px] font-black border border-indigo-100">
                                        <Scissors size={8} /> I-CUT ({o.icutSpeed})
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${isFull ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                        {isFull ? 'COMPLETED' : 'PENDING'}
                                      </span>
                                      <button onClick={() => handleRemoveOrder(o.id)} className="text-red-300 hover:text-red-500 bg-white border border-red-100 p-1 rounded-md transition-colors shadow-sm" title="Remove Order">
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  </div>
                                  <h3 className="font-bold text-gray-900 leading-tight mb-1">{o.itemDesc}</h3>
                                  <p className="text-xs text-indigo-600 font-semibold mb-4">Required Size: {o.size}</p>
                                </div>
                                <div>
                                  <div className="flex justify-between items-end mb-1">
                                    <span className="text-2xl font-black text-gray-900">{o.fulfilledKg.toLocaleString()} <span className="text-sm text-gray-400 font-medium">/ {o.qty.toLocaleString()} kg</span></span>
                                  </div>
                                  <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                    <div className={`h-full ${isFull ? 'bg-green-500' : 'bg-orange-400'}`} style={{ width: `${Math.min(100, pct)}%` }}></div>
                                  </div>
                                  {o.unfulfilledKg > 0 && <p className="text-[10px] text-red-500 font-bold mt-2 text-right">Short: {o.unfulfilledKg.toLocaleString()} kg</p>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* NORMAL SECTION */}
                  {orders.filter(o => o.icutSpeed <= 0).length > 0 && (
                    <div>
                      <h3 className="text-md font-bold text-gray-700 mb-4 border-b pb-2">Manual / Conveyor Demand</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {orders.filter(o => o.icutSpeed <= 0).map((o, idx) => {
                          const pct = o.qty > 0 ? (o.fulfilledKg / o.qty) * 100 : 0;
                          const isFull = o.unfulfilledKg <= 0;
                          return (
                            <div key={`${o.id}-${idx}`} className={`relative overflow-hidden rounded-2xl border ${isFull ? 'border-green-200 bg-white' : 'border-gray-200 bg-white'} shadow-sm p-5 transition-all hover:shadow-md`}>
                              <div className="absolute top-0 left-0 bottom-0 bg-green-50 z-0 transition-all duration-1000" style={{ width: `${Math.min(100, pct)}%` }}></div>
                              <div className="relative z-10 flex flex-col h-full justify-between">
                                <div>
                                  <div className="flex justify-between items-start mb-2">
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{o.itemCode}</span>
                                      {o.priority && (
                                        <span className="inline-flex items-center gap-1 w-fit bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[9px] font-black border border-blue-100">
                                          <CheckCircle size={8} /> P{o.priority}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${isFull ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                        {isFull ? 'COMPLETED' : 'PENDING'}
                                      </span>
                                      <button onClick={() => handleRemoveOrder(o.id)} className="text-red-300 hover:text-red-500 bg-white border border-red-100 p-1 rounded-md transition-colors shadow-sm" title="Remove Order">
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  </div>
                                  <h3 className="font-bold text-gray-900 leading-tight mb-1">{o.itemDesc}</h3>
                                  <p className="text-xs text-indigo-600 font-semibold mb-4">Required Size: {o.size}</p>
                                </div>
                                <div>
                                  <div className="flex justify-between items-end mb-1">
                                    <span className="text-2xl font-black text-gray-900">{o.fulfilledKg.toLocaleString()} <span className="text-sm text-gray-400 font-medium">/ {o.qty.toLocaleString()} kg</span></span>
                                  </div>
                                  <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                    <div className={`h-full ${isFull ? 'bg-green-500' : 'bg-orange-400'}`} style={{ width: `${Math.min(100, pct)}%` }}></div>
                                  </div>
                                  {o.unfulfilledKg > 0 && <p className="text-[10px] text-red-500 font-bold mt-2 text-right">Short: {o.unfulfilledKg.toLocaleString()} kg</p>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* RECIPE SELECTION BOX */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden mb-6">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                  <Package size={16} />
                </div>
                Batch Auto
              </h2>
              <button
                onClick={handleOpenSendBatchModal}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-md transition-all flex items-center gap-2"
              >
                <ArrowRight size={16} /> Send to Batch Auto
              </button>
            </div>
            <div className="p-6 bg-gray-50">
              {orders.length === 0 ? (
                <p className="text-center text-gray-400 font-medium">No orders to process.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {orders.map((o, idx) => {
                    const itemRecipes = recipesMap[o.itemCode] || [];
                    const isLoading = loadingRecipes[o.itemCode];
                    
                    const recipeNos = Array.from(new Set(itemRecipes.map((r: any) => String(r.RECIPE_NO))));

                    const logForOrder = Array.isArray(batchLogs) ? batchLogs.find(l => l.itemCode === o.itemCode) : undefined;
                    const isSuccessBatch = logForOrder?.status === 'SUCCESS';

                    return (
                      <div key={`recipe-sel-${o.id}-${idx}`} className={`bg-white p-4 rounded-xl border ${isSuccessBatch ? 'border-green-200 bg-green-50/30' : 'border-gray-200'} shadow-sm flex flex-col gap-3 relative overflow-hidden`}>
                        {isSuccessBatch && (
                          <div className="absolute top-0 right-0 bg-green-100 text-green-700 text-[10px] font-bold px-2 py-1 rounded-bl-lg flex items-center gap-1 border-b border-l border-green-200">
                            <CheckCircle size={10} /> Batch Created
                          </div>
                        )}
                        <div>
                          <h3 className="font-bold text-gray-900 text-sm mb-1">{o.itemCode}</h3>
                          <p className="text-xs text-gray-500 mb-1 truncate" title={o.itemDesc}>{o.itemDesc}</p>
                          <p className="text-xs font-bold text-indigo-600">Plan Qty: {o.qty.toLocaleString()} kg</p>
                        </div>

                        {logForOrder && (
                          <div className={`mt-1 p-2 rounded-lg border text-xs font-medium ${isSuccessBatch ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                            {isSuccessBatch ? (
                              <div className="flex flex-col gap-1">
                                <span className="flex items-center gap-1"><Check size={12} /> <strong>Batch No:</strong> {logForOrder.batchNo || logForOrder.batchName}</span>
                                <span className="text-[10px] text-green-600">Recipe: {logForOrder.recipeNo} (v{logForOrder.recipeVersion})</span>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1">
                                <span className="flex items-start gap-1 text-red-600"><X size={12} className="mt-0.5 flex-shrink-0" /> <strong>Error:</strong> {logForOrder.errorMsg}</span>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex gap-2 items-center">
                          <button
                            onClick={() => fetchRecipesForItem(o.itemCode)}
                            className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg font-bold text-gray-700 transition-colors flex items-center gap-1 w-full justify-center border border-gray-200"
                            disabled={isLoading || confirmedRecipes[o.itemCode] || isSuccessBatch}
                          >
                            {isLoading ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                            {itemRecipes.length > 0 ? 'Refresh Recipes' : 'Find Recipes'}
                          </button>
                        </div>

                        {itemRecipes.length > 0 && !isSuccessBatch && (
                          <div className="mt-2 space-y-2 border-t border-gray-100 pt-3">
                            <div>
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Select Recipe</label>
                              <select
                                className="w-full text-xs border border-gray-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                value={selectedRecipe[o.itemCode] || ''}
                                onChange={e => setSelectedRecipe(prev => ({ ...prev, [o.itemCode]: e.target.value }))}
                                disabled={confirmedRecipes[o.itemCode]}
                              >
                                <option value="">-- Choose Recipe --</option>
                                {recipeNos.map(rNo => (
                                  <optgroup key={rNo} label={`Recipe ${rNo}`}>
                                    {itemRecipes.filter((r: any) => String(r.RECIPE_NO) === rNo).map((r: any) => (
                                      <option key={r.RECIPE_ID} value={r.RECIPE_ID}>
                                        v{r.RECIPE_VERSION} - {r.RECIPE_DESC}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </div>

                            <button
                              onClick={() => handleConfirmRecipe(o.itemCode)}
                              disabled={!selectedRecipe[o.itemCode] || confirmedRecipes[o.itemCode]}
                              className={`w-full py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all ${
                                confirmedRecipes[o.itemCode]
                                  ? 'bg-green-100 text-green-700 border border-green-200'
                                  : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100 disabled:opacity-50'
                              }`}
                            >
                              {confirmedRecipes[o.itemCode] ? (
                                <>
                                  <CheckCircle size={12} /> Confirmed for Batch
                                </>
                              ) : (
                                'Confirm Recipe'
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {sublots.map((sublot, sublotIdx) => (
            <div key={sublot.id} className="mb-10 bg-slate-200/50 p-4 rounded-2xl border border-slate-200">
              <div className="flex items-center mb-4">
                <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-md">
                  {sublot.id}
                </div>
                <h2 className="ml-3 text-xl font-bold text-slate-800">Sublot {sublot.id}</h2>
              </div>

              {/* 1. Header Section */}
              <div className="mb-4 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center space-x-2">
                  <Layers size={16} className="text-blue-600" />
                  <h3 className="text-md font-bold text-slate-800">Header</h3>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-5 gap-y-4 divide-x divide-slate-100 p-4">
                  <div className="px-4 py-2">
                    <p className="text-xs font-medium text-slate-500 mb-1">วันที่</p>
                    <p className="text-lg font-bold text-slate-800">{targetDate}</p>
                  </div>
                  <div className="px-4 py-2">
                    <p className="text-xs font-medium text-slate-500 mb-1">Sublot</p>
                    <HeaderInput value={sublot.id} onChange={(v) => handleHeaderChange(sublotIdx, 'id', v)} />
                  </div>
                  <div className="px-4 py-2">
                    <p className="text-xs font-medium text-slate-500 mb-1">กะ</p>
                    <HeaderInput value={sublot.shift} onChange={(v) => handleHeaderChange(sublotIdx, 'shift', v)} />
                  </div>
                  <div className="px-4 py-2 relative group">
                    <p className="text-xs font-medium text-slate-500 mb-1">BL แผ่นไม่ตัดแต่ง</p>
                    <div className="flex items-center">
                      <HeaderInput value={sublot.blUntrimmed} type="number" onChange={(v) => handleHeaderChange(sublotIdx, 'blUntrimmed', Number(v))} />
                      <span className="text-xs font-normal text-slate-500 ml-1 absolute right-4">kg</span>
                    </div>
                  </div>
                  <div className="px-4 py-2 relative group">
                    <p className="text-xs font-medium text-slate-500 mb-1">BL แผ่นตัดแต่ง (SOUIKU)</p>
                    <div className="flex items-center">
                      <HeaderInput value={sublot.blTrimmed} type="number" onChange={(v) => handleHeaderChange(sublotIdx, 'blTrimmed', Number(v))} />
                      <span className="text-xs font-normal text-slate-500 ml-1 absolute right-4">kg</span>
                    </div>
                  </div>
                  <div className="px-4 py-2">
                    <p className="text-xs font-medium text-slate-500 mb-1">เวลาเริ่มงาน</p>
                    <HeaderInput value={sublot.startTime} onChange={(v) => handleHeaderChange(sublotIdx, 'startTime', v)} />
                  </div>
                  <div className="px-4 py-2">
                    <p className="text-xs font-medium text-slate-500 mb-1">เวลาเบรค</p>
                    <HeaderInput value={sublot.breakTime} onChange={(v) => handleHeaderChange(sublotIdx, 'breakTime', v)} />
                  </div>
                  <div className="px-4 py-2 relative group">
                    <p className="text-xs font-medium text-slate-500 mb-1">พักเบรค</p>
                    <div className="flex items-center">
                      <HeaderInput value={sublot.breakDuration} type="number" onChange={(v) => handleHeaderChange(sublotIdx, 'breakDuration', Number(v))} />
                      <span className="text-xs font-normal text-slate-500 ml-1 absolute right-4">min</span>
                    </div>
                  </div>
                  <div className="px-4 py-2 relative group">
                    <p className="text-xs font-medium text-slate-500 mb-1">เวลาการทำงาน</p>
                    <div className="flex items-center">
                      <HeaderInput value={sublot.workHours} type="number" onChange={(v) => handleHeaderChange(sublotIdx, 'workHours', Number(v))} />
                      <span className="text-xs font-normal text-slate-500 ml-1 absolute right-4">hrs</span>
                    </div>
                  </div>
                  <div className="px-4 py-2 relative group">
                    <p className="text-xs font-medium text-slate-500 mb-1">น้ำหนักไก่</p>
                    <div className="flex items-center">
                      <HeaderInput value={sublot.chickenWeight} type="number" onChange={(v) => handleHeaderChange(sublotIdx, 'chickenWeight', Number(v))} />
                      <span className="text-xs font-normal text-slate-500 ml-1 absolute right-4">kg</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Belt Gate Section */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-4">
                <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center space-x-2">
                  <Activity size={16} className="text-orange-600" />
                  <h3 className="text-md font-bold text-slate-800">Belt Gate</h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left whitespace-nowrap">
                    <thead className="text-xs text-slate-700 bg-slate-100 border-b border-slate-200">
                      <tr>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">Sublot</th>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">CODE</th>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">ชื่อสินค้า</th>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">ผลผลิต</th>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">น้ำหนักไก่</th>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">Speed BG</th>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">เวลาเรียง</th>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">RM</th>
                        <th className="px-1 py-3 font-semibold text-center bg-orange-200 text-slate-800 border-r border-slate-200">FG Target</th>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">Diff.</th>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">%เข้าไซส์</th>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">FG RM BL</th>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">FG RM BLK</th>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">Diff.</th>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800 border-r border-slate-200">BIN</th>
                        <th className="px-1 py-3 font-semibold text-center bg-yellow-300 text-slate-800">น้ำหนักที่ตั้ง</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sublot.beltGateItems.map((row: any, idx: number) => (
                        <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                          <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.id} onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'id', v)} /></td>
                          <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.code} onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'code', v)} /></td>
                          <td className="px-1 py-1 border-r border-slate-100 flex items-center justify-center space-x-1">
                            <InputCell value={row.name} onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'name', v)} className="w-[60px]" />
                            <InputCell value={row.size} onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'size', v)} className="w-[80px]" />
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.qty} type="number" onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'qty', Number(v))} /></td>
                          <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.chickenWeight} type="number" onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'chickenWeight', Number(v))} /></td>
                          <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.speed} type="number" onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'speed', Number(v))} /></td>
                          <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.sortingTime} type="number" onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'sortingTime', Number(v))} /></td>
                          <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.rm} type="number" onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'rm', Number(v))} className="font-semibold" /></td>
                          <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.fgTarget} type="number" onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'fgTarget', Number(v))} className="font-semibold text-red-500" /></td>
                          <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.diff1} type="number" onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'diff1', Number(v))} /></td>
                          <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.pctSize} type="number" onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'pctSize', Number(v))} /></td>
                          <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.fgRmBl} type="number" onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'fgRmBl', Number(v))} /></td>
                          <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.fgRmBlk} type="number" onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'fgRmBlk', Number(v))} /></td>
                          <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.diff2} type="number" onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'diff2', Number(v))} className="text-red-500" /></td>
                          <td className="px-1 py-1 border-r border-slate-100"><InputCell value={row.bin} type="number" onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'bin', Number(v))} /></td>
                          <td className="px-1 py-1"><InputCell value={row.targetWeight} onChange={(v) => handleTableChange(sublotIdx, 'beltGateItems', idx, 'targetWeight', v)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 3. สายพาน Section */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-4">
                <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center space-x-2">
                  <GitMerge size={16} className="text-purple-600" />
                  <h3 className="text-md font-bold text-slate-800">สายพาน (Conveyor)</h3>
                </div>
                {renderCommonTable(sublot.conveyorItems, sublotIdx, 'conveyorItems')}
              </div>

              {/* 4. Icut Section */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center space-x-2">
                  <Scissors size={16} className="text-emerald-600" />
                  <h3 className="text-md font-bold text-slate-800">I-CUT</h3>
                </div>
                {renderCommonTable(sublot.icutItems, sublotIdx, 'icutItems')}
              </div>

            </div>
          ))}
        </div>
      )}

      {showRunModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex justify-center items-center p-4" onClick={() => setShowRunModal(false)}>
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 w-full max-w-md overflow-hidden flex flex-col p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-gray-900 mb-2">Ready to Generate Schedule</h3>
            <p className="text-sm text-gray-500 mb-6">The system has prepared the raw data for {targetDate}. Are you sure you want to proceed with the waterfall allocation?</p>

            <div className="flex gap-3">
              <button onClick={() => setShowRunModal(false)} disabled={loading} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 font-bold rounded-xl transition-all">Cancel</button>
              <button onClick={generateSchedule} disabled={loading} className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold rounded-xl shadow-lg shadow-blue-200 transition-all flex justify-center items-center gap-2">
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Generating...
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} /> OK, Generate
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send Batch Modal */}
      {showSendBatchModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex justify-center items-center p-4" onClick={() => setShowSendBatchModal(false)}>
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 w-full max-w-2xl overflow-hidden flex flex-col p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                  <ArrowRight size={16} />
                </div>
                Send Confirmed Recipes to Batch Auto
              </h3>
              <button onClick={() => setShowSendBatchModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <div className="space-y-4 mb-8 max-h-[60vh] overflow-y-auto pr-2">
              {Object.keys(modalSelectedItems).length > 0 ? (
                Object.keys(modalSelectedItems).map(itemCode => {
                  const recipeId = selectedRecipe[itemCode];
                  const recipe = recipesMap[itemCode]?.find((r: any) => String(r.RECIPE_ID) === String(recipeId));
                  if (!recipe) return null;

                  return (
                    <div key={itemCode} onClick={() => handleModalSelection(itemCode)} className={`border rounded-xl p-4 flex items-center gap-4 cursor-pointer transition-all ${modalSelectedItems[itemCode] ? 'border-blue-500 bg-blue-50/30' : 'border-gray-200 hover:border-gray-300'}`}>
                      <div className={`w-5 h-5 rounded flex items-center justify-center border ${modalSelectedItems[itemCode] ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300'}`}>
                        {modalSelectedItems[itemCode] && <Check size={14} />}
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-gray-900 text-sm">{itemCode}</p>
                        <p className="text-xs text-gray-500 mt-0.5">Recipe {recipe.RECIPE_NO} (v{recipe.RECIPE_VERSION}) - {recipe.RECIPE_DESC}</p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-center text-gray-400 font-medium py-10">No confirmed recipes available to send.</p>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowSendBatchModal(false)} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-all">Cancel</button>
              <button
                onClick={handleSendToBatchAuto}
                disabled={!Object.values(modalSelectedItems).some(Boolean)}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold rounded-xl shadow-lg shadow-blue-200 transition-all flex justify-center items-center gap-2"
              >
                <ArrowRight size={18} /> Confirm & Send
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default BlDpsPlan;
