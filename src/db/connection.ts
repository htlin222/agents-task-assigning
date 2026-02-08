import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { initializeSchema } from "./schema.js";

type DB = InstanceType<typeof Database>;

const instances = new Map<string, DB>();

function resolveDefaultPath(): string {
	const envPath = process.env.TASK_DB_PATH;
	if (envPath) {
		return resolve(envPath);
	}
	return resolve(process.cwd(), ".tasks", "tasks.db");
}

export function getDb(dbPath?: string): DB {
	const resolvedPath = dbPath ? resolve(dbPath) : resolveDefaultPath();

	const cached = instances.get(resolvedPath);
	if (cached) {
		return cached;
	}

	// Ensure the parent directory exists
	mkdirSync(dirname(resolvedPath), { recursive: true });

	const db = new Database(resolvedPath);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");

	initializeSchema(db);

	instances.set(resolvedPath, db);
	return db;
}

export function closeDb(): void {
	for (const [path, db] of instances) {
		db.close();
		instances.delete(path);
	}
}

export function getDbForTesting(dbPath?: string): DB {
	const db = dbPath ? new Database(dbPath) : new Database(":memory:");
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	initializeSchema(db);
	return db;
}
