// Anki data for the benchmark. The canonical fixture is an Anki SQLite
// collection, because that is what the Claude Code skill reads (scripts/anki_snapshot.py).
// The fake AnkiConnect server below serves the same collection to Sayfern, so both
// harnesses see identical cards and review history.
import { appendFileSync } from "node:fs";
import http from "node:http";
import type { AnkiCallRecord, Phase } from "./types";

// node:sqlite prints an ExperimentalWarning on Node 22; load it lazily and quietly.
type Db = {
  exec(sql: string): void;
  prepare(sql: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): Record<string, unknown>[]; get(...a: unknown[]): Record<string, unknown> | undefined };
  close(): void;
};
async function openDb(path: string, readOnly: boolean): Promise<Db> {
  const listeners = process.listeners("warning");
  process.removeAllListeners("warning");
  try {
    const { DatabaseSync } = (await import("node:sqlite")) as unknown as { DatabaseSync: new (p: string, o?: object) => Db };
    return new DatabaseSync(path, readOnly ? { readOnly: true } : {});
  } finally {
    for (const l of listeners) process.on("warning", l as (w: Error) => void);
  }
}

const DAY = 86_400_000;

// ------------------------------------------------------------------ fixture deck (JSON) → collection

export interface FixtureWord {
  /** Word, reading, meaning; `alt` fills the second field (traditional form for Mandarin). */
  w: string;
  alt?: string;
  r: string;
  m: string;
  state: "new" | "learning" | "review" | "suspended";
  ivl?: number;
  factor?: number;
  lapses?: number;
  leech?: boolean;
  /** Reviews as [days ago (0 = today), ease 1-4, answer ms?]. */
  reviews?: [number, number, number?][];
}

export interface FixtureDeck {
  deck: string;
  fields: string[];
  words: FixtureWord[];
}

/** Builds a minimal Anki (schema 18 style) collection. Review times are relative to `now`. */
export async function buildCollection(path: string, fx: FixtureDeck, now: number): Promise<void> {
  const db = await openDb(path, false);
  try {
    db.exec(`
      CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text);
      CREATE TABLE decks (id integer primary key, name text not null, mtime_secs integer, usn integer, common blob, kind blob);
      CREATE TABLE notetypes (id integer primary key, name text, mtime_secs integer, usn integer, config blob);
      CREATE TABLE fields (ntid integer, ord integer, name text, config blob, primary key (ntid, ord));
      CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld text, csum integer, flags integer, data text);
      CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text);
      CREATE TABLE revlog (id integer primary key, cid integer, usn integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer);
    `);
    const secs = Math.floor(now / 1000);
    db.prepare("INSERT INTO col VALUES (1, ?, ?, ?, 18, 0, 0, 0, '{}', '{}', '{}', '{}', '{}')").run(secs - 400 * 86400, now, now);
    const did = 1700000000001;
    const mid = 1700000000002;
    db.prepare("INSERT INTO decks VALUES (1, 'Default', ?, 0, x'', x'')").run(secs);
    db.prepare("INSERT INTO decks VALUES (?, ?, ?, 0, x'', x'')").run(did, fx.deck, secs);
    db.prepare("INSERT INTO notetypes VALUES (?, 'Bench vocab', ?, 0, x'')").run(mid, secs);
    fx.fields.forEach((f, i) => db.prepare("INSERT INTO fields VALUES (?, ?, ?, x'')").run(mid, i, f));
    const insNote = db.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0, 0, '')");
    const insCard = db.prepare("INSERT INTO cards VALUES (?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, '')");
    const insRev = db.prepare("INSERT INTO revlog VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)");
    let newPos = 0;
    fx.words.forEach((w, i) => {
      const nid = 1600000000000 + i * 1000;
      const cid = nid + 1;
      const flds = [w.w, w.alt ?? w.w, w.r, w.m, ...fx.fields.slice(4).map(() => "")].slice(0, fx.fields.length).join("\x1f");
      insNote.run(nid, `g${i}`, mid, secs, w.leech ? " leech " : "", flds, w.w);
      const reviews = [...(w.reviews ?? [])].sort((a, b) => b[0] - a[0]);
      const type = w.state === "new" ? 0 : w.state === "learning" ? 1 : 2;
      const queue = w.state === "suspended" ? -1 : type;
      const due = w.state === "new" ? ++newPos : Math.floor(now / DAY) + (w.ivl ?? 1);
      insCard.run(cid, nid, did, secs, type, queue, due, w.ivl ?? 0, w.factor ?? (type === 0 ? 0 : 2500), reviews.length, w.lapses ?? 0);
      reviews.forEach(([daysAgo, ease, ms], k) => {
        // Unique, past timestamps: minutes apart per review, a second apart per card.
        const at = now - daysAgo * DAY - (reviews.length - k) * 60_000 - i * 1000;
        insRev.run(at, cid, ease, w.ivl ?? 1, Math.max(0, (w.ivl ?? 1) - 1), w.factor ?? 2500, ms ?? 4000, 1);
      });
    });
  } finally {
    db.close();
  }
}

// ------------------------------------------------------------------ collection → AnkiConnect-shaped data

export interface CollCard {
  cardId: number;
  noteId: number;
  deckName: string;
  modelName: string;
  fields: Record<string, { value: string; order: number }>;
  fieldOrder: string[];
  interval: number;
  factor: number;
  lapses: number;
  reps: number;
  type: number;
  queue: number;
  due: number;
  tags: string[];
}

export interface CollRev {
  id: number;
  cid: number;
  usn: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
}

export interface Collection {
  decks: { id: number; name: string }[];
  models: { id: number; name: string; fields: string[] }[];
  cards: CollCard[];
  revlog: CollRev[];
}

export async function readCollection(path: string): Promise<Collection> {
  const db = await openDb(path, true);
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => String(r.name)));
    let decks: { id: number; name: string }[] = [];
    let models: { id: number; name: string; fields: string[] }[] = [];
    if (tables.has("decks")) {
      decks = db.prepare("SELECT id, name FROM decks").all().map((r) => ({ id: Number(r.id), name: String(r.name).replace(/\x1f/g, "::") }));
    } else {
      const col = db.prepare("SELECT decks FROM col").get();
      decks = Object.values(JSON.parse(String(col?.decks ?? "{}")) as Record<string, { id: number; name: string }>).map((d) => ({ id: Number(d.id), name: d.name }));
    }
    if (tables.has("notetypes") && tables.has("fields")) {
      const names = new Map(db.prepare("SELECT id, name FROM notetypes").all().map((r) => [Number(r.id), String(r.name)]));
      const byNt = new Map<number, string[]>();
      for (const r of db.prepare("SELECT ntid, ord, name FROM fields ORDER BY ntid, ord").all()) {
        const list = byNt.get(Number(r.ntid)) ?? [];
        list.push(String(r.name));
        byNt.set(Number(r.ntid), list);
      }
      models = [...byNt].map(([id, fields]) => ({ id, name: names.get(id) ?? String(id), fields }));
    } else {
      const col = db.prepare("SELECT models FROM col").get();
      models = Object.values(JSON.parse(String(col?.models ?? "{}")) as Record<string, { id: number; name: string; flds: { name: string }[] }>).map((m) => ({
        id: Number(m.id),
        name: m.name,
        fields: m.flds.map((f) => f.name),
      }));
    }
    const deckName = new Map(decks.map((d) => [d.id, d.name]));
    const model = new Map(models.map((m) => [m.id, m]));
    const cards: CollCard[] = db
      .prepare(
        "SELECT c.id, c.nid, c.did, c.odid, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, n.mid, n.flds, n.tags FROM cards c JOIN notes n ON n.id = c.nid",
      )
      .all()
      .map((r) => {
        const m = model.get(Number(r.mid));
        const values = String(r.flds).split("\x1f");
        const fieldOrder = m?.fields ?? values.map((_, i) => `Field${i + 1}`);
        const fields: CollCard["fields"] = {};
        fieldOrder.forEach((f, i) => (fields[f] = { value: values[i] ?? "", order: i }));
        const did = Number(r.odid) || Number(r.did);
        return {
          cardId: Number(r.id),
          noteId: Number(r.nid),
          deckName: deckName.get(did) ?? "Default",
          modelName: m?.name ?? "",
          fields,
          fieldOrder,
          interval: Number(r.ivl),
          factor: Number(r.factor),
          lapses: Number(r.lapses),
          reps: Number(r.reps),
          type: Number(r.type),
          queue: Number(r.queue),
          due: Number(r.due),
          tags: String(r.tags ?? "").trim().split(/\s+/).filter(Boolean),
        };
      });
    const revlog: CollRev[] = db
      .prepare("SELECT id, cid, usn, ease, ivl, lastIvl, factor, time, type FROM revlog ORDER BY id")
      .all()
      .map((r) => ({
        id: Number(r.id),
        cid: Number(r.cid),
        usn: Number(r.usn),
        ease: Number(r.ease),
        ivl: Number(r.ivl),
        lastIvl: Number(r.lastIvl),
        factor: Number(r.factor),
        time: Number(r.time),
        type: Number(r.type),
      }));
    return { decks, models, cards, revlog };
  } finally {
    db.close();
  }
}

// ------------------------------------------------------------------ search queries

function tokenize(q: string): string[] {
  const out: string[] = [];
  const re = /(-?)(\w+:)?("(?:[^"\\]|\\.)*"|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) out.push(m[0]);
  return out;
}

const unquote = (s: string) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s).replace(/\\(.)/g, "$1");
const globRe = (s: string) => new RegExp(`^${s.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");

/** Evaluates the subset of Anki search syntax that AnkiConnect clients commonly send. */
export function matchCards(coll: Collection, query: string, now: number): CollCard[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const revByCard = new Map<number, CollRev[]>();
  for (const r of coll.revlog) (revByCard.get(r.cid) ?? revByCard.set(r.cid, []).get(r.cid)!).push(r);
  const preds: ((c: CollCard) => boolean)[] = [];
  for (const raw of tokenize(query.trim())) {
    const neg = raw.startsWith("-");
    const tok = neg ? raw.slice(1) : raw;
    const i = tok.indexOf(":");
    const key = i > 0 && !tok.startsWith('"') ? tok.slice(0, i).toLowerCase() : "";
    const val = key ? unquote(tok.slice(i + 1)) : unquote(tok);
    let p: (c: CollCard) => boolean;
    switch (key) {
      case "deck": {
        if (val === "*") p = () => true;
        else {
          const re = globRe(val);
          const sub = globRe(`${val}::*`);
          p = (c) => re.test(c.deckName) || sub.test(c.deckName);
        }
        break;
      }
      case "rated": {
        const [days, ease] = val.split(":").map(Number);
        const since = today - (Math.max(1, days || 1) - 1) * DAY;
        p = (c) => (revByCard.get(c.cardId) ?? []).some((r) => r.id >= since && (!ease || r.ease === ease));
        break;
      }
      case "tag":
        p = (c) => c.tags.some((t) => globRe(val).test(t));
        break;
      case "is":
        p = {
          new: (c: CollCard) => c.type === 0,
          learn: (c: CollCard) => c.type === 1 || c.type === 3,
          review: (c: CollCard) => c.type === 2 || c.type === 3,
          suspended: (c: CollCard) => c.queue === -1,
          buried: (c: CollCard) => c.queue <= -2,
          due: (c: CollCard) => c.type === 2 && c.due <= Math.floor(now / DAY),
        }[val] ?? (() => { throw new Error(`unsupported search: is:${val}`); })();
        break;
      case "prop": {
        const m = /^(ivl|lapses|reps|ease|due)(<=|>=|!=|=|<|>)(-?[\d.]+)$/.exec(val);
        if (!m) throw new Error(`unsupported search: prop:${val}`);
        const [, f, op, nStr] = m;
        const n = Number(nStr);
        const get = (c: CollCard) => (f === "ivl" ? c.interval : f === "lapses" ? c.lapses : f === "reps" ? c.reps : f === "ease" ? c.factor / 1000 : c.due - Math.floor(now / DAY));
        p = (c) => {
          const v = get(c);
          return op === "<" ? v < n : op === ">" ? v > n : op === "<=" ? v <= n : op === ">=" ? v >= n : op === "!=" ? v !== n : v === n;
        };
        break;
      }
      case "cid":
        p = (c) => val.split(",").map(Number).includes(c.cardId);
        break;
      case "nid":
        p = (c) => val.split(",").map(Number).includes(c.noteId);
        break;
      case "note":
        p = (c) => globRe(val).test(c.modelName);
        break;
      case "": {
        const re = new RegExp(val.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"), "i");
        p = (c) => Object.values(c.fields).some((f) => re.test(f.value));
        break;
      }
      default: {
        // field:value
        const field = Object.keys(coll.cards[0]?.fields ?? {}).find((f) => f.toLowerCase() === key);
        if (!field) throw new Error(`unsupported search: ${key}:`);
        p = (c) => globRe(val).test(c.fields[field]?.value ?? "");
      }
    }
    preds.push(neg ? (c) => !p(c) : p);
  }
  return coll.cards.filter((c) => preds.every((p) => p(c)));
}

// ------------------------------------------------------------------ fake AnkiConnect

export class FakeAnkiConnect {
  private server?: http.Server;
  private seq = 0;
  private phase: Phase | null = null;
  readonly calls: AnkiCallRecord[] = [];
  port = 0;

  constructor(
    private readonly coll: Collection,
    private readonly logFile: string,
    private readonly now: () => number = Date.now,
  ) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  setPhase(p: Phase | null): void {
    this.phase = p ? { ...p } : null;
  }

  async start(port = 0): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      const parts: Buffer[] = [];
      for await (const c of req) parts.push(c as Buffer);
      let body: { action?: string; params?: Record<string, unknown> } = {};
      try {
        body = JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
      } catch {
        /* handled below */
      }
      const action = String(body.action ?? "");
      let result: unknown = null;
      let error: string | null = null;
      try {
        result = this.dispatch(action, body.params ?? {});
      } catch (err) {
        error = String((err as Error)?.message ?? err);
      }
      const text = JSON.stringify({ result, error });
      const rec: AnkiCallRecord = { seq: ++this.seq, phase: this.phase, action, params: body.params, ok: !error, resultSize: text.length, t: Date.now() };
      if (error) rec.error = error;
      this.calls.push(rec);
      appendFileSync(this.logFile, JSON.stringify(rec) + "\n");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(text);
    });
    await new Promise<void>((r) => this.server!.listen(port, "127.0.0.1", r));
    this.port = (this.server.address() as { port: number }).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  private cardInfo(c: CollCard) {
    const question = c.fields[c.fieldOrder[0]]?.value ?? "";
    return {
      cardId: c.cardId,
      note: c.noteId,
      deckName: c.deckName,
      modelName: c.modelName,
      fieldOrder: 0,
      fields: c.fields,
      question,
      answer: Object.values(c.fields).map((f) => f.value).join("<br>"),
      interval: c.interval,
      factor: c.factor,
      lapses: c.lapses,
      reps: c.reps,
      type: c.type,
      queue: c.queue,
      due: c.due,
      left: 0,
      ord: 0,
      mod: Math.floor(this.now() / 1000),
    };
  }

  private dispatch(action: string, p: Record<string, unknown>): unknown {
    const coll = this.coll;
    const byId = new Map(coll.cards.map((c) => [c.cardId, c]));
    const ids = (k: string) => (Array.isArray(p[k]) ? (p[k] as unknown[]).map(Number) : []);
    switch (action) {
      case "version":
        return 6;
      case "requestPermission":
        return { permission: "granted", requireApikey: false, version: 6 };
      case "deckNames":
        return coll.decks.map((d) => d.name);
      case "deckNamesAndIds":
        return Object.fromEntries(coll.decks.map((d) => [d.name, d.id]));
      case "modelNames":
        return coll.models.map((m) => m.name);
      case "modelFieldNames":
        return coll.models.find((m) => m.name === p.modelName)?.fields ?? [];
      case "findCards":
        return matchCards(coll, String(p.query ?? ""), this.now()).map((c) => c.cardId);
      case "findNotes":
        return [...new Set(matchCards(coll, String(p.query ?? ""), this.now()).map((c) => c.noteId))];
      case "cardsInfo":
        return ids("cards").map((id) => byId.get(id)).filter(Boolean).map((c) => this.cardInfo(c!));
      case "notesInfo": {
        const byNote = new Map(coll.cards.map((c) => [c.noteId, c]));
        return ids("notes")
          .map((id) => byNote.get(id))
          .filter(Boolean)
          .map((c) => ({ noteId: c!.noteId, modelName: c!.modelName, tags: c!.tags, fields: c!.fields, cards: [c!.cardId] }));
      }
      case "areSuspended":
        return ids("cards").map((id) => (byId.has(id) ? byId.get(id)!.queue === -1 : null));
      case "getEaseFactors":
        return ids("cards").map((id) => byId.get(id)?.factor ?? null);
      case "getIntervals":
        return ids("cards").map((id) => byId.get(id)?.interval ?? null);
      case "cardReviews": {
        const deck = String(p.deck ?? "");
        const since = Number(p.startID ?? 0);
        const inDeck = new Set(coll.cards.filter((c) => c.deckName === deck).map((c) => c.cardId));
        return coll.revlog.filter((r) => r.id > since && inDeck.has(r.cid)).map((r) => [r.id, r.cid, r.usn, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type]);
      }
      case "getReviewsOfCards": {
        const out: Record<string, unknown[]> = {};
        for (const id of (p.cards as unknown[] | undefined) ?? []) {
          out[String(id)] = coll.revlog
            .filter((r) => r.cid === Number(id))
            .map((r) => ({ id: r.id, usn: r.usn, ease: r.ease, ivl: r.ivl, lastIvl: r.lastIvl, factor: r.factor, time: r.time, type: r.type }));
        }
        return out;
      }
      case "getNumCardsReviewedToday": {
        const start = new Date(this.now());
        start.setHours(0, 0, 0, 0);
        return coll.revlog.filter((r) => r.id >= start.getTime()).length;
      }
      case "getLatestReviewID": {
        const deck = String(p.deck ?? "");
        const inDeck = new Set(coll.cards.filter((c) => c.deckName === deck).map((c) => c.cardId));
        return coll.revlog.filter((r) => inDeck.has(r.cid)).reduce((m, r) => Math.max(m, r.id), 0);
      }
      case "multi":
        return ((p.actions as { action: string; params?: Record<string, unknown> }[]) ?? []).map((a) => {
          try {
            return { result: this.dispatch(a.action, a.params ?? {}), error: null };
          } catch (err) {
            return { result: null, error: String((err as Error)?.message ?? err) };
          }
        });
      default:
        throw new Error(`unsupported action (the benchmark's AnkiConnect is read-only): ${action}`);
    }
  }
}
