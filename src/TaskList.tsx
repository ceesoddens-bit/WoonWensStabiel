// src/TaskList.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, Trash2, AlertCircle, ListTodo, Bell, Calendar, ChevronLeft, ChevronRight, Clock, Pencil, Users, Home, List, X, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth } from './firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';

interface Task {
  id: string;
  text: string;
  done: boolean;
  type: 'taak' | 'herinnering';
  dueDate?: string;   // ISO date: "2026-05-28"
  dueTime?: string;   // "HH:MM"
  klant?: string;
  woning?: string;
  project?: string;
  notes?: string;
  createdAt?: any;
}

type TabType = 'taken' | 'herinneringen';
type ViewMode = 'lijst' | 'week';

// --- Helpers ---
function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun, 1 = Mon
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toLocalDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

function formatDateNL(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}-${m}-${y}`;
}

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.done) return false;
  const today = toLocalDateString(new Date());
  return task.dueDate < today;
}

function isDueToday(task: Task): boolean {
  if (!task.dueDate) return false;
  return task.dueDate === toLocalDateString(new Date());
}

const NL_DAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
const NL_DAYS_FULL = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];
const NL_MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const NL_MONTHS_FULL = ['Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni', 'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'];

// --- Main Component ---
interface TaskListProps {
  klanten?: any[];
  scans?: any[];
}

const TaskList: React.FC<TaskListProps> = ({ klanten = [], scans = [] }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newDueTime, setNewDueTime] = useState('');
  const [newKlant, setNewKlant] = useState('');
  const [newWoning, setNewWoning] = useState('');
  const [newProject, setNewProject] = useState('');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFallbackMode, setIsFallbackMode] = useState(false);
  const [pushingAgenda, setPushingAgenda] = useState(false);

  const [activeTab, setActiveTab] = useState<TabType>('taken');
  const [viewMode, setViewMode] = useState<ViewMode>('lijst');
  const [weekStart, setWeekStart] = useState<Date>(() => getStartOfWeek(new Date()));
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // --- Data loading (dual-mode Firestore + Express backend) ---
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let fallbackTimer: NodeJS.Timeout | null = null;
    let pollInterval: NodeJS.Timeout | null = null;
    let active = true;

    const startDirectMode = () => {
      try {
        const q = collection(db, 'tasks');
        fallbackTimer = setTimeout(() => {
          if (active && !unsubscribe) {
            console.warn('Direct Firestore timed out. Falling back to backend...');
            switchToBackend();
          }
        }, 2500);

        unsubscribe = onSnapshot(q, (snapshot) => {
          if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
          if (!active) return;
          const tasksData: Task[] = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            let safeDueDate = data.dueDate || undefined;
            if (safeDueDate) {
              if (typeof safeDueDate.toDate === 'function') {
                const d = safeDueDate.toDate();
                safeDueDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              } else if (typeof safeDueDate === 'string') {
                safeDueDate = safeDueDate.split('T')[0];
              } else {
                safeDueDate = String(safeDueDate);
              }
            }
            tasksData.push({
              id: docSnap.id,
              text: data.text || '',
              done: !!data.done,
              type: data.type || 'taak',
              dueDate: safeDueDate,
              dueTime: data.dueTime || undefined,
              klant: data.klant || undefined,
              woning: data.woning || undefined,
              project: data.project || undefined,
              notes: data.notes || undefined,
              createdAt: data.createdAt
            });
          });
          sortTasks(tasksData);
          setTasks(tasksData);
          setLoading(false);
          setError(null);
          setIsFallbackMode(false);
        }, (err) => {
          if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
          if (!active) return;
          console.error('Direct Firestore error, switching to backend:', err);
          switchToBackend();
        });
      } catch (err) {
        switchToBackend();
      }
    };

    const switchToBackend = async () => {
      if (!active) return;
      setIsFallbackMode(true);
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      await fetchTasksFromBackend();
      if (!pollInterval) pollInterval = setInterval(fetchTasksFromBackend, 5000);
    };

    const fetchTasksFromBackend = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('http://localhost:3001/api/tasks', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`Backend error: ${res.statusText}`);
        let tasksData: Task[] = await res.json();
        if (!active) return;
        tasksData = tasksData.map(t => {
          if (t.dueDate) {
             if (typeof (t.dueDate as any).toDate === 'function') {
                const d = (t.dueDate as any).toDate();
                t.dueDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
             } else if (typeof t.dueDate === 'string') {
                t.dueDate = t.dueDate.split('T')[0];
             } else {
                t.dueDate = String(t.dueDate);
             }
          }
          return t;
        });
        sortTasks(tasksData);
        setTasks(tasksData);
        setLoading(false);
        setError(null);
      } catch (err: any) {
        if (active) { setError(`Fout bij ophalen: ${err.message}`); setLoading(false); }
      }
    };

    startDirectMode();
    return () => {
      active = false;
      if (unsubscribe) unsubscribe();
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  function sortTasks(tasksData: Task[]) {
    tasksData.sort((a, b) => {
      // Sort by dueDate first (ascending), then by createdAt descending
      if (a.dueDate && b.dueDate) {
         const strA = typeof a.dueDate === 'string' ? a.dueDate : String(a.dueDate);
         const strB = typeof b.dueDate === 'string' ? b.dueDate : String(b.dueDate);
         return strA.localeCompare(strB);
      }
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      const parseDate = (val: any) => {
        if (!val) return 0;
        if (typeof val.toDate === 'function') return val.toDate().getTime();
        const d = new Date(val);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      };
      return parseDate(b.createdAt) - parseDate(a.createdAt);
    });
  }

  // --- Add Task ---
  const handleAdd = async () => {
    const trimmed = newTask.trim();
    if (!trimmed) {
      if (!isCreateModalOpen) {
        setIsCreateModalOpen(true);
        setError(null);
      } else {
        setError('Vul een taakomschrijving in');
      }
      return;
    }
    if (adding) return;
    setAdding(true);
    setError(null);

    const taskPayload: any = {
      text: trimmed,
      done: false,
      type: activeTab === 'herinneringen' ? 'herinnering' : 'taak',
      createdAt: new Date().toISOString()
    };
    if (newDueDate) taskPayload.dueDate = newDueDate;
    if (newDueTime) taskPayload.dueTime = newDueTime;
    if (newKlant) taskPayload.klant = newKlant;
    if (newWoning) taskPayload.woning = newWoning;
    if (newProject) taskPayload.project = newProject;

    if (isFallbackMode) {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('http://localhost:3001/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(taskPayload)
        });
        if (!res.ok) throw new Error(`Status: ${res.status}`);
        setNewTask(''); setNewDueDate(''); setNewDueTime(''); setNewKlant(''); setNewWoning(''); setNewProject('');
        setIsCreateModalOpen(false);
      } catch (err: any) {
        setError(`Fout bij toevoegen: ${err.message}`);
      } finally { setAdding(false); }
      return;
    }

    const writePromise = addDoc(collection(db, 'tasks'), taskPayload);
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2500));
    try {
      await Promise.race([writePromise, timeoutPromise]);
      setNewTask(''); setNewDueDate(''); setNewDueTime(''); setNewKlant(''); setNewWoning(''); setNewProject('');
      setIsCreateModalOpen(false);
    } catch (err: any) {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('http://localhost:3001/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(taskPayload)
        });
        if (!res.ok) throw new Error(`Status: ${res.status}`);
        setNewTask(''); setNewDueDate(''); setNewDueTime(''); setNewKlant(''); setNewWoning(''); setNewProject('');
        setIsCreateModalOpen(false);
        setIsFallbackMode(true);
      } catch (backErr: any) {
        setError(`Fout bij toevoegen: ${backErr.message}`);
      }
    } finally { setAdding(false); }
  };

  // --- Toggle Done ---
  const toggleDone = async (task: Task) => {
    setError(null);
    const updatedDone = !task.done;
    if (isFallbackMode) {
      try {
        const token = await auth.currentUser?.getIdToken();
        await fetch(`http://localhost:3001/api/tasks/${task.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ done: updatedDone })
        });
      } catch (err: any) { setError(`Fout bij bijwerken: ${err.message}`); }
      return;
    }
    const taskRef = doc(db, 'tasks', task.id);
    try {
      await Promise.race([
        updateDoc(taskRef, { done: updatedDone }),
        new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), 2500))
      ]);
    } catch {
      try {
        const token = await auth.currentUser?.getIdToken();
        await fetch(`http://localhost:3001/api/tasks/${task.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ done: updatedDone })
        });
        setIsFallbackMode(true);
      } catch (backErr: any) { setError(`Fout: ${backErr.message}`); }
    }
  };

  // --- Edit Task ---
  const handleUpdateTask = async (updatedTask: Task) => {
    setError(null);
    const { id, ...rawData } = updatedTask;
    // Firestore updateDoc does not allow undefined values
    const data = Object.fromEntries(Object.entries(rawData).filter(([_, v]) => v !== undefined));
    
    if (isFallbackMode) {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(`http://localhost:3001/api/tasks/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`Status: ${res.status}`);
        setEditingTask(null);
      } catch (err: any) { setError(`Fout bij bijwerken: ${err.message}`); }
      return;
    }

    const taskRef = doc(db, 'tasks', id);
    try {
      await Promise.race([
        updateDoc(taskRef, data),
        new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), 2500))
      ]);
      setEditingTask(null);
    } catch {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(`http://localhost:3001/api/tasks/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`Status: ${res.status}`);
        setIsFallbackMode(true);
        setEditingTask(null);
      } catch (backErr: any) { setError(`Fout: ${backErr.message}`); }
    }
  };

  // --- Delete ---
  const handleDelete = async (task: Task) => {
    setError(null);
    if (isFallbackMode) {
      try {
        const token = await auth.currentUser?.getIdToken();
        await fetch(`http://localhost:3001/api/tasks/${task.id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch (err: any) { setError(`Fout bij verwijderen: ${err.message}`); }
      return;
    }
    try {
      await Promise.race([
        deleteDoc(doc(db, 'tasks', task.id)),
        new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), 2500))
      ]);
    } catch {
      try {
        const token = await auth.currentUser?.getIdToken();
        await fetch(`http://localhost:3001/api/tasks/${task.id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        setIsFallbackMode(true);
      } catch (backErr: any) { setError(`Fout: ${backErr.message}`); }
    }
  };

  // --- Filters ---
  const [filterKlant, setFilterKlant] = useState('');
  const [filterWoning, setFilterWoning] = useState('');
  const [filterProject, setFilterProject] = useState('');

  // --- Derived data ---
  const pushToAgenda = async (task: Task) => {
    if (!task.dueDate) {
      alert('Vul eerst een datum in voordat je deze in de agenda zet.');
      return;
    }
    setPushingAgenda(true);
    
    let eindTijd = '10:00';
    if (task.dueTime) {
      const [h, m] = task.dueTime.split(':');
      let nextH = parseInt(h, 10) + 1;
      if (nextH > 23) nextH = 0;
      eindTijd = `${String(nextH).padStart(2, '0')}:${m}`;
    }

    let titel = task.text;
    if (task.woning && titel.includes('[betreft bezichtiging]')) {
      titel = titel.replace('[betreft bezichtiging]', task.woning);
    }

    const payload = {
      titel: titel,
      datum: task.dueDate,
      tijd: task.dueTime || '09:00',
      eindTijd: eindTijd,
      klant: task.klant || '',
      woning: task.woning || ''
    };

    try {
      await fetch('https://woonwensmakelaar.app.n8n.cloud/webhook/845898c5-28f9-4637-b1b1-5e5152965d2e', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      alert('Succesvol doorgestuurd naar je Google Agenda!');
    } catch (err) {
      console.error(err);
      alert('Er ging iets mis bij het doorsturen.');
    } finally {
      setPushingAgenda(false);
    }
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      const matchKlant = filterKlant ? t.klant?.toLowerCase().includes(filterKlant.toLowerCase()) : true;
      const matchWoning = filterWoning ? t.woning?.toLowerCase().includes(filterWoning.toLowerCase()) : true;
      const matchProject = filterProject ? t.project?.toLowerCase().includes(filterProject.toLowerCase()) : true;
      return matchKlant && matchWoning && matchProject;
    });
  }, [tasks, filterKlant, filterWoning, filterProject]);

  const taken = useMemo(() => filteredTasks.filter(t => !t.type || t.type === 'taak'), [filteredTasks]);
  const herinneringen = useMemo(() => filteredTasks.filter(t => t.type === 'herinnering'), [filteredTasks]);
  const activeTasks = activeTab === 'taken' ? taken : herinneringen;
  const pendingTasks = activeTasks.filter(t => !t.done);
  const completedTasks = activeTasks.filter(t => t.done);

  const urgentCount = herinneringen.filter(t => !t.done && (isOverdue(t) || isDueToday(t))).length;

  // Week days for the calendar
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const tasksByDay = useMemo(() => {
    const map: Record<string, Task[]> = {};
    weekDays.forEach(d => { map[toLocalDateString(d)] = []; });
    filteredTasks.forEach(task => {
      if (task.dueDate && map[task.dueDate] !== undefined) {
        map[task.dueDate].push(task);
      }
    });
    return map;
  }, [filteredTasks, weekDays]);

  const tasksWithoutDate = useMemo(() => filteredTasks.filter(t => !t.dueDate && !t.done), [filteredTasks]);

  const today = toLocalDateString(new Date());
  const weekStartDate = weekStart;
  const weekEndDate = addDays(weekStart, 6);

  const weekLabel = `${weekStart.getDate()} ${NL_MONTHS[weekStart.getMonth()]} – ${weekEndDate.getDate()} ${NL_MONTHS[weekEndDate.getMonth()]} ${weekEndDate.getFullYear()}`;

  const renderTaskText = (task: Task) => {
    if (task.woning && task.text.includes('[betreft bezichtiging]')) {
      return task.text.replace('[betreft bezichtiging]', task.woning);
    }
    return task.text;
  };

  // --- Render helpers ---
  const TaskCard: React.FC<{ task: Task }> = ({ task }) => {
    const overdue = isOverdue(task);
    const today_ = isDueToday(task);
    const isReminder = task.type === 'herinnering';

    return (
      <motion.div
        key={task.id}
        layout
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2, type: 'spring', stiffness: 300, damping: 25 }}
        className={`group flex items-center justify-between p-3.5 rounded-2xl mb-2.5 border shadow-sm hover:shadow-md transition-all duration-200
          ${task.done
            ? 'bg-slate-50/80 border-slate-200/40'
            : overdue
            ? 'bg-red-50/60 border-red-200/60 hover:bg-red-50'
            : today_
            ? 'bg-amber-50/60 border-amber-200/60 hover:bg-amber-50'
            : 'bg-white/80 border-slate-200/60 hover:bg-white'}`}
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <button
            onClick={(e) => { e.stopPropagation(); toggleDone(task); }}
            title={task.done ? 'Markeer onvoltooid' : 'Markeer voltooid'}
            className={`flex-shrink-0 mt-0.5 flex items-center justify-center w-6 h-6 rounded-full border-2 transition-all duration-200
              ${task.done
                ? isReminder ? 'bg-purple-500 border-purple-500 text-white' : 'bg-emerald-500 border-emerald-500 text-white'
                : isReminder ? 'border-purple-300 bg-white group-hover:border-purple-400' : 'border-slate-300 bg-slate-50 group-hover:border-emerald-400'}`}
          >
            {task.done && <Check size={14} strokeWidth={3} />}
          </button>
          <div className="flex-1 min-w-0 cursor-pointer" onClick={(e) => { 
            e.stopPropagation(); 
            let text = task.text;
            if (task.woning && text.includes('[betreft bezichtiging]')) {
              text = text.replace('[betreft bezichtiging]', task.woning);
            }
            setEditingTask({ ...task, text }); 
          }}>
            <span className={`block text-sm font-semibold transition-all duration-200 ${task.done ? 'line-through text-slate-400' : 'text-[#2d3e50]'}`}>
              {renderTaskText(task)}
            </span>
            {task.dueDate && (
              <span className={`inline-flex items-center gap-1 mt-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md
                ${task.done ? 'text-slate-400 bg-slate-100' : overdue ? 'text-red-600 bg-red-100' : today_ ? 'text-amber-700 bg-amber-100' : 'text-slate-500 bg-slate-100'}`}>
                {isReminder ? <Bell size={10} /> : <Calendar size={10} />}
                {formatDateNL(task.dueDate)}{task.dueTime ? ` om ${task.dueTime}` : ''}
                {overdue && !task.done && ' · Verlopen'}
                {today_ && !task.done && !overdue && ' · Vandaag'}
              </span>
            )}
            {(task.klant || task.woning || task.project) && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {task.klant && <span className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-bold border border-blue-100"><Users size={8} /> {task.klant}</span>}
                {task.woning && <span className="inline-flex items-center gap-1 text-[10px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded font-bold border border-orange-100"><Home size={8} /> {task.woning}</span>}
                {task.project && <span className="inline-flex items-center gap-1 text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-bold border border-indigo-100"><List size={8} /> {task.project}</span>}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            onClick={(e) => { 
              e.stopPropagation(); 
              let text = task.text;
              if (task.woning && text.includes('[betreft bezichtiging]')) {
                text = text.replace('[betreft bezichtiging]', task.woning);
              }
              setEditingTask({ ...task, text }); 
            }}
            title="Bewerken"
            className="text-slate-300 hover:text-blue-500 transition-colors p-1.5 flex-shrink-0 bg-blue-50 hover:bg-blue-100 rounded-xl"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(task); }}
            title="Verwijderen"
            className="text-slate-300 hover:text-red-500 transition-colors p-1.5 flex-shrink-0 bg-red-50 hover:bg-red-100 rounded-xl"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </motion.div>
    );
  };

  const WeekTaskPill: React.FC<{ task: Task }> = ({ task }) => {
    const overdue = isOverdue(task);
    const isReminder = task.type === 'herinnering';
    return (
      <div
        onClick={(e) => { 
          e.stopPropagation(); 
          let text = task.text;
          if (task.woning && text.includes('[betreft bezichtiging]')) {
            text = text.replace('[betreft bezichtiging]', task.woning);
          }
          setEditingTask({ ...task, text }); 
        }}
        className={`group flex items-center gap-1.5 px-2 py-1 rounded-lg mb-1 text-[11px] font-semibold border transition-all cursor-pointer
          ${task.done
            ? 'bg-slate-100 border-slate-200 text-slate-400 line-through'
            : isReminder
            ? overdue
              ? 'bg-red-100 border-red-200 text-red-700 hover:bg-red-200'
              : 'bg-purple-100 border-purple-200 text-purple-700 hover:bg-purple-200'
            : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'}`}
      >
        <button 
          onClick={(e) => { e.stopPropagation(); toggleDone(task); }} 
          className="flex-shrink-0 cursor-pointer p-0.5 rounded hover:bg-black/5"
          title="Markeer als afgerond"
        >
          {isReminder ? <Bell size={10} /> : <div className={`w-1.5 h-1.5 rounded-full ${task.done ? 'bg-slate-300' : 'bg-emerald-500'}`} />}
        </button>
        <span className="truncate flex-1">
          {task.dueTime && <span className="mr-1 opacity-70">{task.dueTime}</span>}{renderTaskText(task)}
        </span>
      </div>
    );
  };

  return (
    <div className="glass-card p-5 md:p-8 max-w-6xl mx-auto my-4 md:my-8 relative overflow-hidden">
      {/* Decorative background blobs */}
      <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-emerald-400/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-48 h-48 bg-purple-400/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10">
        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#2d3e50] flex items-center gap-3 drop-shadow-sm">
            <div className="p-2.5 bg-emerald-500/10 text-emerald-600 rounded-xl">
              <ListTodo size={26} strokeWidth={2.5} />
            </div>
            Takenlijst
            {isFallbackMode && (
              <span className="text-[10px] font-semibold text-slate-400 bg-slate-100/80 border border-slate-200 px-2 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Admin mode
              </span>
            )}
          </h2>

          {/* View toggle */}
          <div className="flex items-center bg-slate-100/80 rounded-xl p-1 border border-slate-200/60 gap-1">
            <button
              onClick={() => setViewMode('lijst')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'lijst' ? 'bg-white shadow-sm text-[#2d3e50]' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <ListTodo size={14} /> Lijst
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'week' ? 'bg-white shadow-sm text-[#2d3e50]' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Calendar size={14} /> Week
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5 p-4 bg-white/50 border border-slate-200/80 rounded-xl">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Klantnaam</label>
            <input
              type="text"
              placeholder="Filter op klant..."
              value={filterKlant}
              onChange={(e) => setFilterKlant(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-sm transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Woning</label>
            <input
              type="text"
              placeholder="Filter op woning..."
              value={filterWoning}
              onChange={(e) => setFilterWoning(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-sm transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Project</label>
            <input
              type="text"
              placeholder="Filter op project..."
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-sm transition-all"
            />
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="flex items-center gap-3 p-4 mb-5 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm shadow-sm">
            <AlertCircle size={18} className="flex-shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        {/* Tabs (only in list mode) */}
        {viewMode === 'lijst' && (
          <div className="flex gap-2 mb-5">
            <button
              onClick={() => setActiveTab('taken')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all ${activeTab === 'taken' ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-600'}`}
            >
              <ListTodo size={15} />
              Taken
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === 'taken' ? 'bg-white/30 text-white' : 'bg-slate-100 text-slate-500'}`}>
                {taken.filter(t => !t.done).length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('herinneringen')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all relative ${activeTab === 'herinneringen' ? 'bg-purple-500 text-white border-purple-500 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-purple-300 hover:text-purple-600'}`}
            >
              <Bell size={15} />
              Herinneringen
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === 'herinneringen' ? 'bg-white/30 text-white' : 'bg-slate-100 text-slate-500'}`}>
                {herinneringen.filter(t => !t.done).length}
              </span>
              {urgentCount > 0 && activeTab !== 'herinneringen' && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-black shadow-sm">
                  {urgentCount}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Input bar */}
        <div className="mb-6">
          <div className="flex shadow-sm hover:shadow-md rounded-2xl bg-white/90 overflow-hidden border border-slate-200/80 focus-within:border-emerald-400 focus-within:ring-4 focus-within:ring-emerald-400/20 transition-all duration-300">
            <input
              type="text"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              disabled={adding}
              placeholder={activeTab === 'herinneringen' ? 'Nieuwe herinnering toevoegen...' : 'Nieuwe taak toevoegen...'}
              className="flex-1 px-5 py-3.5 bg-transparent text-[#2d3e50] font-medium focus:outline-none placeholder-slate-400 disabled:opacity-50 text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <button
              onClick={handleAdd}
              disabled={adding}
              className={`px-5 ${activeTab === 'herinneringen' ? 'bg-purple-500 hover:bg-purple-600 border-l border-purple-600' : 'bg-emerald-500 hover:bg-emerald-600 border-l border-emerald-600'} text-white transition-colors flex items-center justify-center ${adding ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {adding
                ? <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                : <Plus size={20} strokeWidth={2.5} />}
            </button>
          </div>

          {/* Date/time fields */}
          <div className="flex gap-2 mt-2">
            <div className="flex items-center gap-1.5 bg-white/80 border border-slate-200/80 rounded-xl px-3 py-1.5 flex-1 focus-within:border-emerald-400 transition-all">
              <Calendar size={14} className="text-slate-400 flex-shrink-0" />
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="flex-1 bg-transparent text-xs text-slate-600 focus:outline-none"
                title="Vervaldatum"
              />
            </div>
            {activeTab === 'herinneringen' && (
              <div className="flex items-center gap-1.5 bg-white/80 border border-slate-200/80 rounded-xl px-3 py-1.5 w-36 focus-within:border-purple-400 transition-all">
                <Clock size={14} className="text-slate-400 flex-shrink-0" />
                <input
                  type="time"
                  value={newDueTime}
                  onChange={(e) => setNewDueTime(e.target.value)}
                  className="flex-1 bg-transparent text-xs text-slate-600 focus:outline-none"
                  title="Tijdstip"
                />
              </div>
            )}
          </div>
          
          <div className="flex flex-wrap gap-2 mt-2">
            <input
              type="text"
              list="klanten-list"
              placeholder="Klant (optioneel)"
              value={newKlant}
              onChange={(e) => setNewKlant(e.target.value)}
              className="flex-1 min-w-[120px] bg-white/80 border border-slate-200/80 rounded-xl px-3 py-1.5 text-xs text-slate-600 focus:outline-none focus:border-emerald-400"
            />
            <input
              type="text"
              list="woningen-list"
              placeholder="Woning (optioneel)"
              value={newWoning}
              onChange={(e) => setNewWoning(e.target.value)}
              className="flex-1 min-w-[120px] bg-white/80 border border-slate-200/80 rounded-xl px-3 py-1.5 text-xs text-slate-600 focus:outline-none focus:border-emerald-400"
            />
            <input
              type="text"
              placeholder="Project (optioneel)"
              value={newProject}
              onChange={(e) => setNewProject(e.target.value)}
              className="flex-1 min-w-[120px] bg-white/80 border border-slate-200/80 rounded-xl px-3 py-1.5 text-xs text-slate-600 focus:outline-none focus:border-emerald-400"
            />
          </div>
        </div>

        {/* LOADING */}
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500" />
          </div>
        ) : viewMode === 'lijst' ? (
          /* ---- LIJST VIEW ---- */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
            {/* Pending */}
            <div>
              <h3 className="text-base font-bold text-[#2d3e50] mb-4 flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full shadow-sm ${activeTab === 'herinneringen' ? 'bg-purple-500 shadow-purple-200' : 'bg-emerald-500 shadow-emerald-200'}`} />
                Nog te doen ({pendingTasks.length})
              </h3>
              <div className="min-h-[200px]">
                <AnimatePresence mode="popLayout">
                  {pendingTasks.map(task => <TaskCard key={task.id} task={task} />)}
                  {pendingTasks.length === 0 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-12 text-slate-400">
                      <div className="p-4 bg-emerald-50/50 rounded-full mb-3">
                        <Check size={26} className="text-emerald-300" />
                      </div>
                      <p className="text-sm font-medium">Alles is afgevinkt!</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Completed */}
            <div>
              <h3 className="text-base font-bold text-slate-500 mb-4 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                Gedaan ({completedTasks.length})
              </h3>
              <div className="min-h-[200px] opacity-80 hover:opacity-100 transition-opacity duration-300">
                <AnimatePresence mode="popLayout">
                  {completedTasks.map(task => <TaskCard key={task.id} task={task} />)}
                  {completedTasks.length === 0 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-12 text-slate-400">
                      <div className="p-4 bg-slate-100/50 rounded-full mb-3">
                        <ListTodo size={26} className="text-slate-300" />
                      </div>
                      <p className="text-sm font-medium">Nog niets voltooid.</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

        ) : (
          /* ---- WEEK VIEW ---- */
          <div>
            {/* Week navigation */}
            <div className="flex items-center justify-between mb-5">
              <button
                onClick={() => setWeekStart(prev => addDays(prev, -7))}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all shadow-sm"
              >
                <ChevronLeft size={16} /> Vorige
              </button>
              <div className="text-center">
                <p className="text-sm font-bold text-[#2d3e50]">Week {getWeekNumber(weekStart)}</p>
                <p className="text-xs text-slate-500 mt-0.5">{weekLabel}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setWeekStart(getStartOfWeek(new Date()))}
                  className="px-3 py-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition-all"
                >
                  Vandaag
                </button>
                <button
                  onClick={() => setWeekStart(prev => addDays(prev, 7))}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all shadow-sm"
                >
                  Volgende <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* Week grid */}
            <div className="grid grid-cols-7 gap-2 mb-6">
              {weekDays.map((day, idx) => {
                const dayStr = toLocalDateString(day);
                const isToday = dayStr === today;
                const dayTasks = tasksByDay[dayStr] || [];
                const isWeekend = idx >= 5;

                return (
                  <div key={dayStr} className={`min-h-[140px] rounded-xl border p-2 transition-all
                    ${isToday ? 'border-emerald-400 bg-emerald-50/50 shadow-md shadow-emerald-100' : isWeekend ? 'border-slate-200/50 bg-slate-50/30' : 'border-slate-200/60 bg-white/60'}`}>
                    <div className="mb-2 text-center">
                      <p className={`text-[10px] font-bold uppercase tracking-wider ${isToday ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {NL_DAYS[idx]}
                      </p>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center mx-auto mt-0.5 text-sm font-black
                        ${isToday ? 'bg-emerald-500 text-white shadow-sm' : 'text-[#2d3e50]'}`}>
                        {day.getDate()}
                      </div>
                    </div>
                    <div>
                      {dayTasks
                        .sort((a, b) => (a.dueTime || '00:00').localeCompare(b.dueTime || '00:00'))
                        .map(task => <WeekTaskPill key={task.id} task={task} />)
                      }
                      {dayTasks.length === 0 && (
                        <p className="text-[10px] text-slate-300 text-center mt-3 font-medium">—</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tasks without a date */}
            {tasksWithoutDate.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-200/60">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Calendar size={12} /> Geen datum ({tasksWithoutDate.length})
                </h4>
                <div className="flex flex-wrap gap-2">
                  {tasksWithoutDate.map(task => {
                    const isReminder = task.type === 'herinnering';
                    return (
                      <div
                        key={task.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          let text = task.text;
                          if (task.woning && text.includes('[betreft bezichtiging]')) {
                            text = text.replace('[betreft bezichtiging]', task.woning);
                          }
                          setEditingTask({ ...task, text });
                        }}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer transition-all group
                          ${isReminder ? 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleDone(task);
                          }}
                          className="flex-shrink-0 cursor-pointer p-0.5 rounded hover:bg-black/5 flex items-center justify-center"
                          title="Markeer als afgerond"
                        >
                          {isReminder ? (
                            <Bell size={11} className="text-purple-600 hover:text-purple-800 transition-colors" />
                          ) : (
                            <div className="w-2.5 h-2.5 rounded-full bg-slate-400 hover:bg-emerald-500 border border-slate-300 transition-colors" />
                          )}
                        </button>
                        <span>{renderTaskText(task)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <datalist id="klanten-list">
        {klanten.map((k) => (
          <option key={k.id || k.naam} value={k.naam || k["naam klant"]} />
        ))}
      </datalist>

      <datalist id="woningen-list">
        {scans.map((s) => (
          <option key={s.id || s.adres} value={s.adres} />
        ))}
      </datalist>

      {/* Edit Modal */}
      {/* Create Modal */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isCreateModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                onClick={() => setIsCreateModalOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="relative bg-white/90 backdrop-blur-xl border border-white rounded-3xl shadow-2xl p-6 w-full max-w-lg overflow-hidden"
              >
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold text-[#2d3e50] flex items-center gap-2">
                    <div className="p-2 bg-emerald-50 text-emerald-500 rounded-xl">
                      <Plus size={20} />
                    </div>
                    Nieuwe Taak / Herinnering
                  </h3>
                  <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-2 bg-slate-100/50 hover:bg-slate-100 rounded-full transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Text */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Omschrijving</label>
                    <input
                      type="text"
                      value={newTask}
                      onChange={(e) => setNewTask(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all"
                      placeholder="Wat moet er gebeuren?"
                    />
                  </div>

                  {/* Type */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Type</label>
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                      <button
                        onClick={() => setActiveTab('taken')}
                        className={`flex-1 py-1.5 text-sm font-semibold rounded-lg transition-all ${activeTab !== 'herinneringen' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Taak
                      </button>
                      <button
                        onClick={() => setActiveTab('herinneringen')}
                        className={`flex-1 py-1.5 text-sm font-semibold rounded-lg transition-all ${activeTab === 'herinneringen' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Herinnering
                      </button>
                    </div>
                  </div>

                  {/* Date & Time */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Datum (optioneel)</label>
                      <input
                        type="date"
                        value={newDueDate}
                        onChange={(e) => setNewDueDate(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 transition-all text-slate-600"
                      />
                    </div>
                    {activeTab === 'herinneringen' && (
                      <div className="flex-1">
                        <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Tijd (optioneel)</label>
                        <input
                          type="time"
                          value={newDueTime}
                          onChange={(e) => setNewDueTime(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 transition-all text-slate-600"
                        />
                      </div>
                    )}
                  </div>

                  {/* Extra velden */}
                  <div className="pt-2 border-t border-slate-100">
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">Koppelingen (optioneel)</label>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <input
                          type="text"
                          list="klanten-list"
                          placeholder="Klant"
                          value={newKlant}
                          onChange={(e) => setNewKlant(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:border-emerald-400 transition-all"
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          list="woningen-list"
                          placeholder="Woning"
                          value={newWoning}
                          onChange={(e) => setNewWoning(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:border-emerald-400 transition-all"
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          placeholder="Project"
                          value={newProject}
                          onChange={(e) => setNewProject(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:border-emerald-400 transition-all"
                        />
                      </div>
                    </div>
                  </div>

                </div>

                <div className="mt-8 flex gap-3">
                  <button
                    onClick={() => {
                      if (!newDueDate) {
                        alert('Vul eerst een datum in (en eventueel een tijd) voordat je deze in de agenda zet.');
                        return;
                      }
                      pushToAgenda({
                        id: 'temp',
                        text: newTask,
                        done: false,
                        type: activeTab === 'herinneringen' ? 'herinnering' : 'taak',
                        dueDate: newDueDate,
                        dueTime: newDueTime,
                        klant: newKlant,
                        woning: newWoning,
                        project: newProject
                      });
                    }}
                    disabled={pushingAgenda || !newDueDate}
                    className="py-2.5 px-4 rounded-xl font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors flex justify-center items-center gap-2 border border-emerald-200 disabled:opacity-50"
                    title="Zet in Google Agenda (vereist een datum)"
                  >
                    {pushingAgenda ? <div className="animate-spin rounded-full h-5 w-5 border-2 border-emerald-500 border-t-transparent" /> : <Calendar size={18} />}
                  </button>
                  <button
                    onClick={() => setIsCreateModalOpen(false)}
                    className="flex-1 py-2.5 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    Annuleren
                  </button>
                  <button
                    onClick={handleAdd}
                    disabled={!newTask.trim() || adding}
                    className="flex-1 py-2.5 rounded-xl font-bold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors flex justify-center items-center gap-2 disabled:opacity-50"
                  >
                    {adding ? <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" /> : <><Plus size={18} /> Aanmaken</>}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Edit Modal */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {editingTask && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                onClick={() => setEditingTask(null)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="relative bg-white/90 backdrop-blur-xl border border-white rounded-3xl shadow-2xl p-6 w-full max-w-lg overflow-hidden"
              >
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold text-[#2d3e50] flex items-center gap-2">
                    <div className="p-2 bg-blue-50 text-blue-500 rounded-xl">
                      <Pencil size={20} />
                    </div>
                    {editingTask.klant ? (
                      <span>Bewerken: <span className="text-blue-600">{editingTask.klant}</span></span>
                    ) : (
                      'Taak / Herinnering Bewerken'
                    )}
                  </h3>
                  <button onClick={() => setEditingTask(null)} className="text-slate-400 hover:text-slate-600 p-2 bg-slate-100/50 hover:bg-slate-100 rounded-full transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Text */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Omschrijving</label>
                    <input
                      type="text"
                      value={editingTask.text}
                      onChange={(e) => setEditingTask({ ...editingTask, text: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                    />
                  </div>

                  {/* Type */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Type</label>
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                      <button
                        onClick={() => setEditingTask({ ...editingTask, type: 'taak' })}
                        className={`flex-1 py-1.5 text-sm font-semibold rounded-lg transition-all ${editingTask.type !== 'herinnering' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Taak
                      </button>
                      <button
                        onClick={() => setEditingTask({ ...editingTask, type: 'herinnering' })}
                        className={`flex-1 py-1.5 text-sm font-semibold rounded-lg transition-all ${editingTask.type === 'herinnering' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Herinnering
                      </button>
                    </div>
                  </div>

                  {/* Date & Time */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Datum (optioneel)</label>
                      <input
                        type="date"
                        value={editingTask.dueDate || ''}
                        onChange={(e) => setEditingTask({ ...editingTask, dueDate: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-all text-slate-600"
                      />
                    </div>
                    {editingTask.type === 'herinnering' && (
                      <div className="flex-1">
                        <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Tijd (optioneel)</label>
                        <input
                          type="time"
                          value={editingTask.dueTime || ''}
                          onChange={(e) => setEditingTask({ ...editingTask, dueTime: e.target.value })}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-all text-slate-600"
                        />
                      </div>
                    )}
                  </div>

                  {/* Notities */}
                  <div className="pt-2 border-t border-slate-100">
                    <details className="group" open={!!editingTask.notes}>
                      <summary className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide cursor-pointer list-none flex items-center gap-2 hover:text-slate-700 transition-colors">
                        <span className="w-4 h-4 flex items-center justify-center rounded bg-slate-100 group-open:bg-blue-50 text-slate-400 group-open:text-blue-500 transition-colors">
                          <span className="block group-open:hidden">+</span>
                          <span className="hidden group-open:block">-</span>
                        </span>
                        Notities (optioneel)
                      </summary>
                      <div className="mt-2 pl-6 pb-2">
                        <textarea
                          placeholder="Eventuele notities toevoegen..."
                          value={editingTask.notes || ''}
                          onChange={(e) => setEditingTask({ ...editingTask, notes: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:bg-white focus:outline-none focus:border-blue-400 transition-all min-h-[80px]"
                        />
                      </div>
                    </details>
                  </div>

                  {/* Extra velden */}
                  <div className="pt-2 border-t border-slate-100">
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">Koppelingen (optioneel)</label>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <input
                          type="text"
                          list="klanten-list"
                          placeholder="Klant"
                          value={editingTask.klant || ''}
                          onChange={(e) => setEditingTask({ ...editingTask, klant: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:border-blue-400 transition-all"
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          list="woningen-list"
                          placeholder="Woning"
                          value={editingTask.woning || ''}
                          onChange={(e) => {
                            const newWoning = e.target.value;
                            let newText = editingTask.text;
                            if (newText.includes('[betreft bezichtiging]') && newWoning) {
                              newText = newText.replace('[betreft bezichtiging]', newWoning);
                            }
                            setEditingTask({ ...editingTask, woning: newWoning, text: newText });
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:border-blue-400 transition-all"
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          placeholder="Project"
                          value={editingTask.project || ''}
                          onChange={(e) => setEditingTask({ ...editingTask, project: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:border-blue-400 transition-all"
                        />
                      </div>
                    </div>
                  </div>

                </div>

                <div className="mt-8 flex gap-3">
                  <button
                    onClick={() => pushToAgenda(editingTask)}
                    disabled={pushingAgenda || !editingTask.dueDate}
                    className="py-2.5 px-4 rounded-xl font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors flex justify-center items-center gap-2 border border-emerald-200 disabled:opacity-50"
                    title="Zet in Google Agenda (vereist een datum)"
                  >
                    {pushingAgenda ? <div className="animate-spin rounded-full h-5 w-5 border-2 border-emerald-500 border-t-transparent" /> : <Calendar size={18} />}
                  </button>
                  <button
                    onClick={() => setEditingTask(null)}
                    className="flex-1 py-2.5 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    Annuleren
                  </button>
                  <button
                    onClick={() => handleUpdateTask(editingTask)}
                    disabled={!editingTask.text.trim()}
                    className="flex-1 py-2.5 rounded-xl font-bold text-white bg-blue-500 hover:bg-blue-600 transition-colors flex justify-center items-center gap-2 disabled:opacity-50"
                  >
                    <Save size={18} /> Opslaan
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

// ISO week number
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export default TaskList;
