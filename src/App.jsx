import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Play, Pause, Square, BarChart2, Clock, Settings, 
  Home, Trash2, Download, Upload, AlertCircle, 
  CheckCircle2, ChevronRight, PieChart, Smartphone
} from 'lucide-react';

// --- 配置常量 ---
const CATEGORIES = ['申论上课', '申论写作', '晨读', '行测刷题', '行测系统课'];
const MODES = {
  NORMAL: 'normal',
  COUNTDOWN_30: 'countdown30'
};
const COUNTDOWN_MINUTES = 30;
const COUNTDOWN_SECONDS = COUNTDOWN_MINUTES * 60;

// --- IndexedDB 本地数据库封装 ---
const DB_NAME = 'FocusAppDB';
const STORE_NAME = 'sessions';
const DB_VERSION = 1;

const db = {
  async getDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  },
  async getAll() {
    const database = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },
  async add(session) {
    const database = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(session);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },
  async delete(id) {
    const database = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },
  async clearAllAndInsert(sessions) {
    const database = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.clear().onsuccess = () => {
        let count = 0;
        if (sessions.length === 0) resolve();
        sessions.forEach(session => {
          store.add(session).onsuccess = () => {
            count++;
            if (count === sessions.length) resolve();
          };
        });
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }
};

// --- 工具函数 ---
const formatTime = (totalSeconds, isCountdown = false) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  
  if (isCountdown && h === 0) {
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const getTodayString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function App() {
  // --- 状态管理 ---
  const [activeTab, setActiveTab] = useState('home'); // home, history, stats, settings
  const [sessions, setSessions] = useState([]);
  
  // PWA 及离线状态
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState(null);

  // 计时器核心状态
  const [timerState, setTimerState] = useState({
    status: 'idle', // idle, running, paused
    category: '',
    mode: '',
    startTimestamp: null,
    accumulatedPauseMs: 0,
    lastPauseTimestamp: null,
  });
  
  // 用于显示的秒数
  const [displaySeconds, setDisplaySeconds] = useState(0);
  
  // 倒计时结束弹窗
  const [showTimeUpModal, setShowTimeUpModal] = useState(false);

  // --- 初始化加载数据 ---
  useEffect(() => {
    loadSessions();

    // 注册 Service Worker (用于离线缓存)
    if ('serviceWorker' in navigator) {
      // 检查协议，防止在 blob: 或沙盒预览环境中引发 TypeError
      if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
          console.warn('Service Worker 注册失败 (可能是因为预览环境):', err);
        });
      }
    }

    // 监听网络状态
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 监听 PWA 安装事件
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const loadSessions = async () => {
    try {
      const data = await db.getAll();
      data.sort((a, b) => b.startTime - a.startTime);
      setSessions(data);
    } catch (error) {
      console.error("加载数据失败:", error);
    }
  };

  // --- 计时器逻辑 (处理防休眠) ---
  useEffect(() => {
    let interval;
    if (timerState.status === 'running') {
      interval = setInterval(() => {
        const now = Date.now();
        const elapsedMs = now - timerState.startTimestamp - timerState.accumulatedPauseMs;
        let currentSeconds = Math.floor(elapsedMs / 1000);
        
        // 倒计时模式处理
        if (timerState.mode === MODES.COUNTDOWN_30) {
          if (currentSeconds >= COUNTDOWN_SECONDS) {
            currentSeconds = COUNTDOWN_SECONDS;
            handleEndSession(true); // 自动结束
            setShowTimeUpModal(true);
          }
        }
        setDisplaySeconds(currentSeconds);
      }, 500);
    }
    return () => clearInterval(interval);
  }, [timerState]);

  // --- 防误触：离开页面警告 ---
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (timerState.status !== 'idle') {
        e.preventDefault();
        e.returnValue = '您当前正在专注中，确定要离开吗？进度将会丢失。';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [timerState.status]);

  // --- 操作函数 ---
  const startTimer = () => {
    if (!timerState.category || !timerState.mode) return;
    setTimerState(prev => ({
      ...prev,
      status: 'running',
      startTimestamp: Date.now(),
      accumulatedPauseMs: 0,
      lastPauseTimestamp: null,
    }));
    setDisplaySeconds(0);
  };

  const pauseTimer = () => {
    setTimerState(prev => ({
      ...prev,
      status: 'paused',
      lastPauseTimestamp: Date.now(),
    }));
  };

  const resumeTimer = () => {
    setTimerState(prev => ({
      ...prev,
      status: 'running',
      accumulatedPauseMs: prev.accumulatedPauseMs + (Date.now() - prev.lastPauseTimestamp),
      lastPauseTimestamp: null,
    }));
  };

  const handleEndSession = async (isAutoEnd = false) => {
    const finalDuration = isAutoEnd && timerState.mode === MODES.COUNTDOWN_30 
      ? COUNTDOWN_SECONDS 
      : displaySeconds;

    if (finalDuration > 0) {
      const newSession = {
        id: Date.now().toString(),
        category: timerState.category,
        mode: timerState.mode,
        startTime: timerState.startTimestamp,
        endTime: Date.now(),
        duration: finalDuration,
        date: getTodayString()
      };
      
      try {
        await db.add(newSession);
        await loadSessions();
      } catch (err) {
        alert("保存记录失败！");
      }
    }

    setTimerState({
      status: 'idle',
      category: '',
      mode: '',
      startTimestamp: null,
      accumulatedPauseMs: 0,
      lastPauseTimestamp: null,
    });
    setDisplaySeconds(0);
  };

  const confirmDelete = async (id) => {
    if (window.confirm("确定要删除这条记录吗？")) {
      await db.delete(id);
      loadSessions();
    }
  };

  const exportData = () => {
    const dataStr = JSON.stringify(sessions, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `focus_backup_${getTodayString()}.json`;
    
    let linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const importData = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const importedSessions = JSON.parse(e.target.result);
        if (!Array.isArray(importedSessions)) throw new Error("无效的数据格式");
        
        if (window.confirm(`确认导入 ${importedSessions.length} 条记录吗？这将覆盖当前所有本地数据！`)) {
          await db.clearAllAndInsert(importedSessions);
          await loadSessions();
          alert("导入成功！");
        }
      } catch (err) {
        alert("导入失败：请确保文件是正确的 JSON 备份文件。");
      }
    };
    reader.readAsText(file);
    event.target.value = null;
  };

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  // --- 统计数据计算 ---
  const stats = useMemo(() => {
    const today = getTodayString();
    const todaySessions = sessions.filter(s => s.date === today);
    
    const todayTotal = todaySessions.reduce((acc, curr) => acc + curr.duration, 0);
    const historyTotal = sessions.reduce((acc, curr) => acc + curr.duration, 0);
    const todayCount = todaySessions.length;
    const todayLongest = todaySessions.length > 0 ? Math.max(...todaySessions.map(s => s.duration)) : 0;

    const categoryStats = CATEGORIES.map(cat => {
      const catSessions = sessions.filter(s => s.category === cat);
      const catTodaySessions = todaySessions.filter(s => s.category === cat);
      return {
        name: cat,
        totalTime: catSessions.reduce((acc, curr) => acc + curr.duration, 0),
        todayTime: catTodaySessions.reduce((acc, curr) => acc + curr.duration, 0),
      };
    });

    return { todayTotal, historyTotal, todayCount, todayLongest, categoryStats, todaySessions };
  }, [sessions]);


  // --- 渲染辅助组件 ---
  
  const renderNav = () => (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-slate-200 md:top-0 md:bottom-auto md:border-t-0 md:border-b flex justify-around md:justify-center md:gap-10 p-2 z-40 safe-area-pb shadow-sm">
      {[
        { id: 'home', icon: Home, label: '计时' },
        { id: 'stats', icon: PieChart, label: '统计' },
        { id: 'history', icon: Clock, label: '历史' },
        { id: 'settings', icon: Settings, label: '设置' },
      ].map(item => (
        <button
          key={item.id}
          onClick={() => timerState.status === 'idle' && setActiveTab(item.id)}
          disabled={timerState.status !== 'idle'}
          className={`flex flex-col md:flex-row items-center gap-1.5 p-3 rounded-xl transition-all duration-200
            ${activeTab === item.id ? 'text-blue-600 bg-blue-50/50 font-semibold' : 'text-slate-500 hover:bg-slate-100/50 hover:text-slate-800'}
            ${timerState.status !== 'idle' && activeTab !== 'home' ? 'opacity-30 cursor-not-allowed' : ''}
          `}
        >
          <item.icon size={24} className={activeTab === item.id ? 'fill-blue-100/30' : ''} />
          <span className="text-[11px] md:text-sm">{item.label}</span>
        </button>
      ))}
    </nav>
  );

  const renderHome = () => {
    const isRunning = timerState.status !== 'idle';
    let displayTimeStr = "00:00:00";
    if (timerState.mode === MODES.COUNTDOWN_30) {
      const remaining = Math.max(0, COUNTDOWN_SECONDS - displaySeconds);
      displayTimeStr = formatTime(remaining, true);
    } else {
      displayTimeStr = formatTime(displaySeconds);
    }

    if (isRunning) {
      return (
        <div className="flex flex-col items-center justify-center h-[calc(100vh-140px)] min-h-[450px] animate-in fade-in zoom-in-95 duration-300">
          <div className="text-slate-600 mb-8 flex items-center gap-2.5 bg-white border border-slate-200 shadow-sm px-5 py-2.5 rounded-full text-sm font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shadow-md shadow-blue-500/40"></span>
            {timerState.category} · {timerState.mode === MODES.NORMAL ? '普通模式' : '30分钟限时'}
          </div>
          
          <div className={`text-7xl sm:text-8xl md:text-9xl font-light tracking-wider mb-20 tabular-nums
            ${timerState.status === 'paused' ? 'text-slate-300' : 'text-slate-800 drop-shadow-sm'}`}>
            {displayTimeStr}
          </div>
          
          <div className="flex items-center gap-8 sm:gap-12">
            {timerState.status === 'running' ? (
              <button onClick={pauseTimer} className="w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center rounded-full bg-amber-100 text-amber-600 shadow-xl shadow-amber-200/50 hover:bg-amber-200 active:scale-95 transition-all">
                <Pause size={32} />
              </button>
            ) : (
              <button onClick={resumeTimer} className="w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center rounded-full bg-blue-100 text-blue-600 shadow-xl shadow-blue-200/50 hover:bg-blue-200 active:scale-95 transition-all">
                <Play size={32} className="ml-1" />
              </button>
            )}
            
            <button onClick={() => handleEndSession(false)} className="w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center rounded-full bg-rose-100 text-rose-600 shadow-xl shadow-rose-200/50 hover:bg-rose-200 active:scale-95 transition-all">
              <Square size={28} />
            </button>
          </div>
          
          {timerState.status === 'paused' && (
            <p className="mt-10 text-slate-400 text-sm animate-pulse tracking-widest uppercase">已暂停</p>
          )}
        </div>
      );
    }

    return (
      <div className="max-w-2xl mx-auto space-y-8 pb-20 mt-4 md:mt-10">
        <section className="bg-white rounded-3xl p-7 shadow-sm shadow-slate-200/50 border border-slate-100">
          <h2 className="text-base font-bold text-slate-800 mb-5 flex items-center gap-2">
            <span className="bg-slate-100 text-slate-500 w-7 h-7 rounded-full flex items-center justify-center text-xs">1</span>
            选择分类
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setTimerState(p => ({ ...p, category: cat }))}
                className={`py-3.5 px-4 rounded-2xl text-sm font-medium transition-all border
                  ${timerState.category === cat 
                    ? 'border-blue-500 bg-blue-500 text-white shadow-md shadow-blue-500/20' 
                    : 'border-slate-200 bg-slate-50/50 text-slate-600 hover:border-slate-300 hover:bg-slate-100'}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </section>

        <section className={`bg-white rounded-3xl p-7 shadow-sm shadow-slate-200/50 border border-slate-100 transition-all duration-300 ${!timerState.category ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
          <h2 className="text-base font-bold text-slate-800 mb-5 flex items-center gap-2">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${timerState.category ? 'bg-slate-100 text-slate-500' : 'bg-slate-50 text-slate-300'}`}>2</span>
            选择模式
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => setTimerState(p => ({ ...p, mode: MODES.NORMAL }))}
              className={`p-5 rounded-2xl flex items-start gap-4 transition-all border text-left group
                ${timerState.mode === MODES.NORMAL ? 'border-blue-500 bg-blue-50 shadow-md shadow-blue-500/10' : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/30'}`}
            >
              <div className={`p-2.5 rounded-xl transition-colors ${timerState.mode === MODES.NORMAL ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400 group-hover:text-blue-500'}`}>
                <Clock size={22} />
              </div>
              <div>
                <div className={`font-bold mb-1.5 ${timerState.mode === MODES.NORMAL ? 'text-blue-900' : 'text-slate-700'}`}>普通模式</div>
                <div className={`text-xs leading-relaxed ${timerState.mode === MODES.NORMAL ? 'text-blue-700/80' : 'text-slate-500'}`}>正向计时，适合自由探索和长时间沉浸。</div>
              </div>
            </button>
            
            <button
              onClick={() => setTimerState(p => ({ ...p, mode: MODES.COUNTDOWN_30 }))}
              className={`p-5 rounded-2xl flex items-start gap-4 transition-all border text-left group
                ${timerState.mode === MODES.COUNTDOWN_30 ? 'border-blue-500 bg-blue-50 shadow-md shadow-blue-500/10' : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/30'}`}
            >
              <div className={`p-2.5 rounded-xl transition-colors ${timerState.mode === MODES.COUNTDOWN_30 ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400 group-hover:text-blue-500'}`}>
                <Square size={22} />
              </div>
              <div>
                <div className={`font-bold mb-1.5 ${timerState.mode === MODES.COUNTDOWN_30 ? 'text-blue-900' : 'text-slate-700'}`}>30分钟限时</div>
                <div className={`text-xs leading-relaxed ${timerState.mode === MODES.COUNTDOWN_30 ? 'text-blue-700/80' : 'text-slate-500'}`}>倒计时 30 分钟，适合番茄工作法和刻意练习。</div>
              </div>
            </button>
          </div>
        </section>

        <div className="pt-6 pb-10 flex justify-center">
          <button
            onClick={startTimer}
            disabled={!timerState.category || !timerState.mode}
            className={`flex items-center gap-3 px-14 py-4.5 rounded-full text-lg font-bold transition-all active:scale-95
              ${(!timerState.category || !timerState.mode)
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                : 'bg-blue-600 text-white hover:bg-blue-500 shadow-xl shadow-blue-600/30'}`}
          >
            <Play size={24} className={(!timerState.category || !timerState.mode) ? '' : 'fill-white'} />
            开始专注
          </button>
        </div>

        {sessions.length > 0 && (
          <section className="bg-white rounded-3xl p-7 shadow-sm shadow-slate-200/50 border border-slate-100">
            <h3 className="text-sm font-bold text-slate-400 mb-5 uppercase tracking-wider flex items-center gap-2">今日概览</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-100">
                <div className="text-2xl font-bold text-slate-800 mb-1">{formatTime(stats.todayTotal)}</div>
                <div className="text-xs text-slate-500 font-medium">今日总时长</div>
              </div>
              <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-100">
                <div className="text-2xl font-bold text-slate-800 mb-1">{stats.todayCount} <span className="text-sm font-normal text-slate-500">次</span></div>
                <div className="text-xs text-slate-500 font-medium">专注次数</div>
              </div>
              <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-100">
                <div className="text-2xl font-bold text-slate-800 mb-1">{formatTime(stats.todayLongest)}</div>
                <div className="text-xs text-slate-500 font-medium">最长单次</div>
              </div>
              <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-100 hidden md:block">
                <div className="text-2xl font-bold text-slate-800 mb-1">{formatTime(stats.historyTotal)}</div>
                <div className="text-xs text-slate-500 font-medium">历史累计</div>
              </div>
            </div>
          </section>
        )}
      </div>
    );
  };

  const renderStats = () => {
    const maxCatTime = Math.max(...stats.categoryStats.map(c => c.totalTime), 1); 
    
    return (
      <div className="max-w-2xl mx-auto space-y-6 pb-20 mt-4 md:mt-10 animate-in fade-in">
        <h2 className="text-2xl font-bold text-slate-800 pt-2 mb-8">数据统计</h2>
        
        <div className="grid grid-cols-2 gap-5">
          <div className="bg-blue-600 text-white p-6 rounded-3xl shadow-lg shadow-blue-600/20">
            <div className="text-blue-100 text-sm mb-3 font-medium">今日累计</div>
            <div className="text-3xl font-bold tracking-tight">{formatTime(stats.todayTotal)}</div>
          </div>
          <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm">
            <div className="text-slate-500 text-sm mb-3 font-medium">历史累计</div>
            <div className="text-3xl font-bold text-slate-800 tracking-tight">{formatTime(stats.historyTotal)}</div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-7 shadow-sm shadow-slate-200/50 border border-slate-100 mt-8">
          <h3 className="text-base font-bold text-slate-800 mb-7">分类占比分布</h3>
          <div className="space-y-7">
            {stats.categoryStats.map((cat, index) => {
              const percent = (cat.totalTime / maxCatTime) * 100;
              return (
                <div key={index}>
                  <div className="flex justify-between text-sm mb-3">
                    <span className="font-bold text-slate-700">{cat.name}</span>
                    <span className="text-slate-500 tabular-nums text-xs">今日: {formatTime(cat.todayTime)} / 总计: {formatTime(cat.totalTime)}</span>
                  </div>
                  <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-out relative"
                      style={{ width: `${percent}%` }}
                    >
                      <div className="absolute inset-0 bg-white/20"></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderHistory = () => (
    <div className="max-w-2xl mx-auto pb-20 mt-4 md:mt-10 animate-in fade-in">
      <h2 className="text-2xl font-bold text-slate-800 pt-2 mb-8">专注历史</h2>
      
      {sessions.length === 0 ? (
        <div className="text-center py-24 text-slate-400 bg-white rounded-3xl border border-slate-100 border-dashed">
          <Clock size={56} className="mx-auto mb-5 opacity-20" />
          <p className="font-medium">还没有记录，去开始第一次专注吧</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sessions.map(session => (
            <div key={session.id} className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm flex items-center justify-between hover:border-blue-200 hover:shadow-md transition-all group">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-bold text-slate-800">{session.category}</span>
                  <span className="text-[10px] px-2.5 py-1 rounded-md bg-slate-100 text-slate-500 font-medium">
                    {session.mode === MODES.NORMAL ? '普通' : '限时'}
                  </span>
                </div>
                <div className="text-xs text-slate-400 font-mono font-medium">
                  {session.date} · {new Date(session.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} 
                  {' - '} 
                  {new Date(session.endTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </div>
              </div>
              <div className="flex items-center gap-5">
                <span className="text-xl font-bold text-slate-700 tabular-nums tracking-tight">
                  {formatTime(session.duration)}
                </span>
                <button 
                  onClick={() => confirmDelete(session.id)}
                  className="text-slate-300 hover:text-rose-500 hover:bg-rose-50 p-2.5 rounded-xl transition-colors md:opacity-0 md:group-hover:opacity-100"
                  title="删除记录"
                >
                  <Trash2 size={20} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderSettings = () => (
    <div className="max-w-2xl mx-auto pb-20 mt-4 md:mt-10 animate-in fade-in space-y-8">
      <h2 className="text-2xl font-bold text-slate-800 pt-2 mb-8">设置与数据</h2>
      
      {installPrompt && (
        <div className="bg-blue-600 rounded-3xl p-7 shadow-lg shadow-blue-600/20 text-white relative overflow-hidden">
          <div className="absolute -right-6 -top-6 text-white/10 rotate-12">
            <Smartphone size={120} />
          </div>
          <div className="relative z-10">
            <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
              安装到桌面 (PWA)
            </h3>
            <p className="text-blue-100 text-sm mb-6 leading-relaxed max-w-[85%]">
              将 Focus App 安装为独立应用，获得全屏无干扰的沉浸体验，并支持完全离线使用。
            </p>
            <button 
              onClick={handleInstallClick}
              className="bg-white text-blue-600 px-7 py-3.5 rounded-xl hover:bg-blue-50 transition-colors font-bold shadow-sm active:scale-95"
            >
              立即安装应用
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-3xl p-7 shadow-sm shadow-slate-200/50 border border-slate-100">
        <h3 className="text-sm font-bold text-slate-400 mb-5 uppercase tracking-wider flex items-center gap-2">
          数据备份与恢复
        </h3>
        <p className="text-sm text-slate-500 mb-8 leading-relaxed">
          您的数据完全保存在当前设备的浏览器缓存中。<br/>为了防止意外丢失，建议您定期进行数据导出备份。
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4">
          <button 
            onClick={exportData}
            className="flex-1 flex items-center justify-center gap-2 bg-slate-800 text-white px-5 py-3.5 rounded-2xl hover:bg-slate-700 transition-colors font-medium shadow-md shadow-slate-800/20"
          >
            <Download size={18} /> 导出为 JSON
          </button>
          
          <label className="flex-1 flex items-center justify-center gap-2 bg-white border-2 border-slate-200 text-slate-700 px-5 py-3.5 rounded-2xl hover:border-blue-500 hover:text-blue-600 cursor-pointer transition-colors relative overflow-hidden font-medium">
            <Upload size={18} /> 从 JSON 恢复
            <input 
              type="file" 
              accept=".json" 
              onChange={importData}
              className="absolute inset-0 opacity-0 cursor-pointer" 
            />
          </label>
        </div>
      </div>
      
      <div className="text-center text-xs text-slate-400 font-medium tracking-wide mt-12">
        Focus App v1.0 · PWA Ready · Local Storage Only
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 md:pt-16 pb-safe selection:bg-blue-200">
      <header className="hidden md:block fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-md border-b border-slate-200/60 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between text-slate-800 font-black tracking-tight text-lg">
          <div className="flex items-center gap-1">Focus App <span className="text-blue-500">.</span></div>
          {isOffline && (
            <span className="text-xs bg-amber-100 text-amber-700 px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm font-medium">
              <AlertCircle size={14}/> 离线模式
            </span>
          )}
        </div>
      </header>

      {isOffline && (
        <div className="md:hidden bg-amber-100 text-amber-700 text-xs py-2 px-4 flex items-center justify-center gap-1.5 shadow-sm relative z-40 font-medium">
          <AlertCircle size={14}/> 当前为离线模式，记录仍将安全保存在本地
        </div>
      )}

      <main className="px-5 py-8 md:px-8 max-w-4xl mx-auto min-h-[calc(100vh-80px)]">
        {activeTab === 'home' && renderHome()}
        {activeTab === 'stats' && renderStats()}
        {activeTab === 'history' && renderHistory()}
        {activeTab === 'settings' && renderSettings()}
      </main>

      {renderNav()}

      {showTimeUpModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full text-center shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="w-24 h-24 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
              <CheckCircle2 size={48} />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-3">专注完成！</h2>
            <p className="text-slate-500 mb-8 leading-relaxed">30 分钟限时已结束，记录已自动保存。<br/>放松眼睛，休息一下吧。</p>
            <button 
              onClick={() => setShowTimeUpModal(false)}
              className="w-full bg-slate-800 text-white font-bold py-4 rounded-2xl hover:bg-slate-700 transition-colors active:scale-95 shadow-lg shadow-slate-800/20"
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}