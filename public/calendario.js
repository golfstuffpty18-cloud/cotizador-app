const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const todayStr = new Date().toISOString().slice(0, 10);
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth(); // 0-based
let selectedDate = todayStr;
let eventsByDay = {}; // 'YYYY-MM-DD' -> [event, ...]

function pad(n) { return String(n).padStart(2, '0'); }
function monthStr(y, m) { return `${y}-${pad(m + 1)}`; }
function dayKey(d) { return d.slice(0, 10); }

function kindLabel(kind) {
  if (kind === 'vence') return 'Fecha límite';
  if (kind === 'apertura') return 'Se abre';
  return 'Cita';
}

async function loadMonth() {
  const res = await fetch(`/api/calendar?month=${monthStr(viewYear, viewMonth)}`);
  const events = await res.json();
  eventsByDay = {};
  events.forEach(ev => {
    const key = dayKey(ev.date);
    if (!eventsByDay[key]) eventsByDay[key] = [];
    eventsByDay[key].push(ev);
  });
  renderGrid();
  renderDay(selectedDate);
}

function renderGrid() {
  document.getElementById('monthLabel').textContent = `${MESES[viewMonth]} ${viewYear}`;
  const grid = document.getElementById('calGrid');
  grid.innerHTML = DIAS.map(d => `<div class="cal-weekday">${d}</div>`).join('');

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startOffset = firstOfMonth.getDay(); // 0=Dom
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const cells = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({ day: daysInPrevMonth - i, otherMonth: true, y: viewMonth === 0 ? viewYear - 1 : viewYear, m: viewMonth === 0 ? 11 : viewMonth - 1 });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, otherMonth: false, y: viewYear, m: viewMonth });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    const nextM = last.m === 11 ? 0 : last.m + 1;
    const nextY = last.m === 11 ? last.y + 1 : last.y;
    cells.push({ day: cells.length - (startOffset + daysInMonth) + 1, otherMonth: true, y: nextY, m: nextM });
  }

  cells.forEach(c => {
    const dateStr = `${c.y}-${pad(c.m + 1)}-${pad(c.day)}`;
    const dayEvents = eventsByDay[dateStr] || [];
    const el = document.createElement('div');
    el.className = 'cal-day' + (c.otherMonth ? ' other-month' : '') + (dateStr === todayStr ? ' today' : '') + (dateStr === selectedDate ? ' selected' : '');
    el.innerHTML = `
      <div class="cal-day-num">${c.day}</div>
      <div class="cal-day-dots">${dayEvents.map(e => `<span class="cal-dot ${e.kind}"></span>`).join('')}</div>
    `;
    el.addEventListener('click', () => {
      selectedDate = dateStr;
      if (c.otherMonth) { viewYear = c.y; viewMonth = c.m; loadMonth(); }
      else { renderGrid(); renderDay(dateStr); }
    });
    grid.appendChild(el);
  });
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = Number(h);
  const ampm = hour >= 12 ? 'pm' : 'am';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

async function deleteEvent(id) {
  await fetch(`/api/calendar-events/${id}`, { method: 'DELETE' });
  loadMonth();
}

async function toggleDone(id, done) {
  await fetch(`/api/calendar-events/${id}/done`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done }),
  });
  loadMonth();
}

function findEvent(id) {
  for (const day of Object.values(eventsByDay)) {
    const found = day.find(e => e.kind === 'manual' && String(e.id) === String(id));
    if (found) return found;
  }
  return null;
}

function editEvent(id) {
  const ev = findEvent(id);
  if (!ev) return;
  openForm({
    id: ev.id,
    title: ev.title,
    notes: ev.notes || '',
    date: ev.date.slice(0, 10),
    time: ev.date.length > 10 ? ev.date.slice(11, 16) : '',
  });
}

function renderDay(dateStr) {
  const heading = document.getElementById('dayHeading');
  const [y, m, d] = dateStr.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString('es-PA', { weekday: 'long', day: 'numeric', month: 'long' });
  heading.textContent = dateStr === todayStr ? `Hoy — ${label}` : label;

  const container = document.getElementById('dayEvents');
  const items = eventsByDay[dateStr] || [];
  if (!items.length) {
    container.innerHTML = '<div class="empty" style="padding:20px 0;">Sin fechas ni citas este día.</div>';
    return;
  }
  container.innerHTML = items.map(e => {
    const time = e.date.length > 10 ? fmtTime(e.date.slice(11, 16)) : '';
    const metaParts = [kindLabel(e.kind)];
    if (time) metaParts.push(time);
    if (e.entity) metaParts.push(e.entity);
    if (e.actNumber) metaParts.push(e.actNumber);
    const isManual = e.kind === 'manual';
    return `
      <div class="cal-event ${isManual && e.done ? 'done' : ''}">
        ${isManual
          ? `<input type="checkbox" class="cal-event-check" data-id="${e.id}" ${e.done ? 'checked' : ''} title="Cumplido">`
          : `<span class="cal-dot ${e.kind}"></span>`}
        <div>
          <div class="cal-event-title">${e.title}${e.notes ? ` — ${e.notes}` : ''}</div>
          <div class="cal-event-meta">${metaParts.join(' · ')}</div>
        </div>
        ${isManual ? `
          <button class="cal-event-edit" data-id="${e.id}" title="Editar">✎</button>
          <button class="cal-event-del" data-id="${e.id}" title="Borrar">✕</button>
        ` : ''}
      </div>
    `;
  }).join('');
  container.querySelectorAll('.cal-event-del').forEach(btn => {
    btn.addEventListener('click', () => deleteEvent(btn.dataset.id));
  });
  container.querySelectorAll('.cal-event-edit').forEach(btn => {
    btn.addEventListener('click', () => editEvent(btn.dataset.id));
  });
  container.querySelectorAll('.cal-event-check').forEach(chk => {
    chk.addEventListener('change', () => toggleDone(chk.dataset.id, chk.checked));
  });
}

document.getElementById('prevBtn').addEventListener('click', () => {
  viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  loadMonth();
});
document.getElementById('nextBtn').addEventListener('click', () => {
  viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  loadMonth();
});
document.getElementById('todayBtn').addEventListener('click', () => {
  viewYear = new Date().getFullYear(); viewMonth = new Date().getMonth(); selectedDate = todayStr;
  loadMonth();
});

const addForm = document.getElementById('addForm');
const formHeading = document.getElementById('formHeading');
const saveFormBtn = document.getElementById('saveFormBtn');
let editingId = null;

function openForm(prefill) {
  editingId = prefill ? prefill.id : null;
  formHeading.textContent = editingId ? 'Editar cita' : 'Nueva cita';
  saveFormBtn.textContent = editingId ? 'Guardar cambios' : 'Guardar cita';
  document.getElementById('fTitle').value = prefill ? prefill.title : '';
  document.getElementById('fDate').value = prefill ? prefill.date : selectedDate;
  document.getElementById('fTime').value = prefill ? prefill.time : '';
  document.getElementById('fNotes').value = prefill ? prefill.notes : '';
  addForm.classList.add('show');
  document.getElementById('fTitle').focus();
}

document.getElementById('addBtn').addEventListener('click', () => openForm(null));
document.getElementById('cancelFormBtn').addEventListener('click', () => addForm.classList.remove('show'));
saveFormBtn.addEventListener('click', async () => {
  const title = document.getElementById('fTitle').value.trim();
  const event_date = document.getElementById('fDate').value;
  const event_time = document.getElementById('fTime').value;
  const notes = document.getElementById('fNotes').value.trim();
  if (!title || !event_date) return;
  const url = editingId ? `/api/calendar-events/${editingId}` : '/api/calendar-events';
  await fetch(url, {
    method: editingId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, notes, event_date, event_time }),
  });
  addForm.classList.remove('show');
  editingId = null;
  selectedDate = event_date;
  const [y, m] = event_date.split('-').map(Number);
  viewYear = y; viewMonth = m - 1;
  loadMonth();
});

loadMonth();
