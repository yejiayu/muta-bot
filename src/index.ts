import { Application, Context } from "probot"; // eslint-disable-line no-unused-vars
import titleize from "titleize";

import fileDB from "./db";
import { moodyblues } from "./moodyblues";
import weekly from "./weekly";

const PROJECT_COLUMN_TODO = "To do";
const PROJECT_COLUMN_IN_PROGRESS = "In progress";
const PROJECT_COLUMN_IN_REVIEW = "In review";
const PROJECT_COLUMN_DONW = "Done";

const LABEL_TODO = "bot:todo";
const LABEL_IN_PROGRESS = "bot:in-progress";
const LABEL_IN_REVIEW = "bot:in-review";
const LABEL_DONE = "bot:done";

interface IssueMeta {
  kind: string;
  point: number;
  assignees: string[];
  reviewers: string[];
  milestone: string;
}

export = (app: Application) => {
  weekly(app);
  moodyblues(app);

  app.on("issues.opened", async context => {
    const body = context.payload.issue.body;
    if (!isTaskIssue(body)) {
      return;
    }
    const issueMeta = parseIssueBody(body);
    fileDB.saveIssuesMeta(context.payload.issue.id, issueMeta);
    fileDB.saveIssueReviewers(context.payload.issue.id, issueMeta.reviewers);

    const {
      data: listMilestone
    } = await context.github.issues.listMilestonesForRepo(context.issue());

    const milestone =
      issueMeta.milestone.toLowerCase() === "latest"
        ? listMilestone[listMilestone.length - 1]
        : listMilestone.find(m => m.title === issueMeta.milestone);
    if (!milestone) {
      await context.github.issues.createComment(
        context.issue({
          body: `Not found milestone ${issueMeta.milestone}`
        })
      );
      return;
    }

    const params = context.issue({
      title: context.payload.issue.title
        .toLowerCase()
        .startsWith(`[${issueMeta.kind.toLowerCase()}]`)
        ? titleize(context.payload.issue.title)
        : `[${titleize(issueMeta.kind)}]` + context.payload.issue.title,
      assignees: issueMeta.assignees.concat(issueMeta.reviewers),
      labels: [
        "k:" + issueMeta.kind,
        "p" + issueMeta.point,
        "bot:task",
        "bot:todo"
      ],
      milestone: milestone.number
    });

    await context.github.issues.update(params);

    if (await issueMoveColumn(context, milestone.title, PROJECT_COLUMN_TODO)) {
      await context.github.issues.createComment(
        context.issue({
          body:
            "You have created a task, if you want to start it formally, please comment /Go"
        })
      );
    }
  });

  // app.on("issues.edited", async context => {
  //   const body = context.payload.issue.body;
  //   if (!isTaskIssue(body)) {
  //     return;
  //   }
  //   const issueMeta = parseIssueBody(body);
  //
  //   const {
  //     data: listMilestone
  //   } = await context.github.issues.listMilestonesForRepo(context.issue());
  //
  //   const milestone =
  //     issueMeta.milestone.toLowerCase() === "latest"
  //       ? listMilestone[listMilestone.length - 1]
  //       : listMilestone.find(m => m.title === issueMeta.milestone);
  //   if (!milestone) {
  //     await context.github.issues.createComment(
  //       context.issue({
  //         body: `Not found milestone ${issueMeta.milestone}`
  //       })
  //     );
  //     return;
  //   }
  //
  //   const params = context.issue({
  //     title: context.payload.issue.title
  //       .toLowerCase()
  //       .startsWith(`[${issueMeta.kind.toLowerCase()}]`)
  //       ? titleize(context.payload.issue.title)
  //       : `[${titleize(issueMeta.kind)}]` + context.payload.issue.title,
  //     assignees: issueMeta.assignees.concat(issueMeta.reviewers),
  //     labels: [
  //       "k:" + issueMeta.kind,
  //       "p" + issueMeta.point,
  //       "bot:task",
  //       "bot:todo"
  //     ],
  //     milestone: milestone.number
  //   });
  //
  //   await context.github.issues.update(params);
  // });

  app.on("issue_comment", async context => {
    const body = context.payload.issue.body;
    if (!isTaskIssue(body)) {
      return;
    }
    if (context.payload.issue.state === "closed") {
      return;
    }

    const comment = context.payload.comment.body.toLowerCase();
    if (comment.startsWith("/go")) {
      if (!isOwnerMessage(context)) {
        return;
      }
      const labels = context.payload.issue.labels.map(l => l.name);
      if (
        isLabelByName(labels, [LABEL_IN_PROGRESS, LABEL_IN_REVIEW, LABEL_DONE])
      ) {
        return;
      }

      labels.push(LABEL_IN_PROGRESS);
      if (
        await issueMoveColumn(
          context,
          context.payload.issue.milestone.title,
          PROJECT_COLUMN_IN_PROGRESS
        )
      ) {
        await context.github.issues.update(
          context.issue({
            labels: labels.filter(s => s !== LABEL_TODO)
          })
        );
        await context.github.issues.createComment(
          context.issue({
            body:
              "Nice Boat! When you finish this task, please comment /PTAL(Please take a look) call reviewers."
          })
        );

        fileDB.saveIssueStartAt(context.payload.issue.id, Date.now());
      }
    } else if (comment.startsWith("/ptal")) {
      if (!isOwnerMessage(context)) {
        return;
      }

      const labels = context.payload.issue.labels.map(l => l.name);
      if (isLabelByName(labels, [LABEL_TODO, LABEL_IN_REVIEW, LABEL_DONE])) {
        return;
      }

      labels.push(LABEL_IN_REVIEW);

      if (
        await issueMoveColumn(
          context,
          context.payload.issue.milestone.title,
          PROJECT_COLUMN_IN_REVIEW
        )
      ) {
        await context.github.issues.update(
          context.issue({
            labels: labels.filter(s => s !== LABEL_IN_PROGRESS)
          })
        );

        const issuesMeta = parseIssueBody(context.payload.issue.body);
        const reviewers = issuesMeta.reviewers.join(" @");
        await context.github.issues.createComment(
          context.issue({
            body: `This task has been marked as completed, please review @${reviewers}. \r\n You can comment /LGTM to indicate that the review is complete.`
          })
        );
      }
    } else if (comment.startsWith("/lgtm")) {
      if (!isReviewerMessage(context)) {
        return;
      }

      const issueMeta = fileDB.getIssuesMeta(context.payload.issue.id);
      const liveReviewers = approve(context);

      const reviewers = issueMeta.reviewers
        .map(s => {
          const reviewer = `- @${s}`;
          const flag = liveReviewers.indexOf(s) === -1 ? " √" : "";
          return reviewer + flag;
        })
        .join("\r\n");
      await context.github.issues.createComment(
        context.issue({
          body: `@${context.payload.sender.login} approved \r\n\r\n **Reviewers**:\r\n${reviewers}`
        })
      );

      if (liveReviewers.length === 0) {
        const labels = context.payload.issue.labels.map(l => l.name);
        if (
          isLabelByName(labels, [LABEL_TODO, LABEL_IN_PROGRESS, LABEL_DONE])
        ) {
          return;
        }

        if (
          await issueMoveColumn(
            context,
            context.payload.issue.milestone.title,
            PROJECT_COLUMN_DONW
          )
        ) {
          labels.push(LABEL_DONE);
          const params = {
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            issue_number: context.payload.issue.number,
            labels: labels.filter(s => s !== LABEL_IN_REVIEW)
          };
          await context.github.issues.createComment(
            context.issue({
              body: `All reviewers have approved, task completed.`
            })
          );
          await context.github.issues.update({
            ...params,
            state: "closed"
          });
        }
      }
    } else if (comment.startsWith("/baba")) {
      if (!isOwnerMessage(context)) {
        return;
      }

      const params = {
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        issue_number: context.payload.issue.number,
        milestone: null
      };

      await context.github.issues.removeLabels(context.issue());
      await context.github.issues.removeAssignees(
        context.issue({
          assignees: context.payload.issue.assignees.map(a => a.login)
        })
      );

      await context.github.issues.update({
        ...params,
        state: "closed"
      });

      await removeCard(context);
    }
  });

  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
};

function parseIssueBody(body: string): IssueMeta {
  const list = body.split("\r\n");
  const newline_index = list.indexOf("");

  const issue_meta = list.splice(0, newline_index);

  const meta: IssueMeta = {
    kind: "",
    point: 0,
    assignees: [],
    reviewers: [],
    milestone: ""
  };

  issue_meta.forEach(item => {
    const sub_items = item.trim().split(" ");
    switch (sub_items[0].toLowerCase()) {
      case "/kind":
        meta.kind = sub_items[1];
        break;
      case "/point":
        meta.point = Number.parseInt(sub_items[1]);
        break;
      case "/assignees":
        meta.assignees = sub_items.slice(1).map(user => user.slice(1));
        break;
      case "/reviewers":
        meta.reviewers = sub_items.slice(1).map(user => user.slice(1));
        break;
      case "/milestone":
        meta.milestone = sub_items[1];
        break;
    }
  });

  return meta;
}

function approve(context: Context): string[] {
  const sender = context.payload.sender.login;
  const reviewers = fileDB.getIssueReviewers(context.payload.issue.id);
  const newReviewers = reviewers.filter(s => s !== sender);

  fileDB.saveIssueReviewers(context.payload.issue.id, newReviewers);

  return newReviewers;
}

async function removeCard(context: Context) {
  const projectInfo = fileDB.getIssueWithProject(context.payload.issue.id);

  await context.github.projects.deleteCard({ card_id: projectInfo.cardID });
}

async function issueMoveColumn(
  context: Context,
  projectName: string,
  columnName: string
): Promise<boolean> {
  if (columnName === PROJECT_COLUMN_TODO) {
    const { data: projects } = await context.github.projects.listForRepo(
      context.issue()
    );

    const project = projects.find(p => p.name === projectName);
    if (!project) {
      await context.github.issues.createComment(
        context.issue({
          body: `Not found project ${projectName}`
        })
      );
      return false;
    }

    const { data: listColumn } = await context.github.projects.listColumns({
      project_id: project.id
    });

    const columnID = findColumnID(listColumn, columnName);
    const { data: card } = await context.github.projects.createCard({
      column_id: columnID,
      content_id: context.payload.issue.id,
      content_type: "Issue"
    });

    fileDB.saveIssueWithProject(context.payload.issue.id, {
      projectID: project.id,
      cardID: card.id,
      column: columnID
    });
    return true;
  }

  const issueProject = fileDB.getIssueWithProject(context.payload.issue.id);
  const { data: listColumn } = await context.github.projects.listColumns({
    project_id: issueProject.projectID
  });

  const columnID = findColumnID(listColumn, columnName);

  await context.github.projects.moveCard({
    card_id: issueProject.cardID,
    column_id: columnID,
    position: "bottom"
  });

  fileDB.saveIssueWithProject(context.payload.issue.id, {
    ...issueProject,
    column: columnID
  });

  return true;
}

function findColumnID(listColumn: any[], columnName: string): number {
  const column = listColumn.find(column => column.name === columnName);
  return column.id;
}

function isTaskIssue(body: string): boolean {
  return body.startsWith("## Task");
}

function isOwnerMessage(context: Context): boolean {
  const issuesMeta = parseIssueBody(context.payload.issue.body);
  return issuesMeta.assignees.indexOf(context.payload.sender.login) !== -1;
}

function isReviewerMessage(context: Context): boolean {
  const issuesMeta = parseIssueBody(context.payload.issue.body);
  return issuesMeta.reviewers.indexOf(context.payload.sender.login) !== -1;
}

function isLabelByName(source: string[], target: string[]): boolean {
  if (source.find(s => target.indexOf(s) !== -1)) {
    return true;
  }
  return false;
}
