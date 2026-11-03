import { Failure, NetworkCdp as Cdp, NetworkLimits as Limit, NetworkOp as Op } from './protocol.js';

export class NetworkCapture {
  constructor(api) { this.api = api; this.pages = new Map(); this.serial = 0; }

  async run(page, p, authorized) {
    if (!Object.values(Op).includes(p.op)) throw new Error(Failure.Invalid);
    for (const value of [p.url, p.type]) if (value !== undefined && (typeof value !== 'string' || value.length > Limit.Text)) throw new Error(Failure.Invalid);
    await authorized();
    let state = this.pages.get(page.pageId);
    if (p.op === Op.Start) {
      if (!page.attached) throw new Error(Failure.Forbidden);
      if (!state) { state = { rows: [], byId: new Map(), current: new Map(), active: false, dropped: 0 }; this.pages.set(page.pageId, state); }
      if (!state.active) {
        await this.api.debugger.sendCommand({ tabId: page.tabId }, Cdp.Enable, {});
        await authorized();
        state.active = true;
      }
      return { active: true, count: state.rows.length };
    }
    if (!state) throw new Error(Failure.NetworkUnavailable);
    if (p.op === Op.Stop) { state.active = false; return { active: false, count: state.rows.length, dropped: state.dropped }; }
    if (p.op === Op.Clear) { state.rows.length = 0; state.byId.clear(); state.current.clear(); state.dropped = 0; return { count: 0, active: state.active }; }
    if (p.op === Op.List) {
      const offset = NetworkData.integer(p.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = NetworkData.integer(p.limit, 50, 1, 100);
      const rows = state.rows.filter(x => (!p.url || x.url.includes(p.url)) && (!p.type || x.type === p.type));
      return { requests: rows.slice(offset, offset + limit).map(NetworkData.summary), total: rows.length, offset,
        nextOffset: offset + limit < rows.length ? offset + limit : null, dropped: state.dropped, active: state.active };
    }
    if (typeof p.requestId !== 'string' || !p.requestId || p.requestId.length > Limit.Text) throw new Error(Failure.Invalid);
    const row = state.byId.get(p.requestId);
    if (!row) throw new Error(Failure.Missing);
    if (p.op === Op.Detail) { const { cdpRequestId, ...detail } = row; return { request: structuredClone(detail) }; }
    const offset = NetworkData.integer(p.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const maxChars = NetworkData.integer(p.maxChars, Limit.BodyDefault, 1, Limit.BodyChunk);
    if (row.failed || row.redirected || row.type === Cdp.SocketType) throw new Error(Failure.NetworkUnavailable);
    if (!row.finished) throw new Error(Failure.NetworkPending);
    let result;
    try { result = await this.api.debugger.sendCommand({ tabId: page.tabId }, Cdp.Body, { requestId: row.cdpRequestId }); }
    catch { await authorized(); throw new Error(Failure.NetworkUnavailable); }
    await authorized();
    if (this.pages.get(page.pageId) !== state || state.byId.get(p.requestId) !== row) throw new Error(Failure.Missing);
    if (typeof result.body !== 'string') throw new Error(Failure.NetworkUnavailable);
    const body = result.body.slice(offset, offset + maxChars);
    return { body, base64Encoded: result.base64Encoded === true, total: result.body.length,
      offset, nextOffset: offset + body.length < result.body.length ? offset + body.length : null };
  }

  event(pageId, method, p = {}) {
    const state = this.pages.get(pageId); if (!state?.active) return;
    if (method === Cdp.Request || method === Cdp.Socket) {
      const old = state.current.get(p.requestId);
      if (p.redirectResponse && old) {
        old.response = NetworkData.copy(p.redirectResponse, old);
        old.finished = true; old.redirected = true;
        old.duration = p.timestamp - old.started;
      }
      const row = { requestId: `r${++this.serial}`, cdpRequestId: p.requestId,
        url: (p.request?.url ?? p.url ?? '').slice(0, Limit.Text), method: p.request?.method?.slice(0,32),
        type: method === Cdp.Socket ? Cdp.SocketType : p.type, started: p.timestamp, events: [] };
      row.truncated = (p.request?.url ?? p.url ?? '').length > Limit.Text;
      row.request = NetworkData.copy(p.request ?? {url:p.url}, row);
      row.initiator = NetworkData.copy(p.initiator, row);
      if (old && p.redirectResponse) row.redirectFrom = old.requestId;
      if (state.rows.length >= Limit.Requests) {
        const dropped = state.rows.shift(); state.byId.delete(dropped.requestId);
        if (state.current.get(dropped.cdpRequestId) === dropped) state.current.delete(dropped.cdpRequestId);
        state.dropped++;
      }
      state.rows.push(row); state.byId.set(row.requestId, row); state.current.set(p.requestId, row);
      return;
    }
    const row = state.current.get(p.requestId); if (!row) return;
    if (method === Cdp.Response) row.response = NetworkData.copy(p.response, row);
    // ExtraInfo may arrive out of order for redirects; keep events without replacing hop headers.
    else if (method === Cdp.RequestExtra || method === Cdp.ResponseExtra) NetworkData.push(row, method, p);
    else if (method === Cdp.Finished) { row.finished = true; row.encodedDataLength = p.encodedDataLength; row.duration = p.timestamp - (row.started ?? p.timestamp); }
    else if (method === Cdp.Failed) { row.failed = NetworkData.copy(p.errorText, row); row.canceled = p.canceled === true; row.finished = true; row.blockedReason = p.blockedReason; }
    else if (method === Cdp.Cache) row.fromCache = true;
    else if (method.startsWith(Cdp.SocketPrefix) || method === Cdp.SSE) NetworkData.push(row, method, p);
  }

  drop(pageId) { this.pages.delete(pageId); }
}

export class NetworkData {
  static integer(v, fallback, min, max) { if (v === undefined) return fallback; if (!Number.isSafeInteger(v) || v < min || v > max) throw new Error(Failure.Invalid); return v; }
  static copy(value, row, max = Limit.Metadata) {
    let left = max;
    const visit = (v, depth = 0) => {
      if (left <= 0 || depth > 8) { row.truncated = true; return null; }
      if (typeof v === 'string') { const n = Math.min(left, Limit.Text); const text = v.slice(0,n); left -= text.length; if (text.length < v.length) row.truncated = true; return text; }
      if (v && typeof v === 'object') {
        const out = Array.isArray(v) ? [] : {};
        for (const [key, item] of Object.entries(v)) {
          left -= key.length + 8;
          if (left <= 0) { row.truncated = true; break; }
          Object.defineProperty(out, key, {value:visit(item, depth + 1),enumerable:true,configurable:true,writable:true});
        }
        return out;
      }
      left -= 24; return v;
    };
    return visit(value);
  }
  static push(row, method, p) {
    if (row.events.length >= Limit.Events) { row.eventsDropped = (row.eventsDropped ?? 0) + 1; return; }
    row.events.push({method, ...NetworkData.copy(p, row, Limit.Message)});
  }
  static summary(x) {
    return { requestId:x.requestId, url:x.url.slice(0,Limit.Url), method:x.method, type:x.type,
      status:x.response?.status, mimeType:x.response?.mimeType?.slice(0,128), finished:x.finished === true,
      failed:!!x.failed, duration:x.duration, encodedDataLength:x.encodedDataLength,
      truncated:x.truncated || x.url.length > Limit.Url, eventsDropped:x.eventsDropped };
  }
}
