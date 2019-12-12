import { Application, Context } from "probot"; // eslint-disable-line no-unused-vars

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
  app.on("issues.opened", async context => {
    const body = context.payload.issue.body;
    if (!isTaskIssue(body)) {
      return;
    }
    const issueMeta = parseIssueBody(body);

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
      title: context.payload.issue.title.startsWith(`[${issueMeta.kind}]`)
        ? context.payload.issue.title
        : `[${issueMeta.kind}]` + context.payload.issue.title,
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
              "Nice Boat! When you start a task, please comment /PATL call reviewers."
          })
        );
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

      await context.github.issues.removeAssignees(
        context.issue({ assignees: [context.payload.sender.login] })
      );

      const { data: issue } = await context.github.issues.get(context.issue());
      if (issue.assignees.length === 0) {
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
          await context.github.issues.update({
            ...params,
            state: "closed"
          });
        }
      }
    } else if (comment.startsWith("/abort")) {
      if (!isOwnerMessage(context)) {
        return;
      }
      const params = {
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        issue_number: context.payload.issue.number
      };
      await context.github.issues.update({
        ...params,
        state: "closed"
      });
    }
  });

  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
};

function parseIssueBody(body: string): IssueMeta {
  let list = body.split("\r\n");
  let newline_index = list.indexOf("");

  let issue_meta = list.splice(0, newline_index);

  const meta: IssueMeta = {
    kind: "",
    point: 0,
    assignees: [],
    reviewers: [],
    milestone: ""
  };

  issue_meta.forEach(item => {
    let sub_items = item.trim().split(" ");
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
      default:
        console.log("not match", sub_items[0]);
    }
  });

  return meta;
}

async function issueMoveColumn(
  context: Context,
  projectName: string,
  columnName: string
): Promise<boolean> {
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
  if (columnName === PROJECT_COLUMN_TODO) {
    await context.github.projects.createCard({
      column_id: columnID,
      content_id: context.payload.issue.id,
      content_type: "Issue"
    });

    return true;
  }

  let lastColumn = 0;
  if (columnName === PROJECT_COLUMN_IN_PROGRESS) {
    lastColumn = findColumnID(listColumn, PROJECT_COLUMN_TODO);
  } else if (columnName === PROJECT_COLUMN_IN_REVIEW) {
    lastColumn = findColumnID(listColumn, PROJECT_COLUMN_IN_PROGRESS);
  } else if (columnName === PROJECT_COLUMN_DONW) {
    lastColumn = findColumnID(listColumn, PROJECT_COLUMN_IN_REVIEW);
  }
  const { data: listCards } = await context.github.projects.listCards({
    column_id: lastColumn
  });

  const card = listCards.find(c => c.content_url === context.payload.issue.url);
  if (card) {
    await context.github.projects.moveCard({
      card_id: card.id,
      column_id: columnID,
      position: "bottom"
    });

    return true;
  } else {
    await context.github.issues.createComment(
      context.issue({
        body: `Not found issue ${context.payload.issue.url}, move fail`
      })
    );
  }

  return false;
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
