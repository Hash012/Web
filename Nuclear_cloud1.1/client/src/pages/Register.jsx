import React, { useState, useEffect } from "react";
import { API_BASE_URL } from "../config";
import { useNavigate } from "react-router-dom";

export default function Register() {
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [msg, setMsg] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    // 进入注册页自动清除token
    localStorage.removeItem("token");
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.status === 201) {
        setMsg("注册成功，正在跳转登录页...");
        setTimeout(() => navigate("/login"), 1000);
      } else {
        setMsg(data.msg || "注册失败");
      }
    } catch (err) {
      setMsg("网络错误");
    }
  };

  return (
    <div style={{ maxWidth: 320, margin: "60px auto", padding: 24, border: "1px solid #eee", borderRadius: 8 }}>
      <h2>注册</h2>
      <form onSubmit={handleSubmit}>
        <input name="username" placeholder="用户名" value={form.username} onChange={handleChange} required style={{ width: "100%", marginBottom: 8, padding: 8 }} />
        <input name="email" type="email" placeholder="邮箱" value={form.email} onChange={handleChange} required style={{ width: "100%", marginBottom: 8, padding: 8 }} />
        <input name="password" type="password" placeholder="密码" value={form.password} onChange={handleChange} required style={{ width: "100%", marginBottom: 8, padding: 8 }} />
        <button type="submit" style={{ width: "100%", padding: 8, marginTop: 8 }}>注册</button>
      </form>
      <div style={{ color: "#d00", marginTop: 8 }}>{msg}</div>
      <div style={{ marginTop: 12 }}>
        已有账号？<a href="/login">去登录</a>
      </div>
    </div>
  );
} 