import {Application, Context, Octokit} from "probot"; // eslint-disable-line no-unused-vars
import createScheduler from "probot-scheduler";
import moment from "moment";
import fileDB from "./db";

import {
    WEEKLY_PROJECT_COLUMN_TODO,
    PROJECT_COLUMN_IN_PROGRESS, PROJECT_COLUMN_IN_REVIEW, PROJECT_COLUMN_DONW,
    ListCard, listCardForProject, getListIssueMeta, IssueMeta
} from './weekly'

import sendToTelegram from './notification'
import {LatestWeekly} from "./types";

const LABEL_DELAY = "bot:delay";
const LABEL_DAILY_REPORT = "bot:delay";

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

        let allTasks: AllTasks = {
            progress: [],
            review: [],
            done: [],
            delay: [],
            daily: [],
        }

        await handleDelayTasks(context, allTasks)

        await dailyReport(context, allTasks)
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

    if (!validIssue(latestDailyIssue)) {
        const yesterday = moment().add(-1, 'days')
        const title = `[Daily-Report] ${yesterday.format("YYY-MM-DD")}`
        daily_issue_number = findTask(title, allTasks)

        // TODO create daily issue
        // const {data: issueRes} = await context.github.issues.create(
        //     context.issue({
        //         body: '',
        //         labels: ["k:daily-report"],
        //         title: ''
        //     })
        // );
    }
    //
    // const {data: issue} = await context.github.issues.get(
    //     context.issue({
    //         issue_number: daily_issue_number
    //     })
    // );

    console.log('daily report issue: ')

    // daily report update
    // const body = await getDailyReportText(context)
    //
    // await context.github.issues.update({
    //     issue_number: latestDailyIssue.number,
    //     body: body,
    //     owner: context.payload.repository.owner.login,
    //     repo: context.payload.repository.name
    // })

    // notification to telegram channel
    const text = `Daily Report: issue_number #`
    sendToTelegram(text)
}

function validIssue(latestDailyIssue: LatestWeekly) {
    // TODO check null, check issue date

    const yesterday = moment().add(-1, 'days')
    const title = `[Daily-Report] ${yesterday.format("YYY-MM-DD")}`

    return false;
}

async function getDailyReportText(context: Context): Promise<string> {
    return "test daily report"
}

function findTask(title: string, allTasks: AllTasks): number {
    for (const task of allTasks.daily) {
        if (task.title == title) {
            return task.number
        }
    }
    return -1
}
