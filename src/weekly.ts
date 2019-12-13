import { Application, Context, Octokit } from "probot"; // eslint-disable-line no-unused-vars
const createScheduler = require("probot-scheduler");

const PROJECT_COLUMN_TODO = "To do";
const PROJECT_COLUMN_IN_PROGRESS = "In progress";
const PROJECT_COLUMN_IN_REVIEW = "In review";
const PROJECT_COLUMN_DONW = "Done";

interface ListCard {
  cardType: string;
  list: Octokit.ProjectsListCardsResponseItem[];
}

// const CURRENT_REPO = proce;
export default function(app) {
  createScheduler(app, {
    interval: 1000 * 10
  });
  app.on("schedule.repository", async (context: Context) => {
    // this event is triggered on an interval, which is 1 hr by default
    console.log("create issues");
    if (context.payload.repository.name !== "muta-bot") {
      return;
    }

    const projectID = await getLatestProjectID(context);

    const listCards = await listCardForProject(context, projectID);
    console.log(listCards);
    // await context.github.issues.create(
    //   context.repo({
    //     title: "test-weekly"
    //   })

    // console.log(context);
  });
}

async function getLatestProjectID(context: Context): Promise<number> {
  const {
    data: listMilestone
  } = await context.github.issues.listMilestonesForRepo(context.issue());
  const milestone = listMilestone[listMilestone.length - 1];

  const { data: projects } = await context.github.projects.listForRepo(
    context.issue()
  );

  const project = projects.find(p => p.name === milestone.title);
  if (!project) {
    throw new Error(`Not found project ${milestone.title}`);
  }
  return project.id;
}

async function listCardForProject(
  context: Context,
  id: number
): Promise<ListCard[]> {
  const { data: listColumn } = await context.github.projects.listColumns({
    project_id: id
  });

  const promiseAll = [
    PROJECT_COLUMN_TODO,
    PROJECT_COLUMN_IN_PROGRESS,
    PROJECT_COLUMN_IN_REVIEW,
    PROJECT_COLUMN_DONW
  ]
    .map(name => {
      return { column_id: findColumnID(listColumn, name), name };
    })
    .map(async ({ column_id, name }) => {
      const { data: listCards } = await context.github.projects.listCards({
        column_id,
        archived_state: "not_archived"
      });

      return { cardType: name, list: listCards };
    });

  return Promise.all(promiseAll);
}

function findColumnID(listColumn: any[], columnName: string): number {
  const column = listColumn.find(column => column.name === columnName);
  return column.id;
}
