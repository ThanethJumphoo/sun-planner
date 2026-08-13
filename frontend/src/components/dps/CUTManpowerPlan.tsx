import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Save, Settings, Target, Users } from 'lucide-react';

const API = import.meta.env.VITE_API_URL;

interface CUTManpowerPlanProps {
  targetDate: string;
  totalBirds: number;
  slaughteredWeight: number; // After 4% deduct
  totalRemainingMain?: number; // From Sublots Remaining Main 
}

export default function CUTManpowerPlan({ targetDate, totalBirds, slaughteredWeight, totalRemainingMain = 0 }: CUTManpowerPlanProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Machine Configs
  const [machines, setMachines] = useState<any[]>([]);

  // Manpower State
  const [manpower, setManpower] = useState({
    orderBilScKg: 8880,
    targetWorkers: 312,
    currentWorkers: 387,
    serviceBlPax: 13,
    inServiceLjPax: 4,
    serviceNsInPax: 8,
    enInShortSkinPax: 6,
    brokenLegDebonePax: 2,
    rmWalkPax: 7,
    hygienePax: 17,
    erpDocPax: 4,
    autoSyncSc: false, // New toggle
  });

  useEffect(() => {
    fetchData();
  }, [targetDate]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [machineRes, manpowerRes] = await Promise.all([
        axios.get(`${API}/api/machine-config`),
        axios.get(`${API}/api/dps/${targetDate}/manpower?partType=leg`),
      ]);
      setMachines(machineRes.data);

      if (manpowerRes.data.exists) {
        setManpower((prev) => ({ ...prev, ...manpowerRes.data.data }));
      }
    } catch (e) {
      console.error('Error fetching manpower data', e);
    } finally {
      setLoading(false);
    }
  };

  const getMachine = (key: string) => machines.find(m => m.machineKey === key && m.isActive);

  // Calculations based on Excel
  const calc = useMemo(() => {
    // Basic Weights
    const bilLCTotal = slaughteredWeight * 0.25; // 25% yield
    
    // **CRITICAL CHANGE:** bilLCDebone is exactly the Rem. Main from sublots (The Whole Leg sent to debone)
    const bilLCDebone = totalRemainingMain;
    
    // The amount of BIL used in allocations is the difference between Total and Debone
    const autoBilScKg = bilLCTotal - bilLCDebone;
    
    // RM BL is 77% of the Whole Leg that goes to debone
    const rmBL = bilLCDebone * 0.77; 
    
    const piecesBl = (rmBL / 0.223).toFixed(0); // Approximate weight per BL piece is ~223g
    const totalBlPieces = Number(piecesBl) || 0;
    
    // Machine capacities (assuming 9.58 hours)
    const workHours = 9.58;
    
    const foodmate = getMachine('auto_foodmate');
    const toridas = getMachine('toridas');
    const manualCutLeg = getMachine('manual_cut_leg');
    const manualScrapeBl = getMachine('manual_scrape_bl');
    const deboneBl = getMachine('manual_debone_bl');
    const xrayBl = getMachine('xray_bl');
    const specCheckBl = getMachine('spec_check_bl');
    const manualNs = getMachine('manual_cut_ns');

    // --- Dynamic Shift & Volume Allocation (MPS Logic) ---
    let remainingPieces = totalBlPieces;
    
    const toridasSpeed = toridas?.capacityPcsPerHour || 1500;
    const foodmateSpeed = foodmate?.capacityPcsPerHour || 6000;
    const xraySpeed = xrayBl?.capacityPcsPerHour || 6000;
    
    // Capacities per shift
    const toridasCapPerShift = (toridas?.defaultLines || 3) * (toridas?.machinesPerLine || 4) * toridasSpeed * workHours;
    const foodmateCapPerShift = (foodmate?.defaultLines || 1) * (foodmate?.machinesPerLine || 1) * foodmateSpeed * workHours;
    const totalAutoDeboneCapPerShift = toridasCapPerShift + foodmateCapPerShift;

    // Determine shifts needed for debone based on volume
    let shiftsNeeded = 0;
    if (remainingPieces > 0) {
      if (remainingPieces <= toridasCapPerShift) {
        shiftsNeeded = 1;
      } else if (remainingPieces <= toridasCapPerShift * 2) {
        shiftsNeeded = 2;
      } else {
        shiftsNeeded = Math.ceil(remainingPieces / totalAutoDeboneCapPerShift);
        if (shiftsNeeded < 2) shiftsNeeded = 2;
      }
    }

    const piecesPerShift = shiftsNeeded > 0 ? Math.ceil(remainingPieces / shiftsNeeded) : 0;

    // Waterfall priority for Debone
    const toridasInputPcsPerShift = Math.min(piecesPerShift, toridasCapPerShift);
    const leftoverPcsPerShift = Math.max(0, piecesPerShift - toridasInputPcsPerShift);
    const foodmateInputPcsPerShift = Math.min(leftoverPcsPerShift, foodmateCapPerShift);
    // User requested Debone BL to always calculate from the full BL pieces
    const manualDebonePcsPerShift = piecesPerShift;

    // Calculate Debone Workers
    let toridasPax = 0;
    let toridasLinesNeeded = 0;
    if (toridasInputPcsPerShift > 0) {
      const capPerToridasLine = (toridas?.machinesPerLine || 4) * toridasSpeed * workHours;
      toridasLinesNeeded = Math.ceil(toridasInputPcsPerShift / capPerToridasLine);
      toridasPax = toridasLinesNeeded * (toridas?.workersPerUnit || 5) * shiftsNeeded;
    }

    let autoFoodmatePax = 0;
    let foodmateLinesNeeded = 0;
    if (foodmateInputPcsPerShift > 0) {
      const capPerFoodmateLine = (foodmate?.machinesPerLine || 1) * foodmateSpeed * workHours;
      foodmateLinesNeeded = Math.ceil(foodmateInputPcsPerShift / capPerFoodmateLine);
      autoFoodmatePax = foodmateLinesNeeded * (foodmate?.workersPerUnit || 5) * shiftsNeeded;
    }

    let deboneBlPax = 0;
    if (manualDebonePcsPerShift > 0) {
      const manualDeboneSpeedHr = deboneBl?.capacityPcsPerHour || (11.5 * 60);
      const deboneWorkHoursPerShift = manualDebonePcsPerShift / manualDeboneSpeedHr;
      deboneBlPax = Math.ceil(deboneWorkHoursPerShift / workHours) * shiftsNeeded;
    }

    // Other Manual Roles (processing all BL pieces)
    const cutLegSpeedHr = manualCutLeg?.capacityPcsPerHour || (18 * 60);
    const cutLegWorkHoursPerShift = piecesPerShift / cutLegSpeedHr;
    const cutLegPax = piecesPerShift > 0 ? Math.ceil(cutLegWorkHoursPerShift / workHours) * shiftsNeeded : 0;

    const scrapeSpeedHr = manualScrapeBl?.capacityPcsPerHour || (18 * 60);
    const scrapeWorkHoursPerShift = piecesPerShift / scrapeSpeedHr;
    const scrapeBlPax = piecesPerShift > 0 ? Math.ceil(scrapeWorkHoursPerShift / workHours) * shiftsNeeded : 0;

    // Spec Check and X-Ray (linked to lines)
    // Assume spec check is 1 worker per debone line
    const totalDeboneLines = toridasLinesNeeded + foodmateLinesNeeded;
    const specCheckPax = totalDeboneLines > 0 ? totalDeboneLines * (specCheckBl?.workersPerUnit || 2) * shiftsNeeded : 0;

    let xrayPax = 0;
    if (piecesPerShift > 0) {
      const xrayCapPerShift = xraySpeed * workHours;
      const xrayMachinesNeeded = Math.ceil(piecesPerShift / xrayCapPerShift);
      const xrayCount = Math.min(xrayBl?.defaultLines || 3, xrayMachinesNeeded);
      xrayPax = xrayCount * (xrayBl?.workersPerUnit || 2) * shiftsNeeded;
    }

    // NS Processing
    const nsPieces = totalBlPieces > 0 ? totalBirds * 2 : 0; 
    const nsPiecesPerShift = shiftsNeeded > 0 ? Math.ceil(nsPieces / shiftsNeeded) : (nsPieces > 0 ? nsPieces : 0);
    const nsShifts = shiftsNeeded > 0 ? shiftsNeeded : 1;
    const nsSpeedHr = manualNs?.capacityPcsPerHour || (5.5 * 60);
    const nsWorkHoursPerShift = nsPiecesPerShift / nsSpeedHr;
    const nsPax = nsPiecesPerShift > 0 ? Math.ceil(nsWorkHoursPerShift / workHours) * nsShifts : 0;

    const calculatedRoles = cutLegPax + autoFoodmatePax + deboneBlPax + toridasPax + scrapeBlPax + specCheckPax + xrayPax + nsPax;

    const fixedRoles = manpower.serviceBlPax + manpower.inServiceLjPax + manpower.serviceNsInPax + 
                       manpower.enInShortSkinPax + manpower.brokenLegDebonePax + manpower.rmWalkPax + 
                       manpower.hygienePax + manpower.erpDocPax;
                       
    const totalWorkers = calculatedRoles + fixedRoles;
    const diff = manpower.currentWorkers - manpower.targetWorkers;

    return {
      bilLCTotal, bilLCDebone, autoBilScKg, rmBL, totalBlPieces,
      autoFoodmatePax, cutLegPax, deboneBlPax, scrapeBlPax, toridasPax, xrayPax, specCheckPax, nsPax,
      calculatedRoles, fixedRoles, totalWorkers, diff,
      shiftsNeeded, toridasLinesNeeded, foodmateLinesNeeded,
      toridasInputPcsPerShift, foodmateInputPcsPerShift, manualDebonePcsPerShift
    };
  }, [slaughteredWeight, manpower, machines, totalBirds, totalRemainingMain]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/api/dps/${targetDate}/manpower`, {
        partType: 'leg',
        ...manpower
      });
      alert('บันทึกแผนกำลังคนสำเร็จ (Manpower Plan Saved)');
    } catch (e) {
      console.error('Error saving manpower', e);
      alert('บันทึกล้มเหลว');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500 animate-pulse">กำลังโหลดข้อมูลกำลังคน...</div>;

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden mb-8 mt-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-6 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="bg-white/20 p-3 rounded-2xl">
            <Users className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white mb-1 tracking-wide">CUT Manpower Plan</h2>
            <p className="text-orange-100 font-medium">แผนจัดการกำลังคนแผนก CUT (ตัดแต่ง) - ประจำวันที่ {targetDate}</p>
          </div>
        </div>
        <button 
          onClick={handleSave} disabled={saving}
          className="bg-white text-orange-600 hover:bg-orange-50 font-bold py-3 px-6 rounded-xl flex items-center gap-2 transition-all shadow-lg"
        >
          {saving ? <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" /> : <Save size={20} />}
          บันทึกแผนกำลังคน
        </button>
      </div>

      <div className="p-8 grid grid-cols-1 xl:grid-cols-3 gap-8">
        
        {/* Column 1: Manual Inputs & Base Calc */}
        <div className="space-y-6">
          <div className="bg-gray-50 p-6 rounded-2xl border border-gray-200">
            <h3 className="font-bold text-gray-800 text-lg mb-4 flex items-center gap-2"><Target className="w-5 h-5 text-blue-500" /> ข้อมูลตั้งต้นรายวัน</h3>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                <span className="text-gray-600 text-sm">จำนวนตัวไก่เนื้อ (ตัว/วัน)</span>
                <span className="font-bold text-gray-900">{totalBirds.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                <span className="text-gray-600 text-sm">นน.ไก่ชำแหละ (หัก 4%)</span>
                <span className="font-bold text-gray-900">{slaughteredWeight.toLocaleString('en-US', {maximumFractionDigits:0})} kg</span>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-blue-500 mb-1">นน. BIL ที่ถูกดึงไปผลิต (kg)</label>
                <div className="w-full bg-blue-50 border border-blue-200 text-blue-900 font-bold rounded-xl p-3 flex justify-between items-center shadow-inner">
                  <span>{calc.autoBilScKg.toLocaleString('en-US', {maximumFractionDigits:0})}</span>
                  <span className="text-xs font-medium text-blue-600 bg-blue-100/80 px-2 py-1 rounded-md border border-blue-200">ดึงอัตโนมัติจากการผลิต</span>
                </div>
              </div>

              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 space-y-2 mt-4">
                <div className="flex justify-between items-center pb-2 border-b border-blue-200/50">
                  <span className="text-blue-800 text-sm">นน. BIL L/C ทั้งหมด (25%)</span>
                  <span className="font-bold text-blue-900">{calc.bilLCTotal.toLocaleString('en-US', {maximumFractionDigits:0})}</span>
                </div>

                <div className="flex justify-between items-center pb-2 border-b border-blue-200">
                  <span className="text-blue-800 text-sm">RM BL ที่ Debone (จาก Rem. Main)</span>
                  <span className="font-bold text-blue-900">{calc.rmBL.toLocaleString('en-US', {maximumFractionDigits:0})}</span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-blue-200">
                  <span className="text-blue-800 font-bold">จำนวนชิ้น BL แผ่นโดยประมาณ</span>
                  <span className="font-black text-blue-900 text-lg">{calc.totalBlPieces.toLocaleString('en-US')} ชิ้น</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Column 2: Calculated Roles */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
            <h3 className="font-bold text-gray-800 text-lg mb-4 flex items-center gap-2"><Settings className="w-5 h-5 text-indigo-500" /> จำนวนคนตาม Capacity เครื่อง</h3>
            
            <div className="space-y-3">
              {[
                { label: 'กรีดน่องรวม (18 ชิ้น/นาที)', pax: calc.cutLegPax, info: calc.cutLegPax > 0 ? `(${calc.shiftsNeeded} กะ)` : '' },
                { label: 'Auto Debone (Foodmate)', pax: calc.autoFoodmatePax, info: calc.autoFoodmatePax > 0 ? `(${calc.foodmateLinesNeeded} ไลน์, ${calc.shiftsNeeded} กะ)` : '' },
                { label: 'Debone BL (11.5 ชิ้น/นาที)', pax: calc.deboneBlPax, info: calc.deboneBlPax > 0 ? `(${calc.shiftsNeeded} กะ)` : '' },
                { label: 'เครื่อง Toridas', pax: calc.toridasPax, info: calc.toridasPax > 0 ? `(${calc.toridasLinesNeeded} ไลน์, ${calc.shiftsNeeded} กะ)` : '' },
                { label: 'ขูดขน (18 ชิ้น/นาที)', pax: calc.scrapeBlPax, info: calc.scrapeBlPax > 0 ? `(${calc.shiftsNeeded} กะ)` : '' },
                { label: 'ตรวจ spec BL', pax: calc.specCheckPax, info: calc.specCheckPax > 0 ? `(${calc.shiftsNeeded} กะ)` : '' },
                { label: 'X-ray BL', pax: calc.xrayPax, info: calc.xrayPax > 0 ? `(${calc.shiftsNeeded} กะ)` : '' },
                { label: 'ทำ นส. (5.5 ชิ้น/นาที)', pax: calc.nsPax, info: calc.nsPax > 0 ? `(${calc.shiftsNeeded > 0 ? calc.shiftsNeeded : 1} กะ)` : '' },
              ].map((role, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 hover:bg-gray-50 rounded-lg transition-colors border-b border-gray-100 last:border-0">
                  <div className="flex flex-col">
                    <span className="text-gray-700 text-sm">{role.label}</span>
                    {role.info && <span className="text-xs font-medium text-indigo-400 mt-0.5">{role.info}</span>}
                  </div>
                  <span className="font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg min-w-[60px] text-center">{role.pax || 0} คน</span>
                </div>
              ))}
            </div>
            
            <div className="mt-4 p-4 bg-indigo-600 text-white rounded-xl flex justify-between items-center shadow-lg shadow-indigo-600/20">
              <span className="font-bold">รวมกำลังคนเครื่องจักร</span>
              <span className="text-2xl font-black">{calc.calculatedRoles}</span>
            </div>
          </div>
        </div>

        {/* Column 3: Fixed Roles */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
            <h3 className="font-bold text-gray-800 text-lg mb-4">ตำแหน่งบริการทั่วไป (แก้ไขได้)</h3>
            
            <div className="space-y-3">
              {[
                { key: 'serviceBlPax', label: 'บริการจุดงาน BL A+B' },
                { key: 'inServiceLjPax', label: 'IN+บริการจุดงาน LJ+ชั่งกระดูก+...' },
                { key: 'serviceNsInPax', label: 'บริการ นส.+IN (2+2)' },
                { key: 'enInShortSkinPax', label: 'EN=IN+ข้อสั้น+หนัง' },
                { key: 'brokenLegDebonePax', label: 'ขาหัก+Deboneมือ+เศษBL' },
                { key: 'rmWalkPax', label: 'RM+เดินยอด (3+1)*2' },
                { key: 'hygienePax', label: 'อนามัย+สวมถุง+ล้างมีด+ฯลฯ' },
                { key: 'erpDocPax', label: 'เอกสาร+erp' },
              ].map((role) => (
                <div key={role.key} className="flex justify-between items-center group">
                  <span className="text-gray-600 text-xs truncate max-w-[200px]" title={role.label}>{role.label}</span>
                  <input 
                    type="number" 
                    value={(manpower as any)[role.key] || 0}
                    onChange={(e) => setManpower(p => ({...p, [role.key]: Number(e.target.value)}))}
                    className="w-20 bg-gray-50 border border-gray-200 text-gray-900 font-bold rounded-lg p-2 text-center focus:ring-2 focus:ring-orange-500 group-hover:bg-white transition-colors"
                  />
                </div>
              ))}
            </div>
            
            <div className="mt-4 p-4 bg-gray-100 text-gray-800 rounded-xl flex justify-between items-center border border-gray-200">
              <span className="font-bold">รวมพนักงานบริการ</span>
              <span className="text-xl font-black">{calc.fixedRoles}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Footer */}
      <div className="bg-gray-900 p-8 text-white flex flex-col md:flex-row justify-between items-center rounded-b-3xl">
        <div className="mb-4 md:mb-0">
          <h3 className="text-xl font-bold text-gray-200">สรุปความต้องการกำลังคนรวม</h3>
          <p className="text-gray-400 text-sm mt-1">อิงตาม Capacity เครื่องจักรและเป้าหมายการผลิตประจำวัน</p>
        </div>
        <div className="flex items-center gap-6">
          <div className="bg-gray-800 px-8 py-4 rounded-2xl border border-gray-700 text-center shadow-inner">
            <div className="text-gray-400 text-sm font-bold mb-1 uppercase tracking-wider">ยอดคนที่ระบบคำนวณได้ทั้งหมด</div>
            <div className="text-4xl font-black text-orange-400">{calc.totalWorkers} <span className="text-xl font-medium text-gray-500">คน</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
