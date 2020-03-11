import {Application, Context, Octokit} from "probot"; // eslint-disable-line no-unused-vars
import createScheduler from "probot-scheduler";
import moment from "moment";
import fileDB from "./db";

import {
    WEEKLY_PROJECT_COLUMN_TODO,
    PROJECT_COLUMN_IN_PROGRESS, PROJECT_COLUMN_IN_REVIEW, PROJECT_COLUMN_DONW,
    ListCard, TemplateData, listCardForProject, getListIssueMeta
} from './weekly'

const LABEL_DELAY = "bot:delay";

export default function (app) {
    createScheduler(app, {
        interval: 20 * 1000 // 20s
    })

    app.on("schedule.repository", async (context: Context) => {
        // this event is triggered on an interval, which is 1 hr by default

        await handleDelayTasks(context)
    })
}

async function handleDelayTasks(context: Context) {
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

        await addDelayInTasks(context, listCards)
    }

}

async function addDelayInTasks(context: Context, listCards: ListCard[]) {
    console.log('handleCardsDelay')

    const localTimestamp = moment().unix()

    const templateData: TemplateData = {
        progress: [],
        review: [],
        done: [],
        delay: []
    }

    for (const cards of listCards) {
        switch (cards.cardType) {
            case PROJECT_COLUMN_IN_PROGRESS:
                const listProgressIssueMeta = await getListIssueMeta(
                    context,
                    cards.list
                );
                templateData.progress = listProgressIssueMeta;
                break;

            case PROJECT_COLUMN_IN_REVIEW:
                const listReviewIssueMeta = await getListIssueMeta(context, cards.list);
                templateData.review = listReviewIssueMeta;
                break;
        }
    }


    console.log("localTime:" + moment())

    // notify reviewers for in-review task
    for (const task of templateData.review) {
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
    const notReadyTask = templateData.progress.concat(templateData.review);
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
