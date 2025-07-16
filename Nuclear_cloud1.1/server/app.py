import os
import time
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash
from config import DEEPSEEK_API_TOKEN, DATABASE_PATH, UPLOAD_FOLDER as CONFIG_UPLOAD_FOLDER
UPLOAD_FOLDER = str(CONFIG_UPLOAD_FOLDER) if CONFIG_UPLOAD_FOLDER else 'uploads'
from config import SECRET_KEY, JWT_SECRET_KEY
import pandas as pd
import docx
import PyPDF2
import pdfplumber
import pytesseract
from PIL import Image
import requests
from datetime import datetime
import json
import numpy as np
import re
import base64
import traceback
import shutil
app = Flask(__name__)
# 增强CORS配置，允许Authorization头
CORS(app, supports_credentials=True, resources={r"/api/*": {"origins": "*"}}, expose_headers=["Authorization"])
app.config['JWT_SECRET_KEY'] = 'mymy_jwt_secret_key'  # 建议后续更换为更安全的密钥
app.config['SECRET_KEY'] = SECRET_KEY
app.config['JWT_SECRET_KEY'] = JWT_SECRET_KEY
jwt = JWTManager(app)

# JWT错误处理，便于调试422问题
def _jwt_error_response(msg, code):
    return jsonify({'msg': msg}), code

@jwt.unauthorized_loader
def unauthorized_callback(callback):
    return _jwt_error_response('Missing Authorization Header', 401)

@jwt.invalid_token_loader
def invalid_token_callback(callback):
    return _jwt_error_response('Invalid Token', 422)

@jwt.expired_token_loader
def expired_token_callback(jwt_header, jwt_payload):
    return _jwt_error_response('Token has expired', 401)

# 确保数据库目录存在
db_dir = os.path.dirname(DATABASE_PATH)
if not os.path.exists(db_dir):
    os.makedirs(db_dir)

# 确保上传文件夹存在
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# 确保数据库存在
if not os.path.exists(DATABASE_PATH):
    conn = sqlite3.connect(DATABASE_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
    )''')
    conn.commit()
    conn.close()

# 删除旧表并重新创建sessions和conversations表
with sqlite3.connect(DATABASE_PATH) as conn:
    c = conn.cursor()
    # 删除旧表（如果存在）
    c.execute('DROP TABLE IF EXISTS conversations')
    c.execute('DROP TABLE IF EXISTS sessions')
    
    # 创建sessions表
    c.execute('''CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT,
        created_at TEXT
    )''')
    
    # 创建conversations表，session_id允许为NULL
    c.execute('''CREATE TABLE conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        user_id INTEGER NOT NULL,
        question TEXT,
        answer TEXT,
        file_name TEXT,
        created_at TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions (id)
    )''')
    conn.commit()

# 注册接口
@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({'msg': '请求体必须为JSON'}), 400
    username = data.get('username')
    email = data.get('email')
    password = data.get('password')
    if not username or not email or not password:
        return jsonify({'msg': '缺少必要字段'}), 400
    password_hash = generate_password_hash(password)
    try:
        with sqlite3.connect(DATABASE_PATH) as conn:
            c = conn.cursor()
            c.execute('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
                      (username, email, password_hash))
            conn.commit()
        return jsonify({'msg': '注册成功'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'msg': '用户名或邮箱已存在'}), 409

# 登录接口
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return jsonify({'msg': '请求体必须为JSON'}), 400
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({'msg': '缺少必要字段'}), 400
    with sqlite3.connect(DATABASE_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT id, password_hash FROM users WHERE username=?', (username,))
        user = c.fetchone()
    if user and check_password_hash(user[1], password):
        identity = {'id': user[0], 'username': username}
        access_token = create_access_token(identity=identity)
        return jsonify({'access_token': access_token, 'identity': identity}), 200
    else:
        return jsonify({'msg': '用户名或密码错误'}), 401

# 受保护的用户信息接口（测试JWT）
@app.route('/api/userinfo', methods=['GET'])
@jwt_required()
def userinfo():
    user = get_jwt_identity()
    return jsonify({'user': user}), 200

# 智能助手：支持文本+文件上传+思考模式+数学公式渲染指令+会话管理
@app.route('/api/ask', methods=['POST'])
@jwt_required()
def ask():
    user = get_jwt_identity()
    user_id = user['id']
    question = request.form.get('question', '')
    mode = request.form.get('mode', 'fast')
    session_id = request.form.get('session_id')  # 新增：会话ID
    file = request.files.get('file')
    file_content = ''
    file_type = ''
    file_name = None
    if file and file.filename:
        filename = file.filename
        ext = filename.rsplit('.', 1)[-1].lower()
        save_path = os.path.join(UPLOAD_FOLDER, filename)
        file.save(save_path)
        file_type = ext
        file_name = filename
        try:
            if ext in ['xlsx', 'csv']:
                if ext == 'csv':
                    df = pd.read_csv(save_path)
                else:
                    df = pd.read_excel(save_path)
                file_content = df.to_string(index=False)
            elif ext == 'docx':
                doc = docx.Document(save_path)
                file_content = '\n'.join([p.text for p in doc.paragraphs])
            elif ext == 'pdf':
                with pdfplumber.open(save_path) as pdf:
                    file_content = '\n'.join(page.extract_text() or '' for page in pdf.pages)
            elif ext in ['png', 'jpg', 'jpeg']:
                img = Image.open(save_path)
                file_content = pytesseract.image_to_string(img)
            else:
                return jsonify({'msg': '不支持的文件类型'}), 400
        except Exception as e:
            return jsonify({'msg': f'文件解析失败: {str(e)}'}), 400
    context_json = request.form.get('context')
    context_msgs = []
    if context_json:
        try:
            context_msgs = json.loads(context_json)
        except Exception:
            context_msgs = []
    prompt = question
    if file_content:
        prompt += f"\n\n以下是用户上传的{file_type}文件内容：\n{file_content}"
    # 根据mode调整AI参数
    if mode == 'deep':
        system_prompt = "你是一个专业的财务分析师，请详细、条理清晰、专业地回答用户问题。"
        temperature = 0.2
        max_tokens = 2048
    else:
        system_prompt = "你是一个高效的智能助手，请简明扼要地回答用户问题。"
        temperature = 0.8
        max_tokens = 512
    # 在system prompt后自动加一条隐藏指令，要求AI用标准Markdown数学公式语法输出所有公式
    math_tip = "对于数学公式，请用标准Markdown数学公式语法输出所有公式，行内公式用$...$，块级公式用$$...$$。"
    system_prompt = system_prompt + " " + math_tip
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_TOKEN}",
        "Content-Type": "application/json"
    }
    # 组装messages
    messages = [
        {"role": "system", "content": system_prompt}
    ]
    messages.extend(context_msgs)
    messages.append({"role": "user", "content": prompt})
    ds_payload = {
        "model": "deepseek-chat",
        "messages": messages,
        "stream": False,
        "temperature": temperature,
        "max_tokens": max_tokens
    }
    try:
        resp = requests.post("https://api.deepseek.com/chat/completions", json=ds_payload, headers=headers, timeout=60)
        if resp.status_code == 200:
            answer = resp.json()["choices"][0]["message"]["content"]
            
            # 会话管理逻辑
            with sqlite3.connect(DATABASE_PATH) as conn:
                c = conn.cursor()
                current_time = datetime.now().isoformat()
                
                # 如果没有session_id或session_id为空，创建新会话
                if not session_id:
                    # 使用问题前20个字符作为会话标题
                    session_title = question[:20] + "..." if len(question) > 20 else question
                    c.execute('''INSERT INTO sessions (user_id, title, created_at) VALUES (?, ?, ?)''',
                              (user_id, session_title, current_time))
                    session_id = c.lastrowid
                else:
                    # 验证session_id是否属于当前用户
                    c.execute('''SELECT id FROM sessions WHERE id=? AND user_id=?''', (session_id, user_id))
                    if not c.fetchone():
                        return jsonify({'msg': '无效的会话ID'}), 400
                
                # 写入对话记录
                c.execute('''INSERT INTO conversations (session_id, user_id, question, answer, file_name, created_at) VALUES (?, ?, ?, ?, ?, ?)''',
                          (session_id, user_id, question, answer, file_name, current_time))
                conn.commit()
            
            return jsonify({'answer': answer, 'session_id': session_id})
        else:
            return jsonify({'msg': f'DeepSeek API错误: {resp.text}'}), 500
    except Exception as e:
        return jsonify({'msg': f'AI接口调用失败: {str(e)}'}), 500

# /api/history分页查询 - 按会话分组
@app.route('/api/history', methods=['GET'])
@jwt_required()
def history():
    user = get_jwt_identity()
    user_id = user['id']
    page = int(request.args.get('page', 1))
    page_size = 20
    offset = (page - 1) * page_size
    
    with sqlite3.connect(DATABASE_PATH) as conn:
        c = conn.cursor()
        # 查询会话列表，按创建时间倒序（最新的在前）
        c.execute('''SELECT id, title, created_at FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?''',
                  (user_id, page_size, offset))
        sessions = c.fetchall()
        
        # 查询总会话数
        c.execute('''SELECT COUNT(*) FROM sessions WHERE user_id=?''', (user_id,))
        total = c.fetchone()[0]
        
        # 为每个会话查询对话记录
        history = []
        for session in sessions:
            session_id, title, created_at = session
            c.execute('''SELECT id, question, answer, file_name, created_at FROM conversations WHERE session_id=? ORDER BY created_at ASC''',
                      (session_id,))
            conversations = c.fetchall()
            
            session_data = {
                "session_id": session_id,
                "title": title,
                "created_at": created_at,
                "conversations": [
                    {
                        "id": conv[0],
                        "question": conv[1],
                        "answer": conv[2],
                        "file_name": conv[3],
                        "created_at": conv[4]
                    } for conv in conversations
                ]
            }
            history.append(session_data)
    
    return jsonify({"history": history, "total": total, "page": page, "page_size": page_size})

# /api/file/<filename>下载
@app.route('/api/file/<filename>', methods=['GET'])
@jwt_required()
def download_file(filename):
    user = get_jwt_identity()
    user_id = user['id']
    # 只允许下载自己上传的文件
    with sqlite3.connect(DATABASE_PATH) as conn:
        c = conn.cursor()
        c.execute('''SELECT COUNT(*) FROM conversations WHERE user_id=? AND file_name=?''', (user_id, filename))
        if c.fetchone()[0] == 0:
            return jsonify({'msg': '无权限下载此文件'}), 403
    return send_from_directory(UPLOAD_FOLDER, filename, as_attachment=True)

# /api/file/delete/<id>删除 - 支持删除会话
@app.route('/api/file/delete/<int:session_id>', methods=['POST'])
@jwt_required()
def delete_session(session_id):
    user = get_jwt_identity()
    user_id = user['id']
    
    with sqlite3.connect(DATABASE_PATH) as conn:
        c = conn.cursor()
        # 验证session是否属于当前用户
        c.execute('''SELECT id FROM sessions WHERE id=? AND user_id=?''', (session_id, user_id))
        if not c.fetchone():
            return jsonify({'msg': '无权限删除此会话'}), 403
        
        # 查询会话中的所有文件
        c.execute('''SELECT file_name FROM conversations WHERE session_id=? AND file_name IS NOT NULL''', (session_id,))
        files = c.fetchall()
        
        # 删除会话及其所有对话记录
        c.execute('''DELETE FROM conversations WHERE session_id=?''', (session_id,))
        c.execute('''DELETE FROM sessions WHERE id=? AND user_id=?''', (session_id, user_id))
        conn.commit()
    
    # 删除相关文件
    for file_row in files:
        file_name = file_row[0]
        if file_name:
            file_path = os.path.join(UPLOAD_FOLDER, file_name)
            if os.path.exists(file_path):
                os.remove(file_path)
    
    return jsonify({'msg': '会话删除成功'})

@app.route('/api/file/delete_by_name', methods=['POST'])
@jwt_required()
def delete_file_by_name():
    user = get_jwt_identity()
    user_id = user['id']
    data = request.get_json()
    filename = data.get('filename')
    if not filename:
        return jsonify({'msg': '缺少文件名'}), 400
    # 检查该文件是否属于当前用户
    with sqlite3.connect(DATABASE_PATH) as conn:
        c = conn.cursor()
        c.execute('''SELECT COUNT(*) FROM conversations WHERE user_id=? AND file_name=?''', (user_id, filename))
        if c.fetchone()[0] == 0:
            return jsonify({'msg': '无权限删除此文件'}), 403
        # 删除数据库记录
        c.execute('''DELETE FROM conversations WHERE user_id=? AND file_name=?''', (user_id, filename))
        conn.commit()
    # 删除物理文件
    file_path = os.path.join(UPLOAD_FOLDER, filename)
    if os.path.exists(file_path):
        os.remove(file_path)
    return jsonify({'msg': '文件删除成功'})

@app.route('/api/report/upload', methods=['POST'])
@jwt_required()
def upload_report():
    user = get_jwt_identity()
    user_id = user['id']
    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({'msg': '未选择文件'}), 400
    
    ext = file.filename.rsplit('.', 1)[-1].lower()
    
    # 创建临时文件路径
    temp_filename = f"temp_{int(time.time())}_{file.filename}"
    temp_path = os.path.join(UPLOAD_FOLDER, temp_filename)
    
    try:
        # 保存文件到临时路径
        file.save(temp_path)
        
        if ext == 'csv':
            # 使用临时文件路径读取CSV
            df = pd.read_csv(temp_path)
            if df.empty or not list(df.columns):
                os.remove(temp_path)  # 删除临时文件
                return jsonify({'msg': '文件内容不规范，请上传标准表格文件'}), 400
            data = df.head(100).replace({np.nan: None}).to_dict(orient='records')
            columns = list(df.columns)
            # 新增：登记文件归属
            with sqlite3.connect(DATABASE_PATH) as conn:
                c = conn.cursor()
                c.execute('''INSERT INTO conversations (user_id, file_name, created_at, question, answer, session_id) VALUES (?, ?, datetime('now'), NULL, NULL, NULL)''', (user_id, file.filename))
                conn.commit()
            
            # 处理完成后删除临时文件
            os.remove(temp_path)
            return jsonify({'sheets': [{
                'name': file.filename,
                'columns': columns,
                'data': data
            }], 'msg': '解析成功'})
            
        elif ext in ['xlsx', 'xls']:
            # 使用 with 语句确保资源释放
            with pd.ExcelFile(temp_path) as xls:
                sheets = []
                valid = False
                for sheet_name in xls.sheet_names:
                    df = xls.parse(sheet_name)
                    if not isinstance(df, pd.DataFrame) or df.empty or not list(df.columns):
                        continue
                    data = df.head(100).replace({np.nan: None}).to_dict(orient='records')
                    columns = list(df.columns)
                    sheets.append({
                        'name': sheet_name,
                        'columns': columns,
                        'data': data
                    })
                    valid = True
            
            if not sheets:
                return jsonify({'msg': '未识别到有效表格，请检查文件内容'}), 400
            
            # 新增：登记文件归属
            with sqlite3.connect(DATABASE_PATH) as conn:
                c = conn.cursor()
                c.execute('''INSERT INTO conversations (user_id, file_name, created_at, question, answer, session_id) VALUES (?, ?, datetime('now'), NULL, NULL, NULL)''', (user_id, file.filename))
                conn.commit()
            
            # 处理完成后删除临时文件
            os.remove(temp_path)
            return jsonify({'sheets': sheets, 'msg': '解析成功'})
            
        else:
            # 删除临时文件
            os.remove(temp_path)
            return jsonify({'msg': '仅支持CSV或Excel文件'}), 400
            
    except Exception as e:
        # 确保在异常情况下也删除临时文件
        if 'temp_path' in locals() and os.path.exists(temp_path):
            os.remove(temp_path)
        return jsonify({'msg': f'文件解析失败: {str(e)}'}), 400
    
def extract_sheets_from_prompt(prompt):
    # 支持多行JSON提取
    match = re.search(r'表格数据：\n?([\s\S]+)$', prompt)
    if match:
        json_str = match.group(1)
        try:
            return json.loads(json_str)
        except Exception as e:
            print('JSON解析失败:', e)
            return []
    return []

@app.route('/api/report/ai_analyze', methods=['POST'])
@jwt_required()
def ai_analyze():
    data = request.get_json()
    prompt = data.get('prompt', '')
    # 直接调用大模型API
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_TOKEN}",
        "Content-Type": "application/json"
    }
    messages = [
        {"role": "system", "content": "你是一个专业的财务分析师，请详细、条理清晰、专业地回答用户问题。对于数学公式，请用标准Markdown数学公式语法输出所有公式，行内公式用$...$，块级公式用$$...$$。"}
    ]
    messages.append({"role": "user", "content": prompt})
    ds_payload = {
        "model": "deepseek-chat",
        "messages": messages,
        "stream": False,
        "temperature": 0.2,
        "max_tokens": 2048
    }
    try:
        resp = requests.post("https://api.deepseek.com/chat/completions", json=ds_payload, headers=headers, timeout=60)
        if resp.status_code == 200:
            answer = resp.json()["choices"][0]["message"]["content"]
            return jsonify({'result': answer})
        else:
            return jsonify({'msg': f'DeepSeek API错误: {resp.text}'}), 500
    except Exception as e:
        return jsonify({'msg': f'AI接口调用失败: {str(e)}'}), 500

@app.route('/api/ai_analyze', methods=['POST'])
@jwt_required()
def ai_analyze_finance():
    print('收到文件keys:', list(request.files.keys()))
    for key in request.files:
        print('key:', key, 'file:', request.files[key])
    user = get_jwt_identity()
    user_id = str(user['id']) if user and 'id' in user and user['id'] is not None else 'anonymous'
    user_folder = os.path.join(str(UPLOAD_FOLDER), f'tmp_{user_id}')
    if os.path.exists(user_folder):
        shutil.rmtree(user_folder)
    os.makedirs(user_folder, exist_ok=True)

    # 只处理本次上传的文件
    files = request.files
    if not files:
        return jsonify({'error': 'No files uploaded'}), 400
    # 支持multipart表单接收months和baseMonth
    months = request.form.get('months')
    if months:
        import json as _json
        months = _json.loads(months)
    else:
        months = []
    base_month = request.form.get('baseMonth') or request.args.get('baseMonth')
    months_list = []
    for key in files:
        # key格式: files[YYYY-MM]
        if key.startswith('files[') and key.endswith(']'):
            month = key[6:-1]
            if not month:
                continue
            if month not in months_list:
                months_list.append(month)
            f = files[key]
            month_folder = os.path.join(str(user_folder), str(month))
            os.makedirs(month_folder, exist_ok=True)
            filename = f.filename if isinstance(f.filename, str) else str(f.filename)
            f.save(os.path.join(month_folder, filename))
    if not months_list:
        shutil.rmtree(user_folder)
        return jsonify({'error': 'No valid months'}), 400

    # 构造发送给大模型的数据
    files_info = []
    for month in months_list:
        month_folder = os.path.join(str(user_folder), str(month))
        if not os.path.exists(month_folder):
            continue
        for fname in os.listdir(month_folder):
            fpath = os.path.join(month_folder, fname)
            if not os.path.isfile(fpath):
                continue
            file_type = fname.split('.')[-1].lower() if '.' in fname else ''
            if file_type in ['xlsx', 'xls', 'csv']:
                try:
                    if file_type == 'csv':
                        df = pd.read_csv(fpath)
                    else:
                        df = pd.read_excel(fpath)
                    content = df.to_string(index=False)
                except Exception as e:
                    with open(fpath, 'rb') as f:
                        content = base64.b64encode(f.read()).decode()
            else:
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        content = f.read()
                except UnicodeDecodeError:
                    try:
                        with open(fpath, 'r', encoding='gbk') as f:
                            content = f.read()
                    except:
                        with open(fpath, 'rb') as f:
                            content = base64.b64encode(f.read()).decode()
            files_info.append(f"时间戳: {month}\n文件名: {fname}\n文件类型: {file_type}\n文件内容:\n{content}\n{'='*50}")
    
    files_content = "\n".join(files_info)
    
    # 设计合理的提示词
    base_month_str = f"基准月份为{base_month}，M0代表{base_month}，M+1为下一个月，以此类推。" if base_month else ""
    # 生成历史区间
    history_months = sorted(list(months_list))
    history_months_str = ", ".join(history_months)
    # 生成预测区间
    predict_count = 6 if len(months_list) > 12 else 3
    predict_months = []
    if base_month:
        m0 = base_month
        for i in range(1, predict_count + 1):
            from datetime import datetime
            from dateutil.relativedelta import relativedelta
            dt = datetime.strptime(m0, "%Y-%m") + relativedelta(months=i)
            predict_months.append(dt.strftime("%Y-%m"))
    predict_months_str = ", ".join(predict_months)
    # 强化bar/area区间要求
    prompt = f"""
你是一个专业的财务分析师，请根据以下财务数据文件进行智能分析和预测。

基准月份为{base_month}，M0代表{base_month}，M+1为下一个月，以此类推。

请仔细分析以下文件内容，每个文件都标注了对应的时间戳（YYYY-MM格式）。对于表格文件，请识别其中的财务数据；对于其他文件，请提取相关的财务信息：

{files_content}

基于以上数据，请进行以下分析并输出结构化JSON：

1. **收入/利润/净利润率趋势分析**：
   - 历史区间务必输出以下月份：{history_months_str}
   - 预测区间务必输出以下月份：{predict_months_str}
   - month字段必须严格等于上述区间的YYYY-MM
   - 输出line字段，包含历史和预测数据，字段：month（YYYY-MM格式）、收入、利润、净利润率

2. **现金流预测**：
   - bar字段历史区间务必输出所有上传的历史月份（YYYY-MM），预测区间为baseMonth后{predict_count}个月
   - 输出bar字段，字段：month（YYYY-MM格式）、余额
   - area字段历史区间务必输出所有上传的历史月份（YYYY-MM），预测区间为baseMonth后{predict_count}个月
   - 预测未来{predict_count}个月经营/投资/筹资活动现金流出占比
   - 输出area字段，字段：month（YYYY-MM格式）、经营、投资、筹资

3. **决策建议（必须包含，要求专业、详细、可操作）**：
   - **分析结论**：结合财务报表的主要指标（如收入、利润、净利润率、现金流等）和趋势，给出条理清晰、专业的分析结论，指出企业当前的经营状况、财务结构、成长性等。
   - **关键风险预警**：结合数据，具体指出潜在的财务风险点（如现金流断裂、盈利能力下滑、负债率过高、成本异常等），并说明预警理由。
   - **决策建议**：基于分析结论和风险预警，给出具体、可操作的改进措施或战略建议（如优化成本结构、加强现金流管理、调整投资策略、提升某项指标等），建议尽量量化目标或给出管理建议。

**重要要求**：
- 只输出JSON格式，不要任何解释文字
- month字段统一使用YYYY-MM格式
- 数值字段使用数字类型，金额单位为元
- 净利润率为小数形式（如0.2表示20%）
- 现金流占比为小数形式，总和为1.0
- **advice字段必须包含三个子字段，不能为空**
- 严格按照以下JSON结构输出：

{{
  "line": [
    {{"month": "2024-10", "收入": 1000000, "利润": 200000, "净利润率": 0.2}},
    {{"month": "2024-11", "收入": 1100000, "利润": 220000, "净利润率": 0.2}},
    {{"month": "2025-02", "收入": 1200000, "利润": 240000, "净利润率": 0.2}}
  ],
  "bar": [
    {{"month": "2025-02", "余额": 500000}},
    {{"month": "2025-03", "余额": 550000}},
    {{"month": "2025-04", "余额": 600000}}
  ],
  "area": [
    {{"month": "2025-02", "经营": 0.6, "投资": 0.3, "筹资": 0.1}},
    {{"month": "2025-03", "经营": 0.65, "投资": 0.25, "筹资": 0.1}},
    {{"month": "2025-04", "经营": 0.7, "投资": 0.2, "筹资": 0.1}}
  ],
  "advice": {{
    "分析结论": "基于历史数据分析，公司收入呈现稳定增长趋势，利润率保持稳定。",
    "关键风险预警": "需要关注现金流波动和季节性影响。",
    "决策建议": "建议加强现金流管理，优化投资结构。"
  }}
}}"""

    try:
        headers = {
            "Authorization": f"Bearer {DEEPSEEK_API_TOKEN}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "deepseek-chat",
            "messages": [
                {"role": "system", "content": "你是一个专业的财务分析师，擅长从各种格式的财务文件中提取关键信息并进行趋势分析和预测。请严格按照要求的JSON格式输出结果，不要添加任何解释文字。特别注意：advice字段必须包含分析结论、关键风险预警、决策建议三个子字段，不能为空。"},
                {"role": "user", "content": prompt}
            ],
            "stream": False,
            "temperature": 0.1,  # 降低温度以获得更稳定的输出
            "max_tokens": 4096   # 增加token限制以处理更多文件内容
        }
        resp = requests.post("https://api.deepseek.com/chat/completions", json=payload, headers=headers, timeout=120)
        print('DeepSeek原始返回:', resp.status_code, resp.text)
        resp_json = resp.json()
        if "choices" not in resp_json:
            print("DeepSeek返回异常:", resp_json)
            return jsonify({'error': f"AI分析失败: {resp_json.get('error', resp_json)}"}), 500
        ds_result = resp_json["choices"][0]["message"]["content"]
        print('大模型原始返回内容:', ds_result)
        
        # 健壮处理：去除代码块标记，自动提取第一个合法JSON对象
        ds_result = ds_result.strip()
        if ds_result.startswith('```'):
            ds_result = re.sub(r'^```[a-zA-Z]*\s*', '', ds_result)
            ds_result = re.sub(r'```$', '', ds_result)
            ds_result = ds_result.strip()
        
        try:
            result = json.loads(ds_result)
        except Exception:
            # 自动提取第一个合法JSON对象
            match = re.search(r'({[\s\S]*})', ds_result)
            if not match:
                match = re.search(r'(\[[\s\S]*\])', ds_result)
            if match:
                json_str = match.group(1)
                try:
                    result = json.loads(json_str)
                except Exception as e:
                    print('二次提取后解析失败:', e)
                    print('原始内容:', ds_result)
                    raise
            else:
                print('未找到合法JSON片段')
                print('原始内容:', ds_result)
                raise
        
        # 确保advice字段存在且不为空
        if 'advice' not in result or not result['advice']:
            result['advice'] = {
                "分析结论": "基于上传的财务数据进行分析，建议进一步补充更多历史数据以获得更准确的趋势分析。",
                "关键风险预警": "数据量有限，预测准确性可能受到影响，建议持续监控关键财务指标。",
                "决策建议": "建议增加数据收集频率，完善财务分析体系，定期进行财务健康检查。"
            }
        else:
            # 确保advice包含所有必需字段
            required_fields = ["分析结论", "关键风险预警", "决策建议"]
            for field in required_fields:
                if field not in result['advice'] or not result['advice'][field]:
                    result['advice'][field] = f"需要补充{field}内容"
        # 自动补全line的type字段，区分历史和预测
        if 'line' in result and isinstance(result['line'], list):
            uploaded_months = sorted([m for m in months_list if re.match(r'^\d{4}-\d{2}$', m)])
            last_history_month = uploaded_months[-1] if uploaded_months else None
            for item in result['line']:
                m = item.get('month')
                if not m or not re.match(r'^\d{4}-\d{2}$', m):
                    continue
                if last_history_month and m <= last_history_month:
                    item['type'] = 'history'
                else:
                    item['type'] = 'predict'
        
        # 分析结束后清理临时目录
        shutil.rmtree(user_folder)
        return jsonify(result)
    except Exception as e:
        print('大模型原始返回:', ds_result if 'ds_result' in locals() else '无')
        print(traceback.format_exc())
        return jsonify({'error': f'AI分析失败: {str(e)}', 'raw': ds_result if 'ds_result' in locals() else ''}), 500

@app.route('/api/upload', methods=['POST'])
def upload_file():
    month = request.args.get('month')
    files = request.files.getlist('file')
    if not files or not month or not UPLOAD_FOLDER:
        return jsonify({'error': 'No file, month or upload folder'}), 400
    
    # 验证月份格式（YYYY-MM）
    if not isinstance(month, str) or not re.match(r'^\d{4}-\d{2}$', month):
        return jsonify({'error': f'Invalid month format: {month}. Expected YYYY-MM format'}), 400
    
    assert isinstance(UPLOAD_FOLDER, str)
    month_folder = os.path.join(str(UPLOAD_FOLDER), str(month))
    os.makedirs(month_folder, exist_ok=True)
    for f in files:
        assert isinstance(month_folder, str)
        assert isinstance(f.filename, str)
        f.save(os.path.join(month_folder, f.filename))
    return jsonify({'success': True})

@app.route('/api/files', methods=['GET'])
def list_uploaded_files():
    result = {}
    if not os.path.exists(UPLOAD_FOLDER):
        return jsonify(result)
    for month in os.listdir(UPLOAD_FOLDER):
        month_folder = os.path.join(UPLOAD_FOLDER, month)
        if os.path.isdir(month_folder):
            files = []
            for fname in os.listdir(month_folder):
                fpath = os.path.join(month_folder, fname)
                if os.path.isfile(fpath):
                    files.append({
                        'name': fname,
                        'size': os.path.getsize(fpath),
                        'type': fname.split('.')[-1] if '.' in fname else ''
                    })
            result[month] = files
    return jsonify(result)

@app.route('/api/preview', methods=['GET'])
def preview_file():
    month = request.args.get('month')
    filename = request.args.get('filename')
    if not month or not filename:
        return jsonify({'error': 'No month or filename'}), 400
    
    # 验证月份格式（YYYY-MM）
    if not isinstance(month, str) or not re.match(r'^\d{4}-\d{2}$', month):
        return jsonify({'error': f'Invalid month format: {month}. Expected YYYY-MM format'}), 400
    
    fpath = os.path.join(UPLOAD_FOLDER, str(month), filename)
    if not os.path.exists(fpath):
        return jsonify({'error': 'File not found'}), 404
    ext = filename.rsplit('.', 1)[-1].lower()
    if ext in ['xlsx', 'xls', 'csv']:
        try:
            if ext == 'csv':
                df = pd.read_csv(fpath)
            else:
                df = pd.read_excel(fpath)
            data = df.head(20).fillna('').values.tolist()
            return jsonify(data)
        except Exception as e:
            return jsonify({'error': f'解析失败: {str(e)}'}), 400
    elif ext in ['png', 'jpg', 'jpeg', 'bmp', 'gif']:
        with open(fpath, 'rb') as f:
            b64 = base64.b64encode(f.read()).decode()
        return jsonify(f'data:image/{ext};base64,{b64}')
    else:
        return jsonify({'error': '暂不支持预览该类型'}), 400

@app.route('/api/delete', methods=['POST'])
def delete_file():
    month = request.args.get('month')
    filename = request.args.get('filename')
    if not month or not filename:
        return jsonify({'error': 'No month or filename'}), 400
    
    # 验证月份格式（YYYY-MM）
    if not isinstance(month, str) or not re.match(r'^\d{4}-\d{2}$', month):
        return jsonify({'error': f'Invalid month format: {month}. Expected YYYY-MM format'}), 400
    
    fpath = os.path.join(UPLOAD_FOLDER, str(month), filename)
    if os.path.exists(fpath):
        os.remove(fpath)
    return jsonify({'success': True})

@app.route('/api/clear_files', methods=['POST'])
def clear_all_files():
    if not os.path.exists(UPLOAD_FOLDER):
        return jsonify({'success': True})
    for month in os.listdir(UPLOAD_FOLDER):
        month_folder = os.path.join(UPLOAD_FOLDER, month)
        if os.path.isdir(month_folder):
            for fname in os.listdir(month_folder):
                fpath = os.path.join(month_folder, fname)
                if os.path.isfile(fpath):
                    os.remove(fpath)
            os.rmdir(month_folder)
    return jsonify({'success': True})

def analyze_month_logic(month):
    """分析指定月份的数据，返回结构化数据"""
    if not month:
        return None
    month_folder = os.path.join(str(UPLOAD_FOLDER), str(month))
    if not os.path.exists(month_folder):
        return None
    results = []
    for fname in os.listdir(month_folder):
        fpath = os.path.join(month_folder, fname)
        ext = fname.rsplit('.', 1)[-1].lower()
        try:
            if ext == 'csv':
                df = pd.read_csv(fpath)
            elif ext in ['xlsx', 'xls']:
                # 自动检测表头行：优先找包含“项目”和“金额”的行
                header_row = None
                for i in range(6):  # 前6行内查找
                    try:
                        row = pd.read_excel(fpath, header=None, nrows=1, skiprows=i).iloc[0].astype(str).tolist()
                        if any('项目' in c or '科目' in c or '摘要' in c for c in row) and any('金额' in c or '余额' in c or '收入' in c or '支出' in c for c in row):
                            header_row = i
                            break
                    except Exception as e:
                        continue
                if header_row is not None:
                    df = pd.read_excel(fpath, header=header_row)
                else:
                    df = pd.read_excel(fpath)  # 回退默认
            else:
                continue
            print(f'文件: {fname}, 表头: {df.columns.tolist()}')
            col_map = {}
            for col in df.columns:
                # 主体字段
                if any(key in str(col) for key in ['科目', '项目', '摘要', '资产', '负债', '所有者权益']):
                    col_map['subject'] = col
                # 金额字段
                if any(key in str(col) for key in ['金额', '余额', '收入', '支出', '本期金额', '本月金额', '本年金额', '上期金额', '上年同期']):
                    col_map['amount'] = col
                # 日期字段
                if any(key in str(col) for key in ['日期', '时间', '年', '月']):
                    col_map['date'] = col
            print(f'字段映射: {col_map}')
            if not col_map.get('subject') or not col_map.get('amount'):
                print('字段不全，跳过')
                continue
            for _, row in df.iterrows():
                subject = row.get(col_map['subject'], '')
                amount = row.get(col_map['amount'], '')
                date = row.get(col_map['date'], '') if col_map.get('date') else ''
                print(f'提取行: subject={subject}, amount={amount}, date={date}')
                # 只提取有amount的有效数据行
                if amount != '' and isinstance(amount, (int, float, str)):
                    try:
                        if not pd.isna(amount):
                            results.append({
                                'file': fname,
                                'subject': subject,
                                'amount': amount,
                                'date': date
                            })
                    except Exception as e:
                        print(f'判断amount isna出错: {e}, amount={amount}')
        except Exception as e:
            print(f'文件解析失败: {fpath}, 错误: {e}')
            continue
    print(f'分析结果条数: {len(results)}')
    return results

@app.route('/api/analyze', methods=['GET'])
def analyze_month():
    month = request.args.get('month')
    if not month:
        return jsonify({'error': 'No month'}), 400
    results = analyze_month_logic(month)
    if results is None:
        return jsonify({'error': 'No data for this month'}), 404
    return jsonify({'data': results})

if __name__ == '__main__':
    app.run(debug=True)