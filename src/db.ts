import low from "lowdb";
import FileSync from "lowdb/adapters/FileSync";

import { IssueMeta, IssueWithProject } from "./types";

export default class FileDB {
  private db: low.LowdbSync<any>;

  constructor(file: string) {
    const adapter = new FileSync(file);
    const db = low(adapter);

    db.defaults({
      issue_meta: {},
      issue_with_project: {},
      issue_reviewers: {}
    }).write();

    this.db = db;
  }

  public saveIssuesMeta(id: number, meta: IssueMeta) {
    this.db.set(`issue_meta.${id}`, meta).write();
  }

  public getIssuesMeta(id: number): IssueMeta {
    return this.db.get(`issue_meta.${id}`).value();
  }

  public saveIssueWithProject(id: number, info: IssueWithProject) {
    this.db.set(`issue_with_project.${id}`, info).write();
  }

  public getIssueWithProject(id: number): IssueWithProject {
    return this.db.get(`issue_with_project.${id}`).value();
  }

  public saveIssueReviewers(id: number, reviewers: string[]) {
    this.db.set(`issue_reviewers.${id}`, reviewers).write();
  }

  public getIssueReviewers(id: number): string[] {
    return this.db.get(`issue_reviewers.${id}`).value();
  }
}
