import React, { useState } from "react";
import { API_BASE_URL } from "../config";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import classNames from 'classnames';
import styles from './Report.module.css';

export default function Report() {
  const [files, setFiles] = useState([]); // 支持多文件
  const [filenames, setFilenames] = useState(() => {
    const saved = localStorage.getItem('report_filenames');
    return saved ? JSON.parse(saved) : [];
  });
  const [sheets, setSheets] = useState(() => {
    const saved = localStorage.getItem('report_sheets');
    return saved ? JSON.parse(saved) : [];
  });
  const [msg, setMsg] = useState(() => {
    const saved = localStorage.getItem('report_msg');
    return saved || "";
  });
  const [loading, setLoading] = useState(false);
  const [openSheet, setOpenSheet] = useState({}); // 折叠状态
  const [aiResult, setAiResult] = useState("");
  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  // 新增4个分区的状态 - 从localStorage恢复或初始化
  const [aiSolvency, setAiSolvency] = useState(() => {
    const saved = localStorage.getItem('report_aiSolvency');
    return saved ? JSON.parse(saved) : { loading: false, result: '', error: '' };
  });
  const [aiProfit, setAiProfit] = useState(() => {
    const saved = localStorage.getItem('report_aiProfit');
    return saved ? JSON.parse(saved) : { loading: false, result: '', error: '' };
  });
  const [aiOperate, setAiOperate] = useState(() => {
    const saved = localStorage.getItem('report_aiOperate');
    return saved ? JSON.parse(saved) : { loading: false, result: '', error: '' };
  });
  const [aiCash, setAiCash] = useState(() => {
    const saved = localStorage.getItem('report_aiCash');
    return saved ? JSON.parse(saved) : { loading: false, result: '', error: '', chart: null };
  });

  // 持久化保存分析结果的函数
  const saveToStorage = (key, data) => {
    localStorage.setItem(key, JSON.stringify(data));
  };

  // 多文件上传处理
  const handleFileChange = async (e) => {
    const newFiles = Array.from(e.target.files);
    setFiles(prev => [...prev, ...newFiles]);
    const newFilenames = [...filenames, ...newFiles.map(f => f.name)];
    setFilenames(newFilenames);
    localStorage.setItem('report_filenames', JSON.stringify(newFilenames));
    setMsg("");
    localStorage.setItem('report_msg', "");
    setOpenSheet({});
    setLoading(true);
    let allSheets = [...sheets];
    let hasValidSheet = false;
    for (const f of newFiles) {
      const formData = new FormData();
      formData.append("file", f);
      try {
        const res = await fetch(`${API_BASE_URL}/report/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        let result = {};
        try {
          result = await res.json();
          // sheet命名递增处理
          if (result.sheets && result.sheets.length > 0) {
            const fileBase = f.name.replace(/\.[^.]+$/, '');
            const currentFileSheets = allSheets.filter(s => s.name.startsWith(fileBase + '-'));
            result.sheets = result.sheets.map((sheet, idx) => {
              const newIndex = currentFileSheets.length + idx + 1;
              return {
                ...sheet,
                name: `${fileBase}-Sheet${newIndex}`
              };
            });
          }
          console.log('接口响应:', result);
        } catch (jsonErr) {
          console.error('JSON解析失败', jsonErr, res);
          setMsg("服务器返回格式错误");
          return;
        }
        if (res.ok && result.sheets && result.sheets.length > 0) {
          allSheets = [...allSheets, ...result.sheets];
          hasValidSheet = true;
        } else if (result.msg && result.msg.includes("不规范")) {
          const errorMsg = "文件内容不规范，请上传标准表格文件";
          setMsg(errorMsg);
          localStorage.setItem('report_msg', errorMsg);
          console.warn('内容不规范:', result);
        } else if (result.msg && result.msg.includes("未识别到有效表格")) {
          const errorMsg = "未识别到有效表格，请检查文件内容";
          setMsg(errorMsg);
          localStorage.setItem('report_msg', errorMsg);
          console.warn('未识别到有效表格:', result);
        } else if (result.msg) {
          setMsg(result.msg);
          localStorage.setItem('report_msg', result.msg);
          console.warn('后端自定义错误:', result);
        } else {
          const errorMsg = "文件解析失败";
          setMsg(errorMsg);
          localStorage.setItem('report_msg', errorMsg);
          console.error('未知错误:', result);
        }
      } catch (err) {
        setMsg("网络错误");
        console.error('网络错误:', err);
        return;
      }
    }
    setSheets(allSheets);
    localStorage.setItem('report_sheets', JSON.stringify(allSheets));
    if (hasValidSheet) {
      const successMsg = "解析成功";
      setMsg(successMsg);
      localStorage.setItem('report_msg', successMsg);
      setIsNewUpload(true); // 标记为新上传，触发AI分析
    }
    setLoading(false);
  };

  // 折叠/展开sheet
  const toggleSheet = (name) => {
    setOpenSheet((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  // 删除文件及其所有sheet
  const handleDeleteFile = async (filename) => {
    if (!window.confirm(`确定要删除文件“${filename}”及其所有表格吗？`)) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/file/delete_by_name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename })
      });
      const data = await res.json();
      if (res.ok) {
        const newSheets = sheets.filter(sheet => !sheet.name.startsWith(filename.replace(/\.[^.]+$/, '')));
        const newFilenames = filenames.filter(name => name !== filename);
        setSheets(newSheets);
        setFilenames(newFilenames);
        localStorage.setItem('report_sheets', JSON.stringify(newSheets));
        localStorage.setItem('report_filenames', JSON.stringify(newFilenames));
        const successMsg = '文件删除成功';
        setMsg(successMsg);
        localStorage.setItem('report_msg', successMsg);
        if (newSheets.length > 0) {
          setIsNewUpload(true); // 删除文件后重新分析
        }
              } else {
          const errorMsg = data.msg || '删除失败';
          setMsg(errorMsg);
          localStorage.setItem('report_msg', errorMsg);
        }
          } catch (e) {
        const errorMsg = '网络错误，删除失败';
        setMsg(errorMsg);
        localStorage.setItem('report_msg', errorMsg);
      }
    setLoading(false);
    if (filenames.length === 1 && filenames[0] === filename) {
      localStorage.removeItem('report_filenames');
      localStorage.removeItem('report_sheets');
      localStorage.removeItem('report_msg');
      setAiSolvency({ loading: false, result: '', error: '' });
      setAiProfit({ loading: false, result: '', error: '' });
      setAiOperate({ loading: false, result: '', error: '' });
      setAiCash({ loading: false, result: '', error: '', chart: null });
      localStorage.removeItem('report_aiSolvency');
      localStorage.removeItem('report_aiProfit');
      localStorage.removeItem('report_aiOperate');
      localStorage.removeItem('report_aiCash');
    }
  };

  // 新增：单sheet删除
  const handleDeleteSheet = async (sheetName) => {
    if (!window.confirm(`确定要删除表格“${sheetName}”吗？`)) return;
    setLoading(true);
    // 只做前端本地删除
    const newSheets = sheets.filter(sheet => sheet.name !== sheetName);
    setSheets(newSheets);
    localStorage.setItem('report_sheets', JSON.stringify(newSheets));
    // 处理filenames
    const filePrefix = sheetName.split('-')[0];
    const remainFileSheets = newSheets.filter(sheet => sheet.name.startsWith(filePrefix));
    let newFilenames = filenames;
    if (remainFileSheets.length === 0) {
      newFilenames = filenames.filter(name => name !== (filePrefix + (sheetName.endsWith('.csv') ? '.csv' : '.xlsx')));
      setFilenames(newFilenames);
      localStorage.setItem('report_filenames', JSON.stringify(newFilenames));
    }
    setMsg('表格删除成功');
    localStorage.setItem('report_msg', '表格删除成功');
    setLoading(false);
    // 若所有sheet都删光，清空所有缓存
    if (newSheets.length === 0) {
      localStorage.removeItem('report_filenames');
      localStorage.removeItem('report_sheets');
      localStorage.removeItem('report_msg');
      setAiSolvency({ loading: false, result: '', error: '' });
      setAiProfit({ loading: false, result: '', error: '' });
      setAiOperate({ loading: false, result: '', error: '' });
      setAiCash({ loading: false, result: '', error: '', chart: null });
      localStorage.removeItem('report_aiSolvency');
      localStorage.removeItem('report_aiProfit');
      localStorage.removeItem('report_aiOperate');
      localStorage.removeItem('report_aiCash');
    }
  };

  // 工具函数：根据sheet名/表头关键词识别表类型
  function findSheetByName(sheets, keywords) {
    return sheets.find(sheet => keywords.some(k => sheet.name.includes(k)));
  }
  // 工具函数：从表格中提取字段（支持常见中文表头，去除括号、空格、单位模糊匹配）
  function extractValue(sheet, keys) {
    if (!sheet) return null;
    for (const row of sheet.data) {
      for (const key of keys) {
        for (const col of sheet.columns) {
          // 去除括号、单位、空格
          const normCol = col.replace(/[（(].*?[）)]/g, '').replace(/\s|:|：|,|，|\.|。|/g, '').replace(/（.*$/g, '');
          const normKey = key.replace(/\s/g, '');
          if (normCol.includes(normKey) && row[col] !== undefined && row[col] !== null && row[col] !== "") {
            // 只取第一个非空值
            const val = row[col];
            if (typeof val === 'string') {
              // 去除千分位、空格等
              const num = parseFloat(val.replace(/[,，\s]/g, ''));
              if (!isNaN(num)) return num;
            } else if (typeof val === 'number') {
              return val;
            }
          }
        }
      }
    }
    return null;
  }
  // 工具函数：自动适配竖表结构，支持查找表头行
  function normalizeSheet(sheet) {
    if (!sheet || !sheet.columns || sheet.columns.length < 2) return sheet;
    // 查找表头行（如“项目”“科目”等）
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(sheet.data.length, 10); i++) {
      const row = sheet.data[i];
      const firstColVal = (row[sheet.columns[0]] || '').toString();
      if (["项目", "科目", "名称", "指标"].some(k => firstColVal.includes(k))) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx >= 0) {
      // 以该行为新表头，后续行为数据
      const headerRow = sheet.data[headerRowIdx];
      const newColumns = sheet.columns.map(col => (headerRow[col] || '').toString().replace(/[（(].*?[）)]/g, '').replace(/\s|:|：|,|，|\.|。|/g, ''));
      const newData = [];
      for (let i = headerRowIdx + 1; i < sheet.data.length; i++) {
        const row = sheet.data[i];
        const newRow = {};
        for (let j = 0; j < newColumns.length; j++) {
          let val = row[sheet.columns[j]];
          if (typeof val === 'string') {
            val = parseFloat(val.replace(/[,，\s]/g, ''));
          }
          newRow[newColumns[j]] = !isNaN(val) ? val : null;
        }
        newData.push(newRow);
      }
      return {
        ...sheet,
        columns: newColumns,
        data: newData
      };
    }
    // 兼容原有竖表逻辑
    const firstCol = sheet.columns[0];
    if (["项目", "科目", "名称", "指标"].some(k => firstCol.includes(k))) {
      const valueCol = sheet.columns[1];
      const newRow = {};
      for (const row of sheet.data) {
        const key = (row[firstCol] || "").toString().replace(/[（(].*?[）)]/g, '').replace(/\s|:|：|,|，|\.|。|/g, '');
        if (key) {
          let val = row[valueCol];
          if (typeof val === 'string') {
            val = parseFloat(val.replace(/[,，\s]/g, ''));
          }
          newRow[key] = !isNaN(val) ? val : null;
        }
      }
      return {
        ...sheet,
        columns: Object.keys(newRow),
        data: [newRow]
      };
    }
    return sheet;
  }

  // 识别sheet
  const assetSheet = normalizeSheet(findSheetByName(sheets, ["资产负债表"]));
  const profitSheet = normalizeSheet(findSheetByName(sheets, ["利润表"]));
  const cashSheet = normalizeSheet(findSheetByName(sheets, ["现金流量表"]));
  // 偿债能力字段
  const liudongzichan = extractValue(assetSheet, ["流动资产"]);
  const liudongfuzhai = extractValue(assetSheet, ["流动负债"]);
  const cunhuo = extractValue(assetSheet, ["存货"]);
  const zongzichan = extractValue(assetSheet, ["资产总额", "资产合计"]);
  const zongfuzhai = extractValue(assetSheet, ["负债总额", "负债合计"]);
  // 盈利能力字段
  const jinglirun = extractValue(profitSheet, ["净利润"]);
  const suoyouzhequanyi = extractValue(assetSheet, ["所有者权益"]);
  const yingyeshouru = extractValue(profitSheet, ["营业收入"]);
  const yingyechengben = extractValue(profitSheet, ["营业成本"]);
  // 现金流量字段
  const jingying = extractValue(cashSheet, ["经营活动产生的现金流量净额"]);
  const touzi = extractValue(cashSheet, ["投资活动产生的现金流量净额"]);
  const chouzi = extractValue(cashSheet, ["筹资活动产生的现金流量净额"]);
  // 指标计算
  const liudongbili = liudongzichan && liudongfuzhai ? liudongzichan / liudongfuzhai : null;
  const sudongbili = (liudongzichan !== null && cunhuo !== null && liudongfuzhai) ? (liudongzichan - cunhuo) / liudongfuzhai : null;
  const zichanfuzhailv = (zongfuzhai && zongzichan) ? zongfuzhai / zongzichan : null;
  const jingzichanshouyilv = (jinglirun && suoyouzhequanyi) ? jinglirun / suoyouzhequanyi : null;
  const xiaoshoujinglilv = (jinglirun && yingyeshouru) ? jinglirun / yingyeshouru : null;
  const maolilv = (yingyeshouru && yingyechengben) ? (yingyeshouru - yingyechengben) / yingyeshouru : null;
  // 结论与颜色
  function getColor(val, good, bad) {
    if (val === null) return '#888';
    if (val >= good) return 'green';
    if (val < bad) return 'red';
    return '#fa0';
  }
  function getConclusion(val, good, bad, desc) {
    if (val === null) return '数据不足';
    if (val >= good) return `✔ ${desc}，较为健康`;
    if (val < bad) return `✘ ${desc}，需关注`;
    return `⚠ ${desc}，一般水平`;
  }

  // 运营能力指标：语义遍历所有sheet和表头
  function extractSemanticValue(sheets, keys) {
    for (const sheet of sheets) {
      const val = extractValue(sheet, keys);
      if (val !== null) return val;
    }
    return null;
  }
  const totalAsset = extractSemanticValue(sheets.map(normalizeSheet), ["总资产", "资产总额", "资产合计"]);
  const totalRevenue = extractSemanticValue(sheets.map(normalizeSheet), ["营业收入", "主营业务收入", "收入"]);
  const assetTurnover = (totalAsset && totalRevenue) ? totalRevenue / totalAsset : null;
  function getAssetTurnoverConclusion(val) {
    if (val === null) return '数据不足';
    if (val > 1.5) return '✔ >1.5，资产利用效率非常高，企业运营能力强';
    if (val >= 1.0) return '⚠ 1.0-1.5，资产周转良好，整体运营效率稳定';
    if (val >= 0.5) return '⚠ 0.5-1.0，资产利用效率一般，可能存在资产闲置或结构待优化';
    return '✘ <0.5，资产周转率偏低，收入转化效率不足，建议关注固定资产、存货周转情况';
  }
  function getAssetTurnoverColor(val) {
    if (val === null) return '#888';
    if (val > 1.5) return 'green';
    if (val >= 1.0) return '#52c41a';
    if (val >= 0.5) return '#faad14';
    return 'red';
  }

  // 记录是否是新上传的文件（用于判断是否需要重新分析）
  const [isNewUpload, setIsNewUpload] = React.useState(false);

  // 上传后分别向AI请求4次
  React.useEffect(() => {
    if (sheets.length === 0 || !isNewUpload) return;
    setIsNewUpload(false); // 重置标志
    // 1. 偿债能力
    setAiSolvency({ loading: true, result: '', error: '' });
    saveToStorage('report_aiSolvency', { loading: true, result: '', error: '' });
    fetch(`${API_BASE_URL}/report/ai_analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt: `你是一名专业财务分析师。请仅根据以下表格数据，分析企业的“偿债能力”。\n请严格按如下格式输出（Markdown）：\n\n1. 先提取并计算以下三个指标，必须有公式和数值：\n- 流动比率 = 流动资产 / 流动负债\n- 速动比率 = (流动资产 - 存货) / 流动负债\n- 资产负债率 = 负债总额 / 资产总额\n\n2. 输出格式示例（请严格遵循）：\n\n## 结论\n**（简明扼要的结论，必须包含三大指标的数值，且加粗）**\n\n### 推导过程\n流动比率 = 流动资产 / 流动负债 = ... / ... = ...  \n速动比率 = (流动资产 - 存货) / 流动负债 = (... - ...) / ... = ...  \n资产负债率 = 负债总额 / 资产总额 = ... / ... = ...  \n\n### 专业评价\n- （条理清晰的专业点评，分点列出）\n\n如缺少关键字段或数据无法计算，也请明确输出“数据不足”或“未找到关键字段”，不要返回空内容。\n【只输出本分区内容，Markdown格式输出，不要输出其他分区内容，不要输出多余内容。如果输出了其他分区内容，将被判为错误。】表格数据：${JSON.stringify(sheets)}`
      })
    })
      .then(res => res.json())
      .then(data => {
        setAiSolvency({ loading: false, result: data.result || data.answer || '', error: '' });
        saveToStorage('report_aiSolvency', { loading: false, result: data.result || data.answer || '', error: '' });
      })
      .catch(() => {
        setAiSolvency({ loading: false, result: '', error: 'AI分析失败' });
        saveToStorage('report_aiSolvency', { loading: false, result: '', error: 'AI分析失败' });
      });
    // 2. 盈利能力
    setAiProfit({ loading: true, result: '', error: '' });
    saveToStorage('report_aiProfit', { loading: true, result: '', error: '' });
    fetch(`${API_BASE_URL}/report/ai_analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt: `你是一名专业财务分析师。请仅根据以下表格数据，分析企业的“盈利能力”。\n请严格按如下格式输出（Markdown）：\n\n1. 先提取并计算以下三个指标，必须有公式和数值：\n- 净资产收益率 = 净利润 / 所有者权益\n- 销售净利率 = 净利润 / 营业收入\n- 毛利率 = (营业收入 - 营业成本) / 营业收入\n\n2. 输出格式示例（请严格遵循）：\n\n## 结论\n**（简明扼要的结论，必须包含三大指标的数值，且加粗）**\n\n### 推导过程\n净资产收益率 = 净利润 / 所有者权益 = ... / ... = ...  \n销售净利率 = 净利润 / 营业收入 = ... / ... = ...  \n毛利率 = (营业收入 - 营业成本) / 营业收入 = (... - ...) / ... = ...  \n\n### 专业评价\n- （条理清晰的专业点评，分点列出）\n\n如缺少关键字段或数据无法计算，也请明确输出“数据不足”或“未找到关键字段”，不要返回空内容。\n【只输出本分区内容，Markdown格式输出，不要输出其他分区内容，不要输出多余内容。如果输出了其他分区内容，将被判为错误。】表格数据：${JSON.stringify(sheets)}`
      })
    })
      .then(res => res.json())
      .then(data => {
        setAiProfit({ loading: false, result: data.result || data.answer || '', error: '' });
        saveToStorage('report_aiProfit', { loading: false, result: data.result || data.answer || '', error: '' });
      })
      .catch(() => {
        setAiProfit({ loading: false, result: '', error: 'AI分析失败' });
        saveToStorage('report_aiProfit', { loading: false, result: '', error: 'AI分析失败' });
      });
    // 3. 运营能力
    setAiOperate({ loading: true, result: '', error: '' });
    saveToStorage('report_aiOperate', { loading: true, result: '', error: '' });
    fetch(`${API_BASE_URL}/report/ai_analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt: `你是一名专业财务分析师。请仅根据以下表格数据，分析企业的“运营能力”。\n请严格按如下格式输出（Markdown）：\n\n1. 先提取并计算以下指标，必须有公式和数值：\n- 总资产周转率 = 营业收入 / 总资产\n\n2. 输出格式示例（请严格遵循）：\n\n## 结论\n**（简明扼要的结论，必须包含总资产周转率的数值，且加粗）**\n\n### 推导过程\n总资产周转率 = 营业收入 / 总资产 = ... / ... = ...  \n\n### 专业评价\n- （条理清晰的专业点评，分点列出）\n\n如缺少关键字段或数据无法计算，也请明确输出“数据不足”或“未找到关键字段”，不要返回空内容。\n【只输出本分区内容，Markdown格式输出，不要输出其他分区内容，不要输出多余内容。如果输出了其他分区内容，将被判为错误。】表格数据：${JSON.stringify(sheets)}`
      })
    })
      .then(res => res.json())
      .then(data => {
        setAiOperate({ loading: false, result: data.result || data.answer || '', error: '' });
        saveToStorage('report_aiOperate', { loading: false, result: data.result || data.answer || '', error: '' });
      })
      .catch(() => {
        setAiOperate({ loading: false, result: '', error: 'AI分析失败' });
        saveToStorage('report_aiOperate', { loading: false, result: '', error: 'AI分析失败' });
      });
    // 4. 现金流量
    setAiCash({ loading: true, result: '', error: '', chart: null });
    saveToStorage('report_aiCash', { loading: true, result: '', error: '', chart: null });
    fetch(`${API_BASE_URL}/report/ai_analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt: `你是一名专业财务分析师。请仅根据以下表格数据，分析企业的“现金流量”。请先用JSON格式返回如下内容：{经营活动现金流:数值,投资活动现金流:数值,筹资活动现金流:数值,分析:"分析内容"}，再用Markdown格式输出分析内容。只输出本分区内容，不要输出其他分区内容，不要输出多余内容。如果输出了其他分区内容，将被判为错误。如缺少关键字段或数据无法计算，也请明确输出“数据不足”或“未找到关键字段”，不要返回空内容。表格数据：${JSON.stringify(sheets)}`
      })
    })
      .then(res => res.json())
      .then(data => {
        // 尝试提取JSON结构
        let chart = null, analysis = '';
        try {
          if (typeof data.result === 'string') {
            const match = data.result.match(/\{[\s\S]*?\}/);
            if (match) {
              const obj = JSON.parse(match[0]);
              chart = [
                { name: '经营活动', value: obj['经营活动现金流'] || 0 },
                { name: '投资活动', value: obj['投资活动现金流'] || 0 },
                { name: '筹资活动', value: obj['筹资活动现金流'] || 0 }
              ];
              analysis = obj['分析'] || '';
            } else {
              analysis = data.result;
            }
          } else if (typeof data.result === 'object' && data.result !== null) {
            chart = [
              { name: '经营活动', value: data.result['经营活动现金流'] || 0 },
              { name: '投资活动', value: data.result['投资活动现金流'] || 0 },
              { name: '筹资活动', value: data.result['筹资活动现金流'] || 0 }
            ];
            analysis = data.result['分析'] || '';
          }
        } catch (e) {
          analysis = data.result || data.answer || 'AI分析失败';
        }
        setAiCash({ loading: false, result: analysis, error: '', chart });
        saveToStorage('report_aiCash', { loading: false, result: analysis, error: '', chart });
      })
      .catch(() => {
        setAiCash({ loading: false, result: '', error: 'AI分析失败', chart: null });
        saveToStorage('report_aiCash', { loading: false, result: '', error: 'AI分析失败', chart: null });
      });
  }, [sheets, isNewUpload]);

  // AI分析结果格式修正函数
  function fixAiMarkdown(md, sectionTitles = ['结论', '推导过程', '专业评价']) {
    if (!md) return 'AI未能给出分析';
    let fixed = md
      .replace(/\$/g, '') // 去除美元符号
      .replace(/,/g, '') // 去除英文逗号
      .replace(/\\n/g, '\n') // 修正换行
      .replace(/([0-9])%/g, '$1%') // 百分号前后不加空格
      .replace(/([0-9.]+)\s*元/g, '$1元'); // 统一单位
    // 检查分区标题
    sectionTitles.forEach(title => {
      if (!fixed.includes(`## ${title}`) && !fixed.includes(`### ${title}`)) {
        fixed += `\n\n## ${title}\nAI未能给出本分区分析`;
      }
    });
    return fixed;
  }

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 24, border: "1px solid #eee", borderRadius: 8 }}>
      <h2>财务报表分析</h2>
      <button onClick={() => navigate("/")} style={{ marginBottom: 24, padding: "6px 18px" }}>返回主页</button>
      {/* 文件管理区 */}
      <div style={{ marginBottom: 32, borderBottom: "1px solid #eee", paddingBottom: 24 }}>
        <b>文件管理：</b>
        <input type="file" accept=".csv,.xlsx" onChange={handleFileChange} multiple style={{ marginLeft: 16 }} />
        {filenames.length > 0 && filenames.map((name, i) => <span key={i} style={{ marginLeft: 12, color: '#1677ff' }}>{name}</span>)}
        {msg && <span style={{ marginLeft: 16, color: msg.includes('成功') ? 'green' : 'red' }}>{msg}</span>}
      </div>
      {/* 多表格折叠区 */}
      {sheets.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <b>原始表格预览：</b>
          {[...new Set(sheets.map(sheet => sheet.name.split('-')[0] + (sheet.name.endsWith('.csv') ? '.csv' : '.xlsx')))].map(filename => (
            <div key={filename} style={{ margin: '18px 0', border: '1px solid #eee', borderRadius: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', background: '#f6f8fa', padding: 10, borderRadius: '6px 6px 0 0', fontWeight: 500 }}>
                <span style={{ flex: 1 }}>{filename}</span>
              </div>
              {sheets.filter(sheet => sheet.name.startsWith(filename.replace(/\.[^.]+$/, ''))).map(sheet => (
                <div key={sheet.name}>
                  <div style={{ cursor: 'pointer', background: '#f6f8fa', padding: 10, borderRadius: '6px', fontWeight: 500 }} onClick={() => toggleSheet(sheet.name)}>
                    {openSheet[sheet.name] ? '▼' : '▶'} {sheet.name}
                    <button onClick={() => handleDeleteSheet(sheet.name)} style={{ marginLeft: 12, color: '#d00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>删除</button>
                  </div>
                  {openSheet[sheet.name] && (
                    <div style={{ overflowX: 'auto', padding: 12 }}>
                      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <thead>
                          <tr>
                            {sheet.columns.map(col => (
                              <th key={col} style={{ border: '1px solid #ddd', padding: 6, background: '#f6f8fa' }}>{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sheet.data.map((row, i) => (
                            <tr key={i}>
                              {sheet.columns.map(col => {
                                const val = row[col];
                                return <td key={col} style={{ border: '1px solid #eee', padding: 6 }}>{(val === null || val === undefined || (typeof val === 'number' && isNaN(val))) ? '-' : val}</td>;
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {/* 四分区卡片区 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, margin: '32px 0' }}>
        {/* 偿债能力 */}
        <div style={{ flex: '1 1 360px', minWidth: 320, background: '#f6f8fa', borderRadius: 8, padding: 20, boxShadow: '0 1px 4px #eee' }}>
          <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 10 }}>偿债能力</div>
          {aiSolvency.loading ? <div style={{ color: '#aaa' }}>AI分析中...</div> :
            aiSolvency.result ? (
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                <ReactMarkdown 
                  components={{
                    h2: ({children}) => <h2 style={{ fontSize: 16, fontWeight: 600, margin: '16px 0 8px 0', color: '#333' }}>{children}</h2>,
                    h3: ({children}) => <h3 style={{ fontSize: 15, fontWeight: 600, margin: '12px 0 6px 0', color: '#444' }}>{children}</h3>,
                    p: ({children}) => <p style={{ margin: '8px 0', color: '#555' }}>{children}</p>,
                    strong: ({children}) => <strong style={{ color: '#333', fontWeight: 600 }}>{children}</strong>,
                    ul: ({children}) => <ul style={{ margin: '8px 0', paddingLeft: 20 }}>{children}</ul>,
                    li: ({children}) => <li style={{ margin: '4px 0', color: '#555' }}>{children}</li>
                  }}
                >
                  {fixAiMarkdown(aiSolvency.result)}
                </ReactMarkdown>
              </div>
            ) : <div style={{ color: '#aaa' }}>AI未能给出分析</div>}
        </div>
        {/* 盈利能力 */}
        <div style={{ flex: '1 1 360px', minWidth: 320, background: '#f6f8fa', borderRadius: 8, padding: 20, boxShadow: '0 1px 4px #eee' }}>
          <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 10 }}>盈利能力</div>
          {aiProfit.loading ? <div style={{ color: '#aaa' }}>AI分析中...</div> :
            aiProfit.result ? (
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                <ReactMarkdown 
                  components={{
                    h2: ({children}) => <h2 style={{ fontSize: 16, fontWeight: 600, margin: '16px 0 8px 0', color: '#333' }}>{children}</h2>,
                    h3: ({children}) => <h3 style={{ fontSize: 15, fontWeight: 600, margin: '12px 0 6px 0', color: '#444' }}>{children}</h3>,
                    p: ({children}) => <p style={{ margin: '8px 0', color: '#555' }}>{children}</p>,
                    strong: ({children}) => <strong style={{ color: '#333', fontWeight: 600 }}>{children}</strong>,
                    ul: ({children}) => <ul style={{ margin: '8px 0', paddingLeft: 20 }}>{children}</ul>,
                    li: ({children}) => <li style={{ margin: '4px 0', color: '#555' }}>{children}</li>
                  }}
                >
                  {fixAiMarkdown(aiProfit.result)}
                </ReactMarkdown>
              </div>
            ) : <div style={{ color: '#aaa' }}>AI未能给出分析</div>}
        </div>
        {/* 运营能力 */}
        <div style={{ flex: '1 1 360px', minWidth: 320, background: '#f6f8fa', borderRadius: 8, padding: 20, boxShadow: '0 1px 4px #eee' }}>
          <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 10 }}>运营能力</div>
          {aiOperate.loading ? <div style={{ color: '#aaa' }}>AI分析中...</div> :
            aiOperate.result ? (
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                <ReactMarkdown 
                  components={{
                    h2: ({children}) => <h2 style={{ fontSize: 16, fontWeight: 600, margin: '16px 0 8px 0', color: '#333' }}>{children}</h2>,
                    h3: ({children}) => <h3 style={{ fontSize: 15, fontWeight: 600, margin: '12px 0 6px 0', color: '#444' }}>{children}</h3>,
                    p: ({children}) => <p style={{ margin: '8px 0', color: '#555' }}>{children}</p>,
                    strong: ({children}) => <strong style={{ color: '#333', fontWeight: 600 }}>{children}</strong>,
                    ul: ({children}) => <ul style={{ margin: '8px 0', paddingLeft: 20 }}>{children}</ul>,
                    li: ({children}) => <li style={{ margin: '4px 0', color: '#555' }}>{children}</li>
                  }}
                >
                  {fixAiMarkdown(aiOperate.result)}
                </ReactMarkdown>
              </div>
            ) : <div style={{ color: '#aaa' }}>AI未能给出分析</div>}
        </div>
        {/* 现金流量 */}
        <div style={{ flex: '1 1 360px', minWidth: 320, background: '#f6f8fa', borderRadius: 8, padding: 20, boxShadow: '0 1px 4px #eee' }}>
          <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 10 }}>现金流量</div>
          {aiCash.loading ? <div style={{ color: '#aaa' }}>AI分析中...</div> :
            aiCash.error ? <div style={{ color: 'red' }}>{aiCash.error}</div> :
              aiCash.result ? (
                <>
                  <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                    <ReactMarkdown 
                      components={{
                        h2: ({children}) => <h2 style={{ fontSize: 16, fontWeight: 600, margin: '16px 0 8px 0', color: '#333' }}>{children}</h2>,
                        h3: ({children}) => <h3 style={{ fontSize: 15, fontWeight: 600, margin: '12px 0 6px 0', color: '#444' }}>{children}</h3>,
                        p: ({children}) => <p style={{ margin: '8px 0', color: '#555' }}>{children}</p>,
                        strong: ({children}) => <strong style={{ color: '#333', fontWeight: 600 }}>{children}</strong>,
                        ul: ({children}) => <ul style={{ margin: '8px 0', paddingLeft: 20 }}>{children}</ul>,
                        li: ({children}) => <li style={{ margin: '4px 0', color: '#555' }}>{children}</li>
                      }}
                    >
                      {fixAiMarkdown(aiCash.result, [])}
                    </ReactMarkdown>
                  </div>
                  {aiCash.chart && (
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'center', minWidth: 0, marginTop: 16 }}>
                      <div style={{ width: '100%', height: 300 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={aiCash.chart} margin={{ left: 40, right: 20, top: 20, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis tick={{ textAnchor: 'end' }} />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="value" name="现金流量" fill="#1890ff" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </>
              ) :
                (!aiCash.loading && !aiCash.error && !aiCash.chart) ? <div style={{ color: '#aaa' }}>AI未能给出分析</div> : null}
        </div>
      </div>
    </div>
  );
} 