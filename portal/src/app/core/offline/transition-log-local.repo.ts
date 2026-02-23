import { Injectable, inject } from '@angular/core';
import { IndexedDbService } from './indexed-db.service';
import { LocalTransitionLog } from './types';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class TransitionLogLocalRepo {
  private db = inject(IndexedDbService);
  private STORE_NAME = 'transitionLogs';

  private changesSubj = new BehaviorSubject<void>(undefined);
  public readonly changes$ = this.changesSubj.asObservable();

  public async getById(id: string): Promise<LocalTransitionLog | undefined> {
    const logs = await this.list();
    return logs.find(l => l.id === id);
  }

  public async list(): Promise<LocalTransitionLog[]> {
    return this.db.getAll<LocalTransitionLog>(this.STORE_NAME);
  }

  public async listByReportId(reportId: string): Promise<LocalTransitionLog[]> {
    const logs = await this.list();
    return logs.filter(l => l.inspectionReportId === reportId).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  public async upsert(log: LocalTransitionLog): Promise<void> {
    await this.db.put(this.STORE_NAME, log);
    this.changesSubj.next();
  }

  public async bulkUpsert(logs: LocalTransitionLog[]): Promise<void> {
    for (const log of logs) {
      await this.db.put(this.STORE_NAME, log);
    }
    this.changesSubj.next();
  }

  public async delete(id: string): Promise<void> {
    await this.db.delete(this.STORE_NAME, id);
    this.changesSubj.next();
  }
}
