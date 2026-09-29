import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { MonitorService } from '@gitroom/nestjs-libraries/database/prisma/monitor/monitor.service';

@Injectable()
@Activity()
export class MonitorActivity {
  constructor(private _monitorService: MonitorService) {}

  // Every due post / competitor / keyword target of every organization, read one after another.
  @ActivityMethod()
  async runDueMonitors() {
    return this._monitorService.runDue();
  }
}
