import React, { useState, useEffect } from "react";
import { API_BASE_URL } from "../config";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [form, setForm] = useState({ username: "", password: "" });
  const [msg, setMsg] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    // 进入登录页自动清除token
    localStorage.removeItem("token");
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.status === 200 && data.access_token) {
        localStorage.setItem("token", data.access_token);
        setMsg("登录成功，正在跳转...");
        setTimeout(() => navigate("/"), 1000);
      } else {
        setMsg(data.msg || "登录失败");
      }
    } catch (err) {
      setMsg("网络错误");
    }
  };

  return (
    <div style={{ maxWidth: 320, margin: "60px auto", padding: 24, border: "1px solid #eee", borderRadius: 8 }}>
      <h2>登录</h2>
      <form onSubmit={handleSubmit}>
        <input name="username" placeholder="用户名" value={form.username} onChange={handleChange} required style={{ width: "100%", marginBottom: 8, padding: 8 }} />
        <input name="password" type="password" placeholder="密码" value={form.password} onChange={handleChange} required style={{ width: "100%", marginBottom: 8, padding: 8 }} />
        <button type="submit" style={{ width: "100%", padding: 8, marginTop: 8 }}>登录</button>
      </form>
      <div style={{ color: "#d00", marginTop: 8 }}>{msg}</div>
      <div style={{ marginTop: 12 }}>
        没有账号？<a href="/register">去注册</a>
      </div>
    </div>
  );
} 