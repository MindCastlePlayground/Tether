import { createServer } from 'node:http';

const CATALOG = [
  { sku: 'PEN-01', name: 'Field Notebook', priceCents: 1250 },
  { sku: 'LAMP-02', name: 'Desk Lamp', priceCents: 4800 },
  { sku: 'MUG-03', name: 'Clay Mug', priceCents: 925 }
];
const BOOK_DATE = '2026-11-20';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function page(title, body, script = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>${body}<script>${script}</script></body></html>`;
}
function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}
function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(Error('body_too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(payload);
}

function createStore() {
  const ledger = Array.from({ length: 60 }, (_, index) => {
    const n = index + 1;
    return { id: `L-${String(n).padStart(3, '0')}`, owner: n % 3 === 0 ? 'north' : 'south', status: 'open', amount: n * 10 };
  });
  return {
    orders: [],
    profile: null,
    tickets: [],
    bookings: [],
    slots: { [BOOK_DATE]: { morning: 'open', afternoon: 'open', evening: 'open' } },
    ledger,
    ledgerBaseline: structuredClone(ledger),
    docs: [],
    dialogs: [],
    deskOrder: { id: 'PO-100', sku: 'LAMP-02', qty: 1, note: 'initial-note' },
    yard: []
  };
}

const shopScript = `
const cart = [];
function money(cents){return (cents/100).toFixed(2);}
function renderCart(){
  const host = document.querySelector('#cart');
  host.replaceChildren();
  for (const item of cart) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = item.name;
    const qty = document.createElement('input');
    qty.id = 'qty-' + item.sku;
    qty.value = String(item.qty);
    const update = document.createElement('button');
    update.type = 'button';
    update.id = 'update-' + item.sku;
    update.textContent = 'Update ' + item.sku;
    update.onclick = () => { item.qty = Number(qty.value); document.querySelector('#cart-result').textContent = item.sku + ':' + item.qty; };
    li.append(name, qty, update);
    host.appendChild(li);
  }
}
async function search(){
  const q = document.querySelector('#q').value;
  const rows = await fetch('/api/catalog?q=' + encodeURIComponent(q)).then(r => r.json());
  const host = document.querySelector('#results');
  host.replaceChildren();
  for (const row of rows) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = row.name + ' ' + money(row.priceCents);
    const add = document.createElement('button');
    add.type = 'button';
    add.id = 'add-' + row.sku;
    add.textContent = 'Add ' + row.name;
    add.onclick = () => { if (!cart.some(item => item.sku === row.sku)) cart.push({ sku: row.sku, name: row.name, qty: 1 }); renderCart(); };
    li.append(name, add);
    host.appendChild(li);
  }
  document.querySelector('#search-result').textContent = 'hits:' + rows.length;
}
document.querySelector('#search').onclick = () => search().catch(error => { document.querySelector('#search-result').textContent = error.message; });
document.querySelector('#checkout').onclick = async () => {
  const items = cart.map(item => ({ sku: item.sku, qty: Number(document.querySelector('#qty-' + item.sku).value) }));
  const res = await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) });
  const body = await res.json();
  document.querySelector('#order-result').textContent = res.ok ? ('order:' + body.id + ' total:' + body.total) : ('error:' + body.error);
};
`;

const profileScript = `
document.querySelector('#save').onclick = async () => {
  const body = {
    accountId: document.querySelector('#account').value,
    displayName: document.querySelector('#display').value,
    department: document.querySelector('#department').value,
    phone: document.querySelector('#phone').value
  };
  const res = await fetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const saved = await res.json();
  document.querySelector('#profile-result').textContent = res.ok ? ('saved:' + saved.displayName) : 'error';
};
`;

const ticketScript = `
function render(data){
  document.querySelector('#ticket-list').textContent = data.tickets.map(ticket => ticket.id + '|' + ticket.status + '|' + ticket.title).join(',');
  document.querySelector('#ticket-history').textContent = data.history.map(item => item.id + ':' + item.from + '>' + item.to).join(',');
}
async function load(status){
  const data = await fetch('/api/tickets' + (status ? '?status=' + encodeURIComponent(status) : '')).then(r => r.json());
  render(data);
  document.querySelector('#filter-result').textContent = 'filter:' + (status || 'all') + ' count:' + data.tickets.length;
}
document.querySelector('#create').onclick = async () => {
  const res = await fetch('/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    title: document.querySelector('#title').value,
    body: document.querySelector('#body').value,
    priority: document.querySelector('#priority').value
  })});
  const ticket = await res.json();
  document.querySelector('#create-result').textContent = 'created:' + ticket.id;
  await load('');
};
document.querySelector('#filter-open').onclick = () => load('open');
document.querySelector('#filter-done').onclick = () => load('done');
document.querySelector('#apply-status').onclick = async () => {
  const id = document.querySelector('#ticket-id').value;
  const status = document.querySelector('#next-status').value;
  const res = await fetch('/api/tickets/' + encodeURIComponent(id) + '/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) });
  const body = await res.json();
  document.querySelector('#status-result').textContent = res.ok ? ('status:' + body.status) : 'error';
  await load(document.querySelector('#filter-result').textContent.includes('done') ? 'done' : '');
};
`;

const bookScript = `
async function load(){
  const date = document.querySelector('#date').value;
  const data = await fetch('/api/slots?date=' + encodeURIComponent(date)).then(r => r.json());
  for (const name of ['morning','afternoon','evening']) document.querySelector('#state-' + name).textContent = name + ':' + data.slots[name];
}
document.querySelector('#refresh-slots').onclick = () => load();
document.querySelector('#book').onclick = async () => {
  const res = await fetch('/api/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    date: document.querySelector('#date').value,
    slot: document.querySelector('#slot').value,
    contact: document.querySelector('#contact').value
  })});
  const body = await res.json();
  document.querySelector('#book-result').textContent = res.ok ? ('booked:' + body.id) : ('error:' + body.error);
  if (res.ok) document.querySelector('#booking-id').value = body.id;
  await load();
};
document.querySelector('#cancel').onclick = async () => {
  const id = document.querySelector('#booking-id').value;
  const res = await fetch('/api/bookings/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
  const body = await res.json();
  document.querySelector('#book-result').textContent = res.ok ? ('cancelled:' + body.id) : 'error';
  await load();
};
load();
`;

const ledgerScript = `
document.querySelector('#apply').onclick = () => {
  const owner = document.querySelector('#owner').value;
  location.href = '/ledger?owner=' + encodeURIComponent(owner) + '&page=1';
};
document.querySelector('#next').onclick = () => {
  const params = new URLSearchParams(location.search);
  const page = Number(params.get('page') || '1') + 1;
  params.set('page', String(page));
  location.href = '/ledger?' + params.toString();
};
for (const button of document.querySelectorAll('[data-save]')) {
  button.onclick = async () => {
    const id = button.dataset.save;
    const status = document.querySelector('#status-' + id).value;
    const res = await fetch('/api/ledger/' + encodeURIComponent(id), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) });
    const body = await res.json();
    document.querySelector('#row-' + id).dataset.state = body.status;
    document.querySelector('#label-' + id).textContent = id + ':' + body.status;
  };
}
`;

const docsScript = `
document.querySelector('#submit-doc').onclick = async () => {
  const file = document.querySelector('#doc').files[0];
  if (!file) { document.querySelector('#doc-result').textContent = 'missing-file'; return; }
  const text = await file.text();
  const res = await fetch('/api/docs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    title: document.querySelector('#doc-title').value, name: file.name, text
  })});
  const body = await res.json();
  document.querySelector('#doc-result').textContent = res.ok ? ('stored:' + body.id + ' name:' + body.name) : 'error';
  document.querySelector('#file-url').textContent = body.url || '';
};
`;

const dialogScript = `
document.querySelector('#rename').onclick = async () => {
  const name = prompt('Batch name?', 'batch-default');
  if (name === null) { document.querySelector('#dialog-result').textContent = 'prompt-cancelled'; return; }
  const res = await fetch('/api/dialogs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'rename', name }) });
  const body = await res.json();
  document.querySelector('#dialog-result').textContent = 'renamed:' + body.name;
};
document.querySelector('#discard').onclick = async () => {
  const ok = confirm('Discard draft 441?');
  if (!ok) { document.querySelector('#dialog-result').textContent = 'cancel-kept'; return; }
  await fetch('/api/dialogs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'discard' }) });
  document.querySelector('#dialog-result').textContent = 'discarded';
};
`;

const ordersScript = `
document.querySelector('#open-detail').onclick = () => { window.open('/orders/detail?id=PO-100', 'po100', 'width=640,height=720'); };
document.querySelector('#reload-order').onclick = async () => {
  const order = await fetch('/api/desk/PO-100').then(r => r.json());
  document.querySelector('#main-note').textContent = 'note:' + order.note;
};
`;

const detailScript = `
document.querySelector('#save-note').onclick = async () => {
  const note = document.querySelector('#note').value;
  const res = await fetch('/api/desk/PO-100/note', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note }) });
  const body = await res.json();
  document.querySelector('#detail-result').textContent = 'detail:' + body.note;
};
`;

const yardScript = `
document.querySelector('#commit').onclick = async () => {
  const value = document.querySelector('#c7').value;
  const res = await fetch('/api/yard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ control: 'c7', value }) });
  const body = await res.json();
  document.querySelector('#yard-result').textContent = 'committed:' + body.count + ':' + body.value;
};
document.querySelector('#rerender').onclick = () => {
  for (const input of [...document.querySelectorAll('#yard input')]) {
    const next = input.cloneNode(true);
    next.value = '';
    input.replaceWith(next);
  }
  const old = document.querySelector('#commit');
  const commit = old.cloneNode(true);
  old.replaceWith(commit);
  commit.addEventListener('click', async () => {
    const value = document.querySelector('#c7').value;
    const res = await fetch('/api/yard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ control: 'c7', value }) });
    const body = await res.json();
    document.querySelector('#yard-result').textContent = 'committed:' + body.count + ':' + body.value;
  });
  document.querySelector('#yard-result').textContent = 'rerendered';
};
document.querySelector('#inflate').onclick = () => {
  const host = document.querySelector('#bulk');
  const label = 'K'.repeat(900);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 750; i++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label + '-' + i;
    frag.appendChild(button);
  }
  host.replaceChildren(frag);
  document.querySelector('#yard-result').textContent = 'inflated';
};
document.querySelector('#deflate').onclick = () => {
  document.querySelector('#bulk').replaceChildren();
  document.querySelector('#yard-result').textContent = 'deflated';
};
`;

function ledgerView(store, owner, pageNumber) {
  const filtered = store.ledger.filter(row => !owner || row.owner === owner);
  const size = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(Math.max(pageNumber, 1), pageCount);
  const rows = filtered.slice((current - 1) * size, current * size);
  const list = rows.map(row => `<li id="row-${esc(row.id)}" data-state="${esc(row.status)}"><span id="label-${esc(row.id)}">${esc(row.id)}:${esc(row.status)}:${esc(row.owner)}</span><input id="status-${esc(row.id)}" value="approved"><button type="button" id="save-${esc(row.id)}" data-save="${esc(row.id)}">Save ${esc(row.id)}</button></li>`).join('');
  return page('Ledger', `<h1>Ledger</h1><p id="ledger-meta">owner:${esc(owner || 'all')} page:${current} rows:${filtered.length}</p><label>Owner <input id="owner" value="${esc(owner)}"></label><button id="apply" type="button">Apply filter</button><ol id="rows">${list}</ol><button id="next" type="button">Next page</button>`, ledgerScript);
}

function profileView(profile) {
  const value = profile ?? { accountId: 'biz-test-7', displayName: '', department: '', phone: '' };
  return page('Account profile', `<h1>Account profile</h1><label>Account <input id="account" value="${esc(value.accountId)}" readonly></label><label>Display name <input id="display" value="${esc(value.displayName)}"></label><label>Department <input id="department" value="${esc(value.department)}"></label><label>Phone <input id="phone" value="${esc(value.phone)}"></label><button id="save" type="button">Save profile</button><output id="profile-result">${value.displayName ? 'loaded:' + esc(value.displayName) : 'new'}</output>`, profileScript);
}

function routes(store, vendorUrl) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/shop') return send(res, 200, page('Shop', '<h1>Shop</h1><label>Search <input id="q"></label><button id="search" type="button">Search catalog</button><output id="search-result">idle</output><ul id="results"></ul><h2>Cart</h2><ul id="cart"></ul><output id="cart-result">empty</output><button id="checkout" type="button">Submit order</button><output id="order-result">none</output>', shopScript));
      if (req.method === 'GET' && url.pathname === '/api/catalog') {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        return send(res, 200, CATALOG.filter(item => !q || item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q)));
      }
      if (req.method === 'POST' && url.pathname === '/api/checkout') {
        const body = JSON.parse(await readBody(req));
        if (!Array.isArray(body.items) || !body.items.length) return send(res, 400, { error: 'empty_cart' });
        let totalCents = 0;
        const items = [];
        for (const item of body.items) {
          const product = CATALOG.find(entry => entry.sku === item.sku);
          const qty = item.qty;
          if (!product || !Number.isInteger(qty) || qty < 1 || qty > 20) return send(res, 400, { error: 'bad_item' });
          totalCents += product.priceCents * qty;
          items.push({ sku: product.sku, name: product.name, qty, priceCents: product.priceCents });
        }
        const order = { id: `ord-${store.orders.length + 1}`, items, totalCents, total: (totalCents / 100).toFixed(2) };
        store.orders.push(order);
        return send(res, 201, order);
      }
      if (req.method === 'GET' && url.pathname === '/account') return send(res, 200, profileView(store.profile));
      if (req.method === 'POST' && url.pathname === '/api/profile') {
        const body = JSON.parse(await readBody(req));
        if (body.accountId !== 'biz-test-7') return send(res, 403, { error: 'account_rejected' });
        for (const key of ['displayName', 'department', 'phone']) if (typeof body[key] !== 'string' || body[key].length > 80) return send(res, 400, { error: 'bad_profile' });
        store.profile = { accountId: body.accountId, displayName: body.displayName, department: body.department, phone: body.phone };
        return send(res, 200, store.profile);
      }
      if (req.method === 'GET' && url.pathname === '/tickets') return send(res, 200, page('Tickets', '<h1>Tickets</h1><label>Title <input id="title"></label><label>Body <textarea id="body"></textarea></label><label>Priority <input id="priority" value="normal"></label><button id="create" type="button">Create ticket</button><output id="create-result">none</output><button id="filter-open" type="button">Filter open</button><button id="filter-done" type="button">Filter done</button><output id="filter-result">filter:all count:0</output><label>Ticket <input id="ticket-id"></label><label>Next status <input id="next-status" value="done"></label><button id="apply-status" type="button">Apply status</button><output id="status-result">none</output><p id="ticket-list"></p><p id="ticket-history"></p>', ticketScript));
      if (req.method === 'GET' && url.pathname === '/api/tickets') {
        const status = url.searchParams.get('status');
        const tickets = store.tickets.filter(ticket => !status || ticket.status === status).map(({ id, title, status: ticketStatus }) => ({ id, title, status: ticketStatus }));
        const history = store.tickets.flatMap(ticket => ticket.history.map(item => ({ id: ticket.id, ...item })));
        return send(res, 200, { tickets, history });
      }
      if (req.method === 'POST' && url.pathname === '/api/tickets') {
        const body = JSON.parse(await readBody(req));
        if (typeof body.title !== 'string' || !body.title || typeof body.body !== 'string') return send(res, 400, { error: 'bad_ticket' });
        const ticket = { id: `T-${store.tickets.length + 1}`, title: body.title, body: body.body, priority: body.priority || 'normal', status: 'open', history: [{ from: 'none', to: 'open' }] };
        store.tickets.push(ticket);
        return send(res, 201, { id: ticket.id, status: ticket.status });
      }
      const ticketStatus = url.pathname.match(/^\/api\/tickets\/([^/]+)\/status$/);
      if (req.method === 'POST' && ticketStatus) {
        const ticket = store.tickets.find(item => item.id === decodeURIComponent(ticketStatus[1]));
        const body = JSON.parse(await readBody(req));
        if (!ticket || !['open', 'done'].includes(body.status)) return send(res, 400, { error: 'bad_status' });
        ticket.history.push({ from: ticket.status, to: body.status });
        ticket.status = body.status;
        return send(res, 200, { id: ticket.id, status: ticket.status, history: ticket.history });
      }
      if (req.method === 'GET' && url.pathname === '/book') return send(res, 200, page('Booking', `<h1>Booking</h1><label>Date <input id="date" value="${BOOK_DATE}"></label><button id="refresh-slots" type="button">Refresh slots</button><p id="state-morning"></p><p id="state-afternoon"></p><p id="state-evening"></p><label>Slot <input id="slot" value="afternoon"></label><label>Contact <input id="contact"></label><button id="book" type="button">Book slot</button><label>Booking <input id="booking-id"></label><button id="cancel" type="button">Cancel booking</button><output id="book-result">none</output>`, bookScript));
      if (req.method === 'GET' && url.pathname === '/api/slots') {
        const date = url.searchParams.get('date');
        const slots = store.slots[date];
        if (!slots) return send(res, 404, { error: 'bad_date' });
        return send(res, 200, { date, slots });
      }
      if (req.method === 'POST' && url.pathname === '/api/bookings') {
        const body = JSON.parse(await readBody(req));
        const slots = store.slots[body.date];
        if (!slots || !['morning', 'afternoon', 'evening'].includes(body.slot) || typeof body.contact !== 'string' || !body.contact) return send(res, 400, { error: 'bad_booking' });
        if (slots[body.slot] !== 'open') return send(res, 409, { error: 'slot_taken' });
        const booking = { id: `B-${store.bookings.length + 1}`, date: body.date, slot: body.slot, contact: body.contact, status: 'booked' };
        slots[body.slot] = booking.id;
        store.bookings.push(booking);
        return send(res, 201, booking);
      }
      const cancel = url.pathname.match(/^\/api\/bookings\/([^/]+)\/cancel$/);
      if (req.method === 'POST' && cancel) {
        const booking = store.bookings.find(item => item.id === decodeURIComponent(cancel[1]));
        if (!booking || booking.status !== 'booked') return send(res, 404, { error: 'booking_missing' });
        booking.status = 'cancelled';
        store.slots[booking.date][booking.slot] = 'open';
        return send(res, 200, booking);
      }
      if (req.method === 'GET' && url.pathname === '/ledger') return send(res, 200, ledgerView(store, url.searchParams.get('owner') || '', Number(url.searchParams.get('page') || '1')));
      const ledgerSave = url.pathname.match(/^\/api\/ledger\/([^/]+)$/);
      if (req.method === 'POST' && ledgerSave) {
        const row = store.ledger.find(item => item.id === decodeURIComponent(ledgerSave[1]));
        const body = JSON.parse(await readBody(req));
        if (!row || !['open', 'approved', 'held'].includes(body.status)) return send(res, 400, { error: 'bad_row' });
        row.status = body.status;
        return send(res, 200, row);
      }
      if (req.method === 'GET' && url.pathname === '/docs') return send(res, 200, page('Documents', '<h1>Documents</h1><label>Title <input id="doc-title"></label><label>File <input id="doc" type="file"></label><button id="submit-doc" type="button">Submit document</button><output id="doc-result">none</output><p id="file-url"></p>', docsScript));
      if (req.method === 'POST' && url.pathname === '/api/docs') {
        const body = JSON.parse(await readBody(req));
        if (typeof body.title !== 'string' || typeof body.name !== 'string' || typeof body.text !== 'string' || !body.name) return send(res, 400, { error: 'bad_doc' });
        const doc = { id: `D-${store.docs.length + 1}`, title: body.title, name: body.name, text: body.text };
        store.docs.push(doc);
        return send(res, 201, { id: doc.id, name: doc.name, bytes: Buffer.byteLength(doc.text), url: `/api/docs/${doc.id}/file` });
      }
      const file = url.pathname.match(/^\/api\/docs\/([^/]+)\/file$/);
      if (req.method === 'GET' && file) {
        const doc = store.docs.find(item => item.id === decodeURIComponent(file[1]));
        if (!doc) return send(res, 404, 'missing');
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${doc.name.replace(/"/g, '')}"` });
        res.end(doc.text);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/prompts') return send(res, 200, page('Prompts', '<h1>Prompt desk</h1><p id="draft">draft-441</p><button id="rename" type="button">Rename batch</button><button id="discard" type="button">Discard draft</button><output id="dialog-result">none</output>', dialogScript));
      if (req.method === 'POST' && url.pathname === '/api/dialogs') {
        const body = JSON.parse(await readBody(req));
        if (body.action === 'rename' && typeof body.name === 'string') { store.dialogs.push({ action: 'rename', name: body.name }); return send(res, 200, { name: body.name }); }
        if (body.action === 'discard') { store.dialogs.push({ action: 'discard' }); return send(res, 200, { action: 'discard' }); }
        return send(res, 400, { error: 'bad_dialog' });
      }
      if (req.method === 'GET' && url.pathname === '/orders') return send(res, 200, page('Orders', `<h1>Order ${esc(store.deskOrder.id)}</h1><button id="open-detail" type="button">Open detail</button><button id="reload-order" type="button">Reload order</button><p id="main-note">note:${esc(store.deskOrder.note)}</p>`, ordersScript));
      if (req.method === 'GET' && url.pathname === '/orders/detail') return send(res, 200, page('Order detail', `<h1>Detail ${esc(store.deskOrder.id)}</h1><p id="detail-sku">${esc(store.deskOrder.sku)}</p><label>Note <input id="note" value="${esc(store.deskOrder.note)}"></label><button id="save-note" type="button">Save note</button><output id="detail-result">detail:${esc(store.deskOrder.note)}</output>`, detailScript));
      if (req.method === 'GET' && url.pathname === '/api/desk/PO-100') return send(res, 200, store.deskOrder);
      if (req.method === 'POST' && url.pathname === '/api/desk/PO-100/note') {
        const body = JSON.parse(await readBody(req));
        if (typeof body.note !== 'string' || !body.note || body.note.length > 200) return send(res, 400, { error: 'bad_note' });
        store.deskOrder.note = body.note;
        return send(res, 200, store.deskOrder);
      }
      if (req.method === 'GET' && url.pathname === '/portal') return send(res, 200, page('Vendor portal', `<h1>Vendor portal</h1><iframe id="vendor" src="${esc(vendorUrl)}/form" width="900" height="700"></iframe>`));
      if (req.method === 'GET' && url.pathname === '/yard') {
        let controls = '';
        for (let i = 0; i < 220; i++) controls += `<input id="c${i}" aria-label="Y${i}" value="">`;
        return send(res, 200, page('Yard', `<h1>Yard</h1><div id="yard">${controls}<button id="commit" type="button">Commit yard</button><button id="rerender" type="button">Rerender yard</button></div><button id="inflate" type="button">Inflate yard</button><button id="deflate" type="button">Deflate yard</button><div id="bulk"></div><output id="yard-result">idle</output>`, yardScript));
      }
      if (req.method === 'POST' && url.pathname === '/api/yard') {
        const body = JSON.parse(await readBody(req));
        if (body.control !== 'c7' || typeof body.value !== 'string') return send(res, 400, { error: 'bad_yard' });
        store.yard.push({ control: 'c7', value: body.value });
        return send(res, 200, { count: store.yard.length, value: body.value });
      }
      send(res, 404, 'missing');
    } catch (error) {
      if (!res.headersSent) send(res, 500, { error: error.message });
    }
  };
}

const vendorScript = `
document.querySelector('#send-intake').onclick = async () => {
  const file = document.querySelector('#invoice').files[0];
  const text = file ? await file.text() : '';
  const res = await fetch('/api/intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    company: document.querySelector('#company').value,
    amount: document.querySelector('#amount').value,
    memo: document.querySelector('#memo').value,
    fileName: file ? file.name : '',
    text
  })});
  const body = await res.json();
  document.querySelector('#intake-result').textContent = res.ok ? ('intake:' + body.id + ':' + body.company) : 'error';
};
`;

export async function startBusiness() {
  const store = createStore();
  const vendorStore = { intakes: [] };
  const vendorServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/form') {
        return send(res, 200, page('Vendor intake', '<h1>Vendor intake</h1><label>Company <input id="company"></label><label>Amount <input id="amount"></label><label>Memo <input id="memo"></label><label>Invoice <input id="invoice" type="file"></label><button id="send-intake" type="button">Send intake</button><output id="intake-result">none</output>', vendorScript));
      }
      if (req.method === 'POST' && url.pathname === '/api/intake') {
        const body = JSON.parse(await readBody(req));
        if (typeof body.company !== 'string' || !body.company || typeof body.amount !== 'string' || typeof body.text !== 'string') return send(res, 400, { error: 'bad_intake' });
        const intake = { id: `V-${vendorStore.intakes.length + 1}`, company: body.company, amount: body.amount, memo: body.memo || '', fileName: body.fileName || '', text: body.text };
        vendorStore.intakes.push(intake);
        return send(res, 201, { id: intake.id, company: intake.company });
      }
      send(res, 404, 'missing');
    } catch (error) {
      if (!res.headersSent) send(res, 500, { error: error.message });
    }
  });
  const vendorPort = await listen(vendorServer);
  const vendorUrl = `http://localhost:${vendorPort}`;
  const server = createServer(routes(store, vendorUrl));
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    vendorUrl,
    store,
    vendorStore,
    async close() {
      await Promise.all([server, vendorServer].map(item => new Promise((resolve, reject) => {
        item.close(error => error ? reject(error) : resolve());
        item.closeAllConnections();
      })));
    }
  };
}
