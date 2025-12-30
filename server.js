const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// === 配置区 ===
const ADMIN_PASSWORD = "admin"; 
const DATA_DIR = path.join(__dirname, 'user_data');
const CONFIG_FILE = path.join(__dirname, 'server_config.json');
const activeTasks = {}; 

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

app.use(cors());
app.use(cookieParser());
// 增加上传限制，防止大文件报错
app.use(express.json({ limit: '50mb' }));

// === 页面路由 ===
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/analysis', (req, res) => res.sendFile(path.join(__dirname, 'analysis.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// === 工具函数 ===
function getFilePath(uid) {
    if (!uid || !/^\d+$/.test(uid)) return null;
    return path.join(DATA_DIR, `${uid}.json`);
}

function getAIConfig() {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return null;
}

function extractUidFromCookie(cookieStr) {
    const match = cookieStr.match(/DedeUserID=(\d+)/);
    return match ? match[1] : null;
}

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.bilibili.com/'
};

// === 登录相关 ===
app.get('/get-qrcode', async (req, res) => {
    try {
        const response = await axios.get('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', { headers: HEADERS });
        const { url, qrcode_key } = response.data.data;
        const qrImage = await QRCode.toDataURL(url);
        res.json({ qrcode_key, qrImage });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.get('/check-login', async (req, res) => {
    const { qrcode_key } = req.query;
    try {
        const response = await axios.get(`https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${qrcode_key}`, { headers: HEADERS });
        const data = response.data.data;
        if (data.code === 0) {
            const cookies = response.headers['set-cookie'];
            const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');
            const uid = extractUidFromCookie(cookieStr);
            res.json({ status: 'success', cookie: cookieStr, uid: uid });
        } else {
            res.json({ status: 'pending', code: data.code, message: data.message });
        }
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// === 后台扫描逻辑 ===
async function runServerScan(uid, cookie) {
    console.log(`[${uid}] 开始后台扫描任务...`);
    const filePath = getFilePath(uid);
    let currentData = { list: [], cursor: null };
    if (fs.existsSync(filePath)) {
        try { currentData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch(e){}
    }

    activeTasks[uid] = { status: 'running', total: currentData.list.length, msg: '启动中...' };

    let cursor = currentData.cursor;
    const oneYearAgo = Date.now() / 1000 - (365 * 24 * 3600);
    let isFinished = false;

    try {
        while (activeTasks[uid] && activeTasks[uid].status === 'running') {
            let url = 'https://api.bilibili.com/x/web-interface/history/cursor?ps=20';
            if (cursor) url += `&view_at=${cursor.view_at}&business=${cursor.business}`;

            const res = await axios.get(url, { headers: { ...HEADERS, Cookie: cookie } });
            const data = res.data.data;

            if (!data.list || data.list.length === 0) {
                isFinished = true;
                activeTasks[uid].msg = '已到达记录尽头';
                break;
            }

            const newItems = [];
            for (const item of data.list) {
                if (item.history.business !== 'archive') continue;
                const bvid = item.history.bvid;
                try {
                    const viewRes = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { headers: { ...HEADERS, Cookie: cookie } });
                    const vData = viewRes.data.data;
                    newItems.push({
                        title: vData.title, desc: vData.desc, tags: [vData.tname, vData.dynamic].filter(Boolean).join(' '),
                        pic: vData.pic, bvid: bvid, author: vData.owner.name, view_at: item.view_at
                    });
                    const delay = Math.floor(Math.random() * 500) + 500;
                    await new Promise(r => setTimeout(r, delay));
                } catch (e) {
                    newItems.push({ title: item.title, desc: '', tags: '', pic: item.cover, bvid: bvid, author: item.author_name, view_at: item.view_at });
                }
            }

            currentData.list = currentData.list.concat(newItems);
            currentData.cursor = data.cursor;
            currentData.lastUpdated = Date.now();
            fs.writeFileSync(filePath, JSON.stringify(currentData));

            cursor = data.cursor;
            activeTasks[uid].total = currentData.list.length;
            const lastTime = newItems[newItems.length-1].view_at;
            activeTasks[uid].lastTime = lastTime;
            activeTasks[uid].msg = `正在获取: ${new Date(lastTime*1000).toLocaleDateString()}`;

            if (lastTime < oneYearAgo) {
                isFinished = true;
                activeTasks[uid].msg = '已完成一年数据扫描';
                break;
            }
        }
    } catch (err) {
        console.error(`[${uid}] 扫描出错:`, err.message);
        if (activeTasks[uid]) {
            activeTasks[uid].status = 'error';
            activeTasks[uid].msg = '扫描中断: ' + err.message;
        }
    } finally {
        if (activeTasks[uid] && activeTasks[uid].status === 'running') {
             activeTasks[uid].status = isFinished ? 'done' : 'stopped';
        }
        console.log(`[${uid}] 任务结束`);
    }
}

app.post('/start-scan', (req, res) => {
    const { uid, cookie } = req.body;
    if (!uid || !cookie) return res.status(400).json({ error: '缺少参数' });
    if (activeTasks[uid] && activeTasks[uid].status === 'running') return res.json({ success: true, msg: '任务已在运行中' });
    runServerScan(uid, cookie);
    res.json({ success: true, msg: '后台扫描已启动' });
});

app.post('/stop-scan', (req, res) => {
    const { uid } = req.body;
    if (activeTasks[uid]) activeTasks[uid].status = 'stopped';
    res.json({ success: true });
});

app.get('/scan-status', (req, res) => {
    const { uid } = req.query;
    const task = activeTasks[uid];
    let total = 0;
    let lastTime = 0;
    const fp = getFilePath(uid);
    if (fs.existsSync(fp)) {
        try {
            const d = JSON.parse(fs.readFileSync(fp));
            total = d.list.length;
            if (total > 0) lastTime = d.list[total-1].view_at;
        } catch(e){}
    }
    res.json({
        status: task ? task.status : 'idle',
        msg: task ? task.msg : '空闲',
        total: task ? task.total : total,
        lastTime: task ? task.lastTime : lastTime
    });
});

app.post('/load-data', (req, res) => {
    const { uid } = req.body;
    const fp = getFilePath(uid);
    if (fs.existsSync(fp)) res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
    else res.json({ list: [] });
});

app.get('/download-data', (req, res) => {
    const { uid } = req.query;
    const fp = getFilePath(uid);
    if (fs.existsSync(fp)) res.download(fp, `bilibili_history_${uid}.json`);
    else res.status(404).send('文件不存在');
});

// ==========================================
// 新增：上传数据接口
// ==========================================
app.post('/upload-data', (req, res) => {
    const { uid, data } = req.body;
    if (!uid || !data || !data.list) return res.status(400).json({ error: '数据格式错误' });
    
    const fp = getFilePath(uid);
    try {
        // 覆盖写入
        fs.writeFileSync(fp, JSON.stringify(data));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '写入失败' });
    }
});

app.post('/clear-data', (req, res) => {
    const { uid } = req.body;
    const fp = getFilePath(uid);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    if (activeTasks[uid]) delete activeTasks[uid];
    res.json({ success: true });
});

// === AI 接口 ===
app.post('/admin/save-config', (req, res) => { const { password, apiUrl, apiKey, model, systemPrompt } = req.body; if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: '密码错误' }); fs.writeFileSync(CONFIG_FILE, JSON.stringify({ apiUrl, apiKey, model, systemPrompt })); res.json({ success: true }); });
app.post('/admin/get-config', (req, res) => { const { password } = req.body; if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: '密码错误' }); const config = getAIConfig() || {}; res.json({ apiUrl: config.apiUrl || '', apiKey: config.apiKey || '', model: config.model || '', systemPrompt: config.systemPrompt || '' }); });

app.post('/analyze-user', async (req, res) => {
    const { videoData, stats } = req.body;
    const config = getAIConfig();
    if (!config || !config.apiKey) return res.status(500).json({ error: 'AI 未配置' });
    
    let targetUrl = config.apiUrl.trim();
    if (!targetUrl.endsWith('/chat/completions')) targetUrl = targetUrl.replace(/\/+$/, '') + '/chat/completions';
    
    const activeSystemPrompt = config.systemPrompt || "你是一个B站用户画像分析师...";
    let statsText = stats ? `【统计数据】\n总数:${stats.total}\n浓度:${stats.percentage}\n` : "";
    const userContent = `${statsText}\n【记录】:\n${videoData.slice(0, 80).map(v => `标题:${v.title}, Tag:${v.tags}`).join('\n')}`;

    try {
        const aiRes = await axios.post(targetUrl, {
            model: config.model,
            messages: [{ role: "system", content: activeSystemPrompt }, { role: "user", content: userContent }],
            temperature: 0.7
        }, { headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' } });
        const choice = aiRes.data.choices?.[0];
        res.json({ result: choice?.message?.content || choice?.text });
    } catch (error) { res.status(500).json({ error: 'AI Error' }); }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
