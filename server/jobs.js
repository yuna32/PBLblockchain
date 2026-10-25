// 분석 작업 큐: 한 번에 하나씩 실행한다(hardhat이 동시에 둘 돌지 않게). 상태는 메모리에만 둔다.
import crypto from "crypto";
import path from "path";
import { runScenario } from "../demo/run.js";
import { runFixture } from "./fixture_run.js";

export class JobQueue {
  #jobs = new Map();
  #pending = [];
  #running = false;

  // runsDir: 작업 결과 디렉터리(<runsDir>/<jobId>/), runOptions: runScenario 옵션(nodeBin, timeoutMs 등)
  constructor({ runsDir, runOptions = {} }) {
    this.runsDir = runsDir;
    this.runOptions = runOptions;
  }

  submit(scenario, mode) {
    const id = crypto.randomUUID();
    const job = {
      id, scenario, mode,
      status: "queued", stage: null, stages: [], source: null,
      reportId: null, error: null, fallbackReason: null,
      createdAt: Date.now(), startedAt: null, finishedAt: null,
      outDir: path.join(this.runsDir, id)
    };
    this.#jobs.set(id, job);
    this.#pending.push(job);
    this.#pump();
    return job;
  }

  get(id) {
    return this.#jobs.get(id) ?? null;
  }

  async #pump() {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#pending.length > 0) await this.#run(this.#pending.shift());
    } finally {
      this.#running = false;
    }
  }

  async #run(job) {
    job.status = "running";
    job.startedAt = Date.now();
    const onStage = (stage, info = {}) => {
      job.stage = stage;
      job.stages.push(stage);
      if (info.source) job.source = info.source;
    };
    try {
      const result = job.mode === "fixture"
        ? await runFixture(job.scenario, job.outDir, { onStage })
        : await runScenario(job.scenario, job.outDir, { ...this.runOptions, onStage });
      job.source = result.source;
      job.fallbackReason = result.fallback_reason;
      job.reportId = job.id;
      job.status = "done";
    } catch (err) {
      job.status = "error";
      job.error = err.message;
    } finally {
      job.stage = null;
      job.finishedAt = Date.now();
    }
  }
}

// API 응답용 (outDir 같은 내부 경로는 내보내지 않는다)
export function publicJob(job) {
  return {
    id: job.id,
    scenario: job.scenario,
    mode: job.mode,
    status: job.status,
    stage: job.stage,
    stages: job.stages,
    source: job.source,
    reportId: job.reportId,
    error: job.error,
    fallbackReason: job.fallbackReason,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt
  };
}
