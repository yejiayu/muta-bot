import {Application, Context, Octokit} from "probot"; // eslint-disable-line no-unused-vars
import createScheduler from "probot-scheduler";
import moment from "moment";
import fileDB from "./db";

import {
    WEEKLY_PROJECT_COLUMN_TODO,
    PROJECT_COLUMN_IN_PROGRESS, PROJECT_COLUMN_IN_REVIEW, PROJECT_COLUMN_DONW,
    ListCard, listCardForProject, getListIssueMeta, IssueMeta, findColumnID
} from './weekly'

import sendToTelegram from './notification'

const LABEL_DELAY = "bot:delay";
const LABEL_DAILY_REPORT = "bot:delay";


const DAILY_PROJECT = "Daily-reports";
const DAILY_PROJECT_COLUMN = "Daily report"


export interface AllTasks {
    progress: IssueMeta[];
    review: IssueMeta[];
    done: IssueMeta[];
    delay: IssueMeta[];
    daily: IssueMeta[];
}

export default function (app) {
    createScheduler(app, {
        interval: 20 * 1000 // 20s
    })

    app.on("schedule.repository", async (context: Context) => {
        // this event is triggered on an interval, which is 1 hr by default

        //ToDo check time valid

        let allTasks: AllTasks = {
            progress: [],
            review: [],
            done: [],
            delay: [],
            daily: [],
        }

        await handleDelayTasks(context, allTasks)

        await dailyReport(context, allTasks)

        await createNextDailyIssue(context, allTasks)
    })
}

async function handleDelayTasks(context: Context, allTasks: AllTasks) {
    console.log('handleDelayTasks')

    const {data: projects} = await context.github.projects.listForRepo(
        context.issue()
    );

    for (const project of projects) {

        console.log(project.id, project.state, project.name)
        const id = project.id
        console.log(id)
        if (project.state in [WEEKLY_PROJECT_COLUMN_TODO, PROJECT_COLUMN_DONW]) {
            continue
        }

        const listCards = await listCardForProject(context, id);

        await addDelayLabelForTasks(context, listCards, allTasks)
    }

}

async function addDelayLabelForTasks(context: Context, listCards: ListCard[], allTasks: AllTasks) {
    console.log('handleCardsDelay')

    const localTimestamp = moment().unix()


    for (const cards of listCards) {
        switch (cards.cardType) {
            case PROJECT_COLUMN_IN_PROGRESS:
                const listProgressIssueMeta = await getListIssueMeta(
                    context,
                    cards.list
                );
                allTasks.progress = listProgressIssueMeta;
                break;

            case PROJECT_COLUMN_IN_REVIEW:
                const listReviewIssueMeta = await getListIssueMeta(context, cards.list);
                allTasks.review = listReviewIssueMeta;
                break;
        }
    }


    console.log("localTime:" + moment())

    // notify reviewers for in-review task
    for (const task of allTasks.review) {
        const assigneeString = task.assignees
            .map(s => {
                return `@${s}`;
            })
            .join("  ");

        const liveReviewers = fileDB.getIssueReviewers(task.id);

        const liveReviewerString = liveReviewers
            .map(s => {
                return `- @${s}`;
            })
            .join("\r\n");

        await context.github.issues.createComment(
            context.issue({
                issue_number: task.number,
                body: `${assigneeString} \r\n\r\n Waiting For Reviewers:\r\n${liveReviewerString}`
            })
        );
    }

    // add delay label for delay tasks
    const notReadyTask = allTasks.progress.concat(allTasks.review);
    const delayTasks = notReadyTask.filter(task => {
        let startAt = moment(fileDB.getIssueStartAt(task.id));

        console.log(task.number, task.id, task.title, startAt)

        for (let i = 0; i < task.point; i++) {
            startAt = startAt.add(1, "days");
            if (startAt.format("E") === "6" || startAt.format("E") === "7") {
                i--;
            }
        }
        const deadline = startAt;
        return deadline.unix() < localTimestamp;
    });

    for (const task of delayTasks) {
        const {data: issue} = await context.github.issues.get(
            context.issue({
                issue_number: task.number
            })
        );

        const labels = issue.labels.map(l => l.name)
        if (LABEL_DELAY in labels) {
            continue
        }
        labels.push(LABEL_DELAY)
        await context.github.issues.update(
            context.issue({
                issue_number: task.number,
                labels: labels
            })
        );
    }

}

async function dailyReport(context: Context, allTasks: AllTasks) {
    console.log('dailyReport')

    const latestDailyIssue = fileDB.getLatestDailyIssue()
    let daily_issue_number = -1

    const yesterday = moment().add(-1, 'days')
    const title = `[Daily-Report] ${yesterday.format("YYY-MM-DD")}`

    if (!latestDailyIssue) {
        daily_issue_number = findDailyTask(title, allTasks)
    }

    if (daily_issue_number < 0) {
        throw new Error(`Not found daily report issue ${title}`);
    }

    const {data: issue} = await context.github.issues.get(
        context.issue({
            issue_number: daily_issue_number
        })
    );

    if (issue.title != title) {
        throw new Error(`Not found daily report issue ${title}`);
    }

    console.log('get daily report issue: ' , issue.title, issue.number, issue.labels)
    const body = await getDailyReportText(context)

    await context.github.issues.update({
        issue_number: latestDailyIssue.number,
        body: body,
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name
    })

    // notification to telegram channel
    const text = `${title}\r\n${issue.url}`
    sendToTelegram(text)
}


async function getDailyReportText(context: Context): Promise<string> {
    return "test daily report"
}

function findDailyTask(title: string, allTasks: AllTasks): number {
    for (const task of allTasks.daily) {
        if (task.title == title) {
            return task.number
        }
    }
    return -1
}

async function createNextDailyIssue(context: Context, allTasks: AllTasks) {
    const today = moment()
    const title = `[Daily-Report] ${today.format("YYY-MM-DD")}`
    const issuer_number = findDailyTask(title, allTasks)
    if (issuer_number > -1) {

    }

    const {data: issueRes} = await context.github.issues.create(
        context.issue({
            body: `**Done**:\r\n**Todo**:\r\n**Problem**:`,
            labels: [LABEL_DAILY_REPORT],
            title: title
        })
    );

    await moveToDailyProject(context, issueRes.id)
    fileDB.saveLatestDailyIssue(
        issueRes.id,
        issueRes.number,
        issueRes.node_id,
        -1,
    )
}

async function getDailyProject(context: Context) {
    const {data: projects} = await context.github.projects.listForRepo(
        context.issue()
    );

    const dailyProject = projects.find(p => p.name === DAILY_PROJECT);
    if (!dailyProject) {
        throw new Error(`Not found ${DAILY_PROJECT}`);
    }
    return dailyProject.id;
}

async function moveToDailyProject(context: Context, id: number) {
    const projectID = await getDailyProject(context);
    const {data: listColumn} = await context.github.projects.listColumns({
        project_id: projectID
    });

    const columnID = findColumnID(listColumn, DAILY_PROJECT_COLUMN);
    await context.github.projects.createCard({
        column_id: columnID,
        content_id: id,
        content_type: "Issue"
    });
}
