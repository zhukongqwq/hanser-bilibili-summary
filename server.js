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

// 默认提示词
const DEFAULT_SYSTEM_PROMPT = `你现在是一位**元气满满、有点小恶魔性格的二次元高中女生（JK）**，同时也是 B站的资深用户和 Hanser 的铁杆粉丝。你的任务是分析“前辈”（用户）的观看历史数据。

**【重要指令】**
我会在开头给你提供精准的【统计数据】（包括浓度百分比、各类视频数量）和【视频列表】。**请务必基于这些真实数据进行分析，不要凭空捏造！**

请输出一份 Markdown 格式的**“成分鉴定报告”**，语气要活泼、可爱、充满梗（如：好耶、寄、LSP、成分复杂、急了），多使用颜文字 \`(≧∇≦)ﾉ\`。

报告必须包含以下三个部分：

### 1. 🍰 成分大饼图 (文字版)
*   **必须引用我提供的【浓度百分比】**。
*   列出占比最高的 2-3 个分类，并配上一句简短的吐槽。

### 2. 🏷️ 核心关键词
*   提取 3-5 个最能代表前辈近期状态的 Tag，用 \`#\` 号开头。

### 3. 📝 JKの观察日记 (画像总结)
这是重点！请用**第一人称**（我）对前辈进行全方位的深度分析（吐槽）。
*   **鬼畜/MAD多**：调侃他是不是黑粉头子？
*   **翻唱/歌曲多**：夸奖前辈懂音乐。
*   **游戏实况多**：问问他是不是为了看板鸭/银狼受苦才来的？
*   **Cosplay/露脸多**：狠狠地“鄙视”一下前辈的动机（LSP！）。

**注意：**
*   称呼用户为 **“前辈”**。
*   结尾要有一个可爱的结束语。`;

const activeTasks = {}; 

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

app.use(cors());
app.use(cookieParser());
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

// === 增量更新扫描逻辑 ===
async function runServerScan(uid, cookie) {
    console.log(`[${uid}] 开始后台扫描任务...`);
    const filePath = getFilePath(uid);
    let localData = { list: [], cursor: null };
    if (fs.existsSync(filePath)) {
        try { localData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch(e){}
    }

    let latestLocalTime = 0;
    if (localData.list.length > 0) {
        latestLocalTime = localData.list[0].view_at || 0;
    }

    activeTasks[uid] = { status: 'running', total: localData.list.length, msg: '启动增量扫描...' };

    let cursor = null; 
    let isFinished = false;
    let newItemsBuffer = []; 

    try {
        while (activeTasks[uid] && activeTasks[uid].status === 'running') {
            let url = 'https://api.bilibili.com/x/web-interface/history/cursor?ps=20';
            if (cursor) url += `&view_at=${cursor.view_at}&business=${cursor.business}`;

            const res = await axios.get(url, { headers: { ...HEADERS, Cookie: cookie } });
            const data = res.data.data;

            if (!data.list || data.list.length === 0) {
                isFinished = true;
                activeTasks[uid].msg = 'B站已无更多记录';
                break;
            }

            let pageNewItems = [];
            let stopScanning = false;

            for (const item of data.list) {
                if (item.history.business !== 'archive') continue;
                if (item.view_at <= latestLocalTime) {
                    stopScanning = true;
                    isFinished = true;
                    break; 
                }

                const bvid = item.history.bvid;
                try {
                    const viewRes = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { headers: { ...HEADERS, Cookie: cookie } });
                    const vData = viewRes.data.data;
                    pageNewItems.push({
                        title: vData.title, desc: vData.desc, tags: [vData.tname, vData.dynamic].filter(Boolean).join(' '),
                        pic: vData.pic, bvid: bvid, author: vData.owner.name, view_at: item.view_at
                    });
                    const delay = Math.floor(Math.random() * 500) + 500;
                    await new Promise(r => setTimeout(r, delay));
                } catch (e) {
                    pageNewItems.push({ title: item.title, desc: '', tags: '', pic: item.cover, bvid: bvid, author: item.author_name, view_at: item.view_at });
                }
            }

            newItemsBuffer.push(...pageNewItems);

            if (pageNewItems.length > 0) {
                const lastTime = pageNewItems[pageNewItems.length - 1].view_at;
                activeTasks[uid].lastTime = lastTime;
                activeTasks[uid].msg = `获取新记录: ${new Date(lastTime * 1000).toLocaleDateString()}`;
            }

            // 保存数据 (保留原有的 ai_analysis 字段)
            const mergedList = newItemsBuffer.concat(localData.list);
            localData.list = mergedList;
            localData.lastUpdated = Date.now();
            
            // 注意：这里我们只更新 list 和 lastUpdated，不要覆盖 ai_analysis
            fs.writeFileSync(filePath, JSON.stringify(localData));
            
            activeTasks[uid].total = mergedList.length;

            if (stopScanning) {
                activeTasks[uid].msg = '增量更新完成！';
                break;
            }
            cursor = data.cursor;
        }
    } catch (err) {
        if (activeTasks[uid]) {
            activeTasks[uid].status = 'error';
            activeTasks[uid].msg = '扫描中断: ' + err.message;
        }
    } finally {
        if (activeTasks[uid] && activeTasks[uid].status === 'running') {
             activeTasks[uid].status = isFinished ? 'done' : 'stopped';
        }
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
            if (total > 0) lastTime = d.list[0].view_at;
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

app.post('/upload-data', (req, res) => {
    const { uid, data } = req.body;
    if (!uid || !data || !data.list) return res.status(400).json({ error: '数据格式错误' });
    const fp = getFilePath(uid);
    try {
        // 如果文件已存在，保留原有的 ai_analysis (如果上传的数据里没有的话)
        let oldData = {};
        if (fs.existsSync(fp)) {
             try { oldData = JSON.parse(fs.readFileSync(fp)); } catch(e){}
        }
        if (!data.ai_analysis && oldData.ai_analysis) {
            data.ai_analysis = oldData.ai_analysis;
        }
        fs.writeFileSync(fp, JSON.stringify(data));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: '写入失败' }); }
});

app.post('/clear-data', (req, res) => {
    const { uid } = req.body;
    const fp = getFilePath(uid);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    if (activeTasks[uid]) delete activeTasks[uid];
    res.json({ success: true });
});

app.post('/admin/save-config', (req, res) => { const { password, apiUrl, apiKey, model, systemPrompt } = req.body; if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: '密码错误' }); fs.writeFileSync(CONFIG_FILE, JSON.stringify({ apiUrl, apiKey, model, systemPrompt })); res.json({ success: true }); });
app.post('/admin/get-config', (req, res) => { const { password } = req.body; if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: '密码错误' }); const config = getAIConfig() || {}; res.json({ apiUrl: config.apiUrl || '', apiKey: config.apiKey || '', model: config.model || '', systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT }); });

// ==========================================
// 核心：AI 分析接口 (带缓存逻辑)
// ==========================================
app.post('/analyze-user', async (req, res) => {
    const { videoData, stats, uid } = req.body; // 新增 uid 参数
    const config = getAIConfig();
    if (!config || !config.apiKey) return res.status(500).json({ error: 'AI 未配置' });

    // 1. 生成本次数据的“指纹” (总数 + 命中数 + 最新视频时间)
    // 只要这三个变了，说明数据变了，需要重新分析
    const latestTime = videoData.length > 0 ? videoData[0].view_at : 0;
    const currentHash = `${stats.total}_${stats.matched}_${latestTime}`;

    // 2. 读取本地存档，检查缓存
    const filePath = getFilePath(uid);
    let localData = {};
    if (fs.existsSync(filePath)) {
        try { localData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch(e){}
    }

    // 3. 如果指纹匹配，直接返回缓存
    if (localData.ai_analysis && localData.ai_analysis.hash === currentHash) {
        console.log(`[${uid}] 命中 AI 缓存，跳过请求`);
        return res.json({ result: localData.ai_analysis.content, fromCache: true });
    }

    // 4. 调用 AI
    console.log(`[${uid}] 数据已变更，请求 AI API...`);
    let targetUrl = config.apiUrl.trim();
    if (!targetUrl.endsWith('/chat/completions')) targetUrl = targetUrl.replace(/\/+$/, '') + '/chat/completions';
    
    const activeSystemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    let statsText = stats ? `【统计数据】\n总数:${stats.total}\n浓度:${stats.percentage}\n细分:${JSON.stringify(stats.breakdown)}` : "";
    const userContent = `${statsText}\n【记录】:\n${videoData.slice(0, 80).map(v => `标题:${v.title}, Tag:${v.tags}`).join('\n')}`;

    try {
        const aiRes = await axios.post(targetUrl, {
            model: config.model,
            messages: [{ role: "system", content: activeSystemPrompt }, { role: "user", content: userContent }],
            temperature: 0.7
        }, { headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' } });
        
        const choice = aiRes.data.choices?.[0];
        const content = choice?.message?.content || choice?.text;

        // 5. 保存结果到本地文件
        if (content) {
            localData.ai_analysis = {
                hash: currentHash,
                content: content,
                timestamp: Date.now()
            };
            fs.writeFileSync(filePath, JSON.stringify(localData));
        }

        res.json({ result: content, fromCache: false });
    } catch (error) { res.status(500).json({ error: 'AI Error' }); }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
