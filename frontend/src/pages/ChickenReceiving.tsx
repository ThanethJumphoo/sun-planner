import { useState, useMemo, useEffect } from 'react';
import { Calendar as CalendarIcon, Plus, CalendarDays, Activity, Truck, BarChart2, Clock, MapPin, Search, X, Edit, Upload, Trash2 } from 'lucide-react';
import ImportModal from '../components/ImportModal';
import CustomSelect from '../components/common/CustomSelect';
import CustomDatePicker from '../components/common/CustomDatePicker';

const CHICKEN_TYPE_OPTIONS = [
  { value: 'ไก่เนื้อ', label: 'ไก่เนื้อ' },
  { value: 'ไก่ไข่', label: 'ไก่ไข่' },
  { value: 'ไก่พันธุ์', label: 'ไก่พันธุ์' }
];

const SHIFT_OPTIONS = [
  { value: 'A', label: 'Shift A (เช้า)' },
  { value: 'B', label: 'Shift B (ดึก)' }
];

const SEX_OPTIONS = [
  { value: 'ผู้', label: 'ตัวผู้' },
  { value: 'เมีย', label: 'ตัวเมีย' },
  { value: 'รวม', label: 'รวม' }
];

const HEALTH_OPTIONS = [
  { value: 'ปกติ', label: 'ปกติ' },
  { value: 'ไม่ปกติ', label: 'ไม่ปกติ' }
];

const tabs = [
  { id: 'monthly', label: 'Monthly Planning', icon: CalendarDays },
  { id: 'weekly', label: 'Weekly Planning', icon: CalendarIcon },
  { id: 'daily', label: 'Daily Scheduling', icon: Activity },
  { id: 'actual', label: 'Actual Receiving', icon: Truck },
  { id: 'reports', label: 'Reports', icon: BarChart2 },
];

// --- Date Helper Functions ---
const getMonthName = (date: Date) => date.toLocaleString('default', { month: 'long', year: 'numeric' });
const getDayName = (date: Date) => date.toLocaleString('default', { weekday: 'short' });
const isSameDay = (d1: Date, d2: Date) => d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();

const addMonths = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth() + amount, 1);
const addWeeks = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount * 7);
const addDays = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);

const startOfWeek = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
};

// Local-safe date formatter (avoids toISOString UTC timezone shift)
const formatLocalDate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export default function ChickenReceiving() {
  const [activeTab, setActiveTab] = useState('monthly');
  const [currentDate, setCurrentDate] = useState(new Date());

  // Data State
  const [records, setRecords] = useState<any[]>([]);

  // Fetch Data
  const fetchData = async () => {
    if (activeTab === 'reports') return;
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/chicken-receiving/${activeTab}`);
      if (response.ok) {
        const data = await response.json();
        setRecords(data);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const emptyForm = {
    id: null,
    receive_date: formatLocalDate(new Date()),
    receive_time: '06:00',
    chicken_type: 'ไก่เนื้อ',
    chicken_count: '',
    chicken_weight: '',
    farm_name: '',
    farm_name_standard: '',
    house: '',
    health: 'ปกติ',
    shift: 'A',
    sex: 'ผู้',
    batch: '',
    sublot: ''
  };
  const [formData, setFormData] = useState<any>(emptyForm);

  const openNewModal = () => {
    setFormData(emptyForm);
    setIsModalOpen(true);
  };

  const handleEdit = (e: React.MouseEvent, record: any) => {
    e.stopPropagation(); // prevent triggering parent clicks
    setFormData({
      ...emptyForm,
      ...record,
      receive_date: record.receive_date ? (typeof record.receive_date === 'string' ? record.receive_date.split('T')[0] : formatLocalDate(new Date(record.receive_date))) : emptyForm.receive_date,
      receive_time: record.receive_time ? record.receive_time.substring(0, 5) : emptyForm.receive_time
    });
    setIsModalOpen(true);
  };

  const handleDelete = async () => {
    if (!formData.id) return;
    if (!window.confirm("Are you sure you want to delete this schedule?")) return;

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/chicken-receiving/${activeTab}/${formData.id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setIsModalOpen(false);
        fetchData();
      } else {
        alert('Failed to delete schedule');
      }
    } catch (error) {
      console.error('Error deleting data:', error);
      alert('Error connecting to the server');
    }
  };

  // Calculate Avg dynamically (weight / count)
  const computedAvg = useMemo(() => {
    const count = Number(formData.chicken_count);
    const weight = Number(formData.chicken_weight);
    if (count > 0 && weight > 0) {
      return (weight / count).toFixed(2);
    }
    return '0.00';
  }, [formData.chicken_count, formData.chicken_weight]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSave = async () => {
    const payload = { ...formData, chicken_avg: computedAvg };
    const method = formData.id ? 'PUT' : 'POST';
    const url = formData.id
      ? `${import.meta.env.VITE_API_URL}/api/chicken-receiving/${activeTab}/${formData.id}`
      : `${import.meta.env.VITE_API_URL}/api/chicken-receiving/${activeTab}`;

    // Clean up empty fields that don't belong to the active tab
    if (activeTab === 'monthly') {
      delete payload.receive_time;
      delete payload.shift;
      delete payload.farm_name;
      delete payload.farm_name_standard;
      delete payload.house;
      delete payload.health;
      delete payload.sex;
      delete payload.batch;
      delete payload.sublot;
    } else if (activeTab === 'weekly') {
      delete payload.receive_time;
      delete payload.sublot;
    } else if (['daily', 'actual'].includes(activeTab)) {
      delete payload.health;
      delete payload.batch;
    }

    // Remove UI-specific layout properties
    delete payload.topPx;
    delete payload.colIndex;
    delete payload.totalCols;

    // Remove id from payload
    delete payload.id;

    // Remove empty string fields to send null
    Object.keys(payload).forEach(key => {
      if (payload[key] === '') delete payload[key];
    });

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        setIsModalOpen(false);
        fetchData(); // Reload data immediately
      } else {
        alert('Failed to save schedule');
      }
    } catch (error) {
      console.error('Error saving data:', error);
      alert('Error connecting to the server');
    }
  };

  const handlePrev = () => {
    if (activeTab === 'monthly') setCurrentDate(addMonths(currentDate, -1));
    else if (activeTab === 'weekly') setCurrentDate(addWeeks(currentDate, -1));
    else if (activeTab === 'daily') setCurrentDate(addDays(currentDate, -1));
  };

  const handleNext = () => {
    if (activeTab === 'monthly') setCurrentDate(addMonths(currentDate, 1));
    else if (activeTab === 'weekly') setCurrentDate(addWeeks(currentDate, 1));
    else if (activeTab === 'daily') setCurrentDate(addDays(currentDate, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const renderMonthlyCalendar = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const gridCells = [];
    for (let i = firstDayOfMonth - 1; i >= 0; i--) gridCells.push({ dayNum: daysInPrevMonth - i, isCurrentMonth: false, date: new Date(year, month - 1, daysInPrevMonth - i) });
    for (let i = 1; i <= daysInMonth; i++) gridCells.push({ dayNum: i, isCurrentMonth: true, date: new Date(year, month, i) });
    const remainingCells = 42 - gridCells.length;
    for (let i = 1; i <= remainingCells; i++) gridCells.push({ dayNum: i, isCurrentMonth: false, date: new Date(year, month + 1, i) });

    const today = new Date();

    return (
      <div className="animate-slide-up">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-gray-800">{getMonthName(currentDate)}</h2>
          <div className="flex gap-2">
            <button onClick={handlePrev} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 font-medium">Prev</button>
            <button onClick={handleToday} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 font-medium">Today</button>
            <button onClick={handleNext} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 font-medium">Next</button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200 rounded-xl overflow-hidden">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="bg-gray-50 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">{day}</div>
          ))}
          {gridCells.map((d, i) => {
            const isToday = isSameDay(d.date, today);
            const dayRecords = records.filter(r => r.receive_date && isSameDay(new Date(r.receive_date), d.date));

            return (
              <div key={i} className={`bg-white min-h-[120px] p-2 hover:bg-orange-50/30 transition-colors relative group ${!d.isCurrentMonth ? 'opacity-50 bg-gray-50' : ''}`}>
                <span className={`text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full ${isToday ? 'bg-orange-500 text-white shadow-md' : 'text-gray-700'}`}>
                  {d.dayNum}
                </span>

                {dayRecords.length > 0 && d.isCurrentMonth && (
                  <div className="mt-2 space-y-1.5 h-full max-h-[80px] overflow-y-auto custom-scrollbar">
                    {dayRecords.map((record, rIdx) => (
                      <div
                        key={rIdx}
                        onClick={(e) => handleEdit(e, record)}
                        className="space-y-1 cursor-pointer group/card hover:scale-105 transition-transform"
                      >
                        <div className="text-[11px] font-medium bg-blue-50 text-blue-700 px-2 py-1 rounded-md border border-blue-100 flex items-center justify-between">
                          <span>{Number(record.chicken_count).toLocaleString()} Birds</span>
                          <Edit size={10} className="opacity-0 group-hover/card:opacity-100" />
                        </div>
                        <div className="text-[11px] font-medium bg-emerald-50 text-emerald-700 px-2 py-1 rounded-md border border-emerald-100">
                          Avg: {record.chicken_avg} kg
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

  const renderWeeklyCalendar = () => {
    const sOfWeek = startOfWeek(currentDate);
    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sOfWeek);
      d.setDate(d.getDate() + i);
      return d;
    });

    const today = new Date();

    return (
      <div className="animate-slide-up">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-gray-800">{getMonthName(currentDate)}</h2>
          <div className="flex gap-2">
            <button onClick={handlePrev} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 font-medium">Prev Week</button>
            <button onClick={handleToday} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 font-medium">This Week</button>
            <button onClick={handleNext} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 font-medium">Next Week</button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-4">
          {weekDays.map((dayObj, i) => {
            const isToday = isSameDay(dayObj, today);
            const dayRecords = records.filter(r => r.receive_date && isSameDay(new Date(r.receive_date), dayObj));

            return (
              <div key={i} className="flex flex-col bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
                <div className={`p-3 text-center border-b border-gray-200 font-bold ${isToday ? 'bg-orange-100 text-orange-800' : 'bg-white text-gray-700'}`}>
                  {getDayName(dayObj)} {dayObj.getDate()}
                </div>
                {dayRecords.length > 0 && (
                  <div className="bg-orange-50/60 border-b border-orange-100/50 p-2 flex justify-between items-center px-3 shadow-sm">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-orange-600/80 font-bold uppercase tracking-wider">Total Birds</span>
                      <span className="text-sm font-black text-orange-800">
                        {dayRecords.reduce((sum, r) => sum + Number(r.chicken_count || 0), 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex flex-col text-right">
                      <span className="text-[10px] text-orange-600/80 font-bold uppercase tracking-wider">Avg Weight</span>
                      <span className="text-sm font-black text-orange-800">
                        {(() => {
                          const tb = dayRecords.reduce((sum, r) => sum + Number(r.chicken_count || 0), 0);
                          const tw = dayRecords.reduce((sum, r) => sum + Number(r.chicken_weight || 0), 0);
                          return tb > 0 ? (tw / tb).toFixed(2) : '0.00';
                        })()} <span className="text-[10px]">kg</span>
                      </span>
                    </div>
                  </div>
                )}
                <div className="p-2 space-y-3 min-h-[400px]">
                  {dayRecords.map((record, rIdx) => (
                    <div
                      key={rIdx}
                      onClick={(e) => handleEdit(e, record)}
                      className="bg-white p-3 rounded-lg shadow-sm border border-gray-100 cursor-pointer hover:border-orange-400 transition-colors group relative"
                    >
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Edit size={14} className="text-orange-500" />
                      </div>
                      <div className="text-xs font-bold text-gray-800 mb-1">Shift {record.shift || '-'}</div>
                      <div className="text-xs font-medium mb-1 truncate text-gray-600 flex items-center gap-1"><MapPin size={12} />{record.farm_name || record.farm_name_standard || 'N/A'}</div>
                      <div className="flex justify-between items-center text-xs font-medium mt-2">
                        <span className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">{Number(record.chicken_count).toLocaleString()}</span>
                        <span className="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">{record.chicken_avg}kg</span>
                      </div>
                    </div>
                  ))}
                  {dayRecords.length === 0 && <div className="text-center text-xs text-gray-400 mt-4">No schedule</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDailyTimeline = () => {
    // Filter records by currentDate
    const dayRecords = records.filter(r => r.receive_date && isSameDay(new Date(r.receive_date), currentDate));

    // Calculate vertical positions and group overlapping records
    const positionedRecords = dayRecords.map((r, idx) => {
      let topPx = idx * 70; // fallback
      if (r.receive_time) {
        const [h, m] = r.receive_time.split(':').map(Number);
        topPx = (h * 64) + ((m / 60) * 64);
      }
      return { ...r, topPx };
    }).sort((a, b) => a.topPx - b.topPx);

    // Grouping overlapping elements
    const overlappingGroups: any[][] = [];
    let currentGroup: any[] = [];
    let groupEndPx = -1;

    positionedRecords.forEach(r => {
      if (r.topPx >= groupEndPx) {
        if (currentGroup.length > 0) overlappingGroups.push(currentGroup);
        currentGroup = [r];
        groupEndPx = r.topPx + 65; // card height ~60px + 5px gap
      } else {
        currentGroup.push(r);
        groupEndPx = Math.max(groupEndPx, r.topPx + 65);
      }
    });
    if (currentGroup.length > 0) overlappingGroups.push(currentGroup);

    // Assign columns within each group
    const finalRecords: any[] = [];
    overlappingGroups.forEach(group => {
      const cols: any[][] = [];
      group.forEach(r => {
        let placed = false;
        for (let i = 0; i < cols.length; i++) {
          const lastInCol = cols[i][cols[i].length - 1];
          if (r.topPx >= lastInCol.topPx + 65) {
            cols[i].push(r);
            r.colIndex = i;
            placed = true;
            break;
          }
        }
        if (!placed) {
          cols.push([r]);
          r.colIndex = cols.length - 1;
        }
      });
      group.forEach(r => {
        r.totalCols = cols.length;
        finalRecords.push(r);
      });
    });

    return (
      <div className="animate-slide-up">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-gray-800">
            {currentDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </h2>
          <div className="flex gap-2">
            <button onClick={handlePrev} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 font-medium">Prev Day</button>
            <button onClick={handleToday} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 font-medium">Today</button>
            <button onClick={handleNext} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 font-medium">Next Day</button>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex">
          <div className="w-24 bg-gray-50 border-r border-gray-200 shrink-0">
            {Array.from({ length: 24 }, (_, i) => i).map(hour => (
              <div key={hour} className="h-16 border-b border-gray-200 flex items-start justify-center py-2 text-xs font-bold text-gray-500">
                {`${hour.toString().padStart(2, '0')}:00`}
              </div>
            ))}
          </div>
          <div className="flex-1 relative bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjY0Ij48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjEwMCUiIGhlaWdodD0iNjQiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiPjxwYXRoIGQ9Ik0wIDY0TDEwMCUgNjQiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2U1ZTdlYiIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] min-h-[1536px]">

            {finalRecords.length === 0 && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 text-gray-400 font-medium flex flex-col items-center">
                <CalendarIcon size={32} className="mb-2 opacity-50" />
                No schedules for this day
              </div>
            )}

            {finalRecords.map((record, idx) => {
              const colors = ['bg-blue-50 border-blue-200', 'bg-emerald-50 border-emerald-200', 'bg-amber-50 border-amber-200', 'bg-purple-50 border-purple-200'];
              const textColors = ['text-blue-900', 'text-emerald-900', 'text-amber-900', 'text-purple-900'];
              const subTextColors = ['text-blue-700', 'text-emerald-700', 'text-amber-700', 'text-purple-700'];
              const themeIdx = idx % colors.length;

              return (
                <div
                  key={idx}
                  onClick={(e) => handleEdit(e, record)}
                  className={`absolute h-[60px] ${colors[themeIdx]} border rounded-lg p-3 shadow-sm hover:shadow-md hover:border-orange-400 transition-all cursor-pointer flex justify-between items-center group overflow-hidden`}
                  style={{
                    top: `${record.topPx}px`,
                    left: `calc(16px + (100% - 32px) / ${record.totalCols} * ${record.colIndex})`,
                    width: `calc((100% - 32px) / ${record.totalCols} - 4px)`
                  }}
                >
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 p-0.5 rounded-md">
                    <Edit size={14} className="text-orange-500" />
                  </div>
                  <div className="truncate flex-1">
                    <div className={`font-bold ${textColors[themeIdx]} text-sm flex items-center gap-1.5 truncate`}>
                      <Truck size={14} className="shrink-0" /> <span className="truncate">{record.farm_name || 'Farm Not Set'} {record.shift && `(S.${record.shift})`}</span>
                    </div>
                    <div className={`text-xs ${subTextColors[themeIdx]} mt-1 flex items-center gap-2 truncate`}>
                      <span className="flex items-center gap-1 shrink-0"><Clock size={10} /> {record.receive_time?.substring(0, 5) || '--:--'}</span>
                      {record.sublot && <span className="flex items-center gap-1 shrink-0 truncate"><MapPin size={10} /> {record.sublot}</span>}
                    </div>
                  </div>
                  {record.totalCols <= 2 && (
                    <div className="text-right shrink-0 ml-2">
                      <div className={`font-bold ${textColors[themeIdx]} text-sm`}>{Number(record.chicken_count).toLocaleString()} 🐔</div>
                      <div className={`text-[10px] ${subTextColors[themeIdx]}`}>{record.chicken_avg} kg/b</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderModalForm = () => {
    return (
      <div className="space-y-4">
        {/* Common Fields */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Receive Date</label>
            <CustomDatePicker
              value={formData.receive_date}
              onChange={(val) => setFormData({ ...formData, receive_date: val })}
            />
          </div>
          {['monthly', 'weekly'].includes(activeTab) ? (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Chicken Type</label>
              <CustomSelect
                options={CHICKEN_TYPE_OPTIONS}
                value={formData.chicken_type}
                onChange={(val) => setFormData({ ...formData, chicken_type: val })}
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Receive Time</label>
              <input type="time" name="receive_time" value={formData.receive_time} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500" />
            </div>
          )}
        </div>

        {activeTab !== 'monthly' && (
          <div className="grid grid-cols-2 gap-4">
            {activeTab !== 'weekly' && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Chicken Type</label>
                <CustomSelect
                  options={CHICKEN_TYPE_OPTIONS}
                  value={formData.chicken_type}
                  onChange={(val) => setFormData({ ...formData, chicken_type: val })}
                />
              </div>
            )}
            <div className={activeTab === 'weekly' ? 'col-span-2' : ''}>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Shift</label>
              <CustomSelect
                options={SHIFT_OPTIONS}
                value={formData.shift}
                onChange={(val) => setFormData({ ...formData, shift: val })}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Total Count (Birds)</label>
            <input type="number" name="chicken_count" placeholder="e.g. 2970" value={formData.chicken_count} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Total Weight (Kg)</label>
            <input type="number" name="chicken_weight" placeholder="e.g. 8019" value={formData.chicken_weight} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Average (Kg/Bird)</label>
            <input type="text" value={computedAvg} readOnly className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
          </div>
        </div>

        {['weekly', 'daily', 'actual'].includes(activeTab) && (
          <>
            <div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Farm Name</label>
                <input type="text" name="farm_name" placeholder="ชื่อฟาร์ม" value={formData.farm_name} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Standard Farm Name</label>
                <input type="text" name="farm_name_standard" placeholder="ชื่อมาตรฐานฟาร์ม" value={formData.farm_name_standard} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">House (เล้า)</label>
                <input type="text" name="house" value={formData.house} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Sex (เพศ)</label>
                <CustomSelect
                  options={SEX_OPTIONS}
                  value={formData.sex}
                  onChange={(val) => setFormData({ ...formData, sex: val })}
                />
              </div>

              {activeTab === 'weekly' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Health Status</label>
                  <CustomSelect
                    options={HEALTH_OPTIONS}
                    value={formData.health}
                    onChange={(val) => setFormData({ ...formData, health: val })}
                  />
                </div>
              )}
            </div>

            {activeTab === 'weekly' && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Batch (รุ่น)</label>
                <input type="text" name="batch" value={formData.batch} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500" />
              </div>
            )}

            {['daily', 'actual'].includes(activeTab) && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Sublot</label>
                <input type="text" name="sublot" placeholder="e.g. 01,02" value={formData.sublot} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500" />
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12 relative">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 animate-slide-up">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Chicken Receiving</h1>
          <p className="text-gray-500 text-sm mt-1">Manage farm schedules, birds per day, and weight distribution.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search farm or truck..." className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-orange-500" />
          </div>
          {activeTab === 'monthly' && (
            <button
              onClick={() => {
                const yyyyMm = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
                const d = window.prompt("Enter month to clear (YYYY-MM):", yyyyMm);
                if (d) {
                  if (window.confirm(`Are you sure you want to delete all monthly data for ${d}?`)) {
                    fetch(`${import.meta.env.VITE_API_URL}/api/chicken-receiving/monthly/clear/month/${d}`, {
                      method: 'DELETE'
                    }).then(res => {
                      if (res.ok) {
                        alert(`Cleared data for ${d}`);
                        fetchData();
                      } else {
                        alert('Failed to clear data');
                      }
                    });
                  }
                }
              }}
              className="px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-all flex items-center gap-2"
            >
              <Trash2 size={16} />
              Clear Month
            </button>
          )}
          {activeTab === 'weekly' && (
            <button
              onClick={() => {
                const d = window.prompt("Enter date to clear (YYYY-MM-DD):", formatLocalDate(currentDate));
                if (d) {
                  if (window.confirm(`Are you sure you want to delete all weekly data for ${d}?`)) {
                    fetch(`${import.meta.env.VITE_API_URL}/api/chicken-receiving/weekly/clear/date/${d}`, {
                      method: 'DELETE'
                    }).then(res => {
                      if (res.ok) {
                        alert(`Cleared data for ${d}`);
                        fetchData();
                      } else {
                        alert('Failed to clear data');
                      }
                    });
                  }
                }
              }}
              className="px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-all flex items-center gap-2"
            >
              <Trash2 size={16} />
              Clear Date
            </button>
          )}
          {activeTab === 'daily' && (
            <button
              onClick={() => {
                const d = window.prompt("Enter date to clear (YYYY-MM-DD):", formatLocalDate(currentDate));
                if (d) {
                  if (window.confirm(`Are you sure you want to delete all daily data for ${d}?`)) {
                    fetch(`${import.meta.env.VITE_API_URL}/api/chicken-receiving/daily/clear/date/${d}`, {
                      method: 'DELETE'
                    }).then(res => {
                      if (res.ok) {
                        alert(`Cleared data for ${d}`);
                        fetchData();
                      } else {
                        alert('Failed to clear data');
                      }
                    });
                  }
                }
              }}
              className="px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-all flex items-center gap-2"
            >
              <Trash2 size={16} />
              Clear Date
            </button>
          )}
          <button
            onClick={() => setIsImportOpen(true)}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-all flex items-center gap-2"
          >
            <Upload size={16} />
            Import
          </button>
          <button
            onClick={openNewModal}
            className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg text-sm font-medium hover:from-orange-600 hover:to-red-600 transition-all shadow-md flex items-center gap-2"
          >
            <Plus size={16} />
            New Schedule
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-1 inline-flex w-full sm:w-auto overflow-x-auto animate-slide-up delay-100">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${isActive
                  ? 'bg-orange-50 text-orange-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
            >
              <Icon size={16} className={isActive ? 'text-orange-600' : 'text-gray-400'} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 min-h-[600px] animate-slide-up delay-200">
        {activeTab === 'monthly' && renderMonthlyCalendar()}
        {activeTab === 'weekly' && renderWeeklyCalendar()}
        {activeTab === 'daily' && renderDailyTimeline()}

        {['actual', 'reports'].includes(activeTab) && (
          <div className="h-full flex flex-col items-center justify-center text-center py-32">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <Truck size={24} className="text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">{tabs.find(t => t.id === activeTab)?.label} Module</h3>
            <p className="text-gray-500 text-sm max-w-sm">This module uses a standard list/table view rather than a calendar. Currently under development.</p>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setIsModalOpen(false)}>
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl border border-gray-200 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100 bg-gray-50/50 rounded-t-2xl">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                {formData.id ? <Edit size={20} className="text-orange-500" /> : <Plus size={20} className="text-orange-500" />}
                {formData.id ? 'Edit' : 'Add'} {tabs.find(t => t.id === activeTab)?.label}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-700 bg-white p-1 rounded-full shadow-sm border border-gray-200 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 overflow-y-auto flex-1 min-h-[380px]">
              {renderModalForm()}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl flex justify-between items-center">
              <div>
                {formData.id && (
                  <button onClick={handleDelete} className="text-red-500 hover:text-red-700 text-sm font-semibold hover:underline">
                    Delete Schedule
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setIsModalOpen(false)} className="px-5 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button onClick={handleSave} className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-orange-500 to-red-500 rounded-xl shadow-md hover:from-orange-600 hover:to-red-600 transition-colors flex items-center gap-2">
                  {formData.id ? 'Update Schedule' : 'Save Schedule'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      <ImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        activeTab={activeTab}
        onImportDone={fetchData}
      />

    </div>
  );
}
