import { AuditWorkerPool } from '../../audit/auditWorker';

/** Singleton worker pool shared across all ReviewTab instances. */
export const auditPool = new AuditWorkerPool({ fallbackToMain: true });
