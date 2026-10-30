// The 2D office: one column per room, agents as chips that move between columns.
// Used when WebGL 2 is missing, under prefers-reduced-motion, or when chosen with the toggle.
import { colorFor, personMarks, stageFor } from './crew.js';

const STATUS_ORDER = { working: 0, idle: 1, done: 2 };
const STATUS_TEXT = { working: 'Working', idle: 'Waiting', done: 'Done' };

export function createBoard(container, { rooms, reducedMotion }) {
  let motionOff = reducedMotion;
  const board = document.createElement('div');
  board.className = 'board';
  board.setAttribute('role', 'region');
  board.setAttribute('aria-label', 'Office board');

  const columns = new Map();
  for (const room of rooms) {
    const column = document.createElement('section');
    column.className = 'col';
    column.dataset.room = room.id;
    const heading = document.createElement('h3');
    heading.className = 'col-title';
    heading.textContent = room.label;
    const hint = document.createElement('p');
    hint.className = 'col-hint';
    hint.textContent = room.hint || '';
    const list = document.createElement('ul');
    list.className = 'chips';
    list.setAttribute('aria-label', `${room.label} agents`);
    const quiet = document.createElement('p');
    quiet.className = 'col-empty';
    quiet.textContent = 'Empty';
    column.append(heading, hint, list, quiet);
    board.append(column);
    columns.set(room.id, { column, list, quiet });
  }
  container.replaceChildren(board);

  const chips = new Map();

  function chipFor(agent) {
    let chip = chips.get(agent.key);
    if (chip) return { chip, isNew: false };
    const li = document.createElement('li');
    li.className = 'chip';
    const head = document.createElement('div');
    head.className = 'chip-head';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');
    const name = document.createElement('strong');
    name.className = 'chip-name';
    const status = document.createElement('span');
    status.className = 'chip-status';
    const { photo, tag } = personMarks(agent, 'chip-photo');
    head.append(photo || dot, name, ...(tag ? [tag] : []), status);
    const action = document.createElement('p');
    action.className = 'chip-action';
    const task = document.createElement('p');
    task.className = 'chip-task';
    li.append(head, action, task);
    chip = { li, name, status, action, task };
    chips.set(agent.key, chip);
    return { chip, isNew: true };
  }

  function fill(chip, agent) {
    chip.li.dataset.status = agent.status;
    chip.li.style.setProperty('--agent', colorFor(agent.type));
    chip.name.textContent = agent.label || 'Agent';
    chip.status.textContent = agent.status === 'done' ? '✓ Done' : STATUS_TEXT[agent.status] || agent.status;
    chip.action.textContent = agent.status === 'done' ? 'Finished' : agent.text || '';
    chip.task.textContent = agent.task || '';
    chip.task.hidden = !agent.task;
  }

  function sync(agents, { reset = false } = {}) {
    const animate = !motionOff && !reset && typeof Element.prototype.animate === 'function';
    const before = new Map();
    if (animate) for (const [key, chip] of chips) before.set(key, chip.li.getBoundingClientRect());

    if (reset) {
      chips.clear();
      for (const { list } of columns.values()) list.replaceChildren();
    }

    const seen = new Set();
    const byRoom = new Map([...columns.keys()].map((id) => [id, []]));
    for (const agent of agents) {
      const roomId = byRoom.has(agent.stage) ? agent.stage : 'build';
      byRoom.get(roomId)?.push(agent);
    }

    const created = [];
    for (const [roomId, list] of byRoom) {
      list.sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || (a.startedAt || 0) - (b.startedAt || 0));
      const target = columns.get(roomId);
      const items = list.map((agent) => {
        seen.add(agent.key);
        const { chip, isNew } = chipFor(agent);
        fill(chip, agent);
        if (isNew && !reset) created.push(chip.li);
        return chip.li;
      });
      target.list.replaceChildren(...items);
      target.quiet.hidden = items.length > 0;
      target.column.dataset.busy = String(list.some((agent) => agent.status === 'working'));
    }

    for (const [key, chip] of chips) {
      if (!seen.has(key)) {
        chip.li.remove();
        chips.delete(key);
      }
    }

    if (!animate) return;
    // FLIP: chips start where they were and glide to their new place.
    for (const [key, rect] of before) {
      const chip = chips.get(key);
      if (!chip) continue;
      const now = chip.li.getBoundingClientRect();
      const dx = rect.left - now.left;
      const dy = rect.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      chip.li.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    for (const li of created) {
      li.animate([{ opacity: 0, transform: 'translateY(-8px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'ease-out' });
    }
  }

  function handoff(event) {
    if (motionOff) return;
    const target = columns.get(stageForTarget(event, rooms));
    if (!target) return;
    target.column.classList.remove('col-flash');
    // Restart the highlight even when hand-offs to the same room follow each other quickly.
    void target.column.offsetWidth;
    target.column.classList.add('col-flash');
  }

  return {
    sync,
    handoff,
    setReducedMotion(value) {
      motionOff = value;
    },
    dispose() {
      chips.clear();
      container.replaceChildren();
    },
  };
}

function stageForTarget(event, rooms) {
  const stage = stageFor(event.target);
  return rooms.some((room) => room.id === stage) ? stage : rooms[0]?.id;
}
