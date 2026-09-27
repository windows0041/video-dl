// 视频下载器 - 本地服务器(零依赖,仅需 Node.js;跨 Windows / Linux)
// 启动: node server.mjs   访问: http://127.0.0.1:8734
// 环境变量: PORT(默认 8734)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DOWNLOADS = path.join(ROOT, 'downloads');
const TMP = path.join(ROOT, 'tmp');
const IS_WIN = process.platform === 'win32';
const PORT = Number(process.env.PORT || 8734);
fs.mkdirSync(DOWNLOADS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

// ---------- 工具定位 ----------
// Windows: 固定用 tools\ 下的 .exe
// Linux:   优先 tools\ 下的同名文件(便于本地部署),不存在则用系统 PATH 里的
function resolveTool(localName, systemName) {
  if (IS_WIN) {
    const p = path.join(ROOT, 'tools', localName);
    return fs.existsSync(p) ? p : systemName;
  }
  const p = path.join(ROOT, 'tools', localName);
  if (fs.existsSync(p)) return p;
  return systemName; // 依赖 PATH
}

const YTDLP = resolveTool(IS_WIN ? 'yt-dlp.exe' : 'yt-dlp', 'yt-dlp');
const FFMPEG = resolveTool(IS_WIN ? 'ffmpeg.exe' : 'ffmpeg', 'ffmpeg');
// 本地 tools/ 里有 ffmpeg 才指定 --ffmpeg-location,否则走系统 PATH
const USE_LOCAL_FFMPEG = fs.existsSync(path.join(ROOT, 'tools', IS_WIN ? 'ffmpeg.exe' : 'ffmpeg'));

const QUALITIES = {
  best: ['bv*+ba/b', true],
  '1080p': ['bv*[height<=1080]+ba/b', true],
  '720p': ['bv*[height<=720]+ba/b', true],
  '480p': ['bv*[height<=480]+ba/b', true],
  audio: ['ba/b', false],
};

const state = {
  running: false,
  pid: null,
  jobName: '',
  lines: [],       // 日志缓冲(最近 400 行)
  sse: new Set(),  // SSE 客户端
};

function log(line) {
  state.lines.push(line);
  if (state.lines.length > 400) state.lines.shift();
  for (const res of state.sse) {
    try { res.write(`data: ${JSON.stringify({ type: 'log', line })}\n\n`); } catch {}
  }
}

function broadcastStatus() {
  const s = { type: 'status', running: state.running, job: state.jobName, fileCount: fs.readdirSync(DOWNLOADS).filter(f => !f.startsWith('.')).length };
  for (const res of state.sse) {
    try { res.write(`data: ${JSON.stringify(s)}\n\n`); } catch {}
  }
}

function startJob({ urls, cookie, quality, fromBrowser, proxy }) {
  if (state.running) return { ok: false, error: '已有任务正在下载,请等待完成或先停止' };
  const q = QUALITIES[quality] || QUALITIES.best;
  const args = [
    '--no-playlist',
    '-f', q[0],
    '-P', DOWNLOADS,
    '-o', '%(title).60B s [%(id)s].%(ext)s',
    '--no-simulate',
    '--retries', '20',
    '--socket-timeout', '30',
  ];
  if (USE_LOCAL_FFMPEG) args.push('--ffmpeg-location', FFMPEG);
  if (q[1]) args.push('--merge-output-format', 'mp4');
  if (fromBrowser === 'edge') args.push('--cookies-from-browser', 'edge');
  const ck = (cookie || '').trim().replace(/^cookie\s*:\s*/i, '');
  if (ck) args.push('--add-header', `Cookie: ${ck}`);
  const px = (proxy || '').trim();
  if (px) args.push('--proxy', px);
  args.push(...urls);

  state.running = true;
  state.jobName = urls[0];
  log('$ ' + args.map(a => a.startsWith('Cookie:') ? '"Cookie: ***"' : a).join(' '));
  broadcastStatus();

  const env = { ...process.env };
  if (IS_WIN) {
    env.PYTHONUTF8 = '1'; // Windows 下 yt-dlp.exe(PyInstaller)输出 UTF-8
    env.TEMP = TMP; env.TMP = TMP;
  }

  // Linux 下用独立进程组,方便一次性杀掉 yt-dlp 和它拉起的 ffmpeg 子进程
  const child = spawn(YTDLP, args, {
    cwd: TMP,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !IS_WIN,
  });
  state.pid = child.pid;
  if (!IS_WIN) child.unref();

  const onData = (buf) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (line.trim()) log(line);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => {
    log(`[错误] 无法启动 ${YTDLP}: ${e.message}`);
    state.running = false; state.pid = null;
    broadcastStatus();
  });
  child.on('close', (code) => {
    log(code === 0 ? '=== 完成 (exit 0) ===' : `=== 结束 (exit ${code}),查看上方日志定位问题 ===`);
    state.running = false;
    state.pid = null;
    broadcastStatus();
  });
  return { ok: true, pid: child.pid };
}

function stopJob() {
  if (!state.pid) return { ok: false, error: '当前没有运行中的任务' };
  const pid = state.pid;
  if (IS_WIN) {
    spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
  } else {
    // 杀整个进程组(yt-dlp + ffmpeg)
    try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} }
  }
  log(`[手动停止] 已发送终止信号 (PID ${pid})`);
  return { ok: true };
}

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const send = (code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  try {
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      return send(200, fs.readFileSync(path.join(PUBLIC_DIR, 'index.html')), 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && u.pathname === '/api/status') {
      const files = fs.readdirSync(DOWNLOADS).filter(f => !f.startsWith('.'))
        .map(f => { const st = fs.statSync(path.join(DOWNLOADS, f)); return { name: f, size: st.size, mtime: st.mtimeMs }; })
        .sort((a, b) => b.mtime - a.mtime);
      return send(200, JSON.stringify({ running: state.running, job: state.jobName, files, tools: { ytDlp: fs.existsSync(YTDLP) || !IS_WIN, ffmpeg: fs.existsSync(FFMPEG) || !IS_WIN }, platform: process.platform }));
    }

    if (req.method === 'POST' && u.pathname === '/api/download') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const { urls, cookie, quality, fromBrowser, proxy } = JSON.parse(body || '{}');
          const list = (Array.isArray(urls) ? urls : String(urls || '').split(/\r?\n/))
            .map(s => s.trim()).filter(Boolean);
          if (!list.length) return send(400, JSON.stringify({ ok: false, error: '请粘贴至少一个视频链接' }));
          return send(200, JSON.stringify(startJob({ urls: list, cookie, quality, fromBrowser, proxy })));
        } catch (e) {
          return send(400, JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && u.pathname === '/api/stop') {
      return send(200, JSON.stringify(stopJob()));
    }

    if (req.method === 'GET' && u.pathname === '/api/logs') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'connection': 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'init', lines: state.lines.slice(-150), running: state.running, job: state.jobName })}\n\n`);
      state.sse.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
      req.on('close', () => { clearInterval(ping); state.sse.delete(res); });
      return;
    }

    if (req.method === 'GET' && u.pathname === '/api/file') {
      const name = u.searchParams.get('name');
      const safe = (name || '').replace(/^.*[\\/]/, '');
      const fp = path.join(DOWNLOADS, safe);
      if (!fs.existsSync(fp)) return send(404, JSON.stringify({ error: '文件不存在' }));
      const st = fs.statSync(fp);
      res.writeHead(200, {
        'content-type': safe.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream',
        'content-length': st.size,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safe)}`,
      });
      fs.createReadStream(fp).pipe(res);
      return;
    }

    if (req.method === 'POST' && u.pathname === '/api/openfolder') {
      const opener = IS_WIN ? ['explorer', [DOWNLOADS]] : ['xdg-open', [DOWNLOADS]];
      spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).unref();
      return send(200, JSON.stringify({ ok: true }));
    }

    if (req.method === 'POST' && u.pathname === '/api/shutdown') {
      send(200, JSON.stringify({ ok: true }));
      setTimeout(() => process.exit(0), 300);
      return;
    }

    send(404, JSON.stringify({ error: 'not found' }));
  } catch (e) {
    send(500, JSON.stringify({ error: e.message }));
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`端口 ${PORT} 已被占用 —— 下载器应该已经在运行,请直接打开 http://127.0.0.1:${PORT}`);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║        视 频 下 载 器 已 启 动         ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log(`  本机访问:    http://127.0.0.1:${PORT}`);
  console.log(`  局域网访问:  http://<本机IP>:${PORT}`);
  console.log(`  下载目录:    ${DOWNLOADS}`);
  console.log(`  平台:        ${process.platform}`);
  console.log(`  yt-dlp:      ${fs.existsSync(YTDLP) ? YTDLP : '(使用系统 PATH: yt-dlp)'}`);
  console.log(`  ffmpeg:      ${USE_LOCAL_FFMPEG ? FFMPEG : '(使用系统 PATH: ffmpeg)'}`);
  console.log('  关闭本窗口或点页面"关闭服务器"即可停止。');
  console.log('');
});
