import { openDB, type DBSchema } from 'idb';
import type { AgentEvent } from '../drivers/types';

export interface AutoTileLibraryEntry {
  id?: number;
  blob: Blob;
  addedAt: number;
}

interface EventRecord {
  sessionId: string;
  timestamp: number;
  event: AgentEvent;
}

interface SessionMetadataRecord {
  sessionId: string;
  emoji: string;
  packId: string | null;
  characterDefinitionId: string;
}

interface AgentsInTheOfficeDB extends DBSchema {
  autoTileLibrary: {
    key: number;
    value: AutoTileLibraryEntry;
  };
  events: {
    key: number;
    value: EventRecord;
    indexes: {
      'by-session': string;
      'by-session-timestamp': [string, number];
    };
  };
  'session-metadata': {
    key: string;
    value: SessionMetadataRecord;
  };
}

const DB_NAME = 'agents-in-the-office-db';
const DB_VERSION = 7;

export async function initDB() {
  return openDB<AgentsInTheOfficeDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 2) {
        db.createObjectStore('autoTileLibrary', {
          keyPath: 'id',
          autoIncrement: true,
        });
      }
      if (oldVersion < 3) {
        const eventStore = db.createObjectStore('events', {
          autoIncrement: true,
        });
        eventStore.createIndex('by-session', 'sessionId');
        eventStore.createIndex('by-session-timestamp',
          ['sessionId', 'timestamp']);
      }
      if (oldVersion >= 6 && oldVersion < 7) {
        db.createObjectStore('session-metadata', { keyPath: 'sessionId' });
        return;
      }
      if (oldVersion >= 7) return;
      const raw = db as unknown as IDBDatabase;
      if (raw.objectStoreNames.contains('maps')) {
        raw.deleteObjectStore('maps');
      }
      if (raw.objectStoreNames.contains('characters')) {
        raw.deleteObjectStore('characters');
      }
      db.createObjectStore('session-metadata', { keyPath: 'sessionId' });
    },
  });
}

export async function saveAutoTileToLibrary(
  blob: Blob,
): Promise<number> {
  const db = await initDB();
  return db.add('autoTileLibrary', {
    blob,
    addedAt: Date.now(),
  });
}

export async function getAllAutoTileLibrary(
): Promise<AutoTileLibraryEntry[]> {
  const db = await initDB();
  return db.getAll('autoTileLibrary');
}

export async function removeFromAutoTileLibrary(
  id: number,
): Promise<void> {
  const db = await initDB();
  await db.delete('autoTileLibrary', id);
}

export async function persistEvent(event: AgentEvent): Promise<void> {
  const db = await initDB();
  await db.add('events', {
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    event,
  });
}

export async function getSessionEvents(sessionId: string): Promise<AgentEvent[]> {
  const db = await initDB();
  const range = IDBKeyRange.bound(
    [sessionId, 0],
    [sessionId, Number.MAX_SAFE_INTEGER],
  );
  const records = await db.getAllFromIndex('events', 'by-session-timestamp', range);
  return records.map(r => r.event);
}

export async function pruneSessionEvents(
  sessionId: string,
  maxKeep = 1000,
): Promise<void> {
  const db = await initDB();
  const allKeys = await db.getAllKeysFromIndex('events', 'by-session', sessionId);
  const toDelete = allKeys.slice(0, Math.max(0, allKeys.length - maxKeep));
  if (toDelete.length === 0) return;
  const tx = db.transaction('events', 'readwrite');
  await Promise.all(toDelete.map(key => tx.store.delete(key)));
  await tx.done;
}

export async function pruneOldEvents(maxAgeMs: number): Promise<void> {
  const db = await initDB();
  const cutoff = Date.now() - maxAgeMs;
  const tx = db.transaction('events', 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (cursor.value.timestamp < cutoff) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function saveSessionMetadata(record: {
  sessionId: string;
  emoji: string;
  packId: string | null;
  characterDefinitionId: string;
}): Promise<void> {
  const db = await initDB();
  await db.put('session-metadata', record);
}

export async function getSessionMetadata(sessionId: string): Promise<{
  sessionId: string;
  emoji: string;
  packId: string | null;
  characterDefinitionId: string;
} | undefined> {
  const db = await initDB();
  return db.get('session-metadata', sessionId);
}
