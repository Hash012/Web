import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Assistant from "./pages/Assistant";
import Report from "./pages/Report";
import Predict from "./pages/Predict";
import { API_BASE_URL } from "./config";

function Home() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // 新增loading状态
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      fetch(`${API_BASE_URL}/userinfo`, {
        headers: {
          Authorization: `Bearer ${token}`
        },
      })
        .then((res) => {
          if (res.status === 200) return res.json();
          else throw new Error();
        })
        .then((data) => setUser(data.user))
        .catch(() => setUser(null))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return <div style={{ textAlign: "center", marginTop: 80 }}>加载中...</div>;
  }

  const handleLogout = () => {
    const userId = localStorage.getItem('userId');
    if (userId) {
      localStorage.removeItem(`uploadedFiles_${userId}`);
    }
    localStorage.clear();
    setUser(null);
    navigate(0); // 刷新页面
  };

  if (user) {
    return (
      <div style={{ textAlign: "center", marginTop: 80 }}>
        <h2>欢迎，{user.username}！</h2>
        <button onClick={handleLogout} style={{ marginTop: 32, padding: "8px 24px" }}>退出登录</button>
        <div style={{ marginTop: 32 }}>
          <button onClick={() => navigate("/assistant")} style={{ margin: 16, padding: "10px 32px", fontSize: 18, borderRadius: 8, border: '1px solid #1677ff', background: '#fff', color: '#1677ff', cursor: 'pointer' }}>进入智能助手</button>
          <button onClick={() => navigate("/report")} style={{ margin: 16, padding: "10px 32px", fontSize: 18, borderRadius: 8, border: '1px solid #1677ff', background: '#fff', color: '#1677ff', cursor: 'pointer' }}>财务报表</button>
          <button onClick={() => navigate("/predict")} style={{ margin: 16, padding: "10px 32px", fontSize: 18, borderRadius: 8, border: '1px solid #1677ff', background: '#fff', color: '#1677ff', cursor: 'pointer' }}>智能预测分析</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center", marginTop: 80 }}>
      <h2>欢迎！请先注册或登录</h2>
      <div style={{ marginTop: 32 }}>
        <a href="/register" style={{ marginRight: 24, fontSize: 18 }}>注册</a>
        <a href="/login" style={{ fontSize: 18 }}>登录</a>
      </div>
      </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/report" element={<Report />} />
        <Route path="/predict" element={<Predict />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}