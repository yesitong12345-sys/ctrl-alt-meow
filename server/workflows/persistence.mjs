import {existsSync} from 'node:fs';
import {readFile, rename, writeFile} from 'node:fs/promises';

export function createJsonPersistence({filePath, defaultValue, normalize = value => value} = {}) {
  if (!filePath || typeof defaultValue !== 'function') throw new Error('INVALID_JSON_PERSISTENCE_CONFIG');
  let writeQueue = Promise.resolve();
  return {
    kind: 'json',
    async load() {
      if (!existsSync(filePath)) return normalize(defaultValue());
      try {
        return normalize(JSON.parse(await readFile(filePath, 'utf8')));
      } catch (error) {
        throw new Error(`PERSISTENCE_LOAD_FAILED:${error.message}`);
      }
    },
    save(value) {
      // A failed write must reject its caller, but must not poison later saves.
      writeQueue = writeQueue.catch(() => {}).then(async () => {
        const temporary = `${filePath}.tmp`;
        await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
        await rename(temporary, filePath);
      });
      return writeQueue;
    }
  };
}

export function createPostgresPersistence({query, defaultValue, normalize = value => value, stateId = 'educompanion'} = {}) {
  if (typeof query !== 'function' || typeof defaultValue !== 'function') throw new Error('INVALID_POSTGRES_PERSISTENCE_CONFIG');
  let writeQueue = Promise.resolve();
  return {
    kind: 'postgres',
    async migrate() {
      await query(`CREATE TABLE IF NOT EXISTS edu_app_state (
        id text PRIMARY KEY,
        payload jsonb NOT NULL,
        schema_version integer NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    },
    async load() {
      await this.migrate();
      const result = await query('SELECT payload FROM edu_app_state WHERE id = $1', [stateId]);
      return normalize(result?.rows?.[0]?.payload || defaultValue());
    },
    save(value) {
      writeQueue = writeQueue.then(() => query(
        `INSERT INTO edu_app_state (id, payload, schema_version, updated_at)
         VALUES ($1, $2::jsonb, 1, now())
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, schema_version = EXCLUDED.schema_version, updated_at = now()`,
        [stateId, JSON.stringify(value)]
      ));
      return writeQueue;
    }
  };
}
