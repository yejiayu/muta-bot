import { Application, Context } from "probot"; // eslint-disable-line no-unused-vars
const createScheduler = require("probot-scheduler");

export default function(app) {
  createScheduler(app, {
    interval: 1000 * 10
  });
  app.on("schedule.repository", async (context: Context) => {
    // this event is triggered on an interval, which is 1 hr by default
    console.log("create issues");
    if (context.payload.repository.name === "muta-bot") {
      console.log(context);
      await context.github.issues.create(
        context.repo({
          title: "test-weekly"
        })
      );
    }

    // console.log(context);
  });
}
