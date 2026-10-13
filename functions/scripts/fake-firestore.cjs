// Minimal in-memory Firestore for flow tests: documents, subcollections,
// equality queries, limit, transactions, batches and getAll. Server timestamps
// are stored as a sentinel; nothing is sorted.
const { FieldValue } = require('firebase-admin/firestore');

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

function applyFieldValues(previous, data) {
  const next = { ...previous };
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof FieldValue) {
      const name = value.constructor.name;
      if (/Delete/i.test(name)) delete next[key];
      else if (/Increment/i.test(name)) next[key] = (Number(previous[key]) || 0) + Number(value.operand ?? value._operand ?? 1);
      else next[key] = { __serverTimestamp: true };
    } else {
      next[key] = clone(value);
    }
  }
  return next;
}

class Snapshot {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this._data = data; this.exists = data !== undefined; }
  data() { return this._data === undefined ? undefined : clone(this._data); }
  get(field) { return this._data?.[field]; }
}

class QuerySnapshot {
  constructor(docs) { this.docs = docs; this.size = docs.length; this.empty = docs.length === 0; }
  forEach(fn) { this.docs.forEach(fn); }
}

class DocRef {
  constructor(store, path) { this.store = store; this.path = path; this.id = path.split('/').pop(); }
  collection(name) { return new CollectionRef(this.store, `${this.path}/${name}`); }
  async get() { return new Snapshot(this, this.store.docs.get(this.path)); }
  async set(data, options) { this.store.write(this.path, data, !!options?.merge); }
  async update(data) {
    if (!this.store.docs.has(this.path)) throw new Error(`No document to update: ${this.path}`);
    this.store.write(this.path, data, true);
  }
  async delete() { this.store.docs.delete(this.path); }
  async create(data) {
    if (this.store.docs.has(this.path)) throw new Error(`Already exists: ${this.path}`);
    this.store.write(this.path, data, false);
  }
}

class Query {
  constructor(store, path, filters = [], max = Infinity) { this.store = store; this.path = path; this.filters = filters; this.max = max; }
  where(field, op, value) {
    if (op !== '==') throw new Error(`Unsupported operator ${op}`);
    return new Query(this.store, this.path, [...this.filters, [field, value]], this.max);
  }
  limit(n) { return new Query(this.store, this.path, this.filters, n); }
  async get() {
    const docs = [];
    for (const [path, data] of this.store.docs) {
      if (docs.length >= this.max) break;
      if (path.slice(0, path.lastIndexOf('/')) !== this.path) continue;
      if (this.filters.every(([field, value]) => data[field] === value)) docs.push(new Snapshot(new DocRef(this.store, path), data));
    }
    return new QuerySnapshot(docs);
  }
}

class CollectionRef extends Query {
  constructor(store, path) { super(store, path); this.id = path.split('/').pop(); }
  doc(id) { return new DocRef(this.store, `${this.path}/${id ?? `auto${++this.store.counter}`}`); }
  async add(data) { const ref = this.doc(); await ref.set(data); return ref; }
}

class FakeFirestore {
  constructor() { this.docs = new Map(); this.counter = 0; this.writes = 0; }
  write(path, data, merge) {
    this.writes += 1;
    this.docs.set(path, applyFieldValues(merge ? this.docs.get(path) ?? {} : {}, data));
  }
  collection(name) { return new CollectionRef(this, name); }
  doc(path) { return new DocRef(this, path); }
  async getAll(...refs) { return Promise.all(refs.map((ref) => ref.get())); }
  batch() {
    const ops = [];
    return {
      set: (ref, data, options) => { ops.push(() => ref.set(data, options)); },
      update: (ref, data) => { ops.push(() => ref.update(data)); },
      delete: (ref) => { ops.push(() => ref.delete()); },
      commit: async () => { for (const op of ops) await op(); },
    };
  }
  async runTransaction(fn) {
    const writes = [];
    let wrote = false;
    const read = (op) => {
      if (wrote) throw new Error('Firestore transactions require all reads before writes.');
      return op();
    };
    const queue = (op) => { wrote = true; writes.push(op); };
    const tx = {
      get: (target) => read(() => target.get()),
      getAll: (...refs) => read(() => this.getAll(...refs)),
      set: (ref, data, options) => { queue(() => ref.set(data, options)); return tx; },
      update: (ref, data) => { queue(() => ref.update(data)); return tx; },
      delete: (ref) => { queue(() => ref.delete()); return tx; },
      create: (ref, data) => { queue(() => ref.create(data)); return tx; },
    };
    const result = await fn(tx);
    for (const write of writes) await write();
    return result;
  }
  async recursiveDelete() {}
  data(path) { return clone(this.docs.get(path)); }
  seed(path, data) { this.docs.set(path, clone(data)); }
}

module.exports = { FakeFirestore };
