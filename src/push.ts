import { exec } from "child_process";
import queue from 'async/queue';
const yaml = require('js-yaml');
const fs   = require('fs');
const _ = require('lodash');
const { promisify } = require("util");
const execAsync = promisify(exec);

let configs = [];
const ci_config_path = process.env.CI_CONFIG;
try {
    configs = yaml.safeLoad(fs.readFileSync(ci_config_path));
} catch(err) {
    console.log(JSON.stringify({name: 'parse_ci_config_failed', ci_config_path, err}));
}

const tasks_queue = Object();
for(let i in configs) {
    const name = configs[i]['name'];
    tasks_queue[name] = queue(async function(task, callback) {
        try {
            const result = await execAsync(task.cmd);
            console.log(JSON.stringify({name: 'run_ci_task_success', task, result}));
        } catch (err) {
            console.log(JSON.stringify({name: 'run_ci_task_failed', task, err}));
        }
        callback();
    }, 1);
}

function checkAndRun(payload, config) {
    // check filters
    const match_filters = Object.entries(config.filters).map( filter => _.get(payload, filter[0]) === filter[1]).every(item => item === true);
    if (!match_filters) {
        return;
    }
    // run cmd
    // WARN: Use template literal in js to format cmd is powful but dangerous.
    //       Be carefule when you use it.
    const escaped_cmd = _.replace(config.cmd, new RegExp('\`', 'g'), '\\\`');
    const cmd = eval('`' + escaped_cmd + '`');
    console.log(JSON.stringify({name: 'put_cmd_to_queue', cmd}));
    tasks_queue[config['name']].push({cmd, name: config.name});
}

export function pushHandler(payload) {
    configs.map(config => {
        checkAndRun(payload, config);
    })
}
