const DB_NAME = 'rental-album';
const DB_VERSION = 4;

let db = null;

export function openDB() {
  if (db) return Promise.resolve(db);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onupgradeneeded = (e) => {
      const database = e.target.result;

      if (!database.objectStoreNames.contains('properties')) {
        const store = database.createObjectStore('properties', { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('unit', 'unit', { unique: false });
      }

      if (!database.objectStoreNames.contains('photos')) {
        const store = database.createObjectStore('photos', { keyPath: 'id' });
        store.createIndex('propertyId', 'propertyId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!database.objectStoreNames.contains('inbox')) {
        const store = database.createObjectStore('inbox', { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!database.objectStoreNames.contains('tasks')) {
        const store = database.createObjectStore('tasks', { keyPath: 'id' });
        store.createIndex('dueDate', 'dueDate', { unique: false });
        store.createIndex('done', 'done', { unique: false });
      }

      if (!database.objectStoreNames.contains('captureSessions')) {
        const store = database.createObjectStore('captureSessions', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!database.objectStoreNames.contains('captures')) {
        const store = database.createObjectStore('captures', { keyPath: 'id' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
  });
}

function tx(storeNames, mode = 'readonly') {
  return db.transaction(storeNames, mode);
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function uid() {
  return crypto.randomUUID();
}

export async function getAllProperties() {
  await openDB();
  const store = tx(['properties']).objectStore('properties');
  const items = await promisifyRequest(store.getAll());
  return items.sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name, 'zh-CN');
    if (nameCmp !== 0) return nameCmp;
    return a.unit.localeCompare(b.unit, 'zh-CN', { numeric: true });
  });
}

export async function saveProperty(property) {
  await openDB();
  const store = tx(['properties'], 'readwrite').objectStore('properties');
  await promisifyRequest(store.put(property));
  return property;
}

export async function deleteProperty(id) {
  await openDB();
  const photos = await getPhotosByProperty(id);
  const t = tx(['properties', 'photos'], 'readwrite');
  await promisifyRequest(t.objectStore('properties').delete(id));
  for (const photo of photos) {
    await promisifyRequest(t.objectStore('photos').delete(photo.id));
  }
}

export async function getPhotosByProperty(propertyId) {
  await openDB();
  const store = tx(['photos']).objectStore('photos');
  const index = store.index('propertyId');
  const items = await promisifyRequest(index.getAll(propertyId));
  return items.sort((a, b) => b.createdAt - a.createdAt).map(hydratePhoto);
}

function hydratePhoto(photo) {
  if ((!photo.blob || photo.blob.size === 0) && photo.data) {
    const buf = photo.data instanceof ArrayBuffer ? photo.data : photo.data;
    photo.blob = new Blob([buf], { type: photo.mimeType || 'image/jpeg' });
  }
  return photo;
}

export async function savePhoto(photo) {
  await openDB();
  const store = tx(['photos'], 'readwrite').objectStore('photos');
  const record = { ...photo };
  if (photo.blob instanceof Blob) {
    record.data = await photo.blob.arrayBuffer();
    delete record.blob;
  }
  await promisifyRequest(store.put(record));
  return hydratePhoto({ ...record, blob: photo.blob });
}

export async function deletePhoto(id) {
  await openDB();
  const store = tx(['photos'], 'readwrite').objectStore('photos');
  await promisifyRequest(store.delete(id));
}

export async function countPhotosByProperty(propertyId) {
  const photos = await getPhotosByProperty(propertyId);
  return photos.length;
}

export async function getAllInbox(status = null) {
  await openDB();
  const store = tx(['inbox']).objectStore('inbox');
  let items = await promisifyRequest(store.getAll());
  if (status) items = items.filter((x) => x.status === status);
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveInboxItem(item) {
  await openDB();
  const store = tx(['inbox'], 'readwrite').objectStore('inbox');
  await promisifyRequest(store.put(item));
  return item;
}

export async function deleteInboxItem(id) {
  await openDB();
  const store = tx(['inbox'], 'readwrite').objectStore('inbox');
  await promisifyRequest(store.delete(id));
}

export async function getAllTasks({ dueDate = null, done = null } = {}) {
  await openDB();
  const store = tx(['tasks']).objectStore('tasks');
  let items = await promisifyRequest(store.getAll());
  if (dueDate !== null) items = items.filter((x) => x.dueDate === dueDate);
  if (done !== null) items = items.filter((x) => x.done === done);
  return items.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.createdAt - b.createdAt;
  });
}

export async function saveTask(task) {
  await openDB();
  const store = tx(['tasks'], 'readwrite').objectStore('tasks');
  await promisifyRequest(store.put(task));
  return task;
}

export async function deleteTasksBySource(source) {
  await openDB();
  const store = tx(['tasks'], 'readwrite').objectStore('tasks');
  const all = await promisifyRequest(store.getAll());
  for (const t of all.filter((x) => x.source === source)) {
    await promisifyRequest(store.delete(t.id));
  }
}

export async function saveCaptureSession(session) {
  await openDB();
  const store = tx(['captureSessions'], 'readwrite').objectStore('captureSessions');
  await promisifyRequest(store.put(session));
  return session;
}

export async function getAllCaptureSessions() {
  await openDB();
  const store = tx(['captureSessions']).objectStore('captureSessions');
  const items = await promisifyRequest(store.getAll());
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveCapture(capture) {
  await openDB();
  const store = tx(['captures'], 'readwrite').objectStore('captures');
  await promisifyRequest(store.put(capture));
  return capture;
}

export async function getCapturesBySession(sessionId) {
  await openDB();
  const store = tx(['captures']).objectStore('captures');
  const index = store.index('sessionId');
  const items = await promisifyRequest(index.getAll(sessionId));
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getAllCaptures() {
  await openDB();
  const store = tx(['captures']).objectStore('captures');
  const items = await promisifyRequest(store.getAll());
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteCapture(id) {
  await openDB();
  const store = tx(['captures'], 'readwrite').objectStore('captures');
  await promisifyRequest(store.delete(id));
}

export async function deleteCaptureSession(id) {
  await openDB();
  const caps = await getCapturesBySession(id);
  const t = tx(['captureSessions', 'captures'], 'readwrite');
  await promisifyRequest(t.objectStore('captureSessions').delete(id));
  for (const c of caps) {
    await promisifyRequest(t.objectStore('captures').delete(c.id));
  }
}

export async function seedDemoData() {
  const existing = await getAllProperties();
  if (existing.length > 0) return;

  const demos = [
    { name: '阳光花园', building: '3栋', unit: '1201', lease: { tenant: '张先生', startDate: '2025-03-01', endDate: '2026-02-28', rent: 4500, remind: true, voiceRemind: true } },
    { name: '阳光花园', building: '3栋', unit: '502', lease: { tenant: '王女士', startDate: '2024-07-16', endDate: '2025-07-15', rent: 3800, remind: true, voiceRemind: true } },
    { name: '翠湖名苑', building: 'A座', unit: '801', lease: { tenant: '李女士', startDate: '2024-06-01', endDate: '2025-05-31', rent: 5200, remind: true, voiceRemind: true } },
  ];

  for (const d of demos) {
    await saveProperty({ id: uid(), ...d, createdAt: Date.now() });
  }
}
