import * as colors from "colors";
import * as readline from "readline";
import {
  LogFilter,
  WorkerLogLevel,
  WorkerLogLevelEnum,
  WorkerMessage,
  WorkerOutput,
  WorkerProgress,
  WorkerInput
} from "..";
import { ConsoleLogger } from "../loggers/console";
import * as util from "util";

export class Terminal {
  tty: boolean;
  wo: WorkerOutput;
  height: number;
  history: string[] = [];
  level: WorkerLogLevel;
  hasProgress: boolean;
  progresses: { [key: string]: WorkerProgress } = {};
  title: string = "";
  format: string;
  inputs: WorkerInput[] = [];
  inputValue: string = "";
  rl: readline.Interface;
  reset: boolean = false;
  inputValid: boolean = true;

  constructor(
    wo: WorkerOutput,
    level: WorkerLogLevel = undefined,
    format: string = undefined,
    tty: boolean = process.stdout.isTTY
  ) {
    this.wo = wo;
    this.tty = tty;
    this.format = format;
    this.level = level ? level : <any>process.env.LOG_LEVEL || "INFO";
    // Fallback on basic ConsoleLogger if no tty
    if (!this.tty) {
      this.wo.on("message", async msg => {
        if (msg.type === "log" && LogFilter(msg.log.level, this.level)) {
          ConsoleLogger.handleMessage(msg, this.level, this.format);
        }
      });
      return;
    }
    this.wo.setInteractive(true);
    this.wo.on("message", async msg => this.router(msg));
    this.height = process.stdout.rows;

    // Reset term
    process.stdout.write("\x1B[?12l\x1B[?47h");

    // Ensure we restore terminal on quit
    let resetTerm = (...args) => {
      if (this.reset) {
        return;
      }
      this.reset = true;
      process.stdout.write("\x1B[?47l");
      process.stdout.write(this.displayHistory(this.height, false));
    };
    process.on("exit", resetTerm);
    process.on("SIGTERM", () => {
      resetTerm();
      process.exit(0);
    });
    process.on("SIGINT", () => {
      resetTerm();
      process.exit(0);
    });

    // Update on terminal resize
    process.stdout.on("resize", size => {
      this.height = process.stdout.rows;
      if (this.hasProgress) {
        this.displayScreen();
      }
    });

    // Manage input
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.setRawMode(true);
    process.stdin.on("data", data => {
      if (data.charCodeAt(0) === 3) {
        resetTerm();
        process.exit(0);
      } else if (data.charCodeAt(0) === 127) {
        if (this.inputValue.length) {
          this.inputValue = this.inputValue.substr(0, this.inputValue.length - 1);
        }
      } else if (data.charCodeAt(0) === 13) {
        // validate input
        this.wo.returnInput(this.inputs[0].uuid, this.inputValue);
        this.inputValue = "";
        this.inputs.shift();
      } else {
        this.inputValue += data;
      }
      this.displayScreen();
    });
  }

  pushHistory(line) {
    this.history.push(line);
    if (this.history.length > 100) {
      this.history.shift();
    }
  }

  async router(msg: WorkerMessage) {
    switch (msg.type) {
      case "log":
        return this.log(msg.groups, msg.log.level, ...msg.log.args);
      case "progress.stop":
      case "progress.start":
        this.hasProgress = Object.keys(msg.progresses)
          .map(i => msg.progresses[i].running)
          .reduce((prev, cur) => cur || prev, false);
      case "progress.update":
        this.progresses = msg.progresses;
        this.displayScreen();
        break;
      case "title.set":
        this.handleTitleMessage(msg);
        break;
      case "input.request":
        this.inputs.push(msg.input);
        this.displayScreen();
        break;
      case "input.received":
        this.inputs = this.inputs.filter(m => msg.input.uuid !== m.uuid);
        this.displayScreen();
        break;
    }
  }

  handleTitleMessage(msg: WorkerMessage) {
    this.title = msg.title;
    this.log(msg.groups, "INFO", [msg.title || ""]);
    this.displayScreen();
  }

  log(groups, level: WorkerLogLevel, ...args) {
    if (!LogFilter(level, this.level)) {
      return;
    }
    let color = ConsoleLogger.getColor(<any>WorkerLogLevelEnum[level]);
    let levelColor = level.padStart(5);
    let groupsPart = "";
    if (groups.length) {
      groupsPart = `[${groups.map(g => `${color(g)}`).join(colors.grey(">"))}] `;
    }
    let line = `[${color(levelColor)}] ${groupsPart}${color(
      args.map(a => (typeof a === "object" ? util.inspect(a) : a.toString())).join(" ")
    )}`;
    this.pushHistory(line);
    this.displayScreen();
  }

  getFooterSize() {
    let size = Object.keys(this.progresses).length + 1 + this.title ? 1 : 0;
    if (this.inputs.length) {
      size += 1;
    }
    if (size) {
      size++;
    }
    return size;
  }

  displayString(str, limit: number = undefined) {
    if (!limit) {
      limit = process.stdout.columns;
    }
    if (str.length > limit) {
      return str.substr(0, limit - 3) + "...";
    }
    // Strip colors for our calculation
    limit += str.length - str.replace(/(\u001b\[[\d;]+m)/gm, "").length;
    return str.padEnd(limit);
  }

  displayBar(ratio, barlen) {
    let barFill = Math.floor(ratio * barlen);
    let barEmpty = Math.floor((1 - ratio) * barlen);
    if (barFill + barEmpty >= barlen) {
      if (barFill) {
        barFill--;
      } else {
        barEmpty--;
      }
    }
    return `[${colors.green("=".repeat(barFill))}${colors.grey("-".repeat(barEmpty))}]`;
  }

  displayTitle() {
    let pads = (process.stdout.columns - this.title.length - 4) / 2;
    if (pads < 0) {
      pads = 0;
    }
    return `${" ".repeat(pads)}${colors.bold(this.title)}${" ".repeat(pads)}\n`;
  }

  displayProgress(p: WorkerProgress) {
    let bar = this.displayBar(p.getRatio(), 40);
    // @ts-ignore
    let percent = Number(p.getRatio() * 100)
      .toFixed(2)
      .padStart(5);
    let numberLength = p.total.toString().length;
    let line = this.displayString(
      `${bar} ${Math.floor(p.current)
        .toString()
        .padStart(numberLength)}/${p.total} ${p.title || ""}`.padEnd(process.stdout.columns - 2)
    );
    if (line.length > process.stdout.columns - 2) {
      line = line.substr(0, process.stdout.columns - 2);
    }
    return `${line}`;
  }

  displayFooter() {
    // Separator

    let res = "\u2015".repeat(process.stdout.columns) + "\n";
    let values = Object.values(this.progresses);
    let k = values.length;
    if (this.title) {
      res += this.displayTitle();
    }
    if (this.inputs.length) {
      k++;
    }
    for (let i in this.progresses) {
      res += this.displayProgress(this.progresses[i]);
      if (--k > 0) {
        res += `\r`;
      }
    }
    return res;
  }

  displayHistory(lines: number, complete: boolean = true) {
    let res = "";
    let j = this.history.length - lines;
    if (!complete && j < 0) {
      j = 0;
    }
    while (j < 0) {
      res += " ".repeat(process.stdout.columns) + "\n";
      j++;
    }
    for (; j < this.history.length; j++) {
      let line = this.displayString(this.history[j].padEnd(process.stdout.columns));
      res += `${line}\n`;
    }
    return res;
  }

  async displayScreen() {
    // Reset terminal
    let screen = ""; //"\x1Bc";
    let footer = this.getFooterSize();
    // Calculate where to start
    let start = this.height - this.history.length + footer;
    if (start < 0) {
      start = 0;
    }
    //readline.cursorTo(process.stdout, 0, start);
    screen += this.displayHistory(this.height - this.getFooterSize());

    // Display footer
    if (this.hasProgress || this.title) {
      screen += this.displayFooter();
    }
    this.clearScreen();
    process.stdout.write(screen);
    // Display input
    if (this.inputs.length) {
      process.stdout.write(colors.bold(this.inputs[0].title + ": ") + this.inputValue);
    }
  }

  clearScreen() {
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
  }
}
