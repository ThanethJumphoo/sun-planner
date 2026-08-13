import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Layers, Activity, CheckCircle, Package, TrendingUp, Calendar, X, Info, Edit2, Check, Plus, RefreshCw, Trash2, Users, ChevronDown, Download, ArrowRight } from 'lucide-react';
import CustomSelect from '../components/common/CustomSelect';
import CustomDatePicker from '../components/common/CustomDatePicker';
import CUTManpowerPlan from '../components/dps/CUTManpowerPlan';

const API = import.meta.env.VITE_API_URL;

interface Order {
  id: string;
  itemCode: string;
  itemDesc: string;
  qty: number;
  type: string;
  size: string;
  unfulfilledKg: number;
  fulfilledKg: number;
  priority: number | null;
}

interface Allocation {
  orderId: string;
  itemDesc: string;
  size: string;
  qty: number;
}

interface Sublot {
  id: string;
  farmName: string;
  totalBirds: number;
  totalWeightKg: number;
  avgLiveWeight: number;
  slaughteredWeight: number;
  rmFlTotal: number;

  initialBins: Record<string, number>; // Before allocation
  bins: Record<string, number>; // Remaining after allocation

  initialCoProductKg: number;
  coProductKg: number;

  shift: string;
  allocations: Allocation[];
  initialTotalFg: number;
  supportManpower?: number;
}

const sizeLabelMap: Record<string, string> = {
  '1': '40 Down',
  '2': '40-45',
  '3': '45-50',
  '4': '50-55',
  '5': '55-60',
  '6': '60-65',
  '7': '65-70',
  '8': '70 Up',
};

const sizeColorMap: Record<string, string> = {
  '40 DOWN': 'bg-slate-500',
  '40-45': 'bg-blue-500',
  '45-50': 'bg-cyan-500',
  '50-55': 'bg-emerald-500',
  '55-60': 'bg-green-500',
  '60-65': 'bg-amber-500',
  '65-70': 'bg-orange-500',
  '70 UP': 'bg-red-500',
  'unsize': 'bg-gray-400',
  'Grade B': 'bg-orange-400'
};

const getSizeLabel = (sz: string) => sizeLabelMap[sz] || sz;
const getSizeColor = (sz: string) => sizeColorMap[getSizeLabel(sz)] || 'bg-gray-400';

const normalizeSize = (sz: string | undefined | null) => {
  if (!sz) return 'unsize';
  const lower = sz.trim().toLowerCase();
  if (lower === 'unsize') return 'unsize';
  if (lower === 'grade b') return 'Grade B';
  const match = Object.values(sizeLabelMap).find(v => v.toLowerCase() === lower);
  return match || sz.trim();
};

const getMatchingBins = (size: string, isBil: boolean, yieldRate: number = 1.0, blMatrix: any[] = [], sizeColumns: string[] = []): string[] => {
  if (!size || size === 'unsize' || size === 'Grade B') return [];

  const parseSizeRange = (s: string): { min: number, max: number } | null => {
    let min = -1, max = -1;
    const nums = s.match(/\d+(\.\d+)?/g);
    const lower = s.toLowerCase();
    if (nums && nums.length >= 2) {
      min = parseFloat(nums[0]);
      max = parseFloat(nums[1]);
    } else if (nums && nums.length === 1) {
      const val = parseFloat(nums[0]);
      if (lower.includes('up') || lower.includes('>')) { min = val; max = 9999; }
      else if (lower.includes('down') || lower.includes('<')) { min = 0; max = val; }
    }
    return min !== -1 && max !== -1 ? { min, max } : null;
  };

  if (isBil) {
    // If it's a BL order (yield ~0.74), map the BL size to BIL bins using the matrix
    if (yieldRate === 0.74 && blMatrix.length > 0) {
      const mappedBins = blMatrix
        .filter(m => m.targetProduct === size)
        .sort((a, b) => a.priority - b.priority)
        .map(m => m.rmSize);
      if (mappedBins.length > 0) return mappedBins;
    }

    // For BIL orders, find overlapping bins from sizeColumns
    const oRange = parseSizeRange(size);
    if (oRange && sizeColumns.length > 0) {
      const matches = sizeColumns.filter(c => {
        const cRange = parseSizeRange(c);
        if (!cRange) return false;
        return cRange.min < oRange.max && cRange.max > oRange.min;
      });
      if (matches.length > 0) return matches;
    }
    return [size];
  }

  // If exact match with a label, return its key
  if (Object.values(sizeLabelMap).includes(size)) {
    const key = Object.keys(sizeLabelMap).find(k => sizeLabelMap[k] === size);
    if (key) return [key];
  }

  const binRanges = [
    { label: '40 Down', min: 0, max: 40 },
    { label: '40-45', min: 40, max: 45 },
    { label: '45-50', min: 45, max: 50 },
    { label: '50-55', min: 50, max: 55 },
    { label: '55-60', min: 55, max: 60 },
    { label: '60-65', min: 60, max: 65 },
    { label: '65-70', min: 65, max: 70 },
    { label: '70 Up', min: 70, max: 9999 }
  ];

  const oRange = parseSizeRange(size);
  if (oRange) {
    const matches = binRanges
      .filter(b => b.min < oRange.max && b.max > oRange.min)
      .map(b => {
        const key = Object.keys(sizeLabelMap).find(k => sizeLabelMap[k] === b.label);
        return key || b.label;
      });
    if (matches.length > 0) return matches;
  }
  return [];
};


const DPSPlan: React.FC = () => {
  const { partId } = useParams<{ partId: string }>();
  const isBil = partId === 'bil';
  // Use local date to avoid UTC timezone shift
  const formatLocalDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const [targetDate, setTargetDate] = useState(formatLocalDate(new Date()));
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sublots, setSublots] = useState<Sublot[]>([]);

  const [isGenerated, setIsGenerated] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [, setPlanId] = useState<number | null>(null);
  const [rawSupplyCount, setRawSupplyCount] = useState(0);
  const [rawDemandCount, setRawDemandCount] = useState(0);
  const [unprocessedSublots, setUnprocessedSublots] = useState<Sublot[]>([]);
  const [unprocessedOrders, setUnprocessedOrders] = useState<Order[]>([]);
  const [availableSpecs, setAvailableSpecs] = useState<any[]>([]);
  const [showAddOrderModal, setShowAddOrderModal] = useState(false);
  const [newOrderForm, setNewOrderForm] = useState({ itemCode: '', qty: '' });

  // RECIPE SELECTION STATE
  const [recipesMap, setRecipesMap] = useState<Record<string, any[]>>({});
  const [selectedRecipeNo, setSelectedRecipeNo] = useState<Record<string, string>>({});
  const [selectedRecipe, setSelectedRecipe] = useState<Record<string, string>>({});
  const [loadingRecipes, setLoadingRecipes] = useState<Record<string, boolean>>({});
  const [confirmedRecipes, setConfirmedRecipes] = useState<Record<string, boolean>>({});
  const [showSendBatchModal, setShowSendBatchModal] = useState(false);
  const [modalSelectedItems, setModalSelectedItems] = useState<Record<string, boolean>>({});
  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false);

  // BATCH LOGS STATE
  const [batchLogs, setBatchLogs] = useState<any[]>([]);

  const fetchBatchLogs = async (date: string) => {
    try {
      const response = await fetch(`${API}/api/erp/batch-logs/${partId || 'fillet'}/${date}`);
      const data = await response.json();
      if (data.success && data.logs) {
        setBatchLogs(data.logs);
      }
    } catch (error) {
      console.error('Failed to fetch batch logs:', error);
    }
  };

  const fetchRecipesForItem = async (itemCode: string) => {
    try {
      setLoadingRecipes(prev => ({ ...prev, [itemCode]: true }));
      const response = await fetch(`${API}/api/erp/recipes/${itemCode}`);
      const data = await response.json();
      setRecipesMap(prev => ({ ...prev, [itemCode]: data }));

      if (data && Array.isArray(data) && data.length > 0) {
        const uniqueNos = Array.from(new Set(data.map((r: any) => String(r.RECIPE_NO))));
        if (uniqueNos.length === 1) {
          const defaultNo = uniqueNos[0];
          setSelectedRecipeNo(prev => ({ ...prev, [itemCode]: defaultNo }));

          const versions = data.filter((r: any) => String(r.RECIPE_NO) === defaultNo);
          if (versions.length === 1) {
            setSelectedRecipe(prev => ({ ...prev, [itemCode]: String(versions[0].RECIPE_ID) }));
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch recipes:', error);
    } finally {
      setLoadingRecipes(prev => ({ ...prev, [itemCode]: false }));
    }
  };

  const handleRecipeNoSelect = (itemCode: string, no: string) => {
    if (confirmedRecipes[itemCode]) return;
    setSelectedRecipeNo(prev => ({ ...prev, [itemCode]: no }));
    setSelectedRecipe(prev => ({ ...prev, [itemCode]: '' }));

    const versions = recipesMap[itemCode]?.filter((r: any) => String(r.RECIPE_NO) === no) || [];
    if (versions.length === 1) {
      setSelectedRecipe(prev => ({ ...prev, [itemCode]: String(versions[0].RECIPE_ID) }));
    }
  };

  const handleRecipeSelect = (itemCode: string, recipeId: string) => {
    if (confirmedRecipes[itemCode]) return;
    setSelectedRecipe(prev => ({ ...prev, [itemCode]: recipeId }));
  };

  const handleConfirmRecipe = (itemCode: string) => {
    const recipeId = selectedRecipe[itemCode];
    if (!recipeId) {
      alert('Please select a recipe first');
      return;
    }
    setConfirmedRecipes(prev => ({ ...prev, [itemCode]: true }));
  };

  const handleUnlockRecipe = (itemCode: string) => {
    setConfirmedRecipes(prev => ({ ...prev, [itemCode]: false }));
  };

  const handleOpenSendBatchModal = () => {
    const confirmedItems = Object.keys(confirmedRecipes).filter(k => confirmedRecipes[k]);
    if (confirmedItems.length === 0) {
      alert('No confirmed recipes to send.');
      return;
    }
    const initialSelection: Record<string, boolean> = {};
    confirmedItems.forEach(k => initialSelection[k] = true);
    setModalSelectedItems(initialSelection);
    setShowSendBatchModal(true);
  };

  const handleConfirmSendBatch = async () => {
    const itemsToSend = Object.keys(modalSelectedItems).filter(k => modalSelectedItems[k]);
    if (itemsToSend.length === 0) {
      alert('Please select at least one item to send.');
      return;
    }

    const recipesPayload = itemsToSend.map(itemCode => {
      const recipeId = selectedRecipe[itemCode];
      const recipe = recipesMap[itemCode]?.find(r => String(r.RECIPE_ID) === String(recipeId));
      return {
        recipeNo: recipe?.RECIPE_NO,
        recipeVersion: recipe?.RECIPE_VERSION,
        itemCode: itemCode
      };
    }).filter(r => r.recipeNo != null);

    try {
      setIsSubmittingBatch(true);
      const response = await fetch(`${API}/api/erp/batch-auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipes: recipesPayload,
          partId: partId || 'fillet',
          planDate: targetDate
        })
      });

      const result = await response.json();
      if (result.success) {
        let msg = `Successfully sent to Batch Auto!\nBatch Name: ${result.batchName}\nRecipes Count: ${result.count}`;
        if (result.retcode && result.retcode !== '0') {
          msg += `\n\nWarning from Oracle:\nCode: ${result.retcode}\nError: ${result.errbuf}`;
        }
        alert(msg);
        
        await fetchBatchLogs(targetDate);

        // Reset states
        setShowSendBatchModal(false);
        setModalSelectedItems({});
        setConfirmedRecipes(prev => {
          const next = { ...prev };
          itemsToSend.forEach(k => delete next[k]);
          return next;
        });
        setSelectedRecipe(prev => {
          const next = { ...prev };
          itemsToSend.forEach(k => delete next[k]);
          return next;
        });
        setSelectedRecipeNo(prev => {
          const next = { ...prev };
          itemsToSend.forEach(k => delete next[k]);
          return next;
        });

        // Fetch logs to update the UI with new Batch numbers
        fetchBatchLogs(targetDate);
      } else {
        alert(`Failed: ${result.message}`);
      }
    } catch (error) {
      console.error('Error sending batch:', error);
      alert('An error occurred while sending to Batch Auto.');
    } finally {
      setIsSubmittingBatch(false);
    }
  };

  const [yieldNodeTypeMap, setYieldNodeTypeMap] = useState<Map<string, string>>(new Map());
  const [yieldNodeNameMap, setYieldNodeNameMap] = useState<Map<string, string>>(new Map());
  const [yieldTree, setYieldTree] = useState<any[]>([]);
  const [specsMap, setSpecsMap] = useState<Record<string, any>>({});
  const [sizeColumns, setSizeColumns] = useState<string[]>([]);
  const [machineConfigs, setMachineConfigs] = useState<any[]>([]);
  const [blBeltGateMatrix, setBlBeltGateMatrix] = useState<any[]>([]);
  const [bilCapacityInputs, setBilCapacityInputs] = useState<Record<string, { manpower: number | string, speed: number | string, hours: number | string, pieceWeight: number | string }>>({});
  const [blPiecesInputs, setBlPiecesInputs] = useState<Record<string, { toridasYield: number | string, blYield: number | string }>>({});

  // Calculate totalRemainingMain for CUTManpowerPlan
  const totalRemainingMain = useMemo(() => {
    return sublots.reduce((sum, sl) => {
      const remainingMainProducts = Object.entries(sl.bins)
        .filter(([k]) => !yieldNodeTypeMap.has(k) || yieldNodeTypeMap.get(k) === 'MAIN')
        .reduce((s, [_, v]) => s + v, 0);

      const blTransferAllocs = sl.allocations.filter(a => a.orderId === '211113001');
      const nextSlTransferAllocs = sl.allocations.filter(a => a.orderId === 'L-9999992');
      const hasBlCommit = blTransferAllocs.length > 0 || nextSlTransferAllocs.length > 0;

      let displayRemainingMain = remainingMainProducts;
      if (hasBlCommit) {
        let committedKg = 0;
        blTransferAllocs.forEach(a => committedKg += a.qty);
        nextSlTransferAllocs.forEach(a => committedKg += a.qty);
        displayRemainingMain += committedKg;
      }
      return sum + displayRemainingMain;
    }, 0);
  }, [sublots, yieldNodeTypeMap]);

  const getProductType = (itemCode: string): 'main' | 'coproduct' | 'byproduct' => {
    const spec = specsMap[itemCode];
    if (!spec) return 'main';

    if (spec.masterYieldIds) {
      const processIds = spec.masterYieldIds.split(',').map((id: any) => id.trim());
      for (const id of processIds) {
        const nodeType = yieldNodeTypeMap.get(id);
        if (nodeType === 'CO-PRODUCT') return 'coproduct';
        if (nodeType === 'BY-PRODUCT') return 'byproduct';
      }
    }

    return 'main';
  };



  const getLegYield = (itemCode: string, itemDesc: string): number => {
    if (!isBil) return 1.0;
    const desc = itemDesc.toUpperCase();
    if (desc.includes('BONE-IN')) return 1.0;
    if (desc.includes('LEG') && !desc.includes('BONELESS')) return 0.99;
    const specType = specsMap[itemCode]?.type?.toLowerCase() || '';
    if (specType === 'bl') return 0.74;
    if (specType === 'leg') return 0.99;
    if (specType === 'bil') return 1.0;
    if (desc.includes('BL')) return 0.74;
    return 0.74; // default to BL for unknown leg items
  };

  const getDisplayLabel = (key: string): string => {
    if (key.includes(',')) {
      const parts: string[] = key.split(',').map((p: string) => getDisplayLabel(p.trim()));
      return Array.from(new Set(parts)).join(', ');
    }
    if (key === 'Grade B' || key === 'Grade B (Co-Product)') return 'Grade B (Co-Product)';
    if (key === 'unsize' || key === 'Unsize / Other Grade A') return 'Unsize / Other Grade A';
    if (yieldNodeNameMap.has(key)) return yieldNodeNameMap.get(key) || key;
    return key;
  };

  const getSizeLabel = (key: string): string => {
    if (key.includes(',')) {
      const parts = key.split(',').map((p: string) => p.trim());
      if (parts.length > 0 && sizeLabelMap[parts[0]]) return sizeLabelMap[parts[0]];
      return parts[0];
    }
    if (key === 'Grade B' || key === 'Grade B (Co-Product)') return 'Grade B (Co-Product)';
    if (key === 'unsize' || key === 'Unsize / Other Grade A') return 'Unsize / Other Grade A';
    if (sizeLabelMap[key]) return sizeLabelMap[key];

    const findNodeName = (nodes: any[]): string | null => {
      for (const n of nodes) {
        if (n.id === key) return n.name;
        if (n.children) {
          const found = findNodeName(n.children);
          if (found) return found;
        }
      }
      return null;
    };

    const nodeName = findNodeName(yieldTree);
    if (nodeName) return nodeName;

    const spec = Object.values(specsMap).find((s: any) => s.masterYieldIds?.split(',').map((id: any) => id.trim()).includes(key));
    if (spec) return spec.erpItemDesc || spec.erpItemCode;

    return key;
  };

  const findNode = (nodes: any[], id: string): any | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const found = findNode(n.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const findParentNode = (nodes: any[], childId: string, parent: any | null = null): any | null => {
    for (const n of nodes) {
      if (n.id === childId) return parent;
      if (n.children) {
        const found = findParentNode(n.children, childId, n);
        if (found) return found;
      }
    }
    return null;
  };

  const computeYieldTreeSubproducts = (sl: Sublot) => {
    const categoryName = isBil ? 'BIL L/C' : 'สันใน';
    const categoryNode = yieldTree.find(n => n.name === categoryName);
    const categorySubproducts: any[] = [];
    const traverseSubproducts = (node: any) => {
      if (node.type === 'BY-PRODUCT' || node.type === 'CO-PRODUCT') {
        categorySubproducts.push(node);
      }
      if (node.children) {
        node.children.forEach(traverseSubproducts);
      }
    };
    if (categoryNode && categoryNode.children) {
      categoryNode.children.forEach(traverseSubproducts);
    }

    // 1. Reset all co-product / by-product bins and coProductKg to 0
    categorySubproducts.forEach(subprod => {
      sl.bins[subprod.id] = 0;
    });
    sl.coProductKg = 0;

    if (isBil) {
      // For BIL, calculate total deboned RM (initial FG - current FG bins)
      let currentRm = 0;
      Object.keys(sl.bins).forEach(binSize => {
        if (!yieldNodeTypeMap.has(binSize)) currentRm += sl.bins[binSize];
      });
      const debonedRm = Math.max(0, sl.initialTotalFg - currentRm);

      if (debonedRm > 0) {
        categorySubproducts.forEach(subprod => {
          const pct = Number(subprod.yieldPercentage || 0);
          const subprodKg = Number((debonedRm * pct).toFixed(1));
          sl.bins[subprod.id] = (sl.bins[subprod.id] || 0) + subprodKg;

          if (subprod.type === 'CO-PRODUCT') {
            sl.coProductKg = Number(((sl.coProductKg || 0) + subprodKg).toFixed(1));
          }
        });
      }
      return; // Skip the standard Fillet logic for BIL
    }

    // 1. Reset all co-product / by-product bins and coProductKg to 0
    categorySubproducts.forEach(subprod => {
      sl.bins[subprod.id] = 0;
    });
    sl.coProductKg = 0;

    // 2. Loop through all allocations of MAIN products in this sublot
    let totalMainAllocatedQty = 0;
    sl.allocations.forEach(alloc => {
      const itemCodeMatch = alloc.itemDesc.split(' - ')[0];
      if (getProductType(itemCodeMatch) !== 'main') return;
      totalMainAllocatedQty += alloc.qty;

      const spec = specsMap[itemCodeMatch];
      if (spec && spec.masterYieldIds) {
        const yieldPct = Number(spec.productYield || 1);
        const rm = alloc.qty / yieldPct;
        const processIds = spec.masterYieldIds.split(',').map((id: any) => id.trim());
        const pId = processIds[0];

        if (pId) {
          const node = findNode(yieldTree, pId);
          if (node) {
            const processNode = findParentNode(yieldTree, pId) || node;
            if (processNode && processNode.children) {
              processNode.children.forEach((child: any) => {
                if (child.id === pId) return;
                if (child.type === 'BY-PRODUCT' || child.type === 'CO-PRODUCT') {
                  const byProdQty = Number((rm * (child.yieldPercentage || 0)).toFixed(1));
                  if (byProdQty > 0) {
                    sl.bins[child.id] = Number(((sl.bins[child.id] || 0) + byProdQty).toFixed(1));

                    const isGradeB = child.name === 'สันในเกรด B' || child.name.includes('เกรด B') || child.name.toLowerCase().includes('grade b');
                    if (isGradeB) {
                      sl.coProductKg = Number((sl.coProductKg + byProdQty).toFixed(1));
                    }
                  }
                }
              });
            }
          }
        }
      }
    });

    // 3. Fallback for Grade B if no yield tree calculation was made
    const hasYieldTreeGradeB = categorySubproducts.some(subprod => {
      const name = subprod.name;
      return (name === 'สันในเกรด B' || name.includes('เกรด B') || name.toLowerCase().includes('grade b')) && (sl.bins[subprod.id] || 0) > 0;
    });

    if (!hasYieldTreeGradeB && totalMainAllocatedQty > 0) {
      sl.coProductKg = Number((totalMainAllocatedQty * 0.093).toFixed(1));
    }

    // 4. Deduct already allocated co-product/by-product quantities from the newly generated supplies
    sl.allocations.forEach(alloc => {
      const itemCodeMatch = alloc.itemDesc.split(' - ')[0];
      const prodType = getProductType(itemCodeMatch);
      if (prodType === 'coproduct' || prodType === 'byproduct') {
        if (alloc.size === 'Grade B') {
          sl.coProductKg = Number((sl.coProductKg - alloc.qty).toFixed(1));
        } else {
          sl.bins[alloc.size] = Number(((sl.bins[alloc.size] || 0) - alloc.qty).toFixed(1));
        }
      }
    });
  };

  const [sizeModalData, setSizeModalData] = useState<{
    isOpen: boolean;
    sublotId: string;
    targetSublotId?: string;
    sizeLabel: string;
    totalRemaining: number;
    allocations: Allocation[];
  } | null>(null);


  const handleAddAllocationToSublot = (orderId: string) => {
    if (!sizeModalData) return;
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const targetId = sizeModalData.targetSublotId || sizeModalData.sublotId;

    const newSublots = [...sublots];
    const sublotIndex = newSublots.findIndex(s => s.id === targetId);
    if (sublotIndex === -1) return;
    const sublot = { ...newSublots[sublotIndex] };

    let allocSize = sizeModalData.sizeLabel === 'Grade B (Co-Product)' || sizeModalData.sizeLabel === 'Grade B' ? 'Grade B' :
      sizeModalData.sizeLabel === 'Unsize / Other Grade A' || sizeModalData.sizeLabel === 'unsize' ? 'unsize' :
        Object.keys(sizeLabelMap).find(k => sizeLabelMap[k] === sizeModalData.sizeLabel) || sizeModalData.sizeLabel;

    if (sizeModalData.sizeLabel.includes(',')) {
      const modalSizes = sizeModalData.sizeLabel.split(',').map((s: any) => s.trim());
      const orderSpec = specsMap[order.itemCode];
      const orderYieldIds = orderSpec?.masterYieldIds?.split(',').map((id: any) => id.trim()) || [];
      const matchedId = orderYieldIds.find((id: any) => modalSizes.includes(id));
      if (matchedId) {
        allocSize = matchedId;
      } else if (modalSizes.includes(order.itemCode)) {
        allocSize = order.itemCode;
      } else {
        allocSize = modalSizes[0];
      }
    }

    const existingIndex = sublot.allocations.findIndex(a => a.orderId === orderId && a.size === allocSize);
    if (existingIndex > -1) {
      setEditingAlloc({ id: sublot.id, orderId, size: allocSize, val: sublot.allocations[existingIndex].qty.toString() });
      return;
    }

    sublot.allocations.push({
      orderId,
      itemDesc: order.itemDesc,
      size: allocSize,
      qty: 0
    });

    newSublots[sublotIndex] = sublot;
    setSublots(newSublots);

    const relatedAllocations = sublot.allocations.filter(a => {
      const aLabel = getSizeLabel(a.size);
      if (sizeModalData.sizeLabel === 'Unsize / Other Grade A' || sizeModalData.sizeLabel === 'unsize') return a.size === 'unsize' || !a.size;
      if (sizeModalData.sizeLabel === 'Grade B (Co-Product)' || sizeModalData.sizeLabel === 'Grade B') return a.size === 'Grade B';
      if (sizeModalData.sizeLabel.includes(',')) {
        const parts = sizeModalData.sizeLabel.split(',').map((p: string) => p.trim());
        return parts.includes(a.size) || parts.includes(aLabel);
      }
      return a.size === sizeModalData.sizeLabel || aLabel === sizeModalData.sizeLabel;
    });
    setSizeModalData({
      ...sizeModalData,
      allocations: relatedAllocations
    });

    setEditingAlloc({ id: sublot.id, orderId, size: allocSize, val: "0" });
  };

  const openSizeModal = (sl: Sublot, labelOrKey: string, remaining: number) => {
    const relatedAllocations = sl.allocations.filter(a => {
      if (labelOrKey === 'Unsize / Other Grade A' || labelOrKey === 'unsize') {
        return a.size === 'unsize' || !a.size;
      }
      if (labelOrKey === 'Grade B (Co-Product)' || labelOrKey === 'Grade B') {
        return a.size === 'Grade B';
      }
      if (labelOrKey.includes(',')) {
        const parts = labelOrKey.split(',').map(p => p.trim());
        return parts.includes(a.size) || parts.includes(getSizeLabel(a.size));
      }
      return a.size === labelOrKey || getSizeLabel(a.size) === labelOrKey;
    });

    setSizeModalData({
      isOpen: true,
      sublotId: sl.id,
      sizeLabel: labelOrKey,
      allocations: relatedAllocations,
      totalRemaining: remaining
    });
  };

  const [editingAlloc, setEditingAlloc] = useState<{ id: string, orderId: string, size: string, val: string } | null>(null);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const toggleItemExpanded = (sublotId: string, itemDesc: string) => {
    const key = `${sublotId}_${itemDesc}`;
    setExpandedItems(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const closeSizeModal = () => {
    setSizeModalData(null);
    setEditingAlloc(null);
  };

  const handlePullLeftoverAndOpenModal = (fromId: string, toId: string, binKey: string, qty: number) => {
    const newSublots = [...sublots];
    const toSl = newSublots.find(s => s.id === toId);

    if (toSl) {
      const label = sizeLabelMap[binKey] || binKey;
      const allocSize = binKey === 'Grade B (Co-Product)' ? 'Grade B' :
        binKey === 'Unsize / Other Grade A' ? 'unsize' : binKey;
      const relatedAllocations = toSl.allocations.filter(a => a.size === allocSize);

      setSizeModalData({
        isOpen: true,
        sublotId: fromId,
        targetSublotId: toId,
        sizeLabel: label,
        allocations: relatedAllocations,
        totalRemaining: qty
      });
    }
  };

  const handleUpdateAllocation = (sourceSublotId: string, targetSublotId: string, orderId: string, itemDesc: string, sizeLabel: string, newQtyStr: string) => {
    const newQty = Number(newQtyStr);
    if (isNaN(newQty) || newQty < 0) return;

    const newSublots = [...sublots];
    const sourceSlIndex = newSublots.findIndex(s => s.id === sourceSublotId);
    const targetSlIndex = newSublots.findIndex(s => s.id === targetSublotId);
    if (sourceSlIndex === -1 || targetSlIndex === -1) return;

    const sourceSl = { ...newSublots[sourceSlIndex] };
    const targetSl = sourceSublotId === targetSublotId ? sourceSl : { ...newSublots[targetSlIndex] };

    const allocIndex = targetSl.allocations.findIndex(a => {
      if (a.orderId !== orderId || a.itemDesc !== itemDesc) return false;
      const sizeKey = sizeLabel === 'Grade B (Co-Product)' || sizeLabel === 'Grade B' ? 'Grade B' :
        sizeLabel === 'Unsize / Other Grade A' || sizeLabel === 'unsize' ? 'unsize' : sizeLabel;
      if (sizeKey.includes(',')) {
        const parts = sizeKey.split(',').map((p: string) => p.trim());
        return parts.includes(a.size) || parts.includes(getSizeLabel(a.size));
      }
      return a.size === sizeKey || getSizeLabel(a.size) === sizeLabel;
    });
    if (allocIndex === -1) return;

    const alloc = { ...targetSl.allocations[allocIndex] };
    const oldQty = alloc.qty;
    const diff = Number((newQty - oldQty).toFixed(1));
    const order = orders.find(o => o.id === orderId);
    const yieldRate = order ? getLegYield(order.itemCode, order.itemDesc) : 1.0;
    const diffRm = Number((diff / yieldRate).toFixed(1));

    if (alloc.size === 'Grade B') {
      if (diffRm > 0 && sourceSl.coProductKg < diffRm) return;
      sourceSl.coProductKg = Number((sourceSl.coProductKg - diffRm).toFixed(1));
    } else {
      if (diffRm > 0 && (sourceSl.bins[alloc.size] || 0) < diffRm) return;
      sourceSl.bins = { ...sourceSl.bins, [alloc.size]: Number(((sourceSl.bins[alloc.size] || 0) - diffRm).toFixed(1)) };
    }

    const newAllocations = [...targetSl.allocations];
    if (newQty === 0) {
      newAllocations.splice(allocIndex, 1);
    } else {
      alloc.qty = newQty;
      newAllocations[allocIndex] = alloc;
    }
    targetSl.allocations = newAllocations;

    // Recalculate dynamic co-products/by-products for sourceSl and targetSl if not BIL
    if (!isBil) {
      computeYieldTreeSubproducts(sourceSl);
      if (sourceSublotId !== targetSublotId) {
        computeYieldTreeSubproducts(targetSl);
      }
    }

    newSublots[sourceSlIndex] = sourceSl;
    if (sourceSublotId !== targetSublotId) {
      newSublots[targetSlIndex] = targetSl;
    }

    setSublots(newSublots);

    const newOrders = [...orders];
    const orderIndex = newOrders.findIndex(o => o.id === orderId);
    if (orderIndex > -1) {
      const order = { ...newOrders[orderIndex] };
      order.fulfilledKg = Number((order.fulfilledKg + diff).toFixed(1));
      order.unfulfilledKg = Number((order.unfulfilledKg - diff).toFixed(1));
      newOrders[orderIndex] = order;
      setOrders(newOrders);
    }

    if (sizeModalData) {
      const relatedAllocations = targetSl.allocations.filter(a => {
        const aLabel = getSizeLabel(a.size);
        if (sizeModalData.sizeLabel === 'Unsize / Other Grade A' || sizeModalData.sizeLabel === 'unsize') return a.size === 'unsize' || !a.size;
        if (sizeModalData.sizeLabel === 'Grade B (Co-Product)' || sizeModalData.sizeLabel === 'Grade B') return a.size === 'Grade B';
        return a.size === sizeModalData.sizeLabel || aLabel === sizeModalData.sizeLabel;
      });
      setSizeModalData({
        ...sizeModalData,
        allocations: relatedAllocations,
        totalRemaining: (sizeModalData.totalRemaining - diff)
      });
    }
    setEditingAlloc(null);
    saveDbUpdate(newSublots, newOrders);
  };

  const handleUpdateSupportManpowerShift = (shift: string, val: number) => {
    const newSublots = [...sublots];
    newSublots.forEach(s => {
      if (s.shift === shift) s.supportManpower = 0;
    });
    const firstIndex = newSublots.findIndex(s => s.shift === shift);
    if (firstIndex > -1) {
      newSublots[firstIndex].supportManpower = val;
    }
    setSublots(newSublots);
    saveDbUpdate(newSublots, orders);
  };

  const handleCommitBlAllocation = async (sl: Sublot, mainBins: { label: string, kg: number, pcs: number }[], estPieces: number, totalPcs: number) => {
    if (estPieces <= 0 || mainBins.length === 0) return;
    if (!window.confirm(`ยืนยันการส่งเนื้อไปทำ BL? (Est. BL Pieces: ${totalPcs}, Cap: ${estPieces})`)) return;

    const newSublots = [...sublots];
    const sourceSlIndex = newSublots.findIndex(s => s.id === sl.id);
    if (sourceSlIndex === -1) return;

    const sourceSl = { ...newSublots[sourceSlIndex] };

    let ratioBL = 1;
    if (totalPcs > estPieces) {
      ratioBL = estPieces / totalPcs;
    }

    const allocationsToAdd: any[] = [];
    const newOrders = [...orders];

    const addDummyOrder = (id: string, desc: string) => {
      if (!newOrders.find(o => o.id === id)) {
        newOrders.push({
          id,
          itemCode: id,
          itemDesc: desc,
          type: 'Transfer',
          size: 'Any',
          qty: 999999, // large demand
          fulfilledKg: 0,
          unfulfilledKg: 999999,
          priority: 99
        });
      }
    };

    addDummyOrder('211113001', 'Transfer to BL');
    addDummyOrder('L-9999992', 'Transfer to Next Sublot'); // Keeping the description/order ID the same to minimize changes in other parts of the code

    let hasRemainder = false;
    const remainderBins: Record<string, number> = {};

    mainBins.forEach(bin => {
      const binKey = Object.keys(sourceSl.bins).find(k => getDisplayLabel(k) === bin.label);
      if (!binKey) return;

      const kgToBL = Number((bin.kg * ratioBL).toFixed(1));
      const kgToNext = Number((bin.kg - kgToBL).toFixed(1));

      if (kgToBL > 0) {
        allocationsToAdd.push({
          orderId: '211113001',
          itemDesc: 'Transfer to BL',
          size: binKey,
          qty: kgToBL,
          sizeLabel: bin.label
        });
        sourceSl.bins[binKey] = Number((sourceSl.bins[binKey] - kgToBL).toFixed(1));
      }

      if (kgToNext > 0) {
        allocationsToAdd.push({
          orderId: 'L-9999992',
          itemDesc: `Transfer to Next Sublot`, // Keep same dummy ID to represent remainder
          size: binKey,
          qty: kgToNext,
          sizeLabel: bin.label
        });
        sourceSl.bins[binKey] = Number((sourceSl.bins[binKey] - kgToNext).toFixed(1));
        
        hasRemainder = true;
        remainderBins[binKey] = kgToNext;
      }
    });

    sourceSl.allocations = [...sourceSl.allocations, ...allocationsToAdd];
    newSublots[sourceSlIndex] = sourceSl;

    if (hasRemainder) {
      // Create a clone of the source sublot to hold the remainder
      const remainderSl: Sublot = {
        ...sourceSl,
        id: `${sourceSl.id}_BL_REM`,
        shift: 'B',
        bins: remainderBins,
        allocations: [],
        initialTotalFg: Object.values(remainderBins).reduce((a, b) => a + b, 0),
        totalBirds: 0,
        totalWeightKg: 0,
        coProductKg: 0,
        rmFlTotal: 0,
        slaughteredWeight: 0,
        initialCoProductKg: 0
      };
      // Insert the cloned sublot right after the source sublot
      newSublots.splice(sourceSlIndex + 1, 0, remainderSl);
    }

    setSublots(newSublots);
    setOrders(newOrders);
    await saveDbUpdate(newSublots, newOrders);
  };

  const handleUndoBlAllocation = async (sl: Sublot) => {
    if (!window.confirm(`ต้องการยกเลิกการส่งเนื้อไปทำ BL ทั้งหมดใน Sublot นี้ใช่หรือไม่?`)) return;
    const newSublots = [...sublots];
    const sourceSlIndex = newSublots.findIndex(s => s.id === sl.id);
    if (sourceSlIndex === -1) return;
    const sourceSl = { ...newSublots[sourceSlIndex] };

    const blAllocs = sourceSl.allocations.filter(a => a.orderId === '211113001' || a.orderId === 'L-9999992');
    if (blAllocs.length === 0) return;

    // Check if the cloned remainder sublot exists
    const cloneId = `${sourceSl.id}_BL_REM`;
    const cloneIndex = newSublots.findIndex(s => s.id === cloneId);
    
    // Legacy fallback setup
    const nextSlIndex = sourceSlIndex + 1;
    const hasNextSl = nextSlIndex < newSublots.length;
    let nextSl = hasNextSl && cloneIndex === -1 ? { ...newSublots[nextSlIndex] } : null;
    if (nextSl) nextSl.bins = { ...nextSl.bins };

    blAllocs.forEach(a => {
      sourceSl.bins[a.size] = Number(((sourceSl.bins[a.size] || 0) + a.qty).toFixed(1));

      // Legacy fallback: deduct from next sublot only if clone doesn't exist
      if (a.orderId === 'L-9999992' && nextSl) {
        nextSl.bins[a.size] = Number(((nextSl.bins[a.size] || 0) - a.qty).toFixed(1));
        if (nextSl.bins[a.size] < 0) nextSl.bins[a.size] = 0;
      }
    });

    sourceSl.allocations = sourceSl.allocations.filter(a => a.orderId !== '211113001' && a.orderId !== 'L-9999992');
    newSublots[sourceSlIndex] = sourceSl;
    
    if (cloneIndex !== -1) {
      // New logic: remove the cloned remainder sublot
      newSublots.splice(cloneIndex, 1);
    } else if (nextSl) {
      // Legacy fallback
      newSublots[nextSlIndex] = nextSl;
    }

    setSublots(newSublots);
    await saveDbUpdate(newSublots, orders);
  };

  const saveDbUpdate = async (currentSublots: Sublot[], currentOrders: Order[]) => {
    const validOrders = currentOrders.filter(o => o.id !== '211113001' && o.id !== 'L-9999992');
    const totalSupplyKg = currentSublots.reduce((sum, s) => sum + s.totalWeightKg, 0);
    const totalDemandKg = validOrders.reduce((sum, o) => sum + o.qty, 0);
    const totalFulfilled = validOrders.reduce((sum, o) => sum + o.fulfilledKg, 0);
    const fulfillmentRate = totalDemandKg > 0 ? (totalFulfilled / totalDemandKg) * 100 : 0;

    const allAllocs: any[] = [];
    currentSublots.forEach(sl => {
      sl.allocations.forEach(a => {
        allAllocs.push({
          sublotId: sl.id,
          itemDesc: a.itemDesc,
          orderId: a.orderId,
          size: a.size,
          qty: a.qty
        });
      });
    });

    const payload = {
      totalSupplyKg, totalDemandKg, fulfillmentRate,
      sublots: currentSublots.map(sl => ({
        ...sl,
        bilManpower: bilCapacityInputs[sl.id]?.manpower ?? null,
        bilSpeed: bilCapacityInputs[sl.id]?.speed ?? null,
        bilHours: bilCapacityInputs[sl.id]?.hours ?? null,
        bilPieceWeight: bilCapacityInputs[sl.id]?.pieceWeight ?? null,
      })),
      orders: currentOrders,
      allocations: allAllocs
    };

    await fetch(`${API}/api/dps/${targetDate}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, partType: partId || 'fillet' })
    });
  };

  useEffect(() => {
    fetchData();
    fetchBatchLogs(targetDate);
  }, [targetDate, partId]);

  const fetchData = async () => {
    setLoading(true);
    setIsGenerated(false);
    try {
      // Fetch yield tree first so it's available for mapping
      let parsedYieldTree: any[] = [];
      const typeMap = new Map<string, string>();
      try {
        const yieldRes = await fetch(`${API}/api/master-yield`);
        if (yieldRes.ok) {
          parsedYieldTree = await yieldRes.json();
          const flatNodes: any[] = [];
          const typeMap = new Map<string, string>();
          const nameMap = new Map<string, string>();
          const traverse = (nodes: any[]) => {
            nodes.forEach(node => {
              flatNodes.push(node);
              if (node.type) {
                typeMap.set(node.id, node.type);
              }
              if (node.name) {
                nameMap.set(node.id, node.name);
              }
              if (node.children) {
                traverse(node.children);
              }
            });
          };
          traverse(parsedYieldTree);
          parsedYieldTree = flatNodes;
          setYieldTree(flatNodes);
          setYieldNodeTypeMap(typeMap);
          setYieldNodeNameMap(nameMap);
        }
      } catch (e) {
        console.error("Error loading yield nodes in fetchData", e);
      }

      // Fetch specs next
      const specMap: Record<string, any> = {};
      try {
        const specRes = await fetch(`${API}/api/product-spec`);
        if (specRes.ok) {
          const rawSpecs = await specRes.json();
          setAvailableSpecs(rawSpecs);
          rawSpecs.forEach((s: any) => {
            specMap[s.erpItemCode] = {
              type: s.productType,
              size: s.productSize,
              productYield: Number(s.productYield || 1),
              productWeight: Number(s.productWeight || 0),
              productSpeed: Number(s.productSpeed || 1),
              masterYieldIds: s.masterYieldIds,
              erpItemDesc: s.erpItemDesc
            };
          });
          setSpecsMap(specMap);
        }
      } catch (e) {
        console.error("Error loading specs in fetchData", e);
      }

      // Fetch machine configs
      try {
        const confRes = await fetch(`${API}/api/machine-config`);
        if (confRes.ok) {
          const confs = await confRes.json();
          setMachineConfigs(confs);
        }
      } catch (e) {
        console.error("Error loading machine configs in fetchData", e);
      }

      // Determine category yield (e.g. 0.04 for fillet, 0.25 for bil)
      const categoryName = isBil ? 'BIL L/C' : 'สันใน';
      const categoryNode = parsedYieldTree.find(n => n.name === categoryName);
      const categoryYield = categoryNode?.yieldPercentage ? Number(categoryNode.yieldPercentage) : (isBil ? 0.25 : 0.04);

      // Get category subproducts (co-products and by-products under category node)
      const categorySubproducts: any[] = [];
      const traverseSubproducts = (node: any) => {
        if (node.type === 'BY-PRODUCT' || node.type === 'CO-PRODUCT') {
          categorySubproducts.push(node);
        }
        if (node.children) {
          node.children.forEach(traverseSubproducts);
        }
      };
      if (categoryNode && categoryNode.children) {
        categoryNode.children.forEach(traverseSubproducts);
      }

      let hasDbPlan = false;
      const dpsRes = await fetch(`${API}/api/dps/${targetDate}?partType=${partId || 'fillet'}`);
      if (dpsRes.ok) {
        const dbPlan = await dpsRes.json();
        if (dbPlan.exists && dbPlan.data) {
          const mappedOrders = dbPlan.data.orders.map((o: any) => ({
            id: `L-${o.erpOrderLineId}`,
            itemCode: o.itemCode,
            itemDesc: o.itemDesc,
            qty: o.requiredKg,
            type: o.productType,
            size: normalizeSize(o.productSize),
            unfulfilledKg: o.unfulfilledKg,
            fulfilledKg: o.fulfilledKg,
            priority: o.priority ?? null
          }));
          const dbSublotCounts: Record<string, number> = {};
          dbPlan.data.sublots.forEach((s: any) => {
            dbSublotCounts[s.sublotNumber] = (dbSublotCounts[s.sublotNumber] || 0) + 1;
          });

          const generatedIds = new Set<string>();

          const mappedSublots = dbPlan.data.sublots.map((s: any) => {
            const binsObj: Record<string, number> = {};
            s.bins.forEach((b: any) => { binsObj[b.sizeLabel] = b.availableKg; });

            const slAllocs = dbPlan.data.allocations.filter((a: any) => a.sourceBin?.sublot?.id === s.id).map((a: any) => ({
              orderId: `L-${a.targetOrder.erpOrderLineId}`,
              itemDesc: a.targetOrder.itemDesc,
              size: a.sourceBin?.sizeLabel || a.sizeLabel || 'Grade B',
              qty: a.allocatedKg
            }));

            const avgLiveWeight = s.avgLiveWeight || (s.totalBirds ? s.totalWeightKg / s.totalBirds : 0);
            const slaughteredWeight = (s.totalWeightKg * 0.9575) * 0.95;
            const rmFlTotal = slaughteredWeight * categoryYield;

            // Sum up subproduct initial quantities
            let totalSubproductsWeight = 0;
            let mainCoproductWeight = 0;

            if (!isBil) {
              categorySubproducts.forEach(subprod => {
                const pct = Number(subprod.yieldPercentage || 0);
                const subprodKg = Number((rmFlTotal * pct).toFixed(1));
                totalSubproductsWeight += subprodKg;

                if (subprod.type === 'CO-PRODUCT' && mainCoproductWeight === 0) {
                  mainCoproductWeight = subprodKg;
                }
              });

              if (mainCoproductWeight === 0) {
                mainCoproductWeight = rmFlTotal * 0.093; // Fallback
                totalSubproductsWeight = mainCoproductWeight;
              }
            }

            const netFillet = rmFlTotal - totalSubproductsWeight;

            const initialBinsObj: Record<string, number> = { ...binsObj };
            slAllocs.forEach((a: any) => {
              const isCoProductOrByProduct = typeMap.get(a.size) === 'CO-PRODUCT' || typeMap.get(a.size) === 'BY-PRODUCT' || a.size === 'Grade B';
              if (!isCoProductOrByProduct) {
                initialBinsObj[a.size] = (initialBinsObj[a.size] || 0) + a.qty;
              }
            });

            let baseId = dbSublotCounts[s.sublotNumber] > 1 ? `${s.sublotNumber}_${s.shift || 'A'}` : s.sublotNumber;
            let finalId = baseId;
            let counter = 1;
            while(generatedIds.has(finalId)) {
                finalId = `${baseId}_${counter}`;
                counter++;
            }
            generatedIds.add(finalId);

            return {
              id: finalId,
              farmName: s.farmName,
              totalBirds: s.totalBirds,
              totalWeightKg: s.totalWeightKg,
              avgLiveWeight,
              coProductKg: s.coProductKg,
              bins: binsObj,
              allocations: slAllocs,
              initialTotalFg: netFillet,
              initialBins: initialBinsObj,
              initialCoProductKg: mainCoproductWeight,
              slaughteredWeight,
              rmFlTotal,
              shift: s.shift || 'A',
              supportManpower: s.supportManpower || 0,
              bilManpower: s.bilManpower,
              bilSpeed: s.bilSpeed,
              bilHours: s.bilHours,
              bilPieceWeight: s.bilPieceWeight
            };
          });
          mappedSublots.sort((a: any, b: any) => a.id.localeCompare(b.id, undefined, { numeric: true }));

          setOrders(mappedOrders);
          setSublots(mappedSublots);

          const loadedInputs: any = {};
          mappedSublots.forEach((sl: any) => {
            loadedInputs[sl.id] = {
              manpower: sl.bilManpower ?? '',
              speed: sl.bilSpeed ?? '',
              hours: sl.bilHours ?? '',
              pieceWeight: sl.bilPieceWeight ?? ''
            };
          });
          setBilCapacityInputs(loadedInputs);

          setPlanId(dbPlan.data.id);
          setIsGenerated(true);
          hasDbPlan = true;
        }
      }

      const matrixUrl = isBil ? `${API}/api/bil-weight-distribution` : `${API}/api/weight-distribution`;

      const [intakeRes, orderRes, wdRes, erpItemsRes, blMatrixRes] = await Promise.all([
        fetch(`${API}/api/chicken-receiving/daily`),
        fetch(`${API}/api/mps/approved-orders/${targetDate}?partType=${partId || 'fillet'}`),
        fetch(matrixUrl),
        fetch(`${API}/api/product-spec/erp-items`),
        fetch(`${API}/api/bl-belt-gate-matrix`)
      ]);

      if (blMatrixRes.ok) {
        setBlBeltGateMatrix(await blMatrixRes.json());
      }

      // 1. Load Matrix
      let loadedMatrix = null;
      if (wdRes.ok) {
        const d = await wdRes.json();
        loadedMatrix = { rows: d.rowLabels, cols: d.colLabels, data: d.matrix };
        setSizeColumns(d.colLabels || []);
      }

      const erpItemsMap: Record<string, string> = {};
      if (erpItemsRes && erpItemsRes.ok) {
        const rawErpItems = await erpItemsRes.json();
        rawErpItems.forEach((i: any) => {
          erpItemsMap[i.erpItemCode] = i.erpItemDesc;
        });
      }

      // 3. Load Sublots
      const loadedSublots: Sublot[] = [];
      if (intakeRes.ok) {
        const rawIntake = await intakeRes.json();
        const dailyIntakes = rawIntake.filter((r: any) => {
          if (!r.receive_date) return false;

          const datePart = String(r.receive_date).split('T')[0];
          const dateParts = datePart.split('-');
          let y = parseInt(dateParts[0]);
          let m = parseInt(dateParts[1]);
          let d = parseInt(dateParts[2]);

          const timePart = String(r.receive_time || '00:00:00');
          const hh = parseInt(timePart.split(':')[0] || '0');

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

        // Sort chronologically to ensure sublots are ordered correctly
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
          const shift = r.shift || 'Unassigned';

          let sublotId = baseSublotId;
          if (rawSublot && sublotShiftCounts[rawSublot] && sublotShiftCounts[rawSublot].size > 1) {
            sublotId = `${baseSublotId}_${shift}`;
          }

          if (!groupedBySublot[sublotId]) {
            orderedSublotIds.push(sublotId);
            groupedBySublot[sublotId] = {
              id: sublotId,
              farmName: r.farm_name || `Unknown Farm`,
              shift: shift,
              totalBirds: 0,
              totalWeightKg: 0
            };
          }
          groupedBySublot[sublotId].totalBirds += Number(r.chicken_count || 0);
          groupedBySublot[sublotId].totalWeightKg += Number(r.chicken_weight || 0);
        });

        orderedSublotIds.forEach(sublotId => {
          const grp = groupedBySublot[sublotId];
          if (grp.totalBirds === 0) return;

          const avgLiveWeight = grp.totalWeightKg / grp.totalBirds;
          const slaughteredWeight = (grp.totalWeightKg * 0.9575) * 0.95;
          const rmFlTotal = slaughteredWeight * categoryYield;

          // Get subproduct node specs
          const bins: Record<string, number> = {};
          let totalSubproductsWeight = 0;
          let mainCoproductWeight = 0;

          if (!isBil) {
            categorySubproducts.forEach(subprod => {
              const pct = Number(subprod.yieldPercentage || 0);
              const subprodKg = Number((rmFlTotal * pct).toFixed(1));
              bins[subprod.id] = subprodKg;
              totalSubproductsWeight += subprodKg;

              if (subprod.type === 'CO-PRODUCT' && mainCoproductWeight === 0) {
                mainCoproductWeight = subprodKg;
              }
            });

            if (mainCoproductWeight === 0) {
              mainCoproductWeight = rmFlTotal * 0.093; // Fallback
              totalSubproductsWeight += mainCoproductWeight;
            }
          }

          const netFillet = rmFlTotal - mainCoproductWeight;

          let matchRow = null;
          if (loadedMatrix && loadedMatrix.rows.length > 0) {
            matchRow = loadedMatrix.rows.find((rowLabel: string) => {
              if (rowLabel.includes('-')) {
                const parts = rowLabel.split('-').map(s => parseFloat(s.trim()));
                return avgLiveWeight >= parts[0] && avgLiveWeight <= parts[1];
              }
              return Math.abs(Number(rowLabel) - avgLiveWeight) < 0.05;
            });
            // Fallback to closest if no exact range match
            if (!matchRow) {
              matchRow = loadedMatrix.rows.reduce((prev: string, curr: string) => {
                const parseVal = (s: string) => {
                  if (s.includes('-')) {
                    const parts = s.split('-').map(p => parseFloat(p.trim()));
                    return (parts[0] + parts[1]) / 2;
                  }
                  return Number(s);
                };
                return Math.abs(parseVal(curr) - avgLiveWeight) < Math.abs(parseVal(prev) - avgLiveWeight) ? curr : prev;
              });
            }
          }

          const getBinKey = (grams: number): string => {
            if (grams < 40) return '1';
            if (grams < 45) return '2';
            if (grams < 50) return '3';
            if (grams < 55) return '4';
            if (grams < 60) return '5';
            if (grams < 65) return '6';
            if (grams < 70) return '7';
            return '8';
          };

          if (matchRow && loadedMatrix) {
            const rowData = loadedMatrix.data[matchRow] || {};
            const totalRowPct = Object.values(rowData).reduce((sum: number, v: any) => sum + Number(v || 0), 0);

            loadedMatrix.cols.forEach((colLabel: string) => {
              let pct = Number(loadedMatrix.data[matchRow]?.[colLabel] || 0);
              if (pct === 0) return;

              if (totalRowPct > 0) {
                pct = (pct / totalRowPct) * 100;
              }

              let binKey = colLabel;
              if (!isBil) {
                const birdWeight = Number(colLabel);
                const pieceSizeGrams = (birdWeight * categoryYield * 1000) / 2;
                binKey = getBinKey(pieceSizeGrams);
              }

              const weightForThisBin = Number((netFillet * (pct / 100)).toFixed(1));
              bins[binKey] = Number(((bins[binKey] || 0) + weightForThisBin).toFixed(1));
            });
          }

          const initialTotalFg = netFillet;

          loadedSublots.push({
            id: grp.id,
            farmName: grp.farmName,
            totalBirds: grp.totalBirds,
            totalWeightKg: grp.totalWeightKg,
            avgLiveWeight,
            slaughteredWeight,
            rmFlTotal,
            initialBins: { ...bins },
            bins: { ...bins },
            initialCoProductKg: mainCoproductWeight,
            coProductKg: Number(mainCoproductWeight.toFixed(1)),
            shift: grp.shift,
            allocations: [],
            initialTotalFg
          });
        });
      }

      // 4. Load Orders
      let initialOrders: Order[] = [];
      if (orderRes.ok) {
        const rawOrders = await orderRes.json();
        rawOrders.forEach((l: any) => {
          const spec = specMap[l.itemCode];
          const erpDesc = erpItemsMap[l.itemCode] || '';



          const finalDesc = erpDesc ? `${l.itemCode} - ${erpDesc}` : l.itemCode;

          initialOrders.push({
            id: `L-${l.erpOrderLineId}`,
            itemCode: l.itemCode,
            itemDesc: finalDesc,
            qty: Number(Number(l.quantityKg).toFixed(1)),
            type: spec?.type || l.productType || 'chilled',
            size: normalizeSize(spec?.size),
            unfulfilledKg: Number(Number(l.quantityKg).toFixed(1)),
            fulfilledKg: 0,
            priority: l.priority ?? null
          });
        });
      }

      setUnprocessedSublots(loadedSublots);
      setUnprocessedOrders(initialOrders);
      setRawSupplyCount(loadedSublots.length);
      setRawDemandCount(initialOrders.length);

      if (!hasDbPlan) {
        setOrders([]);
        setSublots([]);
      }

    } catch (e) {
      console.error("Error loading DPS data:", e);
    } finally {
      setLoading(false);
    }
  };

  const SUBLOT_POOL_SIZE = 2;
  const allocateProportionally = (order: any, yieldRate: number, getTargetBinsForSublot: (sl: any) => string[], sublotsPool: any[]) => {
    let startIndex = 0;
    while (order.unfulfilledKg > 0 && startIndex < sublotsPool.length) {
      const pool = sublotsPool.slice(startIndex, startIndex + SUBLOT_POOL_SIZE);
      let poolAvailRm = 0;
      pool.forEach((sl: any) => {
        const targetBins = getTargetBinsForSublot(sl);
        targetBins.forEach((bin: string) => { poolAvailRm += (sl.bins[bin] || 0); });
      });
      if (poolAvailRm > 0) {
        const reqRm = order.unfulfilledKg / yieldRate;
        const takeFraction = Math.min(1, reqRm / poolAvailRm);
        pool.forEach((sl: any) => {
          const targetBins = getTargetBinsForSublot(sl);
          targetBins.forEach((binSize: string) => {
            const availRm = sl.bins[binSize] || 0;
            if (availRm > 0 && order.unfulfilledKg > 0) {
              const currentReqRm = order.unfulfilledKg / yieldRate;
              let takeRm = Number((availRm * takeFraction).toFixed(1));
              takeRm = Math.min(takeRm, currentReqRm, availRm);
              if (takeRm > 0) {
                const takeFg = Number((takeRm * yieldRate).toFixed(1));
                sl.bins[binSize] = Number((sl.bins[binSize] - takeRm).toFixed(1));
                order.fulfilledKg = Number((order.fulfilledKg + takeFg).toFixed(1));
                order.unfulfilledKg = Number((order.unfulfilledKg - takeFg).toFixed(1));
                sl.allocations.push({ orderId: order.id, itemDesc: order.itemDesc, size: binSize, qty: takeFg });
              }
            }
          });
        });
      }
      startIndex += SUBLOT_POOL_SIZE;
    }
  };

  const generateSchedule = async () => {
    setShowRunModal(false);
    setLoading(true);
    try {
      const loadedSublots = [...unprocessedSublots];
      const initialOrders = [...unprocessedOrders].sort((a, b) => {
        // 1. Prioritize Sized over Unsize
        const aIsSized = a.size !== 'unsize';
        const bIsSized = b.size !== 'unsize';
        if (aIsSized && !bIsSized) return -1;
        if (!aIsSized && bIsSized) return 1;

        // 2. Sort by Priority (1 = highest, null = lowest)
        const pA = a.priority === null || a.priority === undefined ? 999 : a.priority;
        const pB = b.priority === null || b.priority === undefined ? 999 : b.priority;
        if (pA !== pB) return pA - pB;

        return a.itemCode.localeCompare(b.itemCode);
      });

      // Pass 1: Allocate standard sized MAIN product orders
      initialOrders.forEach(order => {
        if (order.size !== 'unsize' && getProductType(order.itemCode) === 'main' && order.unfulfilledKg > 0) {
          const yieldRate = getLegYield(order.itemCode, order.itemDesc);
          const targetBins = getMatchingBins(order.size, isBil, yieldRate, blBeltGateMatrix, sizeColumns);
          allocateProportionally(order, yieldRate, () => targetBins, loadedSublots);
        }
      });

      // Pass 2: Allocate unsized MAIN product orders
      initialOrders.forEach(order => {
        if (order.size === 'unsize' && getProductType(order.itemCode) === 'main' && order.unfulfilledKg > 0) {
          const yieldRate = getLegYield(order.itemCode, order.itemDesc);
          allocateProportionally(order, yieldRate, (sl) => Object.keys(sl.bins).filter(bin => !yieldNodeTypeMap.has(bin)), loadedSublots);
        }
      });

      // Calculate dynamic Co-Product and By-Product supply based on main product allocations
      loadedSublots.forEach(sl => {
        computeYieldTreeSubproducts(sl);
      });

      // Pass 3: Allocate Co-Product & By-Product orders from dynamic yield bins or fallback coProductKg
      initialOrders.forEach(order => {
        const prodType = getProductType(order.itemCode);
        if ((prodType === 'coproduct' || prodType === 'byproduct') && order.unfulfilledKg > 0) {
          const spec = specsMap[order.itemCode];
          const bpIds = spec?.masterYieldIds ? spec.masterYieldIds.split(',').map((id: any) => id.trim()).filter((id: any) => id) : [];

          if (bpIds.length > 0) {
            loadedSublots.forEach(sl => {
              bpIds.forEach((bpId: string) => {
                let avail = sl.bins[bpId] || 0;
                const isGradeB = order.size === 'Grade B' || order.itemDesc.includes('เกรด B') || order.itemDesc.includes('Grade B');
                if (isGradeB && avail === 0 && sl.coProductKg > 0) {
                  avail = sl.coProductKg;
                }

                if (avail > 0 && order.unfulfilledKg > 0) {
                  const take = Number(Math.min(avail, order.unfulfilledKg).toFixed(1));
                  if (take <= 0) return;

                  if (sl.bins[bpId] !== undefined) {
                    sl.bins[bpId] = Number((sl.bins[bpId] - take).toFixed(1));
                  } else if (isGradeB) {
                    sl.coProductKg = Number((sl.coProductKg - take).toFixed(1));
                  }

                  order.fulfilledKg = Number((order.fulfilledKg + take).toFixed(1));
                  order.unfulfilledKg = Number((order.unfulfilledKg - take).toFixed(1));
                  sl.allocations.push({ orderId: order.id, itemDesc: order.itemDesc, size: bpId, qty: take });
                }
              });
            });
          } else {
            // Fallback for Grade B if no masterYieldIds mapped yet
            const isGradeB = order.size === 'Grade B' || order.itemDesc.includes('เกรด B') || order.itemDesc.includes('Grade B');
            if (isGradeB) {
              loadedSublots.forEach(sl => {
                const avail = sl.coProductKg || 0;
                if (avail > 0 && order.unfulfilledKg > 0) {
                  const take = Number(Math.min(avail, order.unfulfilledKg).toFixed(1));
                  if (take <= 0) return;
                  sl.coProductKg = Number((sl.coProductKg - take).toFixed(1));
                  order.fulfilledKg = Number((order.fulfilledKg + take).toFixed(1));
                  order.unfulfilledKg = Number((order.unfulfilledKg - take).toFixed(1));
                  sl.allocations.push({ orderId: order.id, itemDesc: order.itemDesc, size: 'Grade B', qty: take });
                }
              });
            }
          }
        }
      });

      setSublots(loadedSublots);
      setOrders(initialOrders);
      setIsGenerated(true);

      await saveDbUpdate(loadedSublots, initialOrders);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };


  const handleAddOrder = () => {
    if (!newOrderForm.itemCode || !newOrderForm.qty) return;
    const spec = availableSpecs.find(s => s.erpItemCode === newOrderForm.itemCode);
    const qty = Number(newOrderForm.qty);
    if (!spec || qty <= 0) return;

    const newOrder: Order = {
      id: `L-CUSTOM-${Date.now()}`,
      itemCode: spec.erpItemCode,
      itemDesc: `${spec.erpItemCode} - ${spec.erpItemDesc || 'Custom Item'}`,
      qty: qty,
      type: spec.productType || 'chilled',
      size: normalizeSize(spec.productSize),
      unfulfilledKg: qty,
      fulfilledKg: 0,
      priority: null
    };

    setOrders([...orders, newOrder]);
    setShowAddOrderModal(false);
    setNewOrderForm({ itemCode: '', qty: '' });
  };

  const handleRemoveOrder = (orderId: string) => {
    if (!confirm('Are you sure you want to remove this order?')) return;
    setOrders(orders.filter(o => o.id !== orderId));
  };

  const handleDeletePlan = async () => {
    if (!confirm('Are you sure you want to delete this schedule from the database? This action cannot be undone.')) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/dps/${targetDate}?partType=${partId || 'fillet'}`, { method: 'DELETE' });
      if (res.ok) {
        setOrders([]);
        setSublots([]);
        setIsGenerated(false);
        fetchData();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = () => {
    window.open(`${API}/api/dps/${targetDate}/export?partType=${partId || 'fillet'}`, '_blank');
  };

  const handleReallocate = async () => {
    if (!confirm('Re-allocating will overwrite all current manual adjustments and recalculate from scratch. Proceed?')) return;

    setLoading(true);
    try {
      const freshSublots = unprocessedSublots.map(sl => ({
        ...sl,
        bins: { ...sl.initialBins },
        coProductKg: sl.initialCoProductKg,
        allocations: [] as Sublot['allocations']
      }));

      const freshOrders = orders.map(o => ({
        ...o,
        unfulfilledKg: o.qty,
        fulfilledKg: 0
      })).sort((a, b) => {
        // 1. Prioritize Sized over Unsize
        const aIsSized = a.size !== 'unsize';
        const bIsSized = b.size !== 'unsize';
        if (aIsSized && !bIsSized) return -1;
        if (!aIsSized && bIsSized) return 1;

        // 2. Sort by Priority
        const pA = a.priority === null || a.priority === undefined ? 999 : a.priority;
        const pB = b.priority === null || b.priority === undefined ? 999 : b.priority;
        if (pA !== pB) return pA - pB;

        return a.itemCode.localeCompare(b.itemCode);
      });

      // Pass 1: Allocate standard sized MAIN product orders
      freshOrders.forEach(order => {
        if (order.size !== 'unsize' && getProductType(order.itemCode) === 'main' && order.unfulfilledKg > 0) {
          const yieldRate = getLegYield(order.itemCode, order.itemDesc);
          const targetBins = getMatchingBins(order.size, isBil, yieldRate, blBeltGateMatrix, sizeColumns);
          allocateProportionally(order, yieldRate, () => targetBins, freshSublots);
        }
      });

      // Pass 2: Allocate unsized MAIN product orders
      freshOrders.forEach(order => {
        if (order.size === 'unsize' && getProductType(order.itemCode) === 'main' && order.unfulfilledKg > 0) {
          const yieldRate = getLegYield(order.itemCode, order.itemDesc);
          allocateProportionally(order, yieldRate, (sl) => Object.keys(sl.bins).filter(bin => !yieldNodeTypeMap.has(bin)), freshSublots);
        }
      });

      // Calculate dynamic Co-Product and By-Product supply based on main product allocations
      freshSublots.forEach(sl => {
        computeYieldTreeSubproducts(sl);
      });

      // Pass 3: Allocate Co-Product & By-Product orders from dynamic yield bins or fallback coProductKg
      freshOrders.forEach(order => {
        const prodType = getProductType(order.itemCode);
        if ((prodType === 'coproduct' || prodType === 'byproduct') && order.unfulfilledKg > 0) {
          const spec = specsMap[order.itemCode];
          const bpIds = spec?.masterYieldIds ? spec.masterYieldIds.split(',').map((id: any) => id.trim()).filter((id: any) => id) : [];

          if (bpIds.length > 0) {
            freshSublots.forEach(sl => {
              bpIds.forEach((bpId: string) => {
                let avail = sl.bins[bpId] || 0;
                const isGradeB = order.size === 'Grade B' || order.itemDesc.includes('เกรด B') || order.itemDesc.includes('Grade B');
                if (isGradeB && avail === 0 && sl.coProductKg > 0) {
                  avail = sl.coProductKg;
                }

                if (avail > 0 && order.unfulfilledKg > 0) {
                  const take = Number(Math.min(avail, order.unfulfilledKg).toFixed(1));
                  if (take <= 0) return;

                  if (sl.bins[bpId] !== undefined) {
                    sl.bins[bpId] = Number((sl.bins[bpId] - take).toFixed(1));
                  } else if (isGradeB) {
                    sl.coProductKg = Number((sl.coProductKg - take).toFixed(1));
                  }

                  order.fulfilledKg = Number((order.fulfilledKg + take).toFixed(1));
                  order.unfulfilledKg = Number((order.unfulfilledKg - take).toFixed(1));
                  sl.allocations.push({ orderId: order.id, itemDesc: order.itemDesc, size: bpId, qty: take });
                }
              });
            });
          } else {
            // Fallback for Grade B
            const isGradeB = order.size === 'Grade B' || order.itemDesc.includes('เกรด B') || order.itemDesc.includes('Grade B');
            if (isGradeB) {
              freshSublots.forEach(sl => {
                const avail = sl.coProductKg || 0;
                if (avail > 0 && order.unfulfilledKg > 0) {
                  const take = Number(Math.min(avail, order.unfulfilledKg).toFixed(1));
                  if (take <= 0) return;
                  sl.coProductKg = Number((sl.coProductKg - take).toFixed(1));
                  order.fulfilledKg = Number((order.fulfilledKg + take).toFixed(1));
                  order.unfulfilledKg = Number((order.unfulfilledKg - take).toFixed(1));
                  sl.allocations.push({ orderId: order.id, itemDesc: order.itemDesc, size: 'Grade B', qty: take });
                }
              });
            }
          }
        }
      });
      freshSublots.sort((a: any, b: any) => a.id.localeCompare(b.id, undefined, { numeric: true }));

      setSublots(freshSublots);
      setOrders(freshOrders);
      await saveDbUpdate(freshSublots, freshOrders);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const totalDemand = orders.reduce((sum, o) => sum + o.qty, 0);
  const totalFulfilled = orders.reduce((sum, o) => sum + o.fulfilledKg, 0);
  const percentFulfilled = totalDemand > 0 ? (totalFulfilled / totalDemand) * 100 : 0;
  const totalSublots = sublots.length;

  const calculateManpower = () => {
    if (isBil) {
      const getCodesByProcess = (categoryName: string, processName: string) => {
        const catNodes = yieldTree.filter(n => n.type === 'CATEGORY' && n.name === categoryName);
        const procNodes = yieldTree.filter(n => n.type === 'PROCESS' && n.name === processName && catNodes.some(c => c.id === n.parentId));

        const nodeIds: string[] = [];
        const collect = (parentId: string) => {
          const children = yieldTree.filter(n => n.parentId === parentId);
          for (const child of children) {
            nodeIds.push(child.id);
            collect(child.id);
          }
        };

        procNodes.forEach(p => {
          nodeIds.push(p.id);
          collect(p.id);
        });

        return Object.values(specsMap)
          .filter(s => {
            if (!s.masterYieldIds) return false;
            const ids = s.masterYieldIds.split(',').map((id: string) => id.trim());
            return ids.some((id: string) => nodeIds.includes(id));
          })
          .map(s => s.erpItemCode);
      };

      const bilProcess1Codes = getCodesByProcess('BIL L/C', 'process: 1');
      const bilProcess2Codes = getCodesByProcess('BIL L/C', 'process: 2');

      const isByproductSpec = (code: string) => {
        const s = specsMap[code];
        if (!s) return false;
        return s.productType === 'BY-PRODUCT' || s.productType === 'CO-PRODUCT';
      };

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

      const processShift = (shiftTarget: string) => {
        let demandP1 = 0;
        let requiredP1WorkersHours = 0;
        let requiredP2ThighPcs = 0;
        let requiredP2DrumPcs = 0;
        let separationWorkersHours = 0;

        let shiftTotalPcs = 0;
        let shiftRemainingPieces = 0;

        sublots.forEach(sl => {
          if ((sl.shift || 'A') !== shiftTarget) return;

          const bilCategoryNode = yieldTree.find(n => n.name === 'BIL L/C' && n.type === 'CATEGORY');
          const partYield = bilCategoryNode?.yieldPercentage ? Number(bilCategoryNode.yieldPercentage) : 0.25;
          const slNet = sl.totalWeightKg * 0.9575 * 0.95 * partYield;

          const bilPiecesTotal = sl.totalBirds * 2;
          const avgPieceWeight = bilPiecesTotal > 0 ? slNet / bilPiecesTotal : 0.3;
          shiftTotalPcs += bilPiecesTotal;

          sl.allocations.forEach(alloc => {
            const o = orders.find(ord => ord.id === alloc.orderId);
            if (o && !isByproductSpec(o.itemCode)) {
              if (bilProcess1Codes.includes(o.itemCode)) {
                demandP1 += alloc.qty;
                const spec = specsMap[o.itemCode];
                const speed = spec?.productSpeed ? Number(spec.productSpeed) : 45;
                requiredP1WorkersHours += alloc.qty / speed;
              } else if (bilProcess2Codes.includes(o.itemCode)) {
                const spec = specsMap[o.itemCode];
                const isDrum = spec && spec.erpItemDesc && spec.erpItemDesc.includes('น่อง') && !spec.erpItemDesc.includes('สะโพก');
                const yieldPct = spec?.productYield ? Number(spec.productYield) : 0.5;
                const speed = spec?.productSpeed ? Number(spec.productSpeed) : 45;
                const pcs = avgPieceWeight > 0 && yieldPct > 0 ? alloc.qty / (avgPieceWeight * yieldPct) : 0;

                if (isDrum) requiredP2DrumPcs += pcs;
                else requiredP2ThighPcs += pcs;

                separationWorkersHours += alloc.qty / speed;
              }
            }
          });
        });

        // Use a generic avg piece weight for the shift (assume 0.3 if 0)
        const avgPieceWeight = 0.3;
        shiftRemainingPieces = shiftTotalPcs;

        // P1
        const piecesForP1 = demandP1 / avgPieceWeight;
        shiftRemainingPieces = Math.max(0, shiftRemainingPieces - piecesForP1);

        // P2
        const piecesToCutForP2 = Math.max(requiredP2ThighPcs, requiredP2DrumPcs);
        const actualPiecesCutP2 = Math.min(shiftRemainingPieces, piecesToCutForP2);
        shiftRemainingPieces = Math.max(0, shiftRemainingPieces - actualPiecesCutP2);

        const p1CuttingStaff = Math.ceil(requiredP1WorkersHours / 9.58);
        const separation = p1CuttingStaff + Math.ceil(separationWorkersHours / 9.58);

        // P3
        const pcs = shiftRemainingPieces;
        if (pcs <= 0) return { debone: 0, trimming: 0, xray: 0, separation, total: separation };

        const toridasConf = getMachineConfig('toridas', { speed: 1500, yield: 0.75, lines: 3, machinesPerLine: 4, workers: 5 });
        const foodmateConf = getMachineConfig('foodmate', { speed: 6000, yield: 0.70, lines: 1, machinesPerLine: 1, workers: 5 });
        const trimConf = getMachineConfig('trimming_belt', { speed: 600, yield: 1.0, lines: 3, machinesPerLine: 1, workers: 7 });
        const xrayConf = getMachineConfig('xray', { speed: 18700, yield: 1.0, lines: 3, machinesPerLine: 1, workers: 5 });

        const toridasInputPcs = Math.min(pcs, toridasConf.lines * toridasConf.machinesPerLine * toridasConf.speed * 9.58);
        const leftoverPcs = Math.max(0, pcs - toridasInputPcs);
        const foodmateInputPcs = Math.min(leftoverPcs, foodmateConf.lines * foodmateConf.machinesPerLine * foodmateConf.speed * 9.58);
        const totalPcs = toridasInputPcs + foodmateInputPcs;

        const debone = (toridasInputPcs > 0 ? toridasConf.lines * toridasConf.workers : 0) + (foodmateInputPcs > 0 ? foodmateConf.lines * foodmateConf.workers : 0);
        const trimming = Math.ceil((totalPcs / trimConf.speed) / 9.58) + (totalPcs > 0 ? trimConf.lines * trimConf.workers : 0);
        const machinesNeeded = totalPcs > 0 ? Math.ceil(totalPcs / (xrayConf.speed * 9.58)) : 0;
        const xray = Math.min(xrayConf.lines, machinesNeeded) * xrayConf.workers;

        return { debone, trimming, xray, separation, total: debone + trimming + xray + separation };
      };

      const shiftA = processShift('A');
      const shiftB = processShift('B');

      return {
        isBil: true,
        shiftA: shiftA.total,
        shiftB: shiftB.total,
        detailsA: shiftA,
        detailsB: shiftB
      };
    }

    let shiftA_Hours = 0;
    let shiftB_Hours = 0;

    let shiftA_Support = 0;
    let shiftB_Support = 0;

    sublots.forEach(sl => {
      const shift = sl.shift || 'A';

      if (shift === 'A') shiftA_Support += (sl.supportManpower || 0);
      else if (shift === 'B') shiftB_Support += (sl.supportManpower || 0);

      sl.allocations.forEach(alloc => {
        const itemCodeMatch = alloc.itemDesc ? alloc.itemDesc.split(' - ')[0] : '';
        if (!itemCodeMatch || getProductType(itemCodeMatch) !== 'main') return;
        const spec = availableSpecs.find(s => s.erpItemCode === itemCodeMatch);
        const speed = spec?.productSpeed;

        if (speed && speed > 0) {
          const hours = alloc.qty / speed;
          if (shift === 'A') shiftA_Hours += hours;
          else if (shift === 'B') shiftB_Hours += hours;
        }
      });
    });

    return {
      isBil: false,
      shiftA: Math.round(shiftA_Hours > 0 ? (shiftA_Hours / 9.58) : 0),
      shiftB: Math.round(shiftB_Hours > 0 ? (shiftB_Hours / 9.58) : 0),
      supportA: shiftA_Support,
      supportB: shiftB_Support
    };
  };

  const manpower = calculateManpower();

  const activeSizes = isBil
    ? sizeColumns.map(col => ({ key: col, label: col }))
    : Object.keys(sizeLabelMap).map(k => ({ key: k, label: sizeLabelMap[k] }));

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6 bg-[#f8fafc] min-h-screen font-sans">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end bg-white p-6 rounded-3xl shadow-sm border border-gray-100 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center gap-3">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <Layers className="w-7 h-7" />
            </div>
            Daily Production Scheduling
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
                <button onClick={() => setShowAddOrderModal(true)} className="px-4 py-2 bg-green-50 text-green-700 hover:bg-green-100 font-bold text-sm rounded-xl transition-colors flex items-center gap-2">
                  <Plus size={16} /> Add Order
                </button>
                <button onClick={handleReallocate} className="px-4 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold text-sm rounded-xl transition-colors flex items-center gap-2">
                  <RefreshCw size={16} /> Re-Allocate
                </button>

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

            <div className="p-6 bg-gray-50">
              {orders.length === 0 ? (
                <p className="text-center text-gray-400 py-10 font-medium">No approved MPS orders found for this date.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {orders.filter(o => o.id !== '211113001' && o.id !== 'L-9999992').map((o, idx) => {
                    const pct = o.qty > 0 ? (o.fulfilledKg / o.qty) * 100 : 0;
                    const isFull = o.unfulfilledKg <= 0;
                    return (
                      <div key={`${o.id}-${idx}`} className={`relative overflow-hidden rounded-2xl border ${isFull ? 'border-green-200 bg-white' : 'border-gray-200 bg-white'} shadow-sm p-5 transition-all hover:shadow-md`}>
                        {/* Progress Bar Background */}
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
              {orders.filter(o => o.id !== '211113001' && o.id !== 'L-9999992').length === 0 ? (
                <p className="text-center text-gray-400 font-medium">No orders to process.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {orders.filter(o => o.id !== '211113001' && o.id !== 'L-9999992').map((o, idx) => {
                    const itemRecipes = recipesMap[o.itemCode] || [];
                    const isLoading = loadingRecipes[o.itemCode];
                    
                    const recipeNos = Array.from(new Set(itemRecipes.map((r: any) => String(r.RECIPE_NO))));

                    const logForOrder = batchLogs.find(l => l.itemCode === o.itemCode);
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

                        {itemRecipes.length > 0 && (
                          <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-gray-100">
                            <label className="text-xs font-semibold text-gray-600">Select Recipe:</label>
                            <select
                              className="w-full text-sm border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 border bg-gray-50 mb-1 disabled:opacity-60 disabled:bg-gray-100"
                              value={selectedRecipeNo[o.itemCode] || ''}
                              onChange={(e) => handleRecipeNoSelect(o.itemCode, e.target.value)}
                              disabled={confirmedRecipes[o.itemCode] || isSuccessBatch}
                            >
                              <option value="">-- Select Recipe --</option>
                              {recipeNos.map(no => (
                                <option key={no} value={no}>{no}</option>
                              ))}
                            </select>

                            {selectedRecipeNo[o.itemCode] && (
                              <>
                                <label className="text-xs font-semibold text-gray-600">Select Version:</label>
                                <select
                                  className="w-full text-sm border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 border bg-gray-50 disabled:opacity-60 disabled:bg-gray-100"
                                  value={selectedRecipe[o.itemCode] || ''}
                                  onChange={(e) => handleRecipeSelect(o.itemCode, e.target.value)}
                                  disabled={confirmedRecipes[o.itemCode] || isSuccessBatch}
                                >
                                  <option value="">-- Select Version --</option>
                                  {itemRecipes
                                    .filter((r: any) => String(r.RECIPE_NO) === selectedRecipeNo[o.itemCode])
                                    .map((r: any) => (
                                      <option key={r.RECIPE_ID} value={r.RECIPE_ID}>
                                        {String(r.RECIPE_VERSION).replace(/^v/i, '')}
                                      </option>
                                    ))
                                  }
                                </select>
                              </>
                            )}

                            {selectedRecipe[o.itemCode] && (() => {
                              const selected = itemRecipes.find(r => String(r.RECIPE_ID) === String(selectedRecipe[o.itemCode]));
                              return selected ? (
                                <p className="text-[10px] text-gray-500 bg-gray-100 p-2 rounded-md italic mt-1">
                                  {selected.RECIPE_DESCRIPTION}
                                </p>
                              ) : null;
                            })()}

                            {selectedRecipe[o.itemCode] && !isSuccessBatch && (
                              confirmedRecipes[o.itemCode] ? (
                                <button
                                  onClick={() => handleUnlockRecipe(o.itemCode)}
                                  className="w-full mt-2 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-xs py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-sm transition-all border border-gray-300"
                                >
                                  <X size={14} /> Unlock
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleConfirmRecipe(o.itemCode)}
                                  className="w-full mt-2 bg-green-600 hover:bg-green-700 text-white font-bold text-xs py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-md transition-all"
                                >
                                  <Check size={14} /> Confirm
                                </button>
                              )
                            )}
                          </div>
                        )}
                        {itemRecipes.length === 0 && !isLoading && recipesMap[o.itemCode] && (
                          <p className="text-xs text-red-500 font-bold bg-red-50 p-2 rounded-md border border-red-100">No recipes found in Oracle ERP for this item.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* MANPOWER BOX */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden p-6 flex flex-col md:flex-row items-center gap-6">
            <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
              <Users size={24} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-gray-800 mb-1">Manpower Planning</h3>
              {manpower.isBil ? (
                <p className="text-sm text-gray-500">Calculated automatically for Debone (15 pax), Trimming, and X-Ray.</p>
              ) : (
                <p className="text-sm text-gray-500">Calculated automatically based on Item Product Speed and 9.58 hrs/shift.</p>
              )}
            </div>
            <div className="flex items-center gap-8">
              <div className="text-center px-4 border-r border-gray-100">
                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Shift A</div>
                <div className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between items-center gap-4"><span className="text-gray-500">Cutting:</span> <span className="font-bold text-gray-800">{manpower.shiftA.toLocaleString()}</span></div>
                  {!manpower.isBil && (
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-gray-500">Support:</span>
                      <input
                        type="number"
                        min="0"
                        className="w-16 text-right p-1 border border-gray-200 rounded text-gray-800 font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                        defaultValue={(manpower as any).supportA || ''}
                        onBlur={(e) => handleUpdateSupportManpowerShift('A', parseInt(e.target.value) || 0)}
                      />
                    </div>
                  )}
                </div>
                <div className="mt-2 text-2xl font-black text-gray-900 border-t border-gray-50 pt-2">
                  {(manpower.shiftA + (!manpower.isBil ? ((manpower as any).supportA || 0) : 0)).toLocaleString()} <span className="text-sm text-gray-500 font-medium">Head</span>
                </div>
              </div>
              <div className="text-center px-4">
                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Shift B</div>
                <div className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between items-center gap-4"><span className="text-gray-500">Cutting:</span> <span className="font-bold text-gray-800">{manpower.shiftB.toLocaleString()}</span></div>
                  {!manpower.isBil && (
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-gray-500">Support:</span>
                      <input
                        type="number"
                        min="0"
                        className="w-16 text-right p-1 border border-gray-200 rounded text-gray-800 font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                        defaultValue={(manpower as any).supportB || ''}
                        onBlur={(e) => handleUpdateSupportManpowerShift('B', parseInt(e.target.value) || 0)}
                      />
                    </div>
                  )}
                </div>
                <div className="mt-2 text-2xl font-black text-gray-900 border-t border-gray-50 pt-2">
                  {(manpower.shiftB + (!manpower.isBil ? ((manpower as any).supportB || 0) : 0)).toLocaleString()} <span className="text-sm text-gray-500 font-medium">Head</span>
                </div>
              </div>
            </div>
          </div>

          {/* STEP 2: SUBLOTS ALLOCATION */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white/80 backdrop-blur-md z-20">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                  <Package size={16} />
                </div>
                Sublot Fulfillment (Supply)
              </h2>
              <div className="text-sm font-bold text-gray-500">
                {totalSublots} Sublots Total
              </div>
            </div>

            <div className="p-6 space-y-6 bg-gray-50/50">
              {sublots.length === 0 ? (
                <p className="text-center text-gray-400 py-10 font-medium">No chicken receiving sublots found for this date.</p>
              ) : (
                sublots.map((sl, index) => {
                  const totalAllocated = sl.allocations.reduce((sum, a) => sum + a.qty, 0);
                  const utilPct = sl.initialTotalFg > 0 ? (totalAllocated / sl.initialTotalFg) * 100 : 0;

                  // Calculate Sublot Manpower
                  let slHours = 0;
                  sl.allocations.forEach(alloc => {
                    const itemCodeMatch = alloc.itemDesc ? alloc.itemDesc.split(' - ')[0] : '';
                    if (!itemCodeMatch || getProductType(itemCodeMatch) !== 'main') return;
                    const spec = availableSpecs.find(s => s.erpItemCode === itemCodeMatch);
                    const speed = spec?.productSpeed;
                    if (speed && speed > 0) {
                      slHours += alloc.qty / speed;
                    }
                  });
                  const slManpower = Math.round(slHours > 0 ? (slHours / 9.58) : 0);
                  const shiftManpower = sl.shift === 'B' ? manpower.shiftB : manpower.shiftA;
                  const variance = shiftManpower - slManpower;

                  const capInput = bilCapacityInputs[sl.id] || { manpower: '', speed: '', hours: '', pieceWeight: '' };
                  const handleCapInputChange = (field: string, value: number | string) => {
                    setBilCapacityInputs(prev => ({
                      ...prev,
                      [sl.id]: {
                        ...capInput,
                        [field]: value
                      }
                    }));
                  };

                  // Helper for calculation to handle empty strings
                  const getNum = (val: string | number) => Number(val) || 0;
                  const estPieces = Math.round(getNum(capInput.manpower) * getNum(capInput.speed) * getNum(capInput.hours) * 60);

                  const toridasConf = machineConfigs.find(c => c.machineKey === 'toridas');
                  const defaultToridasYield = toridasConf ? toridasConf.yieldPercentage * 100 : 100;

                  const blInput = blPiecesInputs[sl.id] || { toridasYield: defaultToridasYield, blYield: 0.09 };
                  const handleBlInputChange = (field: string, val: number | string) => {
                    setBlPiecesInputs(p => ({ ...p, [sl.id]: { ...blInput, [field]: val } }));
                  };

                  const remainingMainProducts = Object.entries(sl.bins)
                    .filter(([k]) => !yieldNodeTypeMap.has(k) || yieldNodeTypeMap.get(k) === 'MAIN')
                    .reduce((sum, [_, v]) => sum + v, 0);

                  const toridasY = getNum(blInput.toridasYield);
                  const blY = getNum(blInput.blYield);
                  const roundedAvgWeight = Number(sl.avgLiveWeight.toFixed(2));
                  let blPiecesCalc = 0;
                  if (roundedAvgWeight > 0 && blY > 0) {
                    blPiecesCalc = (remainingMainProducts * (toridasY / 100)) / roundedAvgWeight / blY;
                  }

                  const mainBins = Object.entries(sl.bins)
                    .filter(([k]) => !yieldNodeTypeMap.has(k) || yieldNodeTypeMap.get(k) === 'MAIN')
                    .map(([k, v]) => ({
                      label: getDisplayLabel(k),
                      kg: v,
                      pcs: (roundedAvgWeight > 0 && blY > 0) ? (v * (toridasY / 100)) / roundedAvgWeight / blY : 0
                    }))
                    .filter(b => b.kg > 0);

                  const blTransferAllocs = sl.allocations.filter(a => a.orderId === '211113001');
                  const nextSlTransferAllocs = sl.allocations.filter(a => a.orderId === 'L-9999992');
                  const hasBlCommit = blTransferAllocs.length > 0 || nextSlTransferAllocs.length > 0;

                  let displayRemainingMain = remainingMainProducts;
                  let displayBlPiecesCalc = blPiecesCalc;
                  let displayMainBins = [...mainBins];

                  if (hasBlCommit) {
                    let committedKg = 0;
                    blTransferAllocs.forEach(a => committedKg += a.qty);
                    nextSlTransferAllocs.forEach(a => committedKg += a.qty);

                    displayRemainingMain = remainingMainProducts + committedKg;
                    if (roundedAvgWeight > 0 && blY > 0) {
                      displayBlPiecesCalc = (displayRemainingMain * (toridasY / 100)) / roundedAvgWeight / blY;
                    }

                    const binMap = new Map<string, { kg: number, pcs: number }>();
                    mainBins.forEach(b => binMap.set(b.label, { kg: b.kg, pcs: b.pcs }));

                    const processAlloc = (a: any) => {
                      const label = a.sizeLabel || getDisplayLabel(a.size);
                      if (!binMap.has(label)) binMap.set(label, { kg: 0, pcs: 0 });
                      const curr = binMap.get(label)!;
                      curr.kg += a.qty;
                      if (roundedAvgWeight > 0 && blY > 0) {
                        curr.pcs += (a.qty * (toridasY / 100)) / roundedAvgWeight / blY;
                      }
                    };
                    blTransferAllocs.forEach(processAlloc);
                    nextSlTransferAllocs.forEach(processAlloc);

                    displayMainBins = Array.from(binMap.entries()).map(([label, v]) => ({ label, kg: v.kg, pcs: v.pcs })).filter(b => b.kg > 0);
                  }

                  const transferredInFromPrev = index > 0
                    ? sublots[index - 1].allocations.filter(a => a.orderId === 'L-9999992')
                    : [];
                  const transferredInTotalKg = transferredInFromPrev.reduce((sum, a) => sum + a.qty, 0);
                  let transferredInTotalPcs = 0;
                  if (roundedAvgWeight > 0 && blY > 0) {
                    transferredInTotalPcs = (transferredInTotalKg * (toridasY / 100)) / roundedAvgWeight / blY;
                  }

                  return (
                    <div key={sl.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col xl:flex-row">

                      {/* Left: Sublot Info */}
                      <div className="w-full xl:w-1/3 bg-gray-50 border-r border-gray-200 p-6 flex flex-col justify-between relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-5">
                          <Package size={100} />
                        </div>
                        <div className="relative z-10">
                          <div className="flex items-center gap-2 mb-4">
                            <span className="bg-gray-900 text-white text-xs font-black px-2 py-1 rounded-md">#{index + 1}</span>
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{sl.shift}</span>
                          </div>
                          <h3 className="text-xl font-black text-gray-900 mb-6">Sublot {sl.id.split('_')[0]}</h3>

                          {/* Part 1: Primary Intake Stats */}
                          <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-gray-200">
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase">Intake Birds</p>
                              <p className="text-sm font-bold text-gray-800">{sl.totalBirds.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase">Total Weight</p>
                              <p className="text-sm font-bold text-gray-800">{Math.round(sl.totalWeightKg).toLocaleString()} <span className="text-[10px]">kg</span></p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase">Avg. Weight</p>
                              <p className="text-sm font-bold text-blue-600">{sl.avgLiveWeight.toFixed(2)} <span className="text-[10px]">kg</span></p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase">Slaughtered</p>
                              <p className="text-sm font-bold text-indigo-600">{Math.round(sl.slaughteredWeight).toLocaleString()} <span className="text-[10px]">kg</span></p>
                            </div>
                          </div>

                          {/* Part 2: RM Yield Calculation */}
                          {(!partId || partId.toLowerCase() === 'fl') ? (
                            <div className="grid grid-cols-2 gap-4 mb-6">
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase">RM {(partId || 'FL').toUpperCase()} Total</p>
                                <p className="text-sm font-bold text-gray-800">{Math.round(sl.rmFlTotal).toLocaleString()} <span className="text-[10px]">kg</span></p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase">RM {(partId || 'FL').toUpperCase()} Grade B</p>
                                <p className="text-sm font-bold text-orange-500">{Math.round(sl.initialCoProductKg).toLocaleString()} <span className="text-[10px]">kg</span></p>
                              </div>
                              <div className="col-span-2 bg-blue-50/50 p-2 rounded-lg border border-blue-100">
                                <p className="text-[10px] font-bold text-blue-400 uppercase">RM {(partId || 'FL').toUpperCase()} หัก Grade B (Est. FG)</p>
                                <p className="text-lg font-black text-blue-700">{Math.round(sl.initialTotalFg).toLocaleString()} <span className="text-xs">kg</span></p>
                              </div>
                            </div>
                          ) : (
                            <div className="mb-6 bg-blue-50/50 p-3 rounded-lg border border-blue-100 flex flex-col items-center justify-center">
                              <p className="text-[10px] font-bold text-blue-400 uppercase">RM {partId.toUpperCase()} Total (Est. FG)</p>
                              <p className="text-2xl font-black text-blue-700">{Math.round(sl.initialTotalFg).toLocaleString()} <span className="text-sm font-bold">kg</span></p>
                            </div>
                          )}

                          {/* Part 3: Sublot Manpower */}
                          <div className="bg-purple-50/50 p-3 rounded-xl border border-purple-100 flex flex-col gap-3 mb-2">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-[10px] font-bold text-purple-500 uppercase">Cutting Manpower</p>
                                <p className="text-lg font-black text-purple-700">{slManpower.toLocaleString()} <span className="text-[10px]">Head</span></p>
                              </div>
                              <div className="text-right">
                                <p className="text-[10px] font-bold text-purple-400 uppercase">Variance (Shift {sl.shift || 'A'})</p>
                                <p className={`text-base font-black ${variance > 0 ? 'text-blue-500' : variance < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                                  {variance > 0 ? `+${variance}` : variance} <span className="text-[10px]">Head</span>
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Part 4: BL Pieces Calculator */}
                          {(partId && partId.toLowerCase() === 'bil') && (
                            <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-200 flex flex-col gap-3 mb-2">
                              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1">BL Pieces Calculator (Est.)</p>
                              <div className="grid grid-cols-2 gap-2 mb-2">
                                <div>
                                  <label className="text-[9px] font-bold text-gray-500 uppercase">% Yield Toridas</label>
                                  <input type="number" min="0" max="100" step="0.1" placeholder="ระบุ %" className="w-full text-sm p-1.5 border border-gray-200 rounded text-gray-800 font-bold focus:ring-1 focus:ring-blue-500 outline-none" value={blInput.toridasYield} onChange={(e) => handleBlInputChange('toridasYield', e.target.value === '' ? '' : parseFloat(e.target.value))} />
                                </div>
                                <div>
                                  <label className="text-[9px] font-bold text-gray-500 uppercase">% Yield BL / ชิ้น</label>
                                  <input type="number" min="0" step="0.01" placeholder="ระบุ % Yield BL" className="w-full text-sm p-1.5 border border-gray-200 rounded text-gray-800 font-bold focus:ring-1 focus:ring-blue-500 outline-none" value={blInput.blYield} onChange={(e) => handleBlInputChange('blYield', e.target.value === '' ? '' : parseFloat(e.target.value))} />
                                </div>
                              </div>
                              {transferredInTotalKg > 0 && (
                                <div className="bg-purple-50 p-2 rounded-lg border border-purple-100 flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-5 h-5 rounded-full bg-purple-200 text-purple-600 flex items-center justify-center shrink-0">
                                      <ArrowRight size={12} />
                                    </div>
                                    <p className="text-[9px] font-bold text-purple-600 leading-tight">
                                      Transferred in<br />from Prev Sublot
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-xs font-black text-purple-800">
                                      +{Math.round(transferredInTotalPcs).toLocaleString()} <span className="text-[9px] font-medium text-purple-500">pcs</span>
                                    </p>
                                    <p className="text-[9px] font-bold text-purple-500">({transferredInTotalKg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg)</p>
                                  </div>
                                </div>
                              )}
                              <div className="flex flex-col bg-white p-2 rounded-lg border border-blue-100">
                                <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100 border-dashed">
                                  <div className="text-left">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Avg. Weight</p>
                                    <p className="text-sm font-black text-gray-800">{roundedAvgWeight.toFixed(2)} <span className="text-[10px] font-normal text-gray-500">kg</span></p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Rem. Main {hasBlCommit && '(Original)'}</p>
                                    <p className="text-sm font-black text-gray-800">{displayRemainingMain.toLocaleString()} <span className="text-[10px] font-normal text-gray-500">kg</span></p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Est. BL Pieces {hasBlCommit && '(Original)'}</p>
                                    <p className="text-2xl font-black text-blue-600">{Math.round(displayBlPiecesCalc).toLocaleString()} <span className="text-sm font-bold text-blue-400">ชิ้น</span></p>
                                  </div>
                                </div>
                                {displayMainBins.length > 0 ? (
                                  <div className="space-y-1">
                                    {displayMainBins.map((b, i) => (
                                      <div key={i} className="flex justify-between items-center text-[10px] py-0.5">
                                        <span className="text-gray-500 font-medium truncate pr-2">{b.label}</span>
                                        <div className="flex items-center gap-2">
                                          <span className="text-gray-700 w-16 text-right whitespace-nowrap">{b.kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</span>
                                          <span className="text-blue-600 font-bold w-20 text-right whitespace-nowrap">{Math.round(b.pcs).toLocaleString()} pcs</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-gray-400 text-center italic">ไม่มี Remaining ของ Main Product</p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Part 5: BIL to BL Capacity */}
                          {(partId && partId.toLowerCase() === 'bil') && (
                            <div className="bg-orange-50/50 p-3 rounded-xl border border-orange-200 flex flex-col gap-3 mb-2">
                              <p className="text-[10px] font-bold text-orange-600 uppercase tracking-wider mb-1">BIL to BL Capacity (Est.)</p>
                              <div className="grid grid-cols-3 gap-2 mb-2">
                                <div>
                                  <label className="text-[9px] font-bold text-gray-500 uppercase">Manpower (คน)</label>
                                  <input type="number" min="0" step="1" placeholder="ระบุจำนวนคน" className="w-full text-sm p-1.5 border border-gray-200 rounded text-gray-800 font-bold focus:ring-1 focus:ring-orange-500 outline-none" value={capInput.manpower} onChange={(e) => handleCapInputChange('manpower', e.target.value === '' ? '' : parseFloat(e.target.value))} />
                                </div>
                                <div>
                                  <label className="text-[9px] font-bold text-gray-500 uppercase">Speed (ชิ้น/นาที)</label>
                                  <input type="number" min="0" step="0.1" placeholder="ระบุความเร็ว" className="w-full text-sm p-1.5 border border-gray-200 rounded text-gray-800 font-bold focus:ring-1 focus:ring-orange-500 outline-none" value={capInput.speed} onChange={(e) => handleCapInputChange('speed', e.target.value === '' ? '' : parseFloat(e.target.value))} />
                                </div>
                                <div>
                                  <label className="text-[9px] font-bold text-gray-500 uppercase">Hours (ชั่วโมง)</label>
                                  <input type="number" min="0" step="0.1" placeholder="ระบุชั่วโมง" className="w-full text-sm p-1.5 border border-gray-200 rounded text-gray-800 font-bold focus:ring-1 focus:ring-orange-500 outline-none" value={capInput.hours} onChange={(e) => handleCapInputChange('hours', e.target.value === '' ? '' : parseFloat(e.target.value))} />
                                </div>
                              </div>
                              <div className="flex items-center justify-center bg-white p-3 rounded-lg border border-orange-100 text-center">
                                <div>
                                  <p className="text-[10px] font-bold text-orange-500 uppercase tracking-widest mb-1">Estimated Capacity</p>
                                  <p className="text-2xl font-black text-orange-600">{estPieces.toLocaleString()} <span className="text-sm font-bold text-orange-400">ชิ้น (pcs)</span></p>
                                </div>
                              </div>
                              {(() => {
                                const hasBlCommit = sl.allocations.some(a => a.orderId === '211113001' || a.orderId === 'L-9999992');
                                if (hasBlCommit) {
                                  return (
                                    <button
                                      onClick={() => handleUndoBlAllocation(sl)}
                                      className="w-full py-2 px-4 rounded-lg font-bold text-sm text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-all"
                                    >
                                      Undo BL Commit
                                    </button>
                                  );
                                }
                                return (
                                  <button
                                    onClick={() => handleCommitBlAllocation(sl, mainBins, estPieces, Math.round(blPiecesCalc))}
                                    disabled={estPieces <= 0 || mainBins.length === 0}
                                    className={`w-full py-2 px-4 rounded-lg font-bold text-sm text-white shadow-sm transition-all
                                      ${(estPieces <= 0 || mainBins.length === 0) ? 'bg-gray-300 cursor-not-allowed' : 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 hover:shadow active:scale-[0.98]'}`}
                                  >
                                    Commit to BL
                                  </button>
                                );
                              })()}
                            </div>
                          )}

                        </div>

                        <div className="relative z-10 pt-4 border-t border-gray-200">
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Sublot Utilization</p>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500" style={{ width: `${utilPct}%` }}></div>
                            </div>
                            <span className="text-xs font-bold text-gray-700">{utilPct.toFixed(0)}%</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Fulfillment & Remaining */}
                      <div className="w-full xl:w-2/3 flex flex-col md:flex-row">

                        {/* Center: Allocations made */}
                        <div className="w-full md:w-1/2 p-6 border-r border-gray-100 border-dashed">
                          <h4 className="text-xs font-bold text-green-600 uppercase tracking-wider flex items-center gap-2 mb-4">
                            <CheckCircle size={14} /> Fulfilling Orders
                          </h4>

                          {sl.allocations.length === 0 ? (
                            <div className="h-32 flex items-center justify-center border-2 border-dashed border-gray-100 rounded-xl">
                              <p className="text-xs text-gray-400 font-medium">No orders fulfilled by this sublot</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {(() => {
                                const groupedAllocations: Record<string, {
                                  itemDesc: string;
                                  totalQty: number;
                                  allocations: typeof sl.allocations;
                                }> = {};

                                sl.allocations.forEach(a => {
                                  if (!groupedAllocations[a.itemDesc]) {
                                    groupedAllocations[a.itemDesc] = {
                                      itemDesc: a.itemDesc,
                                      totalQty: 0,
                                      allocations: []
                                    };
                                  }
                                  groupedAllocations[a.itemDesc].totalQty = Number((groupedAllocations[a.itemDesc].totalQty + a.qty).toFixed(1));
                                  groupedAllocations[a.itemDesc].allocations.push(a);
                                });

                                const groupedList = Object.values(groupedAllocations);

                                return groupedList.map(({ itemDesc, totalQty, allocations: itemAllocs }) => {
                                  const isExpanded = !!expandedItems[`${sl.id}_${itemDesc}`];
                                  return (
                                    <div key={itemDesc} className="bg-white border border-gray-100 rounded-2xl shadow-sm hover:border-gray-200 transition-all overflow-hidden">
                                      {/* Accordion Header */}
                                      <div
                                        onClick={() => toggleItemExpanded(sl.id, itemDesc)}
                                        className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-gray-50/50 transition-colors"
                                      >
                                        <div className="flex-1 min-w-0 pr-4">
                                          <p className="text-xs font-bold text-gray-800 truncate" title={itemDesc}>{itemDesc}</p>
                                          <div className="flex items-center gap-2 mt-1">
                                            <p className="text-[10px] text-gray-400 font-medium">{itemAllocs.length} sizes allocated</p>
                                            {(() => {
                                              const itemCodeMatch = itemDesc ? itemDesc.split(' - ')[0] : '';
                                              const pWeight = itemCodeMatch && specsMap[itemCodeMatch] ? specsMap[itemCodeMatch].productWeight : 0;
                                              if (pWeight && pWeight > 0) {
                                                const totalBags = Math.ceil(totalQty / pWeight);
                                                return (
                                                  <span className="text-[9px] font-bold text-orange-600 bg-orange-50/50 px-1.5 py-0.5 rounded border border-orange-100/50 whitespace-nowrap">
                                                    ใช้ถุง {pWeight} กก. • {totalBags.toLocaleString()} ถุง
                                                  </span>
                                                );
                                              }
                                              return null;
                                            })()}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0">
                                          <span className="font-black text-green-700 bg-green-50 px-2.5 py-1 rounded-lg border border-green-100 text-xs shadow-sm whitespace-nowrap">
                                            +{totalQty.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
                                          </span>
                                          <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                        </div>
                                      </div>

                                      {/* Accordion Content (Breakdown by Size with CRUD) */}
                                      {isExpanded && (
                                        <div className="border-t border-gray-50 bg-gray-50/30 p-3 space-y-2">
                                          {itemAllocs.map((a, idx) => {
                                            const isEditing = editingAlloc?.id === sl.id && editingAlloc?.orderId === a.orderId && editingAlloc?.size === a.size;
                                            return (
                                              <div key={idx} className="flex justify-between items-center p-2.5 bg-white border border-gray-100 rounded-xl shadow-xs gap-2">
                                                <div className="flex-1 min-w-0">
                                                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Matched Size</p>
                                                  <p className="text-[11px] font-black text-indigo-600 mt-0.5 truncate">{getDisplayLabel(a.size)}</p>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                  {isEditing ? (
                                                    <div className="flex items-center gap-1">
                                                      <input
                                                        type="number"
                                                        step="any"
                                                        className="w-20 text-xs font-black text-blue-600 border border-blue-300 rounded px-1.5 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                        value={editingAlloc.val}
                                                        onChange={(e) => setEditingAlloc({ ...editingAlloc, val: e.target.value })}
                                                        autoFocus
                                                      />
                                                      <button
                                                        onClick={() => handleUpdateAllocation(sl.id, sl.id, a.orderId, a.itemDesc, a.size, editingAlloc.val)}
                                                        className="p-1 bg-green-100 text-green-600 rounded hover:bg-green-200"
                                                      >
                                                        <Check size={12} />
                                                      </button>
                                                      <button
                                                        onClick={() => setEditingAlloc(null)}
                                                        className="p-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                                                      >
                                                        <X size={12} />
                                                      </button>
                                                    </div>
                                                  ) : (
                                                    <div className="flex items-center gap-2">
                                                      {/* Qty label and Bags calculation */}
                                                      <span className="font-extrabold text-[11px] text-blue-700 bg-blue-50/50 px-2 py-0.5 rounded border border-blue-100/50 whitespace-nowrap">
                                                        {a.qty.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
                                                      </span>

                                                      {/* Actions */}
                                                      <div className="flex items-center gap-0.5">
                                                        {/* Quick +10kg adjust */}
                                                        <button
                                                          onClick={() => {
                                                            const newQty = Number((a.qty + 10).toFixed(1));
                                                            handleUpdateAllocation(sl.id, sl.id, a.orderId, a.itemDesc, a.size, newQty.toString());
                                                          }}
                                                          className="px-1 py-0.5 text-[9px] font-bold text-green-600 hover:bg-green-50 rounded transition-colors"
                                                          title="Quick +10 kg"
                                                        >
                                                          +10
                                                        </button>

                                                        {/* Quick -10kg adjust */}
                                                        <button
                                                          onClick={() => {
                                                            const newQty = Math.max(0, Number((a.qty - 10).toFixed(1)));
                                                            handleUpdateAllocation(sl.id, sl.id, a.orderId, a.itemDesc, a.size, newQty.toString());
                                                          }}
                                                          className="px-1 py-0.5 text-[9px] font-bold text-red-500 hover:bg-red-50 rounded transition-colors"
                                                          title="Quick -10 kg"
                                                        >
                                                          -10
                                                        </button>

                                                        {/* Manual edit */}
                                                        <button
                                                          onClick={() => setEditingAlloc({ id: sl.id, orderId: a.orderId, size: a.size, val: Number(a.qty.toFixed(1)).toString() })}
                                                          className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
                                                        >
                                                          <Edit2 size={12} />
                                                        </button>

                                                        {/* Delete allocation */}
                                                        <button
                                                          onClick={() => {
                                                            if (window.confirm(`Remove ${a.qty} kg of ${getDisplayLabel(a.size)} allocation for this order?`)) {
                                                              handleUpdateAllocation(sl.id, sl.id, a.orderId, a.itemDesc, a.size, "0");
                                                            }
                                                          }}
                                                          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                                        >
                                                          <Trash2 size={12} />
                                                        </button>
                                                      </div>
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          )}
                        </div>

                        {/* Far Right: Remaining Yields */}
                        <div className="w-full xl:w-2/3 p-6 bg-gray-50/30">
                          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2 mb-4">
                            <Package size={14} /> Remaining {isBil ? 'BIL' : 'Fillet'} Size
                          </h4>

                          <div className="space-y-4">
                            {/* All Standard Sizes Grid */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              {activeSizes.map(({ key: szKey, label }) => {
                                const q = sl.bins[szKey] || 0;
                                const color = getSizeColor(szKey);
                                const totalInBins = Object.values(sl.bins).reduce((a, b) => a + b, 0);
                                const pct = totalInBins > 0 ? (q / totalInBins) * 100 : 0;

                                return (
                                  <div key={szKey} onClick={() => openSizeModal(sl, label, q)} className={`bg-white border ${q < 0 ? 'border-red-400 shadow-md bg-red-50/30' : q > 0 ? 'border-blue-100 shadow-sm' : 'border-gray-100 opacity-60'} p-3 rounded-2xl transition-all cursor-pointer hover:border-blue-300 hover:shadow-md`}>
                                    <p className={`text-[9px] font-bold ${q < 0 ? 'text-red-500' : 'text-gray-400'} uppercase mb-1 tracking-wider`}>{label}</p>
                                    <div className="flex items-baseline gap-1">
                                      <span className={`text-base font-black ${q < 0 ? 'text-red-600' : q > 0 ? 'text-gray-800' : 'text-gray-300'}`}>{q.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                                      <span className="text-[9px] font-bold text-gray-400">kg</span>
                                    </div>
                                    {q > 0 && (
                                      <div className="mt-2 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                                        <div className={`h-full ${color} opacity-80`} style={{ width: `${pct}%` }}></div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Remaining Co-Products & By-Products */}
                            {(() => {
                              const groupedSubproducts: Record<string, { label: string; nodeIds: string[]; q: number; nodeType: string }> = {};

                              Object.entries(sl.bins).forEach(([k, v]) => {
                                const type = yieldNodeTypeMap.get(k);
                                if (type === 'CO-PRODUCT' || type === 'BY-PRODUCT') {
                                  const label = getDisplayLabel(k);
                                  if (!groupedSubproducts[label]) {
                                    groupedSubproducts[label] = {
                                      label,
                                      nodeIds: [],
                                      q: 0,
                                      nodeType: type
                                    };
                                  }
                                  groupedSubproducts[label].nodeIds.push(k);
                                  groupedSubproducts[label].q = Number((groupedSubproducts[label].q + v).toFixed(1));
                                }
                              });

                              const dynamicSubproductsList = Object.values(groupedSubproducts);

                              const hasGradeB = dynamicSubproductsList.some(({ label }) => label.includes('Grade B') || label.includes('เกรด B'));
                              if (sl.coProductKg > 0 && !hasGradeB) {
                                dynamicSubproductsList.push({
                                  label: 'Grade B (Co-Product)',
                                  nodeIds: ['Grade B'],
                                  q: sl.coProductKg,
                                  nodeType: 'CO-PRODUCT'
                                });
                              }

                              // Sort so CO-PRODUCT is first!
                              dynamicSubproductsList.sort((a, b) => {
                                if (a.nodeType === 'CO-PRODUCT' && b.nodeType !== 'CO-PRODUCT') return -1;
                                if (a.nodeType !== 'CO-PRODUCT' && b.nodeType === 'CO-PRODUCT') return 1;
                                return 0;
                              });

                              return (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
                                  {dynamicSubproductsList.map(({ label, nodeIds, q, nodeType }) => {
                                    const isCoProd = nodeType === 'CO-PRODUCT';
                                    const bgColor = isCoProd ? 'bg-purple-50/50 border-purple-100 hover:border-purple-300' : 'bg-amber-50/50 border-amber-100 hover:border-amber-300';
                                    const textColor = isCoProd ? 'text-purple-800' : 'text-amber-800';
                                    const labelColor = isCoProd ? 'text-purple-400' : 'text-amber-400';
                                    const iconColor = isCoProd ? 'bg-purple-100 text-purple-500' : 'bg-amber-100 text-amber-500';

                                    return (
                                      <div key={label} onClick={() => openSizeModal(sl, nodeIds.join(','), q)} className={`p-4 border rounded-2xl flex justify-between items-center shadow-sm cursor-pointer transition-all hover:shadow-md ${bgColor}`}>
                                        <div>
                                          <p className={`text-[10px] font-bold uppercase tracking-wider ${labelColor}`}>{label} ({nodeType})</p>
                                          <p className={`text-base font-black ${textColor}`}>{q.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-xs font-medium opacity-60">kg</span></p>
                                        </div>
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconColor}`}>
                                          <Package size={16} />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}

                            {/* NEW LEFTOVERS SECTION */}
                            {(() => {
                              const targetIdx = index;
                              const prevSublots = sublots.slice(0, targetIdx);
                              const availableLeftovers: { fromId: string, shift: string, binKey: string, qty: number }[] = [];

                              prevSublots.forEach(prevSl => {
                                Object.entries(prevSl.bins).forEach(([k, v]) => {
                                  if (v > 0) {
                                    availableLeftovers.push({ fromId: prevSl.id, shift: prevSl.shift, binKey: k, qty: v });
                                  }
                                });
                              });

                              if (availableLeftovers.length === 0) return null;

                              const groupedLeftovers: Record<string, typeof availableLeftovers> = {};
                              availableLeftovers.forEach(leftover => {
                                const key = `${leftover.fromId}_${leftover.shift || 'A'}`;
                                if (!groupedLeftovers[key]) groupedLeftovers[key] = [];
                                groupedLeftovers[key].push(leftover);
                              });

                              return (
                                <div className="mt-8 pt-6 border-t border-gray-200 border-dashed">
                                  <h4 className="text-xs font-bold text-indigo-500 uppercase tracking-wider flex items-center gap-2 mb-4">
                                    <RefreshCw size={14} /> Pull Leftovers from Previous Sublots
                                  </h4>
                                  <div className="space-y-4">
                                    {Object.entries(groupedLeftovers).map(([_, leftovers], gIdx) => {
                                      const fromId = leftovers[0].fromId.split('_')[0];
                                      const shift = leftovers[0].shift || 'A';
                                      return (
                                        <div key={gIdx} className="bg-indigo-50/30 border border-indigo-100/60 rounded-2xl p-4">
                                          <p className="text-xs font-black text-indigo-800 mb-3 flex items-center gap-2">
                                            <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md">Sublot {fromId}</span>
                                            <span className="text-indigo-400 font-bold">Shift {shift}</span>
                                          </p>
                                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                            {leftovers.map((leftover, idx) => {
                                              const label = getDisplayLabel(leftover.binKey);
                                              return (
                                                <div key={idx} onClick={() => handlePullLeftoverAndOpenModal(leftover.fromId, sl.id, leftover.binKey, leftover.qty)} className="bg-white border border-indigo-100 shadow-sm p-3 rounded-xl transition-all cursor-pointer hover:border-indigo-400 hover:shadow-md hover:bg-indigo-50/50 group">
                                                  <p className="text-[10px] font-bold text-indigo-400 uppercase mb-1 tracking-wider">{label}</p>
                                                  <div className="flex items-baseline gap-1">
                                                    <span className="text-base font-black text-indigo-900 group-hover:text-indigo-600 transition-colors">{leftover.qty.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                                                    <span className="text-[9px] font-bold text-indigo-400">kg</span>
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </div>

                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      )}
      {showRunModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex justify-center items-center p-4" onClick={() => setShowRunModal(false)}>
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 w-full max-w-md overflow-hidden flex flex-col p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-gray-900 mb-2">Ready to Generate Schedule</h3>
            <p className="text-sm text-gray-500 mb-6">The system has prepared the raw data for {targetDate}. Are you sure you want to proceed with the waterfall allocation?</p>

            <div className="space-y-3 mb-8">
              <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-100">
                <span className="font-bold text-gray-700 text-sm">Demand (Orders)</span>
                <span className="font-black text-blue-600">{rawDemandCount} Orders</span>
              </div>



              <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-100">
                <span className="font-bold text-gray-700 text-sm">Supply (Intake)</span>
                <span className="font-black text-emerald-600">{rawSupplyCount} Sublots</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowRunModal(false)} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-all">Cancel</button>
              <button onClick={generateSchedule} className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-200 transition-all flex justify-center items-center gap-2">
                <CheckCircle size={18} /> OK, Generate
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddOrderModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex justify-center items-center p-4" onClick={() => setShowAddOrderModal(false)}>
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 w-full max-w-md overflow-hidden flex flex-col p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black text-gray-900">Add Custom Order</h3>
              <button onClick={() => setShowAddOrderModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <div className="space-y-4 mb-8">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Select Product Spec</label>
                <CustomSelect
                  options={availableSpecs.map(s => ({ value: s.erpItemCode, label: `${s.erpItemCode} - ${s.erpItemDesc}` }))}
                  value={newOrderForm.itemCode}
                  onChange={val => setNewOrderForm({ ...newOrderForm, itemCode: val })}
                  searchable={true}
                  placeholder="-- Choose Product --"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Quantity (Kg)</label>
                <input
                  type="number"
                  value={newOrderForm.qty}
                  onChange={e => setNewOrderForm({ ...newOrderForm, qty: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-blue-500"
                  placeholder="e.g. 500"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowAddOrderModal(false)} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-all">Cancel</button>
              <button onClick={handleAddOrder} disabled={!newOrderForm.itemCode || !newOrderForm.qty} className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg shadow-blue-200 transition-all flex justify-center items-center gap-2">
                Add Order
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
                    <div key={itemCode} className="flex items-center gap-4 bg-gray-50 p-4 rounded-xl border border-gray-200 hover:border-blue-300 transition-colors">
                      <input
                        type="checkbox"
                        checked={!!modalSelectedItems[itemCode]}
                        onChange={(e) => setModalSelectedItems(prev => ({ ...prev, [itemCode]: e.target.checked }))}
                        className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="font-bold text-gray-900">{itemCode}</span>
                          <span className="text-sm font-semibold text-blue-600">Recipe: {recipe.RECIPE_NO} (v{recipe.RECIPE_VERSION})</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{recipe.RECIPE_DESCRIPTION}</p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-center text-gray-500">No items confirmed.</p>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowSendBatchModal(false)} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-all" disabled={isSubmittingBatch}>Cancel</button>
              <button onClick={handleConfirmSendBatch} className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2" disabled={isSubmittingBatch}>
                {isSubmittingBatch ? <RefreshCw size={16} className="animate-spin" /> : null}
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {(partId === 'bil') && (
        <CUTManpowerPlan
          targetDate={targetDate}
          totalBirds={unprocessedSublots.reduce((sum, s) => sum + (s.totalBirds || 0), 0)}
          slaughteredWeight={unprocessedSublots.reduce((sum, s) => sum + (s.slaughteredWeight || 0), 0)}
          totalRemainingMain={totalRemainingMain}
        />
      )}

      {/* Size Detail Modal */}
      {sizeModalData && sizeModalData.isOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex justify-center items-center p-4" onClick={closeSizeModal}>
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <div>
                <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                  <Package className="text-blue-500" />
                  {getDisplayLabel(sizeModalData.sizeLabel)} Details
                </h3>
                <p className="text-sm font-bold text-gray-500 mt-1">Sublot {sizeModalData.sublotId}</p>
              </div>
              <button onClick={closeSizeModal} className="p-2 hover:bg-gray-200 rounded-full text-gray-500 transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">

              {/* Summary Box */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                  <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-1">Total Allocated</p>
                  <p className="text-2xl font-black text-blue-700">
                    {sizeModalData.allocations.reduce((sum, a) => sum + a.qty, 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-sm font-medium">kg</span>
                  </p>
                </div>
                <div className={`p-4 rounded-2xl border ${sizeModalData.totalRemaining < 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-100'}`}>
                  <p className={`text-[10px] font-bold ${sizeModalData.totalRemaining < 0 ? 'text-red-600' : 'text-emerald-600'} uppercase tracking-wider mb-1`}>Remaining</p>
                  <p className={`text-2xl font-black ${sizeModalData.totalRemaining < 0 ? 'text-red-700' : 'text-emerald-800'}`}>
                    {sizeModalData.totalRemaining.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-sm font-medium">kg</span>
                  </p>
                </div>
              </div>

              {/* Items List */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Items Using This Size</h4>
                  {(() => {
                    const isMatch = (o: Order) => {
                      const modalSize = sizeModalData.sizeLabel;
                      if (modalSize === 'Grade B (Co-Product)' || modalSize === 'Grade B') {
                        return o.size === 'Grade B' || o.type === 'co-product' || getProductType(o.itemCode) === 'coproduct';
                      }
                      if (modalSize === 'Unsize / Other Grade A' || modalSize === 'unsize') {
                        return o.size === 'unsize' || !o.size;
                      }

                      // Check if it matches a specific yield node ID
                      const spec = specsMap[o.itemCode];
                      const bpId = spec?.masterYieldIds?.split(',').map((id: any) => id.trim()).find((id: any) => id === modalSize);
                      if (bpId) return true;

                      return o.size === modalSize;
                    };
                    const matchingUnfulfilled = orders.filter(o => isMatch(o) && o.unfulfilledKg > 0);
                    const matchingFulfilled = orders.filter(o => isMatch(o) && o.unfulfilledKg <= 0);
                    const otherUnfulfilled = orders.filter(o => !isMatch(o) && o.unfulfilledKg > 0);
                    const otherFulfilled = orders.filter(o => !isMatch(o) && o.unfulfilledKg <= 0);

                    const opts: Array<{ value: string, label: string }> = [];
                    matchingUnfulfilled.forEach(o => {
                      opts.push({ value: o.id, label: `📌 [ตรงไซส์] ${o.id} - ${o.itemDesc} (ขาดอีก: ${o.unfulfilledKg.toLocaleString()} kg)` });
                    });
                    otherUnfulfilled.forEach(o => {
                      opts.push({ value: o.id, label: `🔍 [ไซส์อื่น] ${o.id} - ${o.itemDesc} (ขาดอีก: ${o.unfulfilledKg.toLocaleString()} kg)` });
                    });
                    matchingFulfilled.forEach(o => {
                      opts.push({ value: o.id, label: `✅ [ตรงไซส์-ครบ] ${o.id} - ${o.itemDesc}` });
                    });
                    otherFulfilled.forEach(o => {
                      opts.push({ value: o.id, label: `⚪ [ไซส์อื่น-ครบ] ${o.id} - ${o.itemDesc}` });
                    });

                    return (
                      <CustomSelect
                        options={opts}
                        value=""
                        onChange={(val) => {
                          if (val) handleAddAllocationToSublot(val);
                        }}
                        searchable={true}
                        placeholder="+ Add Order to Allocate"
                        className="w-64"
                      />
                    );
                  })()}
                </div>
                {sizeModalData.allocations.length === 0 ? (
                  <div className="p-8 text-center bg-gray-50 rounded-2xl border border-gray-100 border-dashed">
                    <Info size={32} className="mx-auto text-gray-300 mb-2" />
                    <p className="text-gray-500 font-medium">No items were allocated from this size in this sublot.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sizeModalData.allocations.map((a, i) => {
                      const isEditing = editingAlloc?.id === sizeModalData.sublotId && editingAlloc?.orderId === a.orderId && editingAlloc?.size === a.size;
                      return (
                        <div key={i} className="flex justify-between items-center p-3 bg-white border border-gray-100 shadow-sm rounded-xl hover:border-blue-200 transition-colors">
                          <div className="flex-1 min-w-0 pr-4">
                            <p className="font-bold text-gray-900 text-sm truncate" title={a.itemDesc}>{a.itemDesc}</p>
                            <p className="text-[10px] font-medium text-gray-500">Order ID: {a.orderId}</p>
                          </div>
                          <div className="text-right flex items-center gap-3 shrink-0">
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  className="w-24 text-sm font-black text-blue-600 border border-blue-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  value={editingAlloc.val}
                                  onChange={(e) => setEditingAlloc({ ...editingAlloc, val: e.target.value })}
                                  autoFocus
                                />
                                <button onClick={() => handleUpdateAllocation(sizeModalData.sublotId, sizeModalData.targetSublotId || sizeModalData.sublotId, a.orderId, a.itemDesc, sizeModalData.sizeLabel, editingAlloc.val)} className="p-1.5 bg-green-100 text-green-600 rounded-md hover:bg-green-200">
                                  <Check size={14} />
                                </button>
                                <button onClick={() => setEditingAlloc(null)} className="p-1.5 bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200">
                                  <X size={14} />
                                </button>
                              </div>
                            ) : (
                              <>
                                <p className="text-sm font-black text-blue-600">+{a.qty.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</p>
                                <button onClick={() => setEditingAlloc({ id: sizeModalData.sublotId, orderId: a.orderId, size: a.size, val: Number(a.qty.toFixed(1)).toString() })} className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-md transition-colors">
                                  <Edit2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      )}


    </div>
  );
};

export default DPSPlan;
