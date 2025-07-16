import React, { useState, useRef } from "react";
import { API_BASE_URL } from "../config";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { useNavigate } from "react-router-dom";

function HistoryModal({ open, onClose, onFill, token }) {
  const [history, setHistory] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const pageSize = 20;

  const fetchHistory = async (p = 1) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/history?page=${p}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setHistory(data.history);
        setTotal(data.total);
        setPage(data.page);
      }
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (open) fetchHistory(1);
    // eslint-disable-next-line
  }, [open]);

  const handleDownload = async (fileName) => {
    window.open(`${API_BASE_URL}/file/${encodeURIComponent(fileName)}`);
  };

  const handleDelete = async (sessionId) => {
    if (!window.confirm("确定要删除这个会话及其所有对话记录吗？")) return;
    await fetch(`${API_BASE_URL}/file/delete/${sessionId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchHistory(page);
  };

  return (
    <div style={{
      display: open ? "block" : "none",
      position: "fixed", top: 0, right: 0, width: 420, height: "100%", background: "#fff", boxShadow: "-2px 0 8px #0001", zIndex: 1000, overflowY: "auto"
    }}>
      <div style={{ padding: 16, borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b>历史记录</b>
        <button onClick={onClose}>关闭</button>
      </div>
      {loading ? <div style={{ padding: 24 }}>加载中...</div> : (
        <>
          {history.length === 0 ? <div style={{ padding: 24 }}>暂无历史</div> : (
            <div>
              {history.map((session, sessionIndex) => (
                <div key={session.session_id} style={{ borderBottom: "1px solid #eee", padding: 12 }}>
                  <div style={{ fontSize: 13, color: "#888" }}>
                    会话 #{total - (page - 1) * pageSize - sessionIndex} - {new Date(session.created_at).toLocaleString()}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: "bold", margin: "6px 0", color: "#333" }}>
                    {session.title}
                  </div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                    共 {session.conversations.length} 轮对话
                  </div>
                  {session.conversations.map((conv, index) => (
                    <div key={conv.id} style={{ margin: "8px 0", padding: "8px", background: "#f9f9f9", borderRadius: 4 }}>
                      <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
                        第 {index + 1} 轮
                      </div>
                      <div style={{ margin: "4px 0" }}>
                        <b style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => onFill(conv.question)}>
                          Q: {conv.question}
                        </b>
                      </div>
                      <div style={{ background: "#f6f8fa", padding: 6, borderRadius: 4, marginBottom: 4, fontSize: 12 }}>
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{conv.answer}</ReactMarkdown>
                      </div>
                      {conv.file_name && (
                        <div style={{ fontSize: 11, color: "#555" }}>
                          文件: <span style={{ color: "#1677ff", cursor: "pointer" }} onClick={() => handleDownload(conv.file_name)}>{conv.file_name}</span>
                        </div>
                      )}
                    </div>
                  ))}
                  <div style={{ textAlign: "right", marginTop: 8 }}>
                    <button onClick={() => handleDelete(session.session_id)} style={{ color: "#d00", fontSize: 12 }}>删除会话</button>
                  </div>
                </div>
              ))}
              <div style={{ textAlign: "center", margin: 12 }}>
                <button disabled={page <= 1} onClick={() => fetchHistory(page - 1)}>上一页</button>
                <span style={{ margin: "0 16px" }}>第 {page} / {Math.ceil(total / pageSize)} 页</span>
                <button disabled={page * pageSize >= total} onClick={() => fetchHistory(page + 1)}>下一页</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Assistant() {
  const [question, setQuestion] = useState("");
  const [file, setFile] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [history, setHistory] = useState([]); // 当前会话历史
  const [sessionId, setSessionId] = useState(null); // 当前会话ID
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("fast");
  const [username, setUsername] = useState(""); // 用户名
  const fileInput = useRef();
  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  // 获取用户信息
  React.useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/userinfo`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setUsername(data.user.username);
        }
      } catch (err) {
        console.error("获取用户信息失败:", err);
      }
    };
    if (token) {
      fetchUserInfo();
    }
  }, [token]);

  // 新会话
  const handleNewSession = () => {
    setHistory([]);
    setQuestion("");
    setFile(null);
    setSessionId(null); // 清空会话ID，下次提问会创建新会话
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!question && !file) return;
    setLoading(true);
    // 取最近5轮上下文
    const context = history.slice(-10).map(msg => ({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.text
    }));
    const formData = new FormData();
    formData.append("question", question);
    formData.append("mode", mode);
    formData.append("context", JSON.stringify(context));
    if (sessionId) {
      formData.append("session_id", sessionId);
    }
    if (file) formData.append("file", file);
    setHistory((h) => [...h, { role: "user", text: question, file, mode }]);
    setQuestion("");
    setFile(null);
    fileInput.current.value = "";
    try {
      const res = await fetch(`${API_BASE_URL}/ask`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setHistory((h) => [...h, { role: "ai", text: data.answer, mode }]);
        setSessionId(data.session_id); // 保存会话ID
        setHistoryKey(k => k + 1); // 触发历史刷新
      } else {
        setHistory((h) => [...h, { role: "ai", text: data.msg || "AI接口错误", mode }]);
      }
    } catch (err) {
      setHistory((h) => [...h, { role: "ai", text: "网络错误", mode }]);
    }
    setLoading(false);
  };

  const handleFill = (q) => {
    setQuestion(q);
    setHistoryOpen(false);
  };

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", padding: 24, border: "1px solid #eee", borderRadius: 8, position: "relative" }}>
      <h2>智能助手</h2>
      <button onClick={() => navigate("/")} style={{ marginBottom: 16, padding: "6px 18px" }}>返回主页</button>
      <button onClick={() => setHistoryOpen(true)} style={{ marginLeft: 12, marginBottom: 16, padding: "6px 18px" }}>历史记录</button>
      <button onClick={handleNewSession} style={{ marginLeft: 12, marginBottom: 16, padding: "6px 18px" }}>新会话</button>
      <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} onFill={handleFill} token={token} key={historyKey} />
      <div style={{ marginBottom: 16 }}>
        <label>
          <input type="radio" name="mode" value="fast" checked={mode === "fast"} onChange={() => setMode("fast")}/>
          快速思考（简明、响应快）
        </label>
        <label style={{ marginLeft: 24 }}>
          <input type="radio" name="mode" value="deep" checked={mode === "deep"} onChange={() => setMode("deep")}/>
          深度思考（详细、条理、专业）
        </label>
      </div>
      <div style={{ minHeight: 200, marginBottom: 16 }}>
        {history.map((msg, i) => (
          <div key={i} style={{ margin: "12px 0", textAlign: msg.role === "user" ? "right" : "left" }}>
            {msg.role === "user" ? (
              <>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 4, textAlign: "right" }}>
                  {username}:
                </div>
                <div style={{ textAlign: "right" }}>
                  {msg.text}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
                  小蒜:
                </div>
                <div style={{ background: "#f6f8fa", padding: 8, borderRadius: 6, display: "inline-block", maxWidth: "90%" }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                  >
                    {msg.text}
                  </ReactMarkdown>
                </div>
              </>
            )}
            {msg.file && (
              <div style={{ fontSize: 12, color: "#888", textAlign: msg.role === "user" ? "right" : "left" }}>
                已上传文件: {msg.file.name}
              </div>
            )}
            <div style={{ fontSize: 12, color: "#888", textAlign: msg.role === "user" ? "right" : "left" }}>
              {msg.mode === "deep" ? "[深度思考]" : "[快速思考]"}
            </div>
          </div>
        ))}
        {loading && <div style={{ color: "#888" }}>AI思考中...</div>}
      </div>
      <form onSubmit={handleSend} style={{ display: "flex", gap: 8 }}>
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="请输入你的问题"
          style={{ flex: 1, padding: 8 }}
          disabled={loading}
        />
        <input
          type="file"
          accept=".xlsx,.csv,.docx,.pdf,.png,.jpg,.jpeg"
          ref={fileInput}
          onChange={e => setFile(e.target.files[0])}
          disabled={loading}
        />
        <button type="submit" disabled={loading} style={{ padding: "0 16px" }}>发送</button>
      </form>
    </div>
  );
} 