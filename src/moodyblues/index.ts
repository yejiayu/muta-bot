import { Application } from "probot";
import shell from "shelljs";

export function moodyblues(app: Application) {
  app.on("push", async context => {
    const url = context.payload.repository.url;
    const ref = context.payload.ref;
    const cmd = `
    cd /home/muta/overlord-tracing
    git checkout gh-pages
    git fetch origin
    git pull origin gh-pages
    `;

    if (
      url === "https://github.com/homura/MoodyBlues" &&
      ref === "refs/heads/gh-pages"
    ) {
      shell.exec(cmd);
    }
  });
}
