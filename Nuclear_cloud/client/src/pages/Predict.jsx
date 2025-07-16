import React, { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LineChart, Line, AreaChart, Area } from 'recharts';
import axios from 'axios';
import dayjs from 'dayjs';

// 工具函数：生成完整月份序列
function getMonthRange(start, end) {
  const res = [];
  let cur = dayjs(start);
  const last = dayjs(end);
  while (cur.isBefore(last) || cur.isSame(last, 'month')) {
    res.push(cur.format('YYYY-MM'));
    cur = cur.add(1, 'month');
  }
  return res;
}

// 工具函数：根据baseMonth和真实年月，生成业务标签（如M0/M+1）
function getBusinessLabel(month, baseMonth) {
  const diff = dayjs(month).diff(dayjs(baseMonth), 'month');
  if (diff === 0) return 'M0';
  if (diff > 0) return `M+${diff}`;
  return `M${diff}`;
}

// 工具函数：根据基准月份和偏移量，计算真实年月
function getRealMonthByOffset(baseMonth, offset) {
  return dayjs(baseMonth + '-01').add(offset, 'month').format('YYYY-MM');
}

// 生成完整业务标签区间
function getFullBusinessLabels(N, predictCount) {
  const arr = [];
  for (let i = N - 1; i >= 0; i--) arr.push(`M-${i}`);
  arr.push('M0');
  for (let i = 1; i <= predictCount; i++) arr.push(`M+${i}`);
  return arr;
}

// 生成历史区间业务标签与实际上传历史月一一对应
function getHistoryBusinessLabelsFromUploads(uploadedFiles) {
  // 1. 获取所有上传的历史月份，按时间升序排序
  const uploadedMonths = Object.keys(uploadedFiles)
    .filter(m => /^\d{4}-\d{2}$/.test(m) && uploadedFiles[m] && uploadedFiles[m].length > 0)
    .sort((a, b) => dayjs(a).isAfter(dayjs(b)) ? 1 : -1);
  // 2. 生成业务标签映射
  const arr = uploadedMonths.map((realMonth, idx, arr) => ({
    label: `M-${arr.length - 1 - idx}`,
    realMonth
  }));
  if (arr.length > 0) arr[arr.length - 1].label = 'M0'; // 最后一个为M0
  return arr;
}

export default function Predict() {
  const navigate = useNavigate();
  // 时间轴相关
  const [months, setMonths] = useState(12); // 默认12个月
  const [dataByMonth, setDataByMonth] = useState({}); // {month: [sheets]}
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [scrollPosition, setScrollPosition] = useState(0); // 滚动位置
  const timelineRef = useRef(null);
  const nodeRefs = useRef({}); // 存储每个节点的ref
  const [viewportCenter, setViewportCenter] = useState(0); // 视窗中心位置
  // mock预测数据
  const mockLine = [
    { month: 'M-5', 收入: 100, 利润: 20, 净利润率: 0.2 },
    { month: 'M-4', 收入: 120, 利润: 25, 净利润率: 0.21 },
    { month: 'M-3', 收入: 130, 利润: 28, 净利润率: 0.215 },
    { month: 'M-2', 收入: 140, 利润: 30, 净利润率: 0.214 },
    { month: 'M-1', 收入: 150, 利润: 32, 净利润率: 0.213 },
    { month: 'M', 收入: 160, 利润: 35, 净利润率: 0.22 },
    { month: 'M+1', 收入: 170, 利润: 38, 净利润率: 0.223 },
    { month: 'M+2', 收入: 180, 利润: 40, 净利润率: 0.222 },
    { month: 'M+3', 收入: 190, 利润: 43, 净利润率: 0.226 },
  ];
  const mockBar = [
    { month: 'M+1', 余额: 100 },
    { month: 'M+2', 余额: 120 },
    { month: 'M+3', 余额: 130 },
    { month: 'M+4', 余额: 140 },
    { month: 'M+5', 余额: 150 },
    { month: 'M+6', 余额: 160 },
  ];
  const mockArea = [
    { month: 'M+1', 经营: 60, 投资: 25, 筹资: 15 },
    { month: 'M+2', 经营: 55, 投资: 30, 筹资: 15 },
    { month: 'M+3', 经营: 50, 投资: 35, 筹资: 15 },
    { month: 'M+4', 经营: 48, 投资: 37, 筹资: 15 },
    { month: 'M+5', 经营: 45, 投资: 40, 筹资: 15 },
    { month: 'M+6', 经营: 43, 投资: 42, 筹资: 15 },
  ];
  // mock决策建议
  const mockAdvice = {
    结论: "企业收入和利润持续增长，净利润率稳定。",
    风险: "投资活动现金流波动较大，需关注扩张风险。",
    建议: "建议优化投资结构，关注现金流安全边界。"
  };

  // 新增：基准月份
  const [baseMonth, setBaseMonth] = useState(dayjs().format('YYYY-MM'));

  // 生成真实月份数组（YYYY-MM格式）
  const realMonthsArr = React.useMemo(() => {
    const endMonth = baseMonth;
    const startMonth = getRealMonthByOffset(baseMonth, -(months - 1));
    return getMonthRange(startMonth, endMonth);
  }, [baseMonth, months]);

  // 动态补充虚拟节点数量
  const nodeWidth = months <= 12 ? 70 : Math.max(48, 900 / months);
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const maxVirtualNodeCount = 4;
  let virtualNodeCount = Math.ceil((viewportWidth / 2) / nodeWidth);
  if (virtualNodeCount > maxVirtualNodeCount) virtualNodeCount = maxVirtualNodeCount;
  
  // 生成虚拟节点（特殊标记）
  const leftVirtuals = Array.from({ length: virtualNodeCount }, (_, i) => `VIRTUAL-LEFT-${virtualNodeCount - i}`);
  const rightVirtuals = Array.from({ length: virtualNodeCount }, (_, i) => `VIRTUAL-RIGHT-${i + 1}`);
  
  // 合并真实月份和虚拟节点
  const monthsArr = [...leftVirtuals, ...realMonthsArr, ...rightVirtuals];

  // 计算节点相对于页面中心的位置
  const getNodeDistanceFromCenter = useCallback((nodeIndex) => {
    if (!nodeRefs.current[nodeIndex]) return 1000;
    
    const nodeRect = nodeRefs.current[nodeIndex].getBoundingClientRect();
    
    // 计算页面中心位置
    const pageCenter = window.innerWidth / 2;
    
    // 计算节点中心位置
    const nodeCenter = nodeRect.left + nodeRect.width / 2;
    
    // 计算距离
    const distance = Math.abs(nodeCenter - pageCenter);
    return distance;
  }, []);

  // 点击节点自动滚动到页面中心
  const handleNodeClick = (index, m, isVirtual) => {
    if (!isVirtual && nodeRefs.current[index] && timelineRef.current) {
      const nodeRect = nodeRefs.current[index].getBoundingClientRect();
      const containerRect = timelineRef.current.getBoundingClientRect();
      const scrollLeft = timelineRef.current.scrollLeft;
      const nodeCenter = nodeRect.left + nodeRect.width / 2;
      const containerCenter = containerRect.left + containerRect.width / 2;
      const offset = nodeCenter - containerCenter;
      timelineRef.current.scrollTo({
        left: scrollLeft + offset,
        behavior: 'smooth'
      });
      setSelectedMonth(m);
    }
  };

  // 处理滚动事件
  const handleScroll = (e) => {
    const container = e.target;
    const scrollLeft = container.scrollLeft;
    const containerWidth = container.clientWidth;
    const scrollWidth = container.scrollWidth;
    
    // 计算滚动位置（0-1之间）
    const maxScroll = scrollWidth - containerWidth;
    const scrollRatio = maxScroll > 0 ? scrollLeft / maxScroll : 0;
    setScrollPosition(scrollRatio);
    
    // 更新视窗中心位置
    setViewportCenter(window.innerWidth / 2);
    
    // 线条渐变固定，不需要更新
  };

  // 初始化
  useEffect(() => {
    setViewportCenter(window.innerWidth / 2);
  }, []);

  // 强制重新渲染以更新节点颜色
  useEffect(() => {
    const timer = setTimeout(() => {
      // 触发重新渲染
      setScrollPosition(prev => prev);
    }, 100);
    return () => clearTimeout(timer);
  }, [scrollPosition]);

  const [uploadedFiles, setUploadedFiles] = useState({}); // {month: [{name, type, size}]}
  const [uploading, setUploading] = useState({}); // {month: true/false}
  const [uploadError, setUploadError] = useState({}); // {month: errorMsg}
  const [previewData, setPreviewData] = useState(null); // 预览内容
  const [previewType, setPreviewType] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const handleClearAll = async () => {
    setClearDialogOpen(false);
    await axios.post('/api/clear_files');
    setUploadedFiles({}); // 立即清空前端状态
  };

  // 获取userId
  const userId = localStorage.getItem('userId');

  // 读取localStorage恢复uploadedFiles
  // useEffect(() => {
  //   if (userId) {
  //     const saved = localStorage.getItem(`uploadedFiles_${userId}`);
  //     if (saved) setUploadedFiles(JSON.parse(saved));
  //   }
  // }, [userId]);

  // 写入localStorage
  // useEffect(() => {
  //   if (userId) {
  //     localStorage.setItem(`uploadedFiles_${userId}`, JSON.stringify(uploadedFiles));
  //   }
  // }, [uploadedFiles, userId]);

  // 上传文件
  const handleUpload = (month, e) => {
    if (month.startsWith('VIRTUAL-')) return;
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploadedFiles(prev => {
      const oldFiles = prev[month] || [];
      // 合并并按文件名去重
      const allFiles = [...oldFiles, ...files].filter(
        (file, idx, arr) => arr.findIndex(f => f.name === file.name) === idx
      );
      return {
        ...prev,
        [month]: allFiles
      };
    });
    setUploading(prev => ({ ...prev, [month]: false }));
  };

  // 删除文件
  const handleDelete = (month, filename) => {
    setUploadedFiles(prev => ({
      ...prev,
      [month]: prev[month].filter(f => f.name !== filename)
    }));
  };

  // 预览文件
  const handlePreview = async (month, filename, type) => {
    if (month.startsWith('VIRTUAL-')) return; // 虚拟节点不预览
    const res = await axios.get(`/api/preview?month=${encodeURIComponent(month)}&filename=${encodeURIComponent(filename)}`);
    setPreviewData(res.data);
    setPreviewType(type);
    setPreviewOpen(true);
  };

  // 新增AI分析相关状态
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  // 控制台打印AI分析结果line
  console.log('aiResult.line', aiResult?.line);

  // 计算真实年月
  const getRealMonth = (m) => {
    // 处理虚拟节点
    if (typeof m === 'string' && (m.startsWith('VIRTUAL-LEFT-') || m.startsWith('VIRTUAL-RIGHT-'))) {
      return '';
    }
    // 如果已经是YYYY-MM格式，直接返回
    if (typeof m === 'string' && /^\d{4}-\d{2}$/.test(m)) {
      return m;
    }
    // 兼容旧格式（数字或M-数字）
    if (!baseMonth) return '';
    let offset = 0;
    if (typeof m === 'number') {
      offset = -(m - 0);
    } else if (typeof m === 'string' && m.startsWith('M+')) {
      offset = parseInt(m.slice(2), 10);
    } else if (typeof m === 'string' && m.startsWith('M-')) {
      offset = -parseInt(m.slice(2), 10);
    } else if (m === 'M0' || m === 0) {
      offset = 0;
    }
    return dayjs(baseMonth + '-01').add(offset, 'month').format('YYYY-MM');
  };

  // 一键分析时批量上传有数据的历史点
  const fetchAIAnalyze = async () => {
    // 历史区间：所有上传月
    const uploadedMonths = Object.keys(uploadedFiles)
      .filter(m => uploadedFiles[m] && uploadedFiles[m].length > 0)
      .sort((a, b) => dayjs(a).isAfter(dayjs(b)) ? 1 : -1);
    if (uploadedMonths.length === 0) return;
    // baseMonth 由用户选定
    // 预测区间
    const predictCount = uploadedMonths.length > 12 ? 6 : 3;
    const predictMonthsArr = Array.from({ length: predictCount }, (_, i) =>
      dayjs(baseMonth + '-01').add(i + 1, 'month').format('YYYY-MM')
    );
    setAiLoading(true);
    setAiError('');
    try {
      // 构造FormData
      const formData = new FormData();
      uploadedMonths.forEach(month => {
        uploadedFiles[month].forEach(file => {
          formData.append(`files[${month}]`, file);
        });
      });
      formData.append('months', JSON.stringify(uploadedMonths));
      formData.append('baseMonth', baseMonth);
      const token = localStorage.getItem('token');
      const res = await axios.post('/api/ai_analyze', formData, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      console.log('AI接口返回：', res.data);
      setAiResult(res.data);
    } catch (e) {
      console.log('后端返回错误：', e?.response?.data);
      setAiError(e?.response?.data?.error || 'AI分析失败');
    }
    setAiLoading(false);
  };

  // 选中节点变化时自动分析

  // 处理历史与预测数据区分和缺失
  const mergedLineData = React.useMemo(() => {
    if (!aiResult?.line || !baseMonth) return [];
    // 1. 提取所有历史和预测的月份
    const allMonths = aiResult.line.map(d => d.month);
    // 2. 找到历史区间（小于等于baseMonth的为历史）
    const baseIdx = allMonths.findIndex(m => m === baseMonth);
    const historyMonths = allMonths.slice(0, baseIdx + 1);
    const predictMonths = allMonths.slice(baseIdx + 1);
    // 3. 生成完整历史区间
    const fullHistory = getMonthRange(historyMonths[0], historyMonths[historyMonths.length - 1]);
    // 4. 合并数据，标记类型和缺失
    const monthMap = {};
    aiResult.line.forEach(d => { monthMap[d.month] = d; });
    const merged = [];
    fullHistory.forEach(m => {
      if (monthMap[m]) {
        merged.push({ ...monthMap[m], type: 'history', 缺失: false });
      } else {
        merged.push({ month: m, type: 'history', 缺失: true });
      }
    });
    predictMonths.forEach(m => {
      if (monthMap[m]) {
        merged.push({ ...monthMap[m], type: 'predict', 缺失: false });
      }
    });
    return merged;
  }, [aiResult, baseMonth]);

  // 获取所有上传历史月
  const historyMonths = React.useMemo(() => {
    return Object.keys(uploadedFiles)
      .filter(m => /^\d{4}-\d{2}$/.test(m) && uploadedFiles[m] && uploadedFiles[m].length > 0)
      .sort((a, b) => a.localeCompare(b));
  }, [uploadedFiles]);

  const minMonth = historyMonths[0];
  const maxMonth = historyMonths[historyMonths.length - 1];
  const m0Month = baseMonth;

  // 计算历史区间的终点（最大历史月和M0中较大者）
  const historyEndMonth = React.useMemo(() => {
    if (!maxMonth || !m0Month) return maxMonth || m0Month;
    return dayjs(maxMonth).isAfter(dayjs(m0Month)) ? maxMonth : m0Month;
  }, [maxMonth, m0Month]);

  // 补全历史区间（含M0）
  const allHistoryMonths = React.useMemo(() => {
    if (!minMonth || !historyEndMonth) return [];
    let cur = dayjs(minMonth);
    const end = dayjs(historyEndMonth);
    const arr = [];
    while (cur.isBefore(end) || cur.isSame(end, 'month')) {
      arr.push(cur.format('YYYY-MM'));
      cur = cur.add(1, 'month');
    }
    return arr;
  }, [minMonth, historyEndMonth]);

  // 预测区间
  const predictCount = historyMonths.length > 12 ? 6 : 3;
  const predictMonths = React.useMemo(() => {
    if (!baseMonth) return [];
    return Array.from({ length: predictCount }, (_, i) => {
      return dayjs(baseMonth + '-01').add(i + 1, 'month').format('YYYY-MM');
    });
  }, [baseMonth, predictCount]);

  // 横坐标区间 = 补全的历史区间 + 预测区间
  const allLineMonths = React.useMemo(() => {
    return [...allHistoryMonths, ...predictMonths];
  }, [allHistoryMonths, predictMonths]);

  // 主图数据合并
  const mergedLineDataForChart = React.useMemo(() => {
    if (!aiResult?.line) return allLineMonths.map(month => ({ month }));
    const lineByMonth = {};
    aiResult.line.forEach(d => {
      if (d.month) lineByMonth[d.month] = d;
    });
    return allLineMonths.map(month => {
      const d = lineByMonth[month] || {};
      const isHistory = historyMonths.includes(month);
      return {
        month,
        历史收入: isHistory && d.收入 !== undefined ? (d.收入 === 0 ? 0 : d.收入 ?? null) : null,
        历史利润: isHistory && d.利润 !== undefined ? (d.利润 === 0 ? 0 : d.利润 ?? null) : null,
        历史净利润率: isHistory && d.净利润率 !== undefined ? (d.净利润率 === 0 ? 0 : d.净利润率 ?? null) : null,
        预测收入: !isHistory && d.收入 !== undefined ? (d.收入 === 0 ? 0 : d.收入) : null,
        预测利润: !isHistory && d.利润 !== undefined ? (d.利润 === 0 ? 0 : d.利润) : null,
        预测净利润率: !isHistory && d.净利润率 !== undefined ? (d.净利润率 === 0 ? 0 : d.净利润率) : null,
      };
    });
  }, [aiResult, allLineMonths, historyMonths]);

  // 副图横轴：与主图一致
  const allMonths = allLineMonths;

  // 现金流余额预测（柱状图）
  const mergedBarDataForChart = React.useMemo(() => {
    if (!aiResult?.bar) return allMonths.map(month => ({ month }));
    const barByMonth = {};
    aiResult.bar.forEach(item => {
      if (item.month) barByMonth[item.month] = item;
    });
    return allMonths.map(month => {
      const barData = barByMonth[month] || {};
      let value = barData.余额;
      if (value !== undefined && value !== null) value = Number(value);
      return {
        month,
        余额: isNaN(value) ? null : value,
        type: barData.type || null
      };
    });
  }, [aiResult, allMonths]);

  // 现金流出结构占比（面积图）
  const mergedAreaDataForChart = React.useMemo(() => {
    if (!aiResult?.area) return allMonths.map(month => ({ month }));
    const areaByMonth = {};
    aiResult.area.forEach(item => {
      if (item.month) areaByMonth[item.month] = item;
    });
    return allMonths.map(month => {
      const areaData = areaByMonth[month] || {};
      return {
        month,
        经营: areaData.经营 === 0 ? 0 : areaData.经营 ?? null,
        投资: areaData.投资 === 0 ? 0 : areaData.投资 ?? null,
        筹资: areaData.筹资 === 0 ? 0 : areaData.筹资 ?? null,
        type: areaData.type || null
      };
    });
  }, [aiResult, allMonths]);

  return (
    <div style={{ maxWidth: 1000, margin: "40px auto", padding: 32, border: "1px solid #eee", borderRadius: 12, background: '#fff', boxShadow: '0 2px 16px 0 rgba(33,150,243,0.04)' }}>
      {/* 顶部导航 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 32, position: 'relative', height: 48 }}>
        <button onClick={() => navigate("/")} style={{ position: 'absolute', left: 0, padding: "6px 18px", fontSize: 16, borderRadius: 6, border: '1px solid #eee', background: '#f7faff', color: '#1677ff', cursor: 'pointer' }}>返回主页</button>
        <span style={{ fontWeight: 700, fontSize: 24, letterSpacing: 2 }}>智能预测分析</span>
      </div>
      {/* 基准月份选择器 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontWeight: 600, fontSize: 16, marginRight: 12 }}>基准月份（M0）:</span>
        <input type="month" value={baseMonth} onChange={e => setBaseMonth(e.target.value)} style={{ fontSize: 16, padding: '4px 8px', borderRadius: 6, border: '1px solid #e0e6ed', outline: 'none' }} />
      </div>
      {/* 历史数据输入+时间轴整体分组 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: 24 }}>
        {/* 美化后的历史数据输入区 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: 8, marginLeft: 2 }}>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>历史数据（月数）</div>
          <input
            type="number"
            min={1}
            max={60}
            value={months}
            onChange={e => setMonths(Number(e.target.value))}
            style={{
              width: 80,
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid #e0e6ed',
              fontSize: 16,
              outline: 'none',
              textAlign: 'center',
              boxShadow: '0 1px 4px 0 rgba(33,150,243,0.04)',
              transition: 'border 0.2s',
              marginBottom: 4
            }}
          />
          <span style={{ color: '#aaa', fontSize: 13 }}>最长60个月，输入“前x月”</span>
        </div>
        {/* 时间轴分层结构 */}
        <div style={{ position: 'relative', width: '100%', minHeight: 160, marginTop: 38, marginBottom: 8 }}>
          {/* 横线，绝对定位，zIndex: 0 */}
          <div style={{
            position: 'absolute',
            top: 40,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '60%',
            height: 1.5,
            background: 'linear-gradient(90deg, rgba(246,195,67,0.10) 0%, #36c6f4 40%, #ffd700 60%, rgba(246,195,67,0.10) 100%)',
            borderRadius: 1,
            zIndex: 0
          }} />
          {/* 可滚动节点区 */}
          <div
            ref={timelineRef}
            className="timeline-container"
            style={{
              position: 'relative',
              overflowX: 'auto',
              overflowY: 'visible',
              whiteSpace: 'nowrap',
              minWidth: 0,
              zIndex: 1,
              height: 198,
              padding: '12px 24px 0 24px',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none'
            }}
            onScroll={handleScroll}
          >
            <style>
              {`
                .timeline-container::-webkit-scrollbar {
                  display: none;
                }
              `}
            </style>
            <div style={{
              display: 'flex',
              minWidth: 'max-content',
              alignItems: 'flex-start'
            }}>
              {monthsArr.map((m, index) => {
                // 判断是否为虚拟节点
                const isVirtual = typeof m === 'string' && (m.startsWith('VIRTUAL-LEFT-') || m.startsWith('VIRTUAL-RIGHT-'));
                const nodeWidth = months <= 12 ? 70 : Math.max(48, 900 / months);
                const nodeMargin = months <= 12 ? 10 : Math.max(6, 16 / months);

                // 计算节点与页面中心距离
                const distanceFromPageCenter = getNodeDistanceFromCenter(index);
                const maxDistance = 350;
                const opacity = isVirtual ? 0.12 : Math.max(0.18, 1 - (distanceFromPageCenter / maxDistance) * 0.8);
                const isNearPageCenter = !isVirtual && distanceFromPageCenter < 80;

                return (
                  <div
                    key={m + '_' + index}
                    ref={el => nodeRefs.current[index] = el}
                    style={{
                      position: 'relative',
                      minWidth: nodeWidth,
                      textAlign: 'center',
                      margin: `0 ${nodeMargin}px`,
                      opacity,
                      transition: 'opacity 0.3s'
                    }}
                  >

                    {/* 节点 */}
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: isVirtual
                          ? 'linear-gradient(135deg, #e5e5e5 0%, #f8fafc 100%)'
                          : isNearPageCenter
                            ? 'linear-gradient(135deg, #36c6f4 0%, #ffd700 100%)'
                            : `linear-gradient(135deg, rgba(54,198,244,${opacity}) 0%, rgba(246,195,67,${opacity}) 100%)`,
                        boxShadow: isNearPageCenter && !isVirtual
                          ? '0 0 16px 2px rgba(246,195,67,0.18), 0 0 0 4px rgba(54,198,244,0.10)'
                          : 'none',
                        margin: '0 auto',
                        marginBottom: 18,
                        transition: 'all 0.3s',
                        cursor: isVirtual ? 'default' : 'pointer'
                        
                      }}
                      onClick={() => handleNodeClick(index, m, isVirtual)}
                    />
                    {/* 月份文字和真实年月 */}
                    <div style={{
                      fontSize: 12,
                      color: isVirtual ? '#ccc' : isNearPageCenter ? '#1677ff' : `rgba(136,136,136,${opacity})`,
                      marginTop: 6,
                      fontWeight: isNearPageCenter && !isVirtual ? 600 : 400
                    }}>
                      {isVirtual ? (m.startsWith('VIRTUAL-LEFT-') ? `前${m.slice(13)}月` : `后${m.slice(13)}月`) : getBusinessLabel(m, baseMonth)}
                      <div style={{ color: '#aaa', fontSize: 11, marginTop: 2 }}>{getRealMonth(m)}</div>
                    </div>
                    {/* 文件名展示、删除、预览（仅真实节点） */}
                    {!isVirtual && (
                      <div style={{ marginTop: 6, minHeight: 18 }}>
                        {uploading[m] && <span style={{ color: '#1677ff', fontSize: 12 }}>上传中...</span>}
                        {uploadError[m] && <span style={{ color: 'red', fontSize: 12 }}>{uploadError[m]}</span>}
                        {uploadedFiles[m] && uploadedFiles[m].length > 0 && uploadedFiles[m].map(file => (
                          <div key={file.name} style={{ fontSize: 12, color: '#1677ff', display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                            <div style={{
                              width: 6,
                              height: 6,
                              background: '#52c41a',
                              borderRadius: '50%',
                              marginRight: 6,
                              flexShrink: 0
                            }} />
                            <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => handlePreview(m, file.name, file.type)}>{file.name}</span>
                            <span style={{ marginLeft: 6, color: '#aaa', fontSize: 11 }}>{(file.size/1024).toFixed(1)}KB</span>
                            <span style={{ marginLeft: 8, color: '#faad14', cursor: 'pointer', fontWeight: 700 }} onClick={() => handleDelete(m, file.name)}>删除</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* 预览弹窗 */}
                    {previewOpen && (
                      <div style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.18)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setPreviewOpen(false)}>
                        <div style={{ background: '#fff', borderRadius: 8, padding: 24, minWidth: 320, minHeight: 120, maxWidth: 600, maxHeight: 500, overflow: 'auto' }} onClick={e => e.stopPropagation()}>
                          <div style={{ textAlign: 'right', marginBottom: 8 }}><span style={{ cursor: 'pointer', color: '#888' }} onClick={() => setPreviewOpen(false)}>关闭</span></div>
                          {previewData && previewData.error && (
                            <div style={{ color: 'red' }}>{previewData.error}</div>
                          )}
                          {previewType && previewType.startsWith('image') && typeof previewData === 'string' && previewData.startsWith('data:image') && (
                            <img src={previewData} alt="预览" style={{ maxWidth: 500, maxHeight: 400 }} />
                          )}
                          {previewType && Array.isArray(previewData) && previewData.length > 0 && (
                            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                              <thead>
                                <tr>
                                  {previewData[0].map((cell, j) => (
                                    <th key={j} style={{ border: '1px solid #eee', padding: 4, background: '#f6f8fa' }}>{cell}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {previewData.slice(1).map((row, i) => (
                                  <tr key={i}>
                                    {row.map((cell, j) => (
                                      <td key={j} style={{ border: '1px solid #eee', padding: 4 }}>{cell}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {!previewType && !previewData?.error && <div>暂不支持预览</div>}
                        </div>
                      </div>
                    )}
                    {/* 加号按钮（仅真实节点显示） */}
                    {!isVirtual && (
                      <label style={{
                        display: 'inline-block',
                        marginTop: 8,
                        cursor: 'pointer',
                        borderRadius: '50%',
                        background: uploading[m]
                          ? 'linear-gradient(135deg, #b2e0ff 0%, #ffe082 100%)'
                          : isNearPageCenter
                            ? 'linear-gradient(135deg, #fffbe6 0%, #e3f2fd 100%)'
                            : '#f8fafc',
                        width: 28,
                        height: 28,
                        lineHeight: '28px',
                        boxShadow: isNearPageCenter
                          ? '0 0 8px 1px rgba(246,195,67,0.10)'
                          : 'none',
                        transition: 'all 0.3s',
                        userSelect: 'none',
                        fontWeight: 600,
                        textAlign: 'center',
                        opacity: uploading[m] ? 0.7 : 1
                      }}>
                        <span style={{
                          verticalAlign: 'middle',
                          fontSize: 20,
                          fontWeight: 600,
                          color: uploading[m] ? '#1677ff' : (isNearPageCenter ? '#ffd700' : `rgba(246,195,67,${opacity})`)
                        }}>{uploading[m] ? '⏳' : '＋'}</span>
                        <input type="file" multiple accept=".xlsx,.xls,.csv,image/*" style={{ display: 'none' }} onChange={e => handleUpload(m, e)} disabled={uploading[m]} />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {/* 一键分析按钮和一键清空按钮 */}
      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: 24, margin: '16px 0 32px 0' }}>
        <button
          onClick={fetchAIAnalyze}
          disabled={Object.keys(uploadedFiles).filter(m => /^\d{4}-\d{2}$/.test(m) && uploadedFiles[m] && uploadedFiles[m].length > 0).length === 0 || aiLoading}
          style={{
            padding: '8px 32px',
            fontSize: 16,
            borderRadius: 8,
            background: Object.keys(uploadedFiles).filter(m => /^\d{4}-\d{2}$/.test(m) && uploadedFiles[m] && uploadedFiles[m].length > 0).length === 0 || aiLoading ? '#eee' : 'linear-gradient(90deg, #36c6f4 0%, #ffd700 100%)',
            color: Object.keys(uploadedFiles).filter(m => /^\d{4}-\d{2}$/.test(m) && uploadedFiles[m] && uploadedFiles[m].length > 0).length === 0 || aiLoading ? '#aaa' : '#222',
            border: 'none',
            fontWeight: 700,
            cursor: Object.keys(uploadedFiles).filter(m => /^\d{4}-\d{2}$/.test(m) && uploadedFiles[m] && uploadedFiles[m].length > 0).length === 0 || aiLoading ? 'not-allowed' : 'pointer',
            boxShadow: Object.keys(uploadedFiles).filter(m => /^\d{4}-\d{2}$/.test(m) && uploadedFiles).length === 0 || aiLoading ? 'none' : '0 2px 8px 0 rgba(33,150,243,0.08)',
            transition: 'all 0.2s'
          }}
        >
          {aiLoading ? '分析中...' : '一键分析'}
        </button>
        <button
          onClick={() => setClearDialogOpen(true)}
          disabled={aiLoading}
          style={{
            padding: '6px 18px',
            fontSize: 14,
            borderRadius: 6,
            background: aiLoading ? '#eee' : '#f7f7f7',
            color: aiLoading ? '#aaa' : '#888',
            border: '1px solid #ddd',
            fontWeight: 500,
            cursor: aiLoading ? 'not-allowed' : 'pointer',
            boxShadow: 'none',
            transition: 'all 0.2s'
          }}
          onMouseOver={e => { if (!aiLoading) e.currentTarget.style.background = '#ececec'; }}
          onMouseOut={e => { if (!aiLoading) e.currentTarget.style.background = '#f7f7f7'; }}
        >
          一键清空数据
        </button>
      </div>
      {/* 清空确认弹窗 */}
      {clearDialogOpen && (
        <div style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.18)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 32, minWidth: 320, maxWidth: 400, boxShadow: '0 4px 24px 0 rgba(0,0,0,0.10)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 18, color: '#b71c1c' }}>确认清空所有上传数据？</div>
            <div style={{ color: '#888', fontSize: 15, marginBottom: 24 }}>此操作不可恢复，所有已上传文件将被永久删除。</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16 }}>
              <button onClick={() => setClearDialogOpen(false)} style={{ padding: '6px 24px', borderRadius: 6, border: 'none', background: '#eee', color: '#666', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>取消</button>
              <button onClick={handleClearAll} style={{ padding: '6px 24px', borderRadius: 6, border: 'none', background: 'linear-gradient(90deg, #ff7875 0%, #ffd700 100%)', color: '#b71c1c', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>确认清空</button>
            </div>
          </div>
        </div>
      )}
      {/* 收入/利润/净利润率预测折线图 */}
      <div style={{ marginBottom: 48 }}>
        <b style={{ fontSize: 18 }}>收入/利润/净利润率预测：</b>
        {aiLoading ? (
          <div style={{ color: '#1677ff', margin: '16px 0' }}>AI分析中...</div>
        ) : aiError ? (
          <div style={{ color: 'red', margin: '16px 0' }}>{aiError}</div>
        ) : (
          <div style={{ width: '100%', height: 320, margin: '24px 0' }}>
            <ResponsiveContainer>
              <LineChart data={mergedLineDataForChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" interval={0} />
                <YAxis yAxisId={0} label={{ value: '金额', angle: -90, position: 'insideLeft' }} />
                <YAxis yAxisId={1} orientation="right" label={{ value: '净利润率', angle: 90, position: 'insideRight' }} tickFormatter={v => (v * 100).toFixed(1) + '%'} />
                <Tooltip formatter={(value, name) => name.includes('净利润率') ? (value * 100).toFixed(2) + '%' : value} />
                <Legend />
                {/* 历史数据：实线 */}
                <Line type="monotone" dataKey="历史收入" stroke="#1677ff" strokeWidth={2} dot={(props) => (props.payload.历史收入 !== null && props.payload.历史收入 !== undefined) ? <circle cx={props.cx} cy={props.cy} r={3} fill="#1677ff" /> : null} isAnimationActive={false} name="历史收入" yAxisId={0} strokeDasharray="" connectNulls={false} />
                <Line type="monotone" dataKey="历史利润" stroke="#52c41a" strokeWidth={2} dot={(props) => (props.payload.历史利润 !== null && props.payload.历史利润 !== undefined) ? <circle cx={props.cx} cy={props.cy} r={3} fill="#52c41a" /> : null} isAnimationActive={false} name="历史利润" yAxisId={0} strokeDasharray="" connectNulls={false} />
                <Line type="monotone" dataKey="历史净利润率" stroke="#faad14" strokeWidth={2} dot={(props) => (props.payload.历史净利润率 !== null && props.payload.历史净利润率 !== undefined) ? <circle cx={props.cx} cy={props.cy} r={3} fill="#faad14" /> : null} isAnimationActive={false} name="历史净利润率" yAxisId={1} strokeDasharray="" connectNulls={false} />
                {/* 预测数据：虚线+荧光描边 */}
                {/* 荧光描边层 */}
                <Line type="monotone" dataKey="预测收入" stroke="#1677ff" strokeWidth={8} dot={false} isAnimationActive={false} name={null} yAxisId={0} strokeDasharray="6 3" connectNulls={true} opacity={0.18} />
                <Line type="monotone" dataKey="预测利润" stroke="#52c41a" strokeWidth={8} dot={false} isAnimationActive={false} name={null} yAxisId={0} strokeDasharray="6 3" connectNulls={true} opacity={0.18} />
                <Line type="monotone" dataKey="预测净利润率" stroke="#faad14" strokeWidth={8} dot={false} isAnimationActive={false} name={null} yAxisId={1} strokeDasharray="6 3" connectNulls={true} opacity={0.18} />
                {/* 主预测线 */}
                <Line type="monotone" dataKey="预测收入" stroke="#1677ff" strokeWidth={2} dot={(props) => (props.payload.预测收入 !== null && props.payload.预测收入 !== undefined) ? <circle cx={props.cx} cy={props.cy} r={3} fill="#1677ff" /> : null} isAnimationActive={false} name="预测收入" yAxisId={0} strokeDasharray="6 3" connectNulls={false} />
                <Line type="monotone" dataKey="预测利润" stroke="#52c41a" strokeWidth={2} dot={(props) => (props.payload.预测利润 !== null && props.payload.预测利润 !== undefined) ? <circle cx={props.cx} cy={props.cy} r={3} fill="#52c41a" /> : null} isAnimationActive={false} name="预测利润" yAxisId={0} strokeDasharray="6 3" connectNulls={false} />
                <Line type="monotone" dataKey="预测净利润率" stroke="#faad14" strokeWidth={2} dot={(props) => (props.payload.预测净利润率 !== null && props.payload.预测净利润率 !== undefined) ? <circle cx={props.cx} cy={props.cy} r={3} fill="#faad14" /> : null} isAnimationActive={false} name="预测净利润率" yAxisId={1} strokeDasharray="6 3" connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {/* 现金流余额预测： */}
      <div style={{ marginBottom: 48 }}>
        <b style={{ fontSize: 18 }}>现金流余额预测：</b>
        {aiLoading ? <div style={{ color: '#1677ff', margin: '16px 0' }}>AI分析中...</div> : aiError ? <div style={{ color: 'red', margin: '16px 0' }}>{aiError}</div> : (
          <div style={{ width: '100%', height: 220, margin: '24px 0' }}>
            <ResponsiveContainer>
              <BarChart data={mergedBarDataForChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" interval={0} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="余额" fill="#1677ff" connectNulls={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {/* 现金流出结构占比： */}
      <div style={{ marginBottom: 48 }}>
        <b style={{ fontSize: 18 }}>现金流出结构占比：</b>
        {aiLoading ? <div style={{ color: '#1677ff', margin: '16px 0' }}>AI分析中...</div> : aiError ? <div style={{ color: 'red', margin: '16px 0' }}>{aiError}</div> : (
          <div style={{ width: '100%', height: 220, margin: '24px 0' }}>
            <ResponsiveContainer>
              <AreaChart data={mergedAreaDataForChart} stackOffset="expand">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" interval={0} />
                <YAxis tickFormatter={v => (v * 100).toFixed(0) + '%'} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="经营" stackId="1" stroke="#1677ff" fill="#1677ff" connectNulls={false} />
                <Area type="monotone" dataKey="投资" stackId="1" stroke="#faad14" fill="#faad14" connectNulls={false} />
                <Area type="monotone" dataKey="筹资" stackId="1" stroke="#52c41a" fill="#52c41a" connectNulls={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {/* 预测依据说明 */}
      <div style={{ color: '#888', fontSize: 12, marginTop: 8 }}>
        预测依据：本次预测基于您上传的{Object.keys(uploadedFiles).length}个月的财务数据（如利润表、现金流量表等），以{baseMonth}为基准，结合历史趋势和现金流结构，智能预测未来3~6个月的主要财务指标。结果仅供参考，具体以实际经营为准。
      </div>
      {/* 决策建议区，卡片式、圆角、阴影、分段 */}
      <div style={{ marginBottom: 32, background: '#f6f8fa', borderRadius: 12, padding: 28, boxShadow: '0 2px 8px 0 rgba(33,150,243,0.06)' }}>
        <b style={{ fontSize: 18 }}>决策建议</b>
        <div style={{ marginTop: 16, fontSize: 16 }}>
          <div style={{ marginBottom: 10 }}><b>分析结论：</b>{aiResult?.advice?.['分析结论'] ?? ''}</div>
          <div style={{ marginBottom: 10 }}><b>关键风险预警：</b>{aiResult?.advice?.['关键风险预警'] ?? ''}</div>
          <div><b>决策建议：</b>{aiResult?.advice?.['决策建议'] ?? ''}</div>
        </div>
      </div>
    </div>
  );
} 