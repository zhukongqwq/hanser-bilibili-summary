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
const ADMIN_PASSWORD = "admin"; // ⚠️ 请修改此密码
const DATA_DIR = path.join(__dirname, 'user_data');
const CONFIG_FILE = path.join(__dirname, 'server_config.json');

// 默认提示词 (兜底用)
const DEFAULT_SYSTEM_PROMPT = `你是一个B站用户画像分析师。请根据用户观看的Hanser相关视频列表（标题、Tag、简介），分析用户的偏好。
输出 Markdown 格式报告，包含：
1. **成分饼图**: 用文字描述各类型视频的比例。
2. **核心关键词**: 总结用户的兴趣点。
3. **画像总结**: 详细分析用户是喜欢鬼畜、翻唱、游戏实况、切片杂谈还是Cosplay。
请语言幽默风趣，适当玩梗。`;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));

// === 页面路由 ===
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/analysis', (req, res) => res.sendFile(path.join(__dirname, 'analysis.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// === 辅助函数 ===
function getUserFilePath(clientId) {
    if (!clientId || !/^[a-zA-Z0-9-]+$/.test(clientId)) return null;
    return path.join(DATA_DIR, `${clientId}.json`);
}

function getAIConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
    return null;
}

// === B站相关接口 (保持不变) ===
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.bilibili.com/'
};

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
            res.json({ status: 'success', cookie: cookieStr });
        } else {
            res.json({ status: 'pending', code: data.code, message: data.message });
        }
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

app.post('/get-history-page', async (req, res) => {
    const { cookie, cursor } = req.body;
    if (!cookie) return res.status(401).json({ error: '未登录' });
    try {
        let url = 'https://api.bilibili.com/x/web-interface/history/cursor?ps=20';
        if (cursor) url += `&view_at=${cursor.view_at}&business=${cursor.business}`;
        const historyRes = await axios.get(url, { headers: { ...HEADERS, Cookie: cookie } });
        const data = historyRes.data.data;
        if (!data.list) return res.json({ list: [], cursor: null });
        const results = [];
        for (const item of data.list) {
            if (item.history.business !== 'archive') continue;
            const bvid = item.history.bvid;
            try {
                const viewRes = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { headers: { ...HEADERS, Cookie: cookie } });
                const vData = viewRes.data.data;
                results.push({
                    title: vData.title, desc: vData.desc, tags: [vData.tname, vData.dynamic].filter(Boolean).join(' '),
                    pic: vData.pic, bvid: bvid, author: vData.owner.name, view_at: item.view_at
                });
                await new Promise(r => setTimeout(r, 100));
            } catch (e) {
                results.push({ title: item.title, desc: '', tags: '', pic: item.cover, bvid: bvid, author: item.author_name, view_at: item.view_at });
            }
        }
        res.json({ list: results, cursor: data.cursor });
    } catch (error) { res.status(500).json({ error: 'API Error' }); }
});

// === 数据存储接口 ===
app.post('/load-progress', (req, res) => {
    const { clientId } = req.body;
    const fp = getUserFilePath(clientId);
    if (fp && fs.existsSync(fp)) res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
    else res.json({ list: [], cursor: null });
});

app.post('/save-batch', (req, res) => {
    const { newItems, cursor, clientId } = req.body;
    const fp = getUserFilePath(clientId);
    if (!fp) return res.status(400);
    let d = { list: [], cursor: null, lastUpdated: Date.now() };
    if (fs.existsSync(fp)) try { d = JSON.parse(fs.readFileSync(fp)); } catch (e) {}
    d.list = d.list.concat(newItems); d.cursor = cursor; d.lastUpdated = Date.now();
    fs.writeFileSync(fp, JSON.stringify(d));
    res.json({ success: true });
});

app.post('/clear-data', (req, res) => {
    const { clientId } = req.body;
    const fp = getUserFilePath(clientId);
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    res.json({ success: true });
});

// === 管理员接口 (修改：增加 systemPrompt) ===
app.post('/admin/save-config', (req, res) => {
    const { password, apiUrl, apiKey, model, systemPrompt } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: '密码错误' });
    
    // 保存配置到文件
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ apiUrl, apiKey, model, systemPrompt }));
    res.json({ success: true });
});

// 新增：获取当前配置（用于回显到前端，不返回密码）
app.post('/admin/get-config', (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: '密码错误' });
    
    const config = getAIConfig() || {};
    res.json({ 
        apiUrl: config.apiUrl || '', 
        apiKey: config.apiKey || '', 
        model: config.model || '', 
        systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT 
    });
});

// === AI 分析接口 (修改：使用自定义 Prompt) ===
app.post('/analyze-user', async (req, res) => {
    const { videoData } = req.body;
    const config = getAIConfig();

    if (!config || !config.apiKey) return res.status(500).json({ error: 'AI 未配置' });

    // 智能修正 URL
    let targetUrl = config.apiUrl.trim();
    if (!targetUrl.endsWith('/chat/completions')) {
        targetUrl = targetUrl.replace(/\/+$/, '') + '/chat/completions';
    }

    // 【关键修改】使用配置中的 Prompt，如果没有则使用默认值
    const activeSystemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;

    const userContent = videoData.slice(0, 80).map(v => `标题:${v.title}, Tag:${v.tags}, 简介:${v.desc.substring(0, 50)}`).join('\n');

    try {
        const aiRes = await axios.post(targetUrl, {
            model: config.model,
            messages: [
                { role: "system", content: activeSystemPrompt },
                { role: "user", content: userContent }
            ],
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const choice = aiRes.data.choices?.[0];
        const content = choice?.message?.content || choice?.text || JSON.stringify(aiRes.data);
        res.json({ result: content });

    } catch (error) {
        console.error('AI Error:', error.message);
        if (error.response) return res.status(500).json({ error: `AI 报错: ${JSON.stringify(error.response.data)}` });
        res.status(500).json({ error: 'AI 服务连接失败' });
    }
});

// 定时清理
setInterval(() => {
    fs.readdir(DATA_DIR, (err, files) => {
        if (err) return;
        const now = Date.now();
        files.forEach(file => {
            const fp = path.join(DATA_DIR, file);
            fs.stat(fp, (err, stats) => {
                if (!err && (now - stats.mtimeMs > 24 * 3600 * 1000)) fs.unlink(fp, () => {});
            });
        });
    });
}, 3600 * 1000);

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
